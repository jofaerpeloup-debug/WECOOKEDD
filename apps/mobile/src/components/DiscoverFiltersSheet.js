import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius, spacing, typography } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { searchIngredientsStrict } from '../api/ingredientService';
import { getIngredientErrorMessage } from '../api/ingredientErrors';
import {
  DIETARY_OPTIONS,
  DIFFICULTY_OPTIONS,
  REGION_OPTIONS,
  CATEGORY_OPTIONS,
  draftFromFilters,
  validateDiscoverFilterDraft,
} from '../utils/discoverFilters';

const INGREDIENT_SEARCH_DEBOUNCE_MS = 300;
const INGREDIENT_SEARCH_LIMIT = 20;

function ChoiceGroup({ label, options, value, onChange, styles }) {
  return (
    <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.choices}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value || 'any'}
              onPress={() => onChange(option.value)}
              style={[styles.choice, selected && styles.choiceSelected]}
              accessibilityRole="radio"
              accessibilityLabel={`${label}: ${option.label}`}
              accessibilityState={{ selected }}
            >
              <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function DiscoverFiltersSheet({ visible, appliedFilters, onCancel, onApply }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [draft, setDraft] = useState(() => draftFromFilters(appliedFilters));
  const [prepError, setPrepError] = useState(null);
  const [ingredientQuery, setIngredientQuery] = useState('');
  const [ingredientResults, setIngredientResults] = useState([]);
  const [ingredientTruncated, setIngredientTruncated] = useState(false);
  const [ingredientLoading, setIngredientLoading] = useState(false);
  const [ingredientError, setIngredientError] = useState(null);
  const [ingredientSearchAttempt, setIngredientSearchAttempt] = useState(0);
  const mountedRef = useRef(true);
  const ingredientSearchGenRef = useRef(0);
  const wasVisibleRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      ingredientSearchGenRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const wasVisible = wasVisibleRef.current;
    wasVisibleRef.current = visible;
    if (wasVisible === visible) return;

    ingredientSearchGenRef.current += 1;
    setIngredientQuery('');
    setIngredientResults([]);
    setIngredientTruncated(false);
    setIngredientLoading(false);
    setIngredientError(null);
    if (!visible) return;
    setDraft(draftFromFilters(appliedFilters));
    setPrepError(null);
  }, [visible, appliedFilters]);

  useEffect(() => {
    if (!visible) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      cancel();
      return true;
    });
    return () => subscription.remove();
  }, [visible, appliedFilters]);

  const trimmedIngredientQuery = ingredientQuery.trim();

  useEffect(() => {
    if (!visible || !trimmedIngredientQuery) return undefined;

    const gen = ingredientSearchGenRef.current;
    setIngredientLoading(true);
    setIngredientError(null);

    const timer = setTimeout(async () => {
      try {
        const { ingredients, pagination } = await searchIngredientsStrict({
          search: trimmedIngredientQuery,
          limit: INGREDIENT_SEARCH_LIMIT,
        });
        if (!mountedRef.current || gen !== ingredientSearchGenRef.current) return;
        setIngredientResults(ingredients);
        setIngredientTruncated(!!pagination && pagination.total > ingredients.length);
      } catch (error) {
        if (!mountedRef.current || gen !== ingredientSearchGenRef.current) return;
        setIngredientResults([]);
        setIngredientTruncated(false);
        setIngredientError(getIngredientErrorMessage(error));
      } finally {
        if (mountedRef.current && gen === ingredientSearchGenRef.current) {
          setIngredientLoading(false);
        }
      }
    }, INGREDIENT_SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [visible, ingredientQuery, ingredientSearchAttempt, trimmedIngredientQuery]);

  const clearIngredientSearch = useCallback(() => {
    ingredientSearchGenRef.current += 1;
    setIngredientQuery('');
    setIngredientResults([]);
    setIngredientTruncated(false);
    setIngredientLoading(false);
    setIngredientError(null);
  }, []);

  const changeIngredientQuery = useCallback((value) => {
    ingredientSearchGenRef.current += 1;
    setIngredientQuery(value);
    setIngredientResults([]);
    setIngredientTruncated(false);
    setIngredientLoading(false);
    setIngredientError(null);
  }, []);

  const retryIngredientSearch = useCallback(() => {
    ingredientSearchGenRef.current += 1;
    setIngredientResults([]);
    setIngredientTruncated(false);
    setIngredientLoading(false);
    setIngredientError(null);
    setIngredientSearchAttempt((attempt) => attempt + 1);
  }, []);

  const selectIngredient = useCallback((ingredient) => {
    ingredientSearchGenRef.current += 1;
    setDraft((current) => ({
      ...current,
      ingredient: { id: ingredient.id, name: ingredient.name },
    }));
    setIngredientQuery('');
    setIngredientResults([]);
    setIngredientTruncated(false);
    setIngredientLoading(false);
    setIngredientError(null);
  }, []);

  const clearIngredient = useCallback(() => {
    setDraft((current) => ({ ...current, ingredient: null }));
    clearIngredientSearch();
  }, [clearIngredientSearch]);

  const cancel = () => {
    clearIngredientSearch();
    setDraft(draftFromFilters(appliedFilters));
    setPrepError(null);
    onCancel();
  };

  const apply = () => {
    const result = validateDiscoverFilterDraft(draft);
    setPrepError(result.prepError);
    if (!result.filters) return;
    clearIngredientSearch();
    onApply({ ...result.filters, sort: appliedFilters.sort });
  };

  const reset = () => {
    clearIngredientSearch();
    setDraft(draftFromFilters({ sort: appliedFilters.sort }));
    setPrepError(null);
  };

  if (!visible) return null;

  return (
          <View style={styles.panel} accessibilityLabel="Recipe filters">
            <View style={styles.header}>
              <View>
                <Text style={styles.title} accessibilityRole="header">
                  Filter recipes
                </Text>
                <Text style={styles.subtitle}>All selections combine with your search.</Text>
              </View>
              <Pressable
                onPress={cancel}
                hitSlop={10}
                style={styles.closeButton}
                accessibilityRole="button"
                accessibilityLabel="Close recipe filters"
              >
                <Ionicons name="close" size={22} color={colors.inkSoft} />
              </Pressable>
            </View>

            <View style={styles.content}>
              <ChoiceGroup
                label="Region"
                options={REGION_OPTIONS}
                value={draft.region}
                onChange={(region) => setDraft((current) => ({ ...current, region }))}
                styles={styles}
              />
              <ChoiceGroup
                label="Category"
                options={CATEGORY_OPTIONS}
                value={draft.category}
                onChange={(category) => setDraft((current) => ({ ...current, category }))}
                styles={styles}
              />
              <ChoiceGroup
                label="Difficulty"
                options={DIFFICULTY_OPTIONS}
                value={draft.difficulty}
                onChange={(difficulty) => setDraft((current) => ({ ...current, difficulty }))}
                styles={styles}
              />
              <ChoiceGroup
                label="Dietary tag"
                options={DIETARY_OPTIONS}
                value={draft.dietaryTag}
                onChange={(dietaryTag) => setDraft((current) => ({ ...current, dietaryTag }))}
                styles={styles}
              />

              <View style={styles.group}>
                <Text style={styles.groupLabel}>Maximum prep minutes</Text>
                <TextInput
                  style={[styles.prepInput, prepError && styles.prepInputError]}
                  value={draft.maxPrepTimeMinutes}
                  onChangeText={(maxPrepTimeMinutes) => {
                    setDraft((current) => ({ ...current, maxPrepTimeMinutes }));
                    if (prepError) setPrepError(null);
                  }}
                  placeholder="Any"
                  placeholderTextColor={colors.inkFaint}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  returnKeyType="done"
                  maxLength={4}
                  accessibilityLabel="Maximum prep minutes, from 1 to 1440"
                  accessibilityHint={prepError || 'Leave blank for any prep time'}
                />
                <Text style={styles.hint}>Recipes without a prep time will not match.</Text>
                {prepError && (
                  <Text style={styles.errorText} accessibilityLiveRegion="polite">
                    {prepError}
                  </Text>
                )}
              </View>

              <View style={styles.group}>
                <Text style={styles.groupLabel}>Ingredient</Text>
                {draft.ingredient ? (
                  <View style={styles.selectedIngredient}>
                    <Text style={styles.selectedIngredientName}>{draft.ingredient.name}</Text>
                    <Pressable
                      onPress={clearIngredient}
                      style={styles.ingredientAction}
                      accessibilityRole="button"
                      accessibilityLabel={`Clear ingredient ${draft.ingredient.name}`}
                    >
                      <Ionicons name="close" size={18} color={colors.sageDeep} />
                      <Text style={styles.ingredientActionText}>Clear</Text>
                    </Pressable>
                  </View>
                ) : (
                  <>
                    <View style={styles.ingredientSearchField}>
                      <Ionicons name="search" size={17} color={colors.inkFaint} />
                      <TextInput
                        style={styles.ingredientSearchInput}
                        value={ingredientQuery}
                        onChangeText={changeIngredientQuery}
                        placeholder="Search ingredients..."
                        placeholderTextColor={colors.inkFaint}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="off"
                        returnKeyType="search"
                        accessibilityLabel="Search ingredients"
                        accessibilityHint="Type a canonical ingredient name or alias"
                      />
                      {ingredientQuery.length > 0 && (
                        <Pressable
                          onPress={clearIngredientSearch}
                          style={styles.ingredientSearchClear}
                          accessibilityRole="button"
                          accessibilityLabel="Clear ingredient search"
                        >
                          <Ionicons name="close-circle" size={17} color={colors.inkFaint} />
                        </Pressable>
                      )}
                    </View>

                    {!trimmedIngredientQuery ? (
                      <Text style={styles.hint}>
                        Type an ingredient name to search the WeCooked catalog.
                      </Text>
                    ) : ingredientLoading ? (
                      <View style={styles.ingredientState}>
                        <ActivityIndicator
                          color={colors.sageDeep}
                          accessible
                          accessibilityLabel="Searching ingredients"
                          accessibilityState={{ busy: ingredientLoading }}
                        />
                      </View>
                    ) : ingredientError ? (
                      <View style={styles.ingredientErrorState}>
                        <Text style={styles.errorText} accessibilityLiveRegion="polite">
                          {ingredientError}
                        </Text>
                        <Pressable
                          onPress={retryIngredientSearch}
                          style={styles.ingredientRetry}
                          accessibilityRole="button"
                          accessibilityLabel="Retry ingredient search"
                        >
                          <Ionicons name="refresh" size={15} color={colors.sageDeep} />
                          <Text style={styles.ingredientActionText}>Retry</Text>
                        </Pressable>
                      </View>
                    ) : ingredientResults.length === 0 ? (
                      <Text style={styles.hint}>
                        No ingredients match “{trimmedIngredientQuery}”.
                      </Text>
                    ) : (
                      <View style={styles.ingredientResults}>
                        {ingredientResults.map((ingredient) => (
                          <Pressable
                            key={ingredient.id}
                            onPress={() => selectIngredient(ingredient)}
                            style={styles.ingredientResult}
                            accessibilityRole="button"
                            accessibilityLabel={`Select ingredient ${ingredient.name}`}
                          >
                            <Text style={styles.ingredientResultName}>{ingredient.name}</Text>
                            <Ionicons name="add" size={18} color={colors.sageDeep} />
                          </Pressable>
                        ))}
                        {ingredientTruncated && (
                          <Text style={styles.hint}>
                            Showing the first {ingredientResults.length}. Keep typing to narrow it down.
                          </Text>
                        )}
                      </View>
                    )}
                  </>
                )}
              </View>

            </View>

            <View style={styles.actions}>
              <Pressable
                style={styles.resetButton}
                onPress={reset}
                accessibilityRole="button"
                accessibilityLabel="Reset recipe filters"
              >
                <Text style={styles.resetText}>Reset</Text>
              </Pressable>
              <Pressable
                style={styles.applyButton}
                onPress={apply}
                accessibilityRole="button"
                accessibilityLabel="Apply recipe filters"
              >
                <Text style={styles.applyText}>Show recipes</Text>
              </Pressable>
            </View>
          </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    panel: {
      marginTop: spacing.md,
      padding: spacing.lg,
      backgroundColor: colors.paper,
      borderWidth: 1,
      borderColor: colors.hairline,
      borderRadius: radius.lg,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: spacing.md,
      paddingBottom: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
    },
    title: { fontFamily: typography.body.bold, fontSize: typography.sizes.lg, color: colors.ink },
    subtitle: {
      marginTop: spacing.xs,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkFaint,
    },
    closeButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    content: { paddingVertical: spacing.lg, gap: spacing.xl },
    group: { gap: spacing.sm },
    groupLabel: {
      fontFamily: typography.body.semibold,
      fontSize: 11.5,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: colors.sageDeep,
    },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    choice: {
      minWidth: 44,
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.hairline,
      backgroundColor: colors.paper,
    },
    choiceSelected: { backgroundColor: colors.sageDeep, borderColor: colors.sageDeep },
    choiceText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
    },
    choiceTextSelected: { color: colors.onAccent },
    prepInput: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: colors.hairline,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      backgroundColor: colors.paper,
      color: colors.ink,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      outlineStyle: 'none',
    },
    prepInputError: { borderColor: colors.error },
    ingredientSearchField: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.creamDeep,
    },
    ingredientSearchInput: {
      flex: 1,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.ink,
      outlineStyle: 'none',
    },
    ingredientSearchClear: {
      minWidth: 44,
      minHeight: 44,
      marginRight: -spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ingredientState: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    ingredientErrorState: { gap: spacing.sm, alignItems: 'flex-start' },
    ingredientRetry: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      borderWidth: 1,
      borderColor: colors.hairline,
      borderRadius: radius.pill,
    },
    ingredientResults: { gap: spacing.xs },
    ingredientResult: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      borderWidth: 1,
      borderColor: colors.hairline,
      borderRadius: radius.md,
      backgroundColor: colors.paper,
    },
    ingredientResultName: {
      flex: 1,
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.ink,
    },
    selectedIngredient: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      borderWidth: 1,
      borderColor: colors.sageDeep,
      borderRadius: radius.pill,
      backgroundColor: colors.sagePale,
    },
    selectedIngredientName: {
      flex: 1,
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.ink,
    },
    ingredientAction: {
      minWidth: 44,
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.xs,
    },
    ingredientActionText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.sageDeep,
    },
    hint: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
    },
    errorText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.error,
    },
    actions: {
      flexDirection: 'row',
      gap: spacing.md,
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.hairline,
    },
    resetButton: {
      minHeight: 48,
      paddingHorizontal: spacing.lg,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    resetText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.base, color: colors.ink },
    applyButton: {
      flex: 1,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: colors.sageDeep,
    },
    applyText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.base,
      color: colors.onAccent,
    },
  });
}
