import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import RecipeImage from '../components/RecipeImage';
import { listRecipes } from '../api/recipeService';
import { getRecipeErrorMessage } from '../api/recipeErrors';
import { recipeTimeLabel } from '../utils/recipe';

// Each shortcut jumps to Discover with an EXPLICIT backend-supported initial
// filter. The backend has no meal-type/curation concept, so the old
// Breakfast/Lunch/Dinner/Dessert/Vegies chips are gone (see
// docs/architecture/mobile-recipes-integration.md).
const BROWSE_SHORTCUTS = [
  { key: 'filipino', label: 'Filipino', icon: 'restaurant-outline' },
  { key: 'easy', label: 'Easy', icon: 'flash-outline' },
  { key: 'vegetarian', label: 'Vegetarian', icon: 'leaf-outline' },
  { key: 'vegan', label: 'Vegan', icon: 'nutrition-outline' },
];

const SEARCH_DEBOUNCE_MS = 300;
const LATEST_LIMIT = 6;
const SEARCH_LIMIT = 20;

export default function DashboardScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = makeStyles(colors, shadow);

  const [query, setQuery] = useState('');
  const trimmed = query.trim();
  const searching = trimmed.length > 0;

  const [latest, setLatest] = useState([]);
  const [latestLoading, setLatestLoading] = useState(true);
  const [latestError, setLatestError] = useState(null);

  const [results, setResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [searchNonce, setSearchNonce] = useState(0);

  // Monotonic request generations — a slower earlier response is discarded once
  // a newer request (query change / retry / unmount) supersedes it.
  const mountedRef = useRef(true);
  const latestGenRef = useRef(0);
  const searchGenRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadLatest = useCallback(async () => {
    const gen = ++latestGenRef.current;
    setLatestLoading(true);
    setLatestError(null);
    try {
      const { recipes } = await listRecipes({ sort: 'newest', limit: LATEST_LIMIT });
      if (!mountedRef.current || gen !== latestGenRef.current) return;
      setLatest(recipes);
    } catch (err) {
      if (!mountedRef.current || gen !== latestGenRef.current) return;
      setLatestError(getRecipeErrorMessage(err));
    } finally {
      if (mountedRef.current && gen === latestGenRef.current) setLatestLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLatest();
  }, [loadLatest]);

  // Debounced search. Backend `search` matches TITLE or DESCRIPTION only — not
  // ingredients, not tags. The generation guard makes a late response harmless.
  useEffect(() => {
    if (!searching) {
      searchGenRef.current += 1; // abandon any pending/in-flight search
      setResults([]);
      setSearchError(null);
      setSearchLoading(false);
      return undefined;
    }

    setSearchLoading(true);
    setSearchError(null);

    const timer = setTimeout(async () => {
      const gen = ++searchGenRef.current;
      try {
        const { recipes } = await listRecipes({ search: trimmed, page: 1, limit: SEARCH_LIMIT });
        if (!mountedRef.current || gen !== searchGenRef.current) return;
        setResults(recipes);
      } catch (err) {
        if (!mountedRef.current || gen !== searchGenRef.current) return;
        setSearchError(getRecipeErrorMessage(err));
      } finally {
        if (mountedRef.current && gen === searchGenRef.current) setSearchLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [searching, trimmed, searchNonce]);

  const openRecipe = (recipe) => {
    navigation.navigate('RecipeDetail', {
      recipeSource: 'api',
      recipeId: recipe.id,
      initialRecipe: recipe,
    });
  };

  const renderCard = (recipe) => (
    <Pressable key={recipe.id} style={styles.card} onPress={() => openRecipe(recipe)}>
      <RecipeImage source={recipe.imageUrl} style={styles.cardImage} />
      <Text style={styles.cardTitle} numberOfLines={2}>
        {recipe.title}
      </Text>
      <View style={styles.cardMeta}>
        <Ionicons name="time-outline" size={12} color={colors.inkFaint} />
        <Text style={styles.cardTime}>{recipeTimeLabel(recipe)}</Text>
      </View>
    </Pressable>
  );

  const renderErrorBlock = (message, onRetry) => (
    <View style={styles.stateBlock}>
      <Text style={styles.errorText}>{message}</Text>
      <Pressable style={styles.retryBtn} onPress={onRetry} hitSlop={8}>
        <Ionicons name="refresh" size={14} color={colors.sageDeep} />
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
    </View>
  );

  return (
    <View style={styles.root}>
      <TopBar mode="brand" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.greeting}>Hello, Chef! 👋</Text>
        <Text style={styles.subGreeting}>What shall we cook today?</Text>

        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={17} color={colors.inkFaint} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search recipes by name..."
              placeholderTextColor={colors.inkFaint}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoComplete="off"
              returnKeyType="search"
            />
            {searching && (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={17} color={colors.inkFaint} />
              </Pressable>
            )}
          </View>
        </View>

        {searching ? (
          <>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionLabel}>Results for “{trimmed}”</Text>
              {searchLoading && results.length > 0 && (
                <ActivityIndicator size="small" color={colors.sageDeep} />
              )}
            </View>
            {searchLoading && results.length === 0 ? (
              <View style={styles.stateBlock}>
                <ActivityIndicator color={colors.sageDeep} />
              </View>
            ) : searchError ? (
              renderErrorBlock(searchError, () => setSearchNonce((n) => n + 1))
            ) : results.length === 0 ? (
              <Text style={styles.emptyText}>No recipes match “{trimmed}”.</Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.cardRow}
              >
                {results.map(renderCard)}
              </ScrollView>
            )}
          </>
        ) : (
          <>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionLabel}>Browse</Text>
              <Pressable onPress={() => navigation.navigate('Discover')}>
                <Text style={styles.seeAll}>See all</Text>
              </Pressable>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.browseRow}
            >
              {BROWSE_SHORTCUTS.map((c) => (
                <Pressable
                  key={c.key}
                  onPress={() => navigation.navigate('Discover', { initialFilter: c.key })}
                  style={styles.browseChip}
                >
                  <Ionicons name={c.icon} size={18} color={colors.inkSoft} />
                  <Text style={styles.browseLabel}>{c.label}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionLabel}>Latest Recipes</Text>
              <Pressable onPress={() => navigation.navigate('Discover')}>
                <Text style={styles.seeAll}>See all</Text>
              </Pressable>
            </View>
            {latestLoading && latest.length === 0 ? (
              <View style={styles.stateBlock}>
                <ActivityIndicator color={colors.sageDeep} />
              </View>
            ) : latestError ? (
              renderErrorBlock(latestError, loadLatest)
            ) : latest.length === 0 ? (
              <Text style={styles.emptyText}>No recipes yet.</Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.cardRow}
              >
                {latest.map(renderCard)}
              </ScrollView>
            )}
          </>
        )}

        <View style={styles.toolsGrid}>
          <Pressable style={styles.toolCard} onPress={() => navigation.navigate('Saved')}>
            <View style={styles.toolIconWrap}>
              <Ionicons name="book" size={20} color={colors.sageDeep} />
            </View>
            <Text style={styles.toolLabel}>Recipe{'\n'}Collection</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors, shadow) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    greeting: {
      fontFamily: typography.display.fontFamily,
      fontSize: 24,
      color: colors.ink,
      marginTop: spacing.sm,
    },
    subGreeting: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.inkSoft,
      marginTop: 2,
      marginBottom: spacing.lg,
    },
    searchRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
    searchBar: {
      flex: 1,
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
    sectionHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.md,
    },
    sectionLabel: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.base,
      color: colors.ink,
    },
    seeAll: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.xs,
      color: colors.sageDeep,
    },
    browseRow: { gap: spacing.sm, paddingBottom: spacing.xl, paddingRight: spacing.md },
    browseChip: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      minWidth: 82,
    },
    browseLabel: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.xs,
      color: colors.inkSoft,
    },
    emptyText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkFaint,
      marginBottom: spacing.xl,
    },
    stateBlock: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.md,
      paddingVertical: spacing.xl,
      marginBottom: spacing.xl,
    },
    errorText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      textAlign: 'center',
    },
    retryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderWidth: 1,
      borderColor: colors.hairline,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.lg,
      paddingVertical: 8,
    },
    retryText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.sageDeep,
    },
    cardRow: { gap: spacing.md, paddingBottom: spacing.xl, paddingRight: spacing.md },
    card: {
      width: 160,
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      overflow: 'hidden',
      ...shadow.soft,
    },
    cardImage: { width: '100%', height: 110 },
    cardTitle: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.ink,
      marginTop: spacing.sm,
      marginHorizontal: spacing.sm,
      lineHeight: 16,
    },
    cardMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginHorizontal: spacing.sm,
      marginTop: 4,
      marginBottom: spacing.sm,
    },
    cardTime: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
    },
    toolsGrid: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xl },
    toolCard: {
      flex: 1,
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      padding: spacing.lg,
      alignItems: 'center',
      gap: spacing.sm,
    },
    toolIconWrap: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
    },
    toolLabel: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.ink,
      textAlign: 'center',
      lineHeight: 17,
    },
  });
}