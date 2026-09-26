import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useAuth } from '../context/AuthContext';
import TopBar from '../components/TopBar';
import RecipeImage from '../components/RecipeImage';
import FavoriteHeart from '../components/FavoriteHeart';
import { listRecipes } from '../api/recipeService';
import { getRecipeErrorMessage } from '../api/recipeErrors';
import { difficultyLabel } from '../api/recipeOptions';
import { recipeTimeLabel } from '../utils/recipe';
import { shouldBlockRecipeFailure } from '../utils/recipeFreshnessState';
import { loadJSON, saveJSON } from '../utils/storage';
import useRecipeScreenRefresh from '../hooks/useRecipeScreenRefresh';

// M2.1 — teammate Dashboard/Home visual port on top of our real data + routes.
//
// PRESENTATION comes from the audited teammate Dashboard (commit 081a94b): time-of-day
// greeting, search + filter affordance, recent-search chips, a rotating
// daily-pick hero, a browse row, and a horizontal recipe rail.
//
// DATA + ROUTES stay ours and are NOT regressed:
//   - recipes come from the Express REST API via `listRecipes` (debounced,
//     generation-guarded search + a "latest" fetch). No mockData, no fake
//     loading, no local recipe arrays.
//   - recipe cards keep the real `FavoriteHeart` (Favorites API) and
//     `RecipeImage` (backend `imageUrl` + the existing bundled fallback).
//   - navigation uses OUR route names/params: RecipeDetail takes
//     `{ recipeSource:'api', recipeId, initialRecipe }`; every Dashboard ->
//     Discover jump goes through `openDiscover(key)` which ALWAYS passes an
//     explicit `initialFilter` ('all' for the filter button / "See all"), so
//     the Discover screen never keeps a stale shortcut. No
//     MainTabs replace/reset, no RootNavigator change.
//   - the header stays our shared `<TopBar mode="brand">` (wordmark + Saved +
//     bell), with the teammate Dashboard's `bookmark-outline` affordance wired
//     through TopBar's opt-in `onSavedPress` prop —
//     the only teammate-authoritative entry point into Saved/My Collections
//     (verified: no other teammate screen navigates there). Saved therefore
//     remains Dashboard-specific rather than automatic in brand mode.
//
// Teammate parts that need a backend we don't have yet are represented
// honestly, never faked:
//   - "Browse by craving" is category-driven in the teammate app. `category`
//     (+ Philippine `region`) exist on the Recipe domain as of M3 but have no
//     controlled vocabulary or classified content yet, and per the M2 locked
//     decisions we add no new cuisine-based UX here. So this row links to the
//     backend-supported Discover filters (difficulty / dietary) instead of
//     inventing category tiles or imagery.
//   - "Today's Pick" is a deterministic daily rotation FROM the real latest
//     recipes — not a curated/editorial "featured" flag (the backend has none).
//   - the notifications bell stays the shared TopBar affordance (a real
//     notifications feed is M9).
//
// Recent searches are device-local only (an allowed M2 decision): hydrated once
// from the shared `utils/storage` helper and written back by a single effect on
// every change (add / bump-to-front / clear). Never through auth/token storage.
// The chips show whenever history exists — including while a search is active —
// so a just-submitted query is visible immediately.

const SEARCH_DEBOUNCE_MS = 300;
const LATEST_LIMIT = 8;
const SEARCH_LIMIT = 20;

const RECENT_SEARCH_KEY = 'wecooked:recentSearches';
const RECENT_SEARCH_MAX = 6;

// Each shortcut maps to an EXACT backend-supported Discover filter key
// (see api/recipeOptions.js DISCOVER_FILTERS). No cuisine entry — `cuisine`
// was retired from the Recipe domain in M3 and the M2 decisions forbid new
// cuisine UX on Home.
const BROWSE_SHORTCUTS = [
  { key: 'easy', label: 'Easy', icon: 'flash-outline' },
  { key: 'vegetarian', label: 'Vegetarian', icon: 'leaf-outline' },
  { key: 'vegan', label: 'Vegan', icon: 'nutrition-outline' },
];

