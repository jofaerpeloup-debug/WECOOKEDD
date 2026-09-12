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
import { searchIngredients } from '../api/ingredientService';
import { getIngredientErrorMessage } from '../api/ingredientErrors';
import { getSubstitutesFor } from '../api/substitutionService';
import { getSubstitutionErrorMessage } from '../api/substitutionErrors';

const SEARCH_DELAY_MS = 300;
const SEARCH_LIMIT = 20;

// The teammate-final Substitute Finder shell now reads only canonical catalog
// ingredients and real directed substitutions. The API does not define images,
// ratios, confidence, or scientific metrics, so none are invented here.
export default function IngredientStudioScreen({ navigation, route }) {
  const { colors, shadow } = useTheme();
  const styles = makeStyles(colors, shadow);
  const asTab = route?.name === 'Swaps';

  const [query, setQuery] = useState('');
  const [ingredients, setIngredients] = useState([]);
  const [selected, setSelected] = useState(null);
  const [searchLoading, setSearchLoading] = useState(true);
  const [searchError, setSearchError] = useState(null);
  const [searchNonce, setSearchNonce] = useState(0);

  const [substitutes, setSubstitutes] = useState([]);
  const [substitutesLoading, setSubstitutesLoading] = useState(false);
  const [substitutesError, setSubstitutesError] = useState(null);
  const [substitutesNonce, setSubstitutesNonce] = useState(0);

  const searchGeneration = useRef(0);
  const substitutesGeneration = useRef(0);

  useEffect(() => {
    const generation = ++searchGeneration.current;
    const trimmed = query.trim();
    setSearchLoading(true);
    setSearchError(null);
    setIngredients([]);

    const timer = setTimeout(async () => {
      try {
        const result = await searchIngredients({
          search: trimmed || undefined,
          limit: SEARCH_LIMIT,
        });
        if (generation !== searchGeneration.current) return;
        setIngredients(result.ingredients);
        setSelected((current) => current || result.ingredients[0] || null);
      } catch (err) {
        if (generation !== searchGeneration.current) return;
        setIngredients([]);
        setSearchError(getIngredientErrorMessage(err));
      } finally {
        if (generation === searchGeneration.current) setSearchLoading(false);
      }
    }, trimmed ? SEARCH_DELAY_MS : 0);

    return () => {
      clearTimeout(timer);
      if (generation === searchGeneration.current) searchGeneration.current += 1;
    };
  }, [query, searchNonce]);

  useEffect(() => {
    const generation = ++substitutesGeneration.current;
    setSubstitutes([]);
    setSubstitutesError(null);

    if (!selected?.id) {
      setSubstitutesLoading(false);
      return undefined;
    }

    setSubstitutesLoading(true);
    getSubstitutesFor(selected.id)
      .then((result) => {
        if (generation === substitutesGeneration.current) {
          setSubstitutes(result.substitutes);
        }
      })
      .catch((err) => {
        if (generation === substitutesGeneration.current) {
          setSubstitutesError(getSubstitutionErrorMessage(err));
        }
      })
      .finally(() => {
        if (generation === substitutesGeneration.current) setSubstitutesLoading(false);
      });

    return () => {
      substitutesGeneration.current += 1;
    };
  }, [selected, substitutesNonce]);

  return (
    <View style={styles.root}>
      <TopBar
        mode={asTab ? 'title' : 'back'}
        title="Substitute Finder"
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
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={17} color={colors.inkFaint} />
            </Pressable>
          )}
        </View>

        {searchLoading && ingredients.length === 0 ? (
          <View style={styles.searchStatus}>
            <ActivityIndicator size="small" color={colors.sageDeep} />
            <Text style={styles.searchStatusText}>Searching the ingredient catalog…</Text>
          </View>
        ) : searchError ? (
          <Pressable style={styles.searchStatus} onPress={() => setSearchNonce((n) => n + 1)}>
            <Text style={styles.searchErrorText}>{searchError} Tap to retry.</Text>
          </Pressable>
        ) : (
          <ScrollView
            horizontal
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
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {ingredient.name}
                  </Text>
                </Pressable>
              );
            })}
            {ingredients.length === 0 && (
              <Text style={styles.noMatches}>
                {query.trim() ? `No ingredients match “${query.trim()}”.` : 'No ingredients available.'}
              </Text>
            )}
          </ScrollView>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {selected ? (
          <>
            <View style={styles.heroCircleWrap}>
              <View style={styles.heroCircle}>
                <Ionicons name="leaf-outline" size={38} color={colors.sageDeep} />
              </View>
            </View>

            <Text style={styles.eyebrow}>ORIGINAL INGREDIENT</Text>
            <Text style={styles.title}>{selected.name}</Text>
            <Text style={styles.subtitle}>
              {selected.category
                ? `Catalog category: ${selected.category}`
                : 'Canonical WeCooked ingredient'}
            </Text>

            <Text style={styles.sectionLabel}>Catalog Swaps</Text>

            {substitutesLoading ? (
              <View style={styles.resultStatus}>
                <ActivityIndicator color={colors.sageDeep} />
                <Text style={styles.statusText}>Loading catalog substitutions…</Text>
              </View>
            ) : substitutesError ? (
              <Pressable
                style={styles.resultStatus}
                onPress={() => setSubstitutesNonce((n) => n + 1)}
              >
                <Ionicons name="refresh" size={20} color={colors.sageDeep} />
                <Text style={styles.errorText}>{substitutesError} Tap to retry.</Text>
              </Pressable>
            ) : substitutes.length === 0 ? (
              <View style={styles.resultStatus}>
                <Ionicons name="information-circle-outline" size={22} color={colors.sageDeep} />
                <Text style={styles.statusTitle}>No substitutions available</Text>
                <Text style={styles.statusText}>
                  The catalog does not currently list a substitute for {selected.name}.
                </Text>
              </View>
            ) : (
              substitutes.map((substitution) => (
                <Pressable
                  key={substitution.id || substitution.substitute.id}
                  style={styles.swapCard}
                  onPress={() =>
                    navigation.navigate('SwapDetail', {
                      sourceIngredient: selected,
                      substitution,
                    })
                  }
                >
                  <View style={styles.swapIconWrap}>
                    <Ionicons name="swap-horizontal" size={22} color={colors.sageDeep} />
                  </View>
                  <View style={styles.swapBody}>
                    <View style={styles.swapHeaderRow}>
                      <Text style={styles.swapName}>{substitution.substitute.name}</Text>
                      <Badge
                        label={substitution.contexts[0] || 'Catalog'}
                        tone="sage"
                      />
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
              ))
            )}
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
      marginBottom: spacing.md,
    },
    searchInput: {
      flex: 1,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.ink,
      height: '100%',
      outlineStyle: 'none',
    },
    chipRow: { gap: spacing.sm, paddingBottom: spacing.xs },
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
    scroll: {
      padding: spacing.lg,
      paddingBottom: spacing.xxxl,
      alignItems: 'center',
      flexGrow: 1,
    },
    heroCircleWrap: {
      marginTop: spacing.lg,
      marginBottom: spacing.lg,
      ...shadow.card,
      borderRadius: 60,
    },
    heroCircle: {
      width: 96,
      height: 96,
      borderRadius: 48,
      borderWidth: 3,
      borderColor: colors.paper,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
    },
    eyebrow: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      letterSpacing: 1,
      marginBottom: spacing.xs,
    },
    title: {
      fontFamily: typography.display.fontFamily,
      fontSize: 30,
      color: colors.ink,
      marginBottom: spacing.sm,
      textAlign: 'center',
    },
    subtitle: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.inkSoft,
      textAlign: 'center',
      lineHeight: 20,
      marginBottom: spacing.xxl,
      maxWidth: '90%',
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
