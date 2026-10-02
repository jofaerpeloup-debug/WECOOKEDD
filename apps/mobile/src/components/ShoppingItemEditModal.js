import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { INGREDIENT_CATEGORY_LABELS } from '@wecooked/contracts';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { RECIPE_UNITS, unitLabel } from '../api/recipeOptions';
import Button from './Button';

const TO_TASTE = 'toTaste';

function parseQuantity(raw) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export default function ShoppingItemEditModal({ visible, item, onClose, onSave }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const [unit, setUnit] = useState(null);
  const [quantity, setQuantity] = useState('');
  const [formError, setFormError] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const mountedRef = useRef(true);
  const submitLockRef = useRef(false);
  const modalSessionRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      modalSessionRef.current += 1;
    };
  }, []);

  useEffect(() => {
    modalSessionRef.current += 1;
    submitLockRef.current = false;
    setSubmitting(false);
    setFormError(null);
    setSubmitError(null);
    if (!visible || !item) {
      setUnit(null);
      setQuantity('');
      return;
    }
    setUnit(item.unit);
    setQuantity(item.unit === TO_TASTE || item.quantity == null ? '' : String(item.quantity));
  }, [visible, item?.id]);

  const dismiss = useCallback(() => {
    if (submitLockRef.current) return;
    onClose();
  }, [onClose]);

  const pickUnit = useCallback((value) => {
    setUnit((previous) => {
      if (value === TO_TASTE || previous === TO_TASTE) setQuantity('');
      return value;
    });
    setFormError(null);
    setSubmitError(null);
  }, []);

  const submit = useCallback(async () => {
    if (submitLockRef.current || !item) return;

    let parsedQuantity = null;
    if (unit !== TO_TASTE) {
      parsedQuantity = parseQuantity(quantity);
      if (parsedQuantity == null) {
        setFormError('Enter a quantity greater than zero.');
        return;
      }
    }

    const session = modalSessionRef.current;
    submitLockRef.current = true;
    setSubmitting(true);
    setFormError(null);
    setSubmitError(null);

    let result;
    try {
      result = await onSave(item.id, { quantity: parsedQuantity, unit });
    } catch (_err) {
      result = { ok: false, error: 'Couldn\u2019t update that item. Please try again.' };
    }

    if (!mountedRef.current || session !== modalSessionRef.current) return;
    submitLockRef.current = false;
    setSubmitting(false);

    if (result && result.ok) {
      onClose();
      return;
    }
    if (result && result.superseded) return;
    if (result && result.busy) {
      setSubmitError('Another change is still saving. Try again in a moment.');
      return;
    }
    setSubmitError((result && result.error) || 'Couldn\u2019t update that item. Please try again.');
  }, [item, unit, quantity, onSave, onClose]);

  if (!item) return null;

  const measurable = unit !== TO_TASTE;
  const quantityValid = !measurable || parseQuantity(quantity) != null;
  const canSubmit = !!unit && quantityValid && !submitting;
  const category = INGREDIENT_CATEGORY_LABELS[item.category] || 'Category unavailable';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={dismiss}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable
          style={styles.backdropFill}
          onPress={dismiss}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Close item editor"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kav}
        >
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.header}>
              <Text style={styles.title} accessibilityRole="header">Edit Shopping Item</Text>
              <Pressable
                onPress={dismiss}
                disabled={submitting}
                hitSlop={10}
                style={styles.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="Close item editor"
                accessibilityState={{ disabled: submitting }}
              >
                <Ionicons name="close" size={22} color={colors.inkSoft} />
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.body}
            >
              <View style={styles.identityCard}>
                <Text style={styles.identityLabel}>Ingredient</Text>
                <Text style={styles.ingredientName}>{item.ingredient.name}</Text>
                <Text style={styles.categoryLabel}>Category: {category}</Text>
              </View>

              <Text style={styles.fieldLabel}>Unit</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.unitRow}
              >
                {RECIPE_UNITS.map((value) => {
                  const active = unit === value;
                  return (
                    <Pressable
                      key={value}
                      onPress={() => pickUnit(value)}
                      disabled={submitting}
                      style={[styles.unitChip, active && styles.unitChipActive]}
                      accessibilityRole="button"
                      accessibilityLabel={`${unitLabel(value)} unit`}
                      accessibilityState={{ selected: active, disabled: submitting }}
                    >
                      <Text style={[styles.unitChipText, active && styles.unitChipTextActive]}>
                        {unitLabel(value)}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {measurable ? (
                <>
                  <Text style={styles.fieldLabel}>Quantity</Text>
                  <TextInput
                    style={styles.quantityInput}
                    accessibilityLabel="Quantity"
                    placeholder="e.g. 2.5"
                    placeholderTextColor={colors.inkFaint}
                    value={quantity}
                    onChangeText={(value) => {
                      setQuantity(value);
                      setFormError(null);
                      setSubmitError(null);
                    }}
                    editable={!submitting}
                    keyboardType="decimal-pad"
                    returnKeyType="done"
                  />
                </>
              ) : (
                <Text style={styles.hint}>\u201cTo taste\u201d items do not have a quantity.</Text>
              )}

              {formError ? <Text style={styles.errorText}>{formError}</Text> : null}
              {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}
            </ScrollView>

            <View style={styles.footer}>
              <Pressable
                style={styles.cancelButton}
                onPress={dismiss}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel="Cancel editing item"
                accessibilityState={{ disabled: submitting }}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <View
                style={styles.saveWrap}
                accessible
                accessibilityRole="button"
                accessibilityLabel="Save item changes"
                accessibilityState={{ disabled: !canSubmit, busy: submitting }}
                onAccessibilityTap={submit}
              >
                <Button
                  title="Save"
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
    backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
    backdropFill: { ...StyleSheet.absoluteFillObject },
    kav: { width: '100%' },
    sheet: {
      maxHeight: '82%',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      backgroundColor: colors.cream,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
    },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    title: { fontFamily: typography.body.semibold, fontSize: typography.sizes.lg, color: colors.ink },
    closeBtn: { padding: spacing.xs },
    body: { paddingBottom: spacing.lg },
    identityCard: {
      padding: spacing.md,
      backgroundColor: colors.sagePale,
      borderRadius: radius.md,
    },
    identityLabel: { fontFamily: typography.body.medium, fontSize: typography.sizes.xs, color: colors.inkSoft },
    ingredientName: {
      marginTop: 2,
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.md,
      color: colors.ink,
    },
    categoryLabel: { marginTop: 4, fontFamily: typography.body.fontFamily, fontSize: typography.sizes.sm, color: colors.inkFaint },
    fieldLabel: {
      marginTop: spacing.md,
      marginBottom: spacing.xs,
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
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
    unitChipText: { fontFamily: typography.body.medium, fontSize: typography.sizes.sm, color: colors.inkSoft },
    unitChipTextActive: { color: colors.onAccent },
    quantityInput: {
      height: 46,
      paddingHorizontal: spacing.md,
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.hairline,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.ink,
      outlineStyle: 'none',
    },
    hint: { paddingVertical: spacing.sm, fontFamily: typography.body.fontFamily, fontSize: typography.sizes.sm, color: colors.inkFaint },
    errorText: { paddingTop: spacing.sm, fontFamily: typography.body.medium, fontSize: typography.sizes.sm, color: colors.error },
    footer: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.hairline,
    },
    cancelButton: { minHeight: 44, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
    cancelText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.sm, color: colors.inkSoft },
    saveWrap: { flex: 1 },
  });
}