function greetingForNow(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function firstNameOf(user) {
  const raw = (user && user.name ? String(user.name) : '').trim();
  if (!raw) return 'Chef';
  return raw.replace(/^chef\s+/i, '').split(/\s+/)[0] || 'Chef';
}

// Deterministic "pick of the day" so the hero rotates once per day rather than
// on every render — over the real latest recipes, not a curated flag.
function featureIndexForToday(length, date = new Date()) {
  if (!length) return 0;
  const dayNumber = Math.floor(date.getTime() / 86400000);
  return ((dayNumber % length) + length) % length;
}

function metaLine(recipe) {
  return [recipeTimeLabel(recipe), difficultyLabel(recipe.difficulty)]
    .filter(Boolean)
    .join(' · ');
}

export default function DashboardScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { user } = useAuth();

  const firstName = firstNameOf(user);
  const greeting = greetingForNow();

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

  const [recent, setRecent] = useState([]);

  // Monotonic request generations — a slower earlier response is discarded once
  // a newer request (query change / retry / unmount) supersedes it.
  const mountedRef = useRef(true);
  const latestGenRef = useRef(0);
  const searchGenRef = useRef(0);
  // Gates the persist effect below so the initial hydrate never writes the
  // empty seed over stored history.
  const recentHydratedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Recent searches — device-local convenience only. Hydrate once from the
  // shared storage helper; a separate effect (below) is the ONLY writer, so
  // every mutation — add, bump, clear — persists the same way.
  useEffect(() => {
    let active = true;
    (async () => {
      const stored = await loadJSON(RECENT_SEARCH_KEY, []);
      if (!active || !mountedRef.current) return;
      if (Array.isArray(stored)) {
        setRecent(stored.filter((v) => typeof v === 'string').slice(0, RECENT_SEARCH_MAX));
      }
      recentHydratedRef.current = true;
    })();
    return () => {
      active = false;
    };
  }, []);

  // Single writer. Runs after every `recent` change once hydration is done.
  useEffect(() => {
    if (!recentHydratedRef.current) return;
    saveJSON(RECENT_SEARCH_KEY, recent);
  }, [recent]);

  const rememberSearch = useCallback((raw) => {
    const value = String(raw || '').trim();
    if (!value) return;
    setRecent((prev) => {
      const next = [
        value,
        ...prev.filter((v) => v.toLowerCase() !== value.toLowerCase()),
      ].slice(0, RECENT_SEARCH_MAX);
      // Same list, same order -> return the previous reference so React bails
      // and the persist effect does not re-fire.
      const unchanged = next.length === prev.length && next.every((v, i) => v === prev[i]);
      return unchanged ? prev : next;
    });
  }, []);

  const clearRecent = useCallback(() => {
    setRecent([]);
  }, []);

  const loadLatest = useCallback(async () => {
    const gen = ++latestGenRef.current;
    setLatestLoading(true);
    try {
      const { recipes } = await listRecipes({ sort: 'newest', limit: LATEST_LIMIT });
      if (!mountedRef.current || gen !== latestGenRef.current) return;
      setLatest(recipes);
      setLatestError(null);
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

  useRecipeScreenRefresh(() => {
    loadLatest();
    if (searching) {
      // Invalidate immediately, before the debounced replacement request starts,
      // so an older search response cannot win during the debounce window.
      searchGenRef.current += 1;
      setSearchNonce((value) => value + 1);
    }
  });

  // Debounced search. Backend `search` matches TITLE or DESCRIPTION only. The
  // generation guard makes a late response harmless.
  useEffect(() => {
    if (!searching) {
      searchGenRef.current += 1; // abandon any pending/in-flight search
      setResults([]);
      setSearchError(null);
      setSearchLoading(false);
      return undefined;
    }

    setSearchLoading(true);

    const timer = setTimeout(async () => {
      const gen = ++searchGenRef.current;
      try {
        const { recipes } = await listRecipes({ search: trimmed, page: 1, limit: SEARCH_LIMIT });
        if (!mountedRef.current || gen !== searchGenRef.current) return;
        setResults(recipes);
        setSearchError(null);
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
    // Opening a result means that query mattered — record it even if the user
    // never pressed the keyboard's search key.
    if (searching) rememberSearch(trimmed);
    navigation.navigate('RecipeDetail', {
      recipeSource: 'api',
      recipeId: recipe.id,
      initialRecipe: recipe,
    });
  };

  // Every Dashboard -> Discover navigation passes an EXPLICIT filter key so the
  // Discover screen never keeps a stale shortcut. 'all' is a real
  // DISCOVER_FILTERS key (unfiltered) that Discover's param effect consumes, so
  // "See all" / the filter button reliably clear a previously chosen shortcut.
  const openDiscover = (filterKey) =>
    navigation.navigate('Discover', { initialFilter: filterKey || 'all' });

  const feature = useMemo(() => {
    if (latest.length === 0) return null;
    return latest[featureIndexForToday(latest.length)];
  }, [latest]);

  const rail = useMemo(
    () => (feature ? latest.filter((r) => r.id !== feature.id) : latest),
    [latest, feature]
  );

  const renderErrorBlock = (message, onRetry) => (
    <View style={styles.stateBlock}>
      <View style={styles.stateIcon}>
        <Ionicons name="alert-circle-outline" size={21} color={colors.sageDeep} />
      </View>
      <Text style={styles.errorText}>{message}</Text>
      <Pressable style={styles.retryBtn} onPress={onRetry} hitSlop={8}>
        <Ionicons name="refresh" size={14} color={colors.sageDeep} />
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
    </View>
  );

  const renderLoadingBlock = (message = 'Loading recipes…') => (
    <View style={styles.stateBlock}>
      <ActivityIndicator color={colors.sageDeep} />
      <Text style={styles.stateMessage}>{message}</Text>
    </View>
  );

  const renderEmptyBlock = (message, icon = 'restaurant-outline') => (
    <View style={styles.stateBlock}>
      <View style={styles.stateIcon}>
        <Ionicons name={icon} size={21} color={colors.sageDeep} />
      </View>
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );

  // Horizontal rail card. The heart is a SIBLING of the navigating Pressable
  // (not a child) so a tap on it never also opens the recipe.
  const renderRailCard = (recipe) => (
    <View key={recipe.id} style={styles.railCard}>
      <Pressable onPress={() => openRecipe(recipe)}>
        <RecipeImage source={recipe.imageUrl} style={styles.railImage} />
        <Text style={styles.railTitle} numberOfLines={2}>
          {recipe.title}
        </Text>
        <Text style={styles.railMeta} numberOfLines={1}>
          {metaLine(recipe)}
        </Text>
      </Pressable>
      <FavoriteHeart recipe={recipe} size={15} variant="overlay" style={styles.railHeart} />
    </View>
  );

  const renderSearchRow = (recipe) => (
    <View key={recipe.id} style={styles.resultRow}>
      <Pressable style={styles.resultMain} onPress={() => openRecipe(recipe)}>
        <RecipeImage source={recipe.imageUrl} style={styles.resultThumb} />
        <View style={styles.resultTextWrap}>
          <Text style={styles.resultTitle} numberOfLines={1}>
            {recipe.title}
          </Text>
          <Text style={styles.resultMeta} numberOfLines={1}>
            {metaLine(recipe)}
          </Text>
        </View>
      </Pressable>
      <FavoriteHeart recipe={recipe} size={16} variant="plain" style={styles.resultHeart} />
    </View>
  );

  return (
    <View style={styles.root}>
      <TopBar mode="brand" onSavedPress={() => navigation.navigate('Saved')} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.greetingSub}>
          {greeting}, {firstName}
        </Text>
        <Text style={styles.greeting}>What shall we cook today?</Text>

        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={16} color={colors.inkSoft} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search recipes by name..."
              placeholderTextColor={colors.inkFaint}
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => rememberSearch(trimmed)}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect={false}
              returnKeyType="search"
            />
            {searching && (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={17} color={colors.inkFaint} />
              </Pressable>
            )}
          </View>
          <Pressable
            style={styles.filterBtn}
            onPress={() => openDiscover()}
            accessibilityRole="button"
            accessibilityLabel="Open recipe filters"
          >
            <Ionicons name="options-outline" size={18} color={colors.onAccent} />
          </Pressable>
        </View>

        {recent.length > 0 && (
          <View style={styles.recentWrap}>
            <View style={styles.recentHead}>
              <Text style={styles.eyebrow}>Recent searches</Text>
              <Pressable hitSlop={8} onPress={clearRecent}>
                <Text style={styles.linkText}>Clear</Text>
              </Pressable>
            </View>
            <View style={styles.recentChips}>
              {recent.map((term) => (
                <Pressable
                  key={term}
                  style={styles.recentChip}
                  onPress={() => {
                    setQuery(term);
                    rememberSearch(term);
                  }}
                >
                  <Ionicons name="time-outline" size={12} color={colors.inkFaint} />
                  <Text style={styles.recentChipText} numberOfLines={1}>
                    {term}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {searching ? (
          <View style={styles.searchSection}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionLabel}>Results for “{trimmed}”</Text>
              {searchLoading && results.length > 0 && (
                <ActivityIndicator size="small" color={colors.sageDeep} />
              )}
            </View>
            {searchLoading && results.length === 0 ? (
              renderLoadingBlock('Searching recipes…')
            ) : shouldBlockRecipeFailure(searchError, results, { background: true }) ? (
              renderErrorBlock(searchError, () => setSearchNonce((n) => n + 1))
            ) : results.length === 0 ? (
              renderEmptyBlock(`No recipes match “${trimmed}”.`, 'search-outline')
            ) : (
              <View style={styles.resultList}>{results.map(renderSearchRow)}</View>
            )}
          </View>
        ) : (
          <>
            {/* Today's Pick — a daily rotation from the real latest recipes. */}
            {latestLoading && latest.length === 0 ? (
              renderLoadingBlock()
            ) : shouldBlockRecipeFailure(latestError, latest, { background: true }) ? (
              renderErrorBlock(latestError, loadLatest)
            ) : feature ? (
              <>
                <Pressable style={styles.hero} onPress={() => openRecipe(feature)}>
                  <RecipeImage source={feature.imageUrl} style={styles.heroImage} />
                  {/* Plain stacked overlay for text legibility — NOT
                      expo-linear-gradient (proven not to paint on the
                      Samsung/Fabric runtime this app was tested on). */}
                  <View style={styles.heroScrim} pointerEvents="none" />
                  <Text style={styles.heroEyebrow}>TODAY'S PICK</Text>
                  <View style={styles.heroTextWrap}>
                    <Text style={styles.heroTitle} numberOfLines={2}>
                      {feature.title}
                    </Text>
                    <Text style={styles.heroMeta}>{metaLine(feature)}</Text>
                  </View>
                  <View style={styles.heroPlay}>
                    <Ionicons name="play" size={14} color={colors.onAccent} />
                  </View>
                </Pressable>

                <View style={styles.eyebrowRow}>
                  <Text style={styles.eyebrow}>Browse</Text>
                  <Pressable hitSlop={8} onPress={() => openDiscover()}>
                    <Text style={styles.linkText}>See all</Text>
                  </Pressable>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.browseRow}
                >
                  {BROWSE_SHORTCUTS.map((shortcut) => (
                    <Pressable
                      key={shortcut.key}
                      style={styles.browseChip}
                      onPress={() => openDiscover(shortcut.key)}
                    >
                      <View style={styles.browseIcon}>
                        <Ionicons name={shortcut.icon} size={21} color={colors.sageDeep} />
                      </View>
                      <Text style={styles.browseLabel}>{shortcut.label}</Text>
                    </Pressable>
                  ))}
                </ScrollView>

                <View style={styles.eyebrowRow}>
                  <Text style={styles.eyebrow}>Latest recipes</Text>
                  <Pressable hitSlop={8} onPress={() => openDiscover()}>
                    <Text style={styles.linkText}>See all</Text>
                  </Pressable>
                </View>
                {rail.length === 0 ? (
                  renderEmptyBlock('No other recipes yet.')
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.railRow}
                  >
                    {rail.map(renderRailCard)}
                  </ScrollView>
                )}
              </>
            ) : (
              renderEmptyBlock('No recipes yet.')
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    scroll: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.lg,
      paddingBottom: spacing.xxxl,
    },

    greetingSub: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.inkSoft,
      marginTop: spacing.md,
    },
    greeting: {
      fontFamily: typography.display.fontFamily,
      fontSize: 22,
      color: colors.ink,
      marginTop: 2,
      marginBottom: spacing.xl,
    },

    searchRow: { flexDirection: 'row', gap: 10, marginBottom: spacing.xl },
    searchBar: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.creamDeep,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      height: 44,
    },
    searchInput: {
      flex: 1,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.ink,
      outlineStyle: 'none',
    },
    filterBtn: {
      width: 44,
      height: 44,
      borderRadius: radius.md,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },

    recentWrap: { marginBottom: spacing.xl },
    recentHead: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
    },
    recentChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    recentChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      maxWidth: '100%',
      paddingHorizontal: spacing.md,
      paddingVertical: 7,
      borderRadius: radius.pill,
      backgroundColor: colors.creamDeep,
    },
    recentChipText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      flexShrink: 1,
    },

    eyebrowRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    eyebrow: {
      fontFamily: typography.body.bold,
      fontSize: typography.sizes.xs,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: colors.inkFaint,
    },
    linkText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.sageDeep,
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

    hero: {
      borderRadius: radius.xl,
      overflow: 'hidden',
      height: 190,
      backgroundColor: colors.creamDeep,
      marginBottom: spacing.xxl,
    },
    heroImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
    heroScrim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(18,22,14,0.42)',
    },
    heroEyebrow: {
      position: 'absolute',
      left: spacing.lg,
      top: spacing.md,
      fontFamily: typography.body.bold,
      fontSize: 10.5,
      letterSpacing: 1.2,
      color: colors.stone,
    },
    heroTextWrap: { position: 'absolute', left: spacing.lg, right: 68, bottom: spacing.md },
    heroTitle: {
      fontFamily: typography.display.fontFamily,
      fontSize: 21,
      lineHeight: 25,
      color: '#FAF9F6',
    },
    heroMeta: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: 'rgba(250,249,246,0.85)',
      marginTop: 6,
    },
    heroPlay: {
      position: 'absolute',
      right: spacing.lg,
      bottom: spacing.lg,
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },

    browseRow: { gap: spacing.lg, paddingBottom: spacing.xxl, paddingRight: spacing.md },
    browseChip: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      width: 78,
    },
    browseIcon: {
      width: 62,
      height: 62,
      borderRadius: 31,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.paper,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    browseLabel: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
    },

    railRow: { gap: spacing.md, paddingBottom: spacing.xl, paddingRight: spacing.md },
    railCard: {
      width: 168,
      padding: spacing.sm,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      backgroundColor: colors.paper,
    },
    railImage: {
      width: '100%',
      height: 112,
      borderRadius: radius.md,
      backgroundColor: colors.creamDeep,
    },
    railHeart: {
      position: 'absolute',
      top: spacing.md,
      right: spacing.md,
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: 'rgba(255,255,255,0.92)',
    },
    railTitle: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.ink,
      marginTop: spacing.sm,
      lineHeight: 16,
    },
    railMeta: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      marginTop: 3,
    },

    searchSection: { marginTop: spacing.xs },
    resultList: { gap: spacing.md },
    resultRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.hairline,
      backgroundColor: colors.paper,
    },
    resultMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    resultThumb: {
      width: 56,
      height: 56,
      borderRadius: radius.md,
      backgroundColor: colors.creamDeep,
    },
    resultTextWrap: { flex: 1 },
    resultTitle: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.base,
      color: colors.ink,
    },
    resultMeta: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      marginTop: 3,
    },
    resultHeart: { paddingHorizontal: spacing.xs },

    emptyText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkFaint,
      textAlign: 'center',
    },
    stateBlock: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.md,
      paddingVertical: spacing.xl,
      marginBottom: spacing.xl,
    },
    stateIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.sagePale,
    },
    stateMessage: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkFaint,
      textAlign: 'center',
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
  });
}
