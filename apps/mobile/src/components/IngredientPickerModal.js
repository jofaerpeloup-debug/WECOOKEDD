import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import Button from './Button';
import { searchIngredients } from '../api/ingredientService';
import { getIngredientErrorMessage } from '../api/ingredientErrors';
import { RECIPE_UNITS, unitLabel } from '../api/recipeOptions';

// Manual "Add Item" to the Shopping List, using ONLY canonical backend
// ingredients (GET /api/v1/ingredients) + the existing add-item contract.
// This component never calls the shopping-list service itself: it hands a
// { ingredientId, unit, quantity } payload to `onAdd` (wired to
// ShoppingListContext.addItem -> runMutation), so every manual add inherits the
// provider's global mutation lock, session guard and pessimistic full-list
// replacement. There is no free-text item and no local/optimistic merge.

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_LIMIT = 20;
const TO_TASTE = 'toTaste';

// Number-with-optional-decimal only. Returns a finite JS number > 0, or null.
// The backend does NOT coerce strings, so the raw TextInput value must never
// reach it.
function parseQuantity(raw) {
  const n = Number(String(raw == null ? '' : raw).trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default function IngredientPickerModal({ visible, onClose, onAdd }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);

  const [selected, setSelected] = useState(null); // { id, name, category, aliases } | null
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState(null); // one of RECIPE_UNITS | null

  const [formError, setFormError] = useState(null); // client-side validation
  const [submitError, setSubmitError] = useState(null); // from the provider result
  const [submitting, setSubmitting] = useState(false);

  const mountedRef = useRef(true);
  const searchGenRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Fresh state on every open. Bumping the search generation abandons any
  // response still in flight from a previous session of the modal.
  useEffect(() => {
    if (!visible) return;
    searchGenRef.current += 1;
    setQuery('');
    setResults([]);
    setTruncated(false);
    setSearchLoading(false);
    setSearchError(null);
    setSelected(null);
    setQty('');
    setUnit(null);
    setFormError(null);
    setSubmitError(null);
    setSubmitting(false);
  }, [visible]);

  const trimmed = query.trim();

  // Debounced canonical ingredient search with a monotonic generation guard so
  // a slower earlier response can never replace the results of a newer query
  // (or land after the modal has closed).
  useEffect(() => {
    if (!visible || !trimmed) {
      searchGenRef.current += 1;
      setResults([]);
      setTruncated(false);
      setSearchError(null);
      setSearchLoading(false);
      return undefined;
    }

    setSearchLoading(true);
    setSearchError(null);

    const timer = setTimeout(async () => {
      const gen = ++searchGenRef.current;
      try {
        const { ingredients, pagination } = await searchIngredients({
          search: trimmed,
          limit: SEARCH_LIMIT,
        });
        if (!mountedRef.current || gen !== searchGenRef.current) return;
        setResults(ingredients);
        setTruncated(!!pagination && pagination.total > ingredients.length);
      } catch (err) {
        if (!mountedRef.current || gen !== searchGenRef.current) return;
        setResults([]);
        setTruncated(false);
        setSearchError(getIngredientErrorMessage(err));
      } finally {
        if (mountedRef.current && gen === searchGenRef.current) setSearchLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [visible, trimmed]);

  const pickIngredient = useCallback((ingredient) => {
    setSelected(ingredient);
    setFormError(null);
    setSubmitError(null);
  }, []);

  const clearSelection = useCallback(() => {
    setSelected(null);
    setUnit(null);
    setQty('');
    setFormError(null);
    setSubmitError(null);
  }, []);

  const pickUnit = useCallback((value) => {
    setUnit(value);
    setFormError(null);
    setSubmitError(null);
    if (value === TO_TASTE) setQty('');
  }, []);

  const measurable = unit !== null && unit !== TO_TASTE;
  const quantityOk = unit === TO_TASTE || parseQuantity(qty) != null;
  const canSubmit = !!selected && !!unit && quantityOk && !submitting;

  const submit = useCallback(async () => {
    if (submitting) return;
    if (!selected) {
      setFormError('Choose an ingredient first.');
      return;
    }
    if (!unit) {
      setFormError('Choose a unit.');
      return;
    }

    let quantity;
    if (unit === TO_TASTE) {
      quantity = undefined;
    } else {
      const parsed = parseQuantity(qty);
      if (parsed == null) {
        setFormError('Enter a quantity greater than zero.');
        return;
      }
      quantity = parsed;
    }

    setFormError(null);
    setSubmitError(null);
    setSubmitting(true);

    let result;
    try {
      result = await onAdd({ ingredientId: selected.id, unit, quantity });
    } catch (err) {
      result = { ok: false, error: 'Couldn’t add that item. Please try again.' };
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }

    if (!mountedRef.current) return;

    if (result && result.ok) {
      onClose();
      return;
    }
    if (result && result.superseded) {
      // Auth identity changed mid-request — the provider already discarded it.
      onClose();
      return;
    }
    if (result && result.busy) {
      // Another shopping-list mutation holds the lock. Keep the modal open and
      // do NOT retry automatically — the user can tap Add again shortly.
      setSubmitError('Another change is still saving. Try again in a moment.');
      return;
    }
    setSubmitError((result && result.error) || 'Couldn’t add that item. Please try again.');
  }, [submitting, selected, unit, qty, onAdd, onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropFill} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kav}
        >
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.header}>
              <Text style={styles.title} accessibilityRole="header">Add Item</Text>
              <Pressable
                onPress={onClose}
                hitSlop={10}
                style={styles.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="Close add item"
              >
                <Ionicons name="close" size={22} color={colors.inkSoft} />
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.body}
            >
              {/* --- Ingredient search / selection --- */}
              {selected ? (
                <View style={styles.selectedRow}>
                  <View style={styles.selectedTextWrap}>
                    <Text style={styles.selectedLabel}>Ingredient</Text>
                    <Text style={styles.selectedName}>{selected.name}</Text>
                  </View>
                  <Pressable onPress={clearSelection} hitSlop={8} style={styles.changeBtn}>
                    <Text style={styles.changeBtnText}>Change</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  <View style={styles.searchBar}>
                    <Ionicons name="search" size={17} color={colors.inkFaint} />
                    <TextInput
                      style={styles.searchInput}
                      placeholder="Search ingredients..."
                      placeholderTextColor={colors.inkFaint}
                      value={query}
                      onChangeText={setQuery}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="off"
                      returnKeyType="search"
                      autoFocus
                    />
                    {query.length > 0 && (
                      <Pressable onPress={() => setQuery('')} hitSlop={8}>
                        <Ionicons name="close-circle" size={17} color={colors.inkFaint} />
                      </Pressable>
                    )}
                  </View>

                  {trimmed === '' ? (
                    <Text style={styles.hint}>
                      Type an ingredient name to search the WeCooked catalog.
                    </Text>
                  ) : searchLoading && results.length === 0 ? (
                    <View style={styles.centerBlock}>
                      <ActivityIndicator
                        color={colors.sageDeep}
                        accessible
                        accessibilityLabel="Searching ingredients"
                        accessibilityState={{ busy: searchLoading }}
                      />
                    </View>
                  ) : searchError ? (
                    <Text style={styles.errorText}>{searchError}</Text>
                  ) : results.length === 0 ? (
                    <Text style={styles.hint}>No ingredients match “{trimmed}”.</Text>
                  ) : (
                    <View style={styles.results}>
                      {results.map((ing) => (
                        <Pressable
                          key={ing.id}
                          style={({ pressed }) => [
                            styles.resultRow,
                            pressed && styles.resultRowPressed,
                          ]}
                          onPress={() => pickIngredient(ing)}
                          accessibilityRole="button"
                          accessibilityLabel={`Select ${ing.name}`}
                        >
                          <Text style={styles.resultName}>{ing.name}</Text>
                          <Ionicons name="add" size={18} color={colors.sageDeep} />
                        </Pressable>
                      ))}
                      {truncated && (
                        <Text style={styles.hint}>
                          Showing the first {results.length}. Keep typing to narrow it down.
                        </Text>
                      )}
                    </View>
                  )}
                </>
              )}

              {/* --- Quantity + unit (only once an ingredient is chosen) --- */}
              {selected && (
                <>
                  <Text style={styles.fieldLabel}>Unit</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={styles.unitRow}
                  >
                    {RECIPE_UNITS.map((u) => {
                      const active = unit === u;
                      return (
                        <Pressable
                          key={u}
                          onPress={() => pickUnit(u)}
                          style={[styles.unitChip, active && styles.unitChipActive]}
                          accessibilityRole="button"
                          accessibilityLabel={`${unitLabel(u)} unit`}
                          accessibilityState={{ selected: active }}
                        >
                          <Text style={[styles.unitChipText, active && styles.unitChipTextActive]}>
                            {unitLabel(u)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  {measurable && (
                    <>
                      <Text style={styles.fieldLabel}>Quantity</Text>
                      <TextInput
                        style={styles.qtyInput}
                        placeholder="e.g. 200"
                        placeholderTextColor={colors.inkFaint}
                        value={qty}
                        onChangeText={(t) => {
                          setQty(t);
                          setFormError(null);
                          setSubmitError(null);
                        }}
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                      />
                    </>
                  )}

                  {unit === TO_TASTE && (
                    <Text style={styles.hint}>“To taste” items are added without a quantity.</Text>
                  )}
                </>
              )}

              {formError && <Text style={styles.errorText}>{formError}</Text>}
              {submitError && <Text style={styles.errorText}>{submitError}</Text>}
            </ScrollView>

            <View style={styles.footer}>
              <View
                accessible
                accessibilityRole="button"
                accessibilityLabel="Add item to shopping list"
                accessibilityState={{ disabled: !canSubmit, busy: submitting }}
                onAccessibilityTap={submit}
              >
                <Button
                  title="Add to list"
                  onPress={submit}
                  disabled={!canSubmit}
                  loading={submitting}
                />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'flex-end',
    },
    backdropFill: { ...StyleSheet.absoluteFill },
    kav: { width: '100%' },
    sheet: {
      backgroundColor: colors.cream,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      maxHeight: '88%',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    title: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.lg,
      color: colors.ink,
    },
    closeBtn: { padding: spacing.xs },
    body: { paddingBottom: spacing.lg, gap: spacing.sm },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.paper,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.hairline,
      paddingHorizontal: spacing.lg,
      height: 46,
    },
    searchInput: {
      flex: 1,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.ink,
      outlineStyle: 'none',
    },
    hint: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkFaint,
      paddingVertical: spacing.sm,
    },
    errorText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.error,
      paddingVertical: spacing.sm,
    },
    centerBlock: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.xl,
    },
    results: { gap: 2 },
    resultRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    resultRowPressed: { opacity: 0.6 },
    resultName: {
      flex: 1,
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.base,
      color: colors.ink,
    },
    selectedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.sagePale,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    selectedTextWrap: { flex: 1 },
    selectedLabel: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.xs,
      color: colors.inkSoft,
      marginBottom: 2,
    },
    selectedName: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.md,
      color: colors.ink,
    },
    changeBtn: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
    changeBtnText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.sageDeep,
    },
    fieldLabel: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    unitRow: { gap: spacing.sm, paddingVertical: spacing.xs, paddingRight: spacing.md },
    unitChip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.hairline,
      backgroundColor: colors.paper,
    },
    unitChipActive: { backgroundColor: colors.sageDeep, borderColor: colors.sageDeep },
    unitChipText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
    },
    unitChipTextActive: { color: colors.onAccent },
    qtyInput: {
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.hairline,
      paddingHorizontal: spacing.md,
      height: 46,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.ink,
      outlineStyle: 'none',
    },
    footer: {
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.hairline,
    },
  });
}
