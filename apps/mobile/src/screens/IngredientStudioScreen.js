import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import Badge from '../components/Badge';
import { searchIngredientsStrict } from '../api/ingredientService';
import { getIngredientErrorMessage } from '../api/ingredientErrors';
import { getSubstitutesFor } from '../api/substitutionService';
import { getSubstitutionErrorMessage } from '../api/substitutionErrors';
import { useAuth } from '../context/AuthContext';

const SEARCH_DELAY_MS = 300;
const SEARCH_LIMIT = 20;
const COMPACT_CONTEXT_MAX_LENGTH = 22;
const ASSISTANT_QUERY_MAX_LENGTH = 100;

function sourceMatchesSelection(selectedIngredientId, resultSourceIngredientId) {
  return Boolean(
    selectedIngredientId && selectedIngredientId === resultSourceIngredientId
  );
}

function compactContextLabel(value) {
  const context = typeof value === 'string' && value.trim() ? value.trim() : 'Catalog';
  return context.length > COMPACT_CONTEXT_MAX_LENGTH
    ? `${context.slice(0, COMPACT_CONTEXT_MAX_LENGTH - 1)}…`
    : context;
}

// The teammate-inspired Ingredient Swaps shell reads only canonical catalog
// ingredients and real directed substitutions. The API does not define images,
// confidence, or scientific metrics, and its ratio lacks unit semantics, so none
// of those values are presented here.
export default function IngredientStudioScreen({ navigation, route }) {
  const { colors, shadow } = useTheme();
  const { status: authStatus, user } = useAuth();
  const styles = makeStyles(colors, shadow);
  const asTab = route?.name === 'Swaps';
  const authUserId = authStatus === 'authenticated' && typeof user?.id === 'string'
    ? user.id.trim()
    : '';

  const [query, setQuery] = useState('');
  const [ingredients, setIngredients] = useState([]);
  const [selected, setSelected] = useState(null);
  const [searchLoading, setSearchLoading] = useState(true);
  const [searchError, setSearchError] = useState(null);
  const [searchNonce, setSearchNonce] = useState(0);
  const [confirmedEmptyQuery, setConfirmedEmptyQuery] = useState(null);

  const [substitutionState, setSubstitutionState] = useState({
    sourceIngredientId: null,
    substitutes: [],
    loading: false,
    error: null,
  });
  const [substitutesNonce, setSubstitutesNonce] = useState(0);

  const searchGeneration = useRef(0);
  const substitutesGeneration = useRef(0);
  const assistantHandoffRef = useRef(false);
  const authOwnerRef = useRef(authUserId);
  const previousAuthOwnerRef = useRef(authUserId);
  const accountStateIsCurrent = previousAuthOwnerRef.current === authUserId;
  authOwnerRef.current = authUserId;

  const clearSubstitutionState = () => {
    substitutesGeneration.current += 1;
    setSubstitutionState({
      sourceIngredientId: null,
      substitutes: [],
      loading: false,
      error: null,
    });
  };

  const changeQuery = (value) => {
    searchGeneration.current += 1;
    assistantHandoffRef.current = false;
    setQuery(value);
    setIngredients([]);
    setSelected(null);
    setSearchError(null);
    setConfirmedEmptyQuery(null);
    clearSubstitutionState();
  };

  useEffect(function resetForAuthenticatedOwnerChange() {
    if (previousAuthOwnerRef.current === authUserId) return;
    previousAuthOwnerRef.current = authUserId;
    searchGeneration.current += 1;
    substitutesGeneration.current += 1;
    assistantHandoffRef.current = false;
    setQuery('');
    setIngredients([]);
    setSelected(null);
    setSearchLoading(false);
    setSearchError(null);
    setConfirmedEmptyQuery(null);
    setSubstitutionState({
      sourceIngredientId: null,
      substitutes: [],
      loading: false,
      error: null,
    });
  }, [authUserId]);

  useEffect(function loadIngredientCatalog() {
    if (!accountStateIsCurrent) return undefined;
    const generation = ++searchGeneration.current;
    const ownerId = authUserId;
    const trimmed = query.trim();
    setSearchLoading(true);
    setSearchError(null);
    setIngredients([]);
    setSelected(null);
    setConfirmedEmptyQuery(null);

    const timer = setTimeout(async () => {
      try {
        const result = await searchIngredientsStrict({
          search: trimmed || undefined,
          limit: SEARCH_LIMIT,
        });
        if (generation !== searchGeneration.current || ownerId !== authOwnerRef.current) return;
        setIngredients(result.ingredients);
        setSelected(result.ingredients[0] || null);
        setConfirmedEmptyQuery(trimmed && result.ingredients.length === 0 ? trimmed : null);
      } catch (err) {
        if (generation !== searchGeneration.current || ownerId !== authOwnerRef.current) return;
        setIngredients([]);
        setSelected(null);
        setConfirmedEmptyQuery(null);
        setSearchError(getIngredientErrorMessage(err));
      } finally {
        if (generation === searchGeneration.current && ownerId === authOwnerRef.current) {
          setSearchLoading(false);
        }
      }
    }, trimmed ? SEARCH_DELAY_MS : 0);

    return () => {
      clearTimeout(timer);
      if (generation === searchGeneration.current) searchGeneration.current += 1;
    };
  }, [accountStateIsCurrent, authUserId, query, searchNonce]);

  const askAssistant = () => {
    const currentQuery = query.trim();
    if (
      assistantHandoffRef.current ||
      !currentQuery ||
      confirmedEmptyQuery !== currentQuery ||
      searchLoading ||
      searchError ||
      selected
    ) return;
    assistantHandoffRef.current = true;
    const boundedQuery = currentQuery.slice(0, ASSISTANT_QUERY_MAX_LENGTH);
    navigation.navigate('Assistant', {
      initialPrompt: `I couldn't find "${boundedQuery}" in the ingredient catalog. What cooking alternatives can I use?`,
    });
  };

  useEffect(function loadSubstitutions() {
    if (!accountStateIsCurrent) return undefined;
    const generation = ++substitutesGeneration.current;
    const ownerId = authUserId;

    if (!selected?.id) {
      setSubstitutionState({
        sourceIngredientId: null,
        substitutes: [],
        loading: false,
        error: null,
      });
      return undefined;
    }

    setSubstitutionState({
      sourceIngredientId: selected.id,
      substitutes: [],
      loading: true,
      error: null,
    });
    getSubstitutesFor(selected.id)
      .then((result) => {
        if (
          generation === substitutesGeneration.current &&
          ownerId === authOwnerRef.current
        ) {
          setSubstitutionState({
            sourceIngredientId: selected.id,
            substitutes: result.substitutes,
            loading: false,
            error: null,
          });
        }
      })
      .catch((err) => {
        if (
          generation === substitutesGeneration.current &&
          ownerId === authOwnerRef.current
        ) {
          setSubstitutionState({
            sourceIngredientId: selected.id,
            substitutes: [],
            loading: false,
            error: getSubstitutionErrorMessage(err),
          });
        }
      });

    return () => {
      substitutesGeneration.current += 1;
    };
  }, [accountStateIsCurrent, authUserId, selected, substitutesNonce]);

  if (!accountStateIsCurrent) {
    return (
      <View style={styles.root}>
        <TopBar
          mode={asTab ? 'title' : 'back'}
          title="Ingredient Swaps"
          onBack={asTab ? undefined : () => navigation.goBack()}
        />
      </View>
    );
  }

  const substitutionStateIsCurrent = sourceMatchesSelection(
    selected?.id,
    substitutionState.sourceIngredientId
  );

  const renderSubstitutions = () => {
    if (!substitutionStateIsCurrent || substitutionState.loading) {
      return (
        <View style={styles.resultStatus} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.sageDeep} />
          <Text style={styles.statusText}>Loading catalog substitutions…</Text>
        </View>
      );
    }

    if (substitutionState.error) {
      return (
        <Pressable
          style={styles.resultStatus}
          onPress={() => setSubstitutesNonce((n) => n + 1)}
          accessibilityRole="button"
          accessibilityLabel={`${substitutionState.error} Retry substitution lookup`}
        >
          <Ionicons name="refresh" size={20} color={colors.sageDeep} />
          <Text style={styles.errorText}>{substitutionState.error} Tap to retry.</Text>
        </Pressable>
      );
    }

    if (substitutionState.substitutes.length === 0) {
      return (
        <View style={styles.resultStatus}>
          <Ionicons name="information-circle-outline" size={22} color={colors.sageDeep} />
          <Text style={styles.statusTitle}>No substitutions available</Text>
          <Text style={styles.statusText}>
            The catalog does not currently list a substitute for {selected.name}.
          </Text>
        </View>
      );
    }

    return substitutionState.substitutes.map((substitution) => {
      const primaryContext = substitution.contexts[0] || 'Catalog';
      return (
        <Pressable
          key={substitution.id || substitution.substitute.id}
          style={styles.swapCard}
          onPress={() =>
            navigation.navigate('SwapDetail', {
              sourceIngredient: selected,
              substitution,
            })
          }
          accessibilityRole="button"
          accessibilityLabel={`View ${substitution.substitute.name} substitution details. Context: ${primaryContext}`}
          accessibilityHint={`Opens substitution guidance for ${selected.name}`}
        >
          <View style={styles.swapIconWrap}>
            <Ionicons name="swap-horizontal" size={22} color={colors.sageDeep} />
          </View>
          <View style={styles.swapBody}>
            <View style={styles.swapHeaderRow}>
              <Text style={styles.swapName}>{substitution.substitute.name}</Text>
              <View style={styles.contextBadgeWrap}>
                <Badge label={compactContextLabel(primaryContext)} tone="sage" />
              </View>
            </View>
            <Text style={styles.swapDesc}>
              {substitution.notes || 'Catalog substitution guidance is available.'}
            </Text>
            <View style={styles.guidanceRow}>
              <Ionicons
                name="information-circle-outline"
                size={12}
                color={colors.inkFaint}
              />
              <Text style={styles.guidanceText}>No quantity ratio is assumed</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.inkFaint} />
        </Pressable>
      );
    });
  };

  return (
    <View style={styles.root}>
      <TopBar
        mode={asTab ? 'title' : 'back'}
        title="Ingredient Swaps"
        onBack={asTab ? undefined : () => navigation.goBack()}
      />

      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={17} color={colors.inkFaint} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search an ingredient..."
            placeholderTextColor={colors.inkFaint}
            value={query}
            onChangeText={changeQuery}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            returnKeyType="search"
            accessibilityLabel="Search ingredient catalog"
          />
          {query.length > 0 && (
            <Pressable
              onPress={() => changeQuery('')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear ingredient search"
            >
              <Ionicons name="close-circle" size={17} color={colors.inkFaint} />
            </Pressable>
          )}
        </View>

        {searchLoading && ingredients.length === 0 ? (
          <View style={styles.searchStatus} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={colors.sageDeep} />
            <Text style={styles.searchStatusText}>Searching the ingredient catalog…</Text>
          </View>
        ) : searchError ? (
          <Pressable
            style={styles.searchStatus}
            onPress={() => setSearchNonce((n) => n + 1)}
            accessibilityRole="button"
            accessibilityLabel={`${searchError} Retry ingredient search`}
          >
            <Text style={styles.searchErrorText}>{searchError} Tap to retry.</Text>
          </Pressable>
        ) : (
          <>
            <Text style={styles.pickerLabel}>INGREDIENT CATALOG</Text>
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {ingredients.map((ingredient) => {
                const active = ingredient.id === selected?.id;
                return (
                  <Pressable
                    key={ingredient.id}
                    onPress={() => setSelected(ingredient)}
                    style={[styles.chip, active && styles.chipActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={ingredient.name}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {ingredient.name}
                    </Text>
                  </Pressable>
                );
              })}
              {ingredients.length === 0 && (
                <View style={styles.noMatchesWrap} accessibilityLiveRegion="polite">
                  <Text style={styles.noMatches}>
                    {query.trim() ? `No ingredients match “${query.trim()}”.` : 'No ingredients available.'}
                  </Text>
                  {confirmedEmptyQuery === query.trim() && query.trim() ? (
                    <Pressable
                      onPress={askAssistant}
                      accessibilityRole="button"
                      accessibilityLabel={`Ask Chef Assistant about ${query.trim()}`}
                      style={styles.assistantAction}
                    >
                      <Ionicons name="sparkles-outline" size={16} color={colors.onAccent} />
                      <Text style={styles.assistantActionText}>Ask Chef Assistant</Text>
                    </Pressable>
                  ) : null}
                </View>
              )}
            </ScrollView>
          </>
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {selected ? (
          <>
            <View style={styles.selectedHeader}>
              <View style={styles.heroCircleWrap}>
                <View style={styles.heroCircle}>
                  <Ionicons name="leaf-outline" size={24} color={colors.sageDeep} />
                </View>
              </View>
              <View style={styles.selectedCopy}>
                <Text style={styles.eyebrow}>SELECTED INGREDIENT</Text>
                <Text style={styles.title}>Swaps for {selected.name}</Text>
                <Text style={styles.subtitle}>
                  {selected.category
                    ? `Catalog category: ${selected.category}`
                    : 'Canonical WeCooked ingredient'}
                </Text>
              </View>
            </View>

            <Text style={styles.sectionLabel}>Catalog Swaps</Text>
            {renderSubstitutions()}
          </>
        ) : (
          <View style={styles.resultStatus}>
            <Ionicons name="search-outline" size={28} color={colors.sageDeep} />
            <Text style={styles.statusTitle}>Choose an ingredient</Text>
            <Text style={styles.statusText}>
              Search the live WeCooked catalog to view available substitutions.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors, shadow) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    searchWrap: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
    },
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
      marginBottom: spacing.sm,
    },
    searchInput: {
      flex: 1,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.ink,
      height: '100%',
      outlineStyle: 'none',
    },
    pickerLabel: {
      fontFamily: typography.body.bold,
      fontSize: 10.5,
      letterSpacing: 1,
      color: colors.inkFaint,
      marginBottom: spacing.sm,
    },
    chipRow: { gap: spacing.sm, paddingRight: spacing.lg, paddingBottom: spacing.xs },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.paper,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    chipActive: { backgroundColor: colors.sageDeep, borderColor: colors.sageDeep },
    chipText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
    },
    chipTextActive: { color: colors.onAccent },
    searchStatus: {
      minHeight: 36,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingBottom: spacing.xs,
    },
    searchStatusText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
    },
    searchErrorText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.error,
      textAlign: 'center',
    },
    noMatches: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkFaint,
      paddingVertical: spacing.sm,
    },
    noMatchesWrap: { alignItems: 'flex-start', gap: spacing.sm, paddingBottom: spacing.xs },
    assistantAction: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      backgroundColor: colors.sageDeep,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    assistantActionText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.onAccent,
    },
    scroll: {
      padding: spacing.lg,
      paddingBottom: spacing.xxxl,
      flexGrow: 1,
    },
    selectedHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingBottom: spacing.lg,
      marginBottom: spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
    },
    heroCircleWrap: {
      ...shadow.card,
      borderRadius: radius.md,
    },
    heroCircle: {
      width: 56,
      height: 56,
      borderRadius: radius.md,
      borderWidth: 2,
      borderColor: colors.paper,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
    },
    selectedCopy: { flex: 1 },
    eyebrow: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      letterSpacing: 1,
      marginBottom: spacing.xs,
    },
    title: {
      fontFamily: typography.display.fontFamily,
      fontSize: 22,
      color: colors.ink,
      marginBottom: 3,
    },
    subtitle: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      lineHeight: 18,
    },
    sectionLabel: {
      alignSelf: 'flex-start',
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.lg,
      color: colors.ink,
      marginBottom: spacing.md,
    },
    swapCard: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'stretch',
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      padding: spacing.md,
      gap: spacing.md,
      marginBottom: spacing.md,
    },
    swapIconWrap: {
      width: 52,
      height: 52,
      borderRadius: radius.md,
      backgroundColor: colors.creamDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    swapBody: { flex: 1 },
    swapHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      marginBottom: 4,
    },
    contextBadgeWrap: {
      flexShrink: 1,
      maxWidth: '42%',
      overflow: 'hidden',
    },
    swapName: {
      flex: 1,
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.md,
      color: colors.ink,
    },
    swapDesc: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      lineHeight: 18,
      marginBottom: spacing.sm,
    },
    guidanceRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    guidanceText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
    },
    resultStatus: {
      alignSelf: 'stretch',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.xxl,
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    statusTitle: {
      fontFamily: typography.display.fontFamily,
      fontSize: typography.sizes.md,
      color: colors.ink,
      textAlign: 'center',
    },
    statusText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      lineHeight: 19,
      color: colors.inkSoft,
      textAlign: 'center',
    },
    errorText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      lineHeight: 19,
      color: colors.error,
      textAlign: 'center',
    },
  });
}
