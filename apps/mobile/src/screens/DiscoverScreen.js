import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  Pressable,
  TextInput,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import RecipeImage from '../components/RecipeImage';
import FavoriteHeart from '../components/FavoriteHeart';
import { listRecipes } from '../api/recipeService';
import { getRecipeErrorMessage } from '../api/recipeErrors';
import { DISCOVER_FILTERS, difficultyLabel } from '../api/recipeOptions';
import { recipeTimeLabel } from '../utils/recipe';

// M2.2 — teammate Discover ("Search") visual port on top of our real data + routes.
//
// PRESENTATION comes from the teammate Discover screen (commit c1c86ed): the
// screen title, the filled search field, pill filter chips (active = deep sage),
// an uppercase result-count label, and compact image + title + meta result rows.
//
// DATA + ROUTES stay ours and are NOT regressed:
//   - recipes come from the Express REST API via `listRecipes` — the same
//     generation-guarded first-page / load-more / pull-to-refresh pipeline as
//     before. No mockData, no fake latency, no local recipe arrays.
//   - the search box is wired to the real backend `search` param (debounced,
//     trimmed, generation-guarded); it is NOT the teammate's client-side
//     title/description/ingredient scan over a mock array.
//   - cards keep the real `FavoriteHeart` (Favorites API) and `RecipeImage`
//     (backend `imageUrl` + the bundled fallback).
//   - navigation stays ours: RecipeDetail takes
//     `{ recipeSource:'api', recipeId, initialRecipe }`; the Dashboard handoff
//     param `initialFilter` ('all' | 'easy' | 'vegetarian' | 'vegan') is still
//     consumed on the already-mounted tab.
//   - the navigation shell is untouched: this stays a root-stack destination
//     with the shared `<TopBar mode="back">`; no PlusMenu or tab-arch port.
//
// Teammate parts that do not map onto our real model, represented honestly:
//   - the collapsible multi-group filter panel (Cooking Time / Difficulty /
//     multi-select Dietary) + the bottom "Show N recipes" CTA are a staged
//     apply-then-show flow. Our filters refetch immediately and the Dashboard
//     handoff carries exactly ONE filter key, so we keep a single-select chip
//     row mapped to the four real M2 filters. `cuisine` is intentionally NOT a
//     chip here — it was retired from the Recipe domain in M3. Real category +
//     Philippine-region browsing waits on a content-classification milestone.
//   - the teammate "Recent" chips read a shared SearchHistory context. Recent
//     searches are Dashboard-owned in our app (device-local, one store); Discover
//     does not open a second one.

const PAGE_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 300;

// The four real M2 Discover filters — the exact Dashboard handoff contract
// ('all' | 'easy' | 'vegetarian' | 'vegan'), taken from the shared
// `DISCOVER_FILTERS` source of truth so each keeps its real backend query.
// There is no cuisine/region/category chip: cuisine was retired in M3 and
// region/category have no controlled vocabulary yet.
const M2_FILTER_KEYS = ['all', 'easy', 'vegetarian', 'vegan'];
const M2_FILTERS = M2_FILTER_KEYS
  .map((key) => DISCOVER_FILTERS.find((f) => f.key === key))
  .filter(Boolean);
const FILTER_BY_KEY = Object.fromEntries(M2_FILTERS.map((f) => [f.key, f]));

function metaLine(recipe) {
  return [recipeTimeLabel(recipe), difficultyLabel(recipe.difficulty)]
    .filter(Boolean)
    .join(' · ');
}

function dedupeById(list) {
  const seen = new Set();
  const out = [];
  for (const r of list || []) {
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

function mergeById(prev, next) {
  const seen = new Set(prev.map((r) => r.id));
  const out = prev.slice();
  for (const r of next || []) {
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

export default function DiscoverScreen({ navigation, route }) {
  const { colors, shadow } = useTheme();
  const styles = makeStyles(colors, shadow);

  // Seed from a Home shortcut param on first mount so Discover fetches the
  // right filter once, instead of fetching "all" and then re-fetching.
  const [activeKey, setActiveKey] = useState(() => {
    const k = route.params?.initialFilter;
    return k && FILTER_BY_KEY[k] ? k : 'all';
  });

  // Real backend search: `search` is the live field value, `debouncedSearch`
  // is what actually reaches the API (trimmed, settled).
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [recipes, setRecipes] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [pageLoaded, setPageLoaded] = useState(0);
  const [phase, setPhase] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(null);

  // One monotonic generation per filter/search change / refresh. A response
  // tagged with a superseded generation is dropped instead of mutating the list.
  const genRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Consume an initial filter handed over from Home, then clear it so a repeat
  // tap re-applies even when the value is unchanged. A fresh filter intent also
  // clears any search the user had typed, so "Home -> Vegan" lands on the plain
  // Vegan list.
  useEffect(() => {
    const key = route.params?.initialFilter;
    if (key && FILTER_BY_KEY[key]) {
      setActiveKey(key);
      setSearch('');
      setDebouncedSearch('');
      navigation.setParams({ initialFilter: undefined });
    }
  }, [route.params?.initialFilter, navigation]);

  // Debounce the search field into `debouncedSearch`. Whitespace-only collapses
  // to '' (an unfiltered search), matching Dashboard.
  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === debouncedSearch) return undefined;
    const timer = setTimeout(() => setDebouncedSearch(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, debouncedSearch]);

  const queryFor = useCallback(
    (page) => ({
      ...(FILTER_BY_KEY[activeKey]?.query || {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      page,
      limit: PAGE_LIMIT,
    }),
    [activeKey, debouncedSearch]
  );

  const loadFirstPage = useCallback(
    async ({ refresh = false } = {}) => {
      const gen = ++genRef.current;
      loadingMoreRef.current = false;
      setMoreError(null);
      if (refresh) {
        setRefreshing(true);
      } else {
        setPhase('loading');
        setRecipes([]);
        setPagination(null);
        setPageLoaded(0);
      }
      setError(null);
      try {
        const data = await listRecipes(queryFor(1));
        if (!mountedRef.current || gen !== genRef.current) return;
        setRecipes(dedupeById(data.recipes));
        setPagination(data.pagination);
        setPageLoaded(1);
        setPhase('ready');
      } catch (err) {
        if (!mountedRef.current || gen !== genRef.current) return;
        setError(getRecipeErrorMessage(err));
        setPhase('error');
      } finally {
        if (mountedRef.current && gen === genRef.current) setRefreshing(false);
      }
    },
    [queryFor]
  );

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    if (phase !== 'ready' || !pagination) return;
    // Backend V1 behavior: the DB page is fetched BEFORE the non-admin "usable"
    // filter, so a page can arrive SHORT and `total` can overcount. A short
    // page is NOT terminal — page strictly against totalPages instead.
    if (pageLoaded >= (pagination.totalPages || 0)) return;

    loadingMoreRef.current = true;
    const gen = genRef.current;
    const nextPage = pageLoaded + 1;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const data = await listRecipes(queryFor(nextPage));
      if (!mountedRef.current || gen !== genRef.current) return;
      setRecipes((prev) => mergeById(prev, data.recipes));
      setPagination(data.pagination);
      setPageLoaded(nextPage);
    } catch (err) {
      if (!mountedRef.current || gen !== genRef.current) return;
      setMoreError(getRecipeErrorMessage(err));
    } finally {
      loadingMoreRef.current = false;
      if (mountedRef.current && gen === genRef.current) setLoadingMore(false);
    }
  }, [phase, pagination, pageLoaded, queryFor]);

  const openRecipe = (recipe) => {
    navigation.navigate('RecipeDetail', {
      recipeSource: 'api',
      recipeId: recipe.id,
      initialRecipe: recipe,
    });
  };

  const countLabel = useMemo(() => {
    if (phase !== 'ready') return null;
    const n = recipes.length;
    const more = pagination && pageLoaded < (pagination.totalPages || 0);
    return `${n}${more ? '+' : ''} recipe${n === 1 && !more ? '' : 's'}`;
  }, [phase, recipes.length, pagination, pageLoaded]);

  // The heart is a SIBLING of the card Pressable (not a child) so tapping it
  // never also triggers Recipe navigation. Shared Favorites API state — one
  // fetch in the provider, never one per card.
  const renderItem = ({ item }) => (
    <View style={styles.row}>
      <Pressable style={styles.rowMain} onPress={() => openRecipe(item)}>
        <RecipeImage source={item.imageUrl} style={styles.thumb} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {metaLine(item)}
          </Text>
        </View>
      </Pressable>
      <FavoriteHeart recipe={item} size={16} variant="plain" style={styles.rowHeart} />
    </View>
  );

  const renderEmpty = () => {
    if (phase === 'loading') {
      return (
        <View style={styles.centerBox}>
          <ActivityIndicator color={colors.sageDeep} />
        </View>
      );
    }
    if (phase === 'error') {
      return (
        <View style={styles.centerBox}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={() => loadFirstPage()} hitSlop={8}>
            <Ionicons name="refresh" size={14} color={colors.sageDeep} />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.centerBox}>
        <Text style={styles.emptyText}>
          {debouncedSearch
            ? `No recipes match “${debouncedSearch}”.`
            : 'No recipes match this filter yet.'}
        </Text>
      </View>
    );
  };

  const renderFooter = () => {
    if (loadingMore) {
      return (
        <View style={styles.footerBox}>
          <ActivityIndicator color={colors.sageDeep} />
        </View>
      );
    }
    if (moreError) {
      return (
        <Pressable style={styles.footerBox} onPress={loadMore} hitSlop={8}>
          <Text style={styles.errorText}>{moreError} Tap to retry.</Text>
        </Pressable>
      );
    }
    return null;
  };

  return (
    <View style={styles.root}>
      <TopBar mode="back" title="Discover" onBack={() => navigation.goBack()} />

      {/* Fixed search / filter header — kept out of the FlatList so the text
          field is never re-mounted by list virtualization. */}
      <View style={styles.header}>
        <Text style={styles.pageSub}>Search our kitchen, then narrow it down.</Text>

        <View style={styles.searchField}>
          <Ionicons name="search" size={15} color={colors.inkSoft} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search recipes..."
            placeholderTextColor={colors.inkFaint}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.inkFaint} />
            </Pressable>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.chipRow}
        >
          {M2_FILTERS.map((f) => {
            const isActive = f.key === activeKey;
            return (
              <Pressable
                key={f.key}
                onPress={() => setActiveKey(f.key)}
                style={[styles.chip, isActive && styles.chipActive]}
              >
                <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {countLabel && <Text style={styles.countLabel}>{countLabel} found</Text>}
      </View>

      <FlatList
        data={recipes}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadFirstPage({ refresh: true })}
            tintColor={colors.sageDeep}
            colors={[colors.sageDeep]}
          />
        }
        ListEmptyComponent={renderEmpty()}
        ListFooterComponent={renderFooter()}
      />
    </View>
  );
}

function makeStyles(colors, shadow) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    header: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
    },
    pageSub: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkFaint,
      marginTop: 2,
      marginBottom: spacing.md,
    },
    searchField: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.creamDeep,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      height: 44,
    },
    searchInput: {
      flex: 1,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.ink,
      outlineStyle: 'none',
    },
    chipRow: { gap: spacing.sm, paddingTop: spacing.md, paddingRight: spacing.md },
    chip: {
      paddingHorizontal: 15,
      paddingVertical: 9,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    chipActive: { backgroundColor: colors.sageDeep, borderColor: colors.sageDeep },
    chipText: {
      fontFamily: typography.body.semibold,
      fontSize: 13,
      color: colors.inkSoft,
    },
    chipTextActive: { color: colors.onAccent },
    countLabel: {
      fontFamily: typography.body.bold,
      fontSize: 11.5,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: colors.inkFaint,
      marginTop: spacing.md,
    },
    listContent: { padding: spacing.lg, paddingBottom: spacing.xxxl, flexGrow: 1 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      padding: spacing.sm,
      marginBottom: spacing.md,
      ...shadow.soft,
    },
    rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    thumb: {
      width: 64,
      height: 64,
      borderRadius: radius.sm,
      backgroundColor: colors.creamDeep,
    },
    rowText: { flex: 1 },
    rowTitle: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.base,
      lineHeight: 19,
      color: colors.ink,
    },
    rowMeta: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      marginTop: 3,
    },
    rowHeart: { paddingHorizontal: spacing.xs },
    centerBox: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.md,
      paddingVertical: spacing.xxxl,
    },
    footerBox: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.lg,
    },
    errorText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      textAlign: 'center',
    },
    emptyText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkFaint,
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
