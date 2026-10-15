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
import { useSearchHistory } from '../context/SearchHistoryContext';
import { useAuth } from '../context/AuthContext';
import TopBar from '../components/TopBar';
import RecipeImage from '../components/RecipeImage';
import FavoriteHeart from '../components/FavoriteHeart';
import DiscoverFiltersSheet from '../components/DiscoverFiltersSheet';
import { listRecipes } from '../api/recipeService';
import { getRecipeErrorMessage } from '../api/recipeErrors';
import {
  categoryLabel,
  DISCOVER_SORT_OPTIONS,
  discoverSortLabel,
  DISCOVER_FILTERS,
  difficultyLabel,
  regionLabel,
} from '../api/recipeOptions';
import { recipeTimeLabel } from '../utils/recipe';
import { recipeCollectionPhaseAfterFailure } from '../utils/recipeFreshnessState';
import {
  activeFilterCount,
  discoverFilterQuery,
  presetFilters,
  presetFiltersState,
  selectedPresetKey,
} from '../utils/discoverFilters';
import useRecipeScreenRefresh from '../hooks/useRecipeScreenRefresh';

// M2.2 — teammate Discover ("Search") visual port on top of our real data + routes.
//
// PRESENTATION comes from the audited teammate Discover screen (commit bae924b): the
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
//   - this stays a root-stack destination with the shared
//     `<TopBar mode="back">`; no PlusMenu or tab-arch port.
//
// Teammate parts that do not map onto our real model, represented honestly:
//   - the collapsible multi-group filter panel (Cooking Time / Difficulty /
//     multi-select Dietary) + the bottom "Show N recipes" CTA are a staged
//     apply-then-show flow. Our filters refetch immediately and the Dashboard
//     handoff carries exactly ONE filter key, so we keep a single-select chip
//     row mapped to the four real M2 filters. `cuisine` is intentionally NOT a
//     chip here — it was retired from the Recipe domain in M3. Real category +
//     Philippine-region browsing waits on a content-classification milestone.
//   - Dashboard and Search read one authenticated-account-scoped, device-local
//     SearchHistory provider. Neither screen owns a second persisted store.

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
  return [categoryLabel(recipe.category), regionLabel(recipe.region), recipeTimeLabel(recipe), difficultyLabel(recipe.difficulty)]
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
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { user } = useAuth();
  const { recentSearches, recordSearch, clearSearchHistory } = useSearchHistory();
  const ownerKey = String(user?.id || '');

  // Seed from a Home shortcut param on first mount so Discover fetches the
  // right filter once, instead of fetching "all" and then re-fetching.
  const [appliedFilters, setAppliedFilters] = useState(() => {
    const k = route.params?.initialFilter;
    return presetFilters(k && FILTER_BY_KEY[k] ? k : 'all');
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activePresetKey = selectedPresetKey(appliedFilters);
  const filterCount = activeFilterCount(appliedFilters);
  const appliedSortLabel = discoverSortLabel(appliedFilters.sort);

  // Real backend search: `search` is the live field value, `debouncedSearch`
  // is what actually reaches the API (trimmed, settled).
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchRequestNonce, setSearchRequestNonce] = useState(0);

  const [recipes, setRecipes] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [pageLoaded, setPageLoaded] = useState(0);
  const [phase, setPhase] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(null);
  const [rankingNotice, setRankingNotice] = useState(null);

  // One monotonic generation per filter/search change / refresh. A response
  // tagged with a superseded generation is dropped instead of mutating the list.
  const genRef = useRef(0);
  // Generation that currently owns a first-page request. Unlike visible phase
  // state, this updates synchronously, so onEndReached cannot start load-more
  // during refresh or before a first-page state update has rendered.
  const firstPageGenRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const mountedRef = useRef(true);
  const recipesRef = useRef([]);
  const ownerRef = useRef(ownerKey);
  ownerRef.current = ownerKey;

  const invalidateForReplacement = useCallback(() => {
    genRef.current += 1;
    firstPageGenRef.current = null;
    loadingMoreRef.current = false;
    recipesRef.current = [];
    setRecipes([]);
    setPagination(null);
    setPageLoaded(0);
    setError(null);
    setMoreError(null);
    setRefreshing(false);
    setLoadingMore(false);
    setPhase('loading');
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      genRef.current += 1;
      firstPageGenRef.current = null;
      loadingMoreRef.current = false;
    };
  }, []);

  // Consume an initial filter handed over from Home, then clear it so a repeat
  // tap re-applies even when the value is unchanged. A fresh filter intent also
  // clears any search the user had typed, so "Home -> Vegan" lands on the plain
  // Vegan list.
  useEffect(() => {
    const key = route.params?.initialFilter;
    if (key && FILTER_BY_KEY[key]) {
      invalidateForReplacement();
      setAppliedFilters((current) => presetFiltersState(current, key));
      setSearch('');
      setDebouncedSearch('');
      navigation.setParams({ initialFilter: undefined });
    }
  }, [route.params?.initialFilter, navigation, invalidateForReplacement]);

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
      ...discoverFilterQuery(appliedFilters),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      page,
      limit: PAGE_LIMIT,
    }),
    [appliedFilters, debouncedSearch]
  );

  const loadFirstPage = useCallback(
    async ({ refresh = false } = {}) => {
      const owner = ownerKey;
      const gen = ++genRef.current;
      firstPageGenRef.current = gen;
      loadingMoreRef.current = false;
      setLoadingMore(false);
      setMoreError(null);
      if (appliedFilters.sort === 'relevance' && !debouncedSearch) {
        recipesRef.current = [];
        setRecipes([]);
        setPagination(null);
        setPageLoaded(0);
        setRefreshing(false);
        setPhase('ready');
        setRankingNotice('Enter a search term to sort by Relevance.');
        firstPageGenRef.current = null;
        return;
      }
      setRankingNotice(null);
      if (refresh) {
        setRefreshing(true);
      } else {
        setPhase('loading');
        recipesRef.current = [];
        setRecipes([]);
        setPagination(null);
        setPageLoaded(0);
      }
      try {
        const snapshot = queryFor(1);
        const data = await listRecipes(snapshot);
        if (!mountedRef.current || owner !== ownerRef.current || gen !== genRef.current) return;
        const nextRecipes = dedupeById(data.recipes);
        recipesRef.current = nextRecipes;
        setRecipes(nextRecipes);
        setPagination(data.pagination);
        setPageLoaded(1);
        setError(null);
        setPhase('ready');
      } catch (err) {
        if (!mountedRef.current || owner !== ownerRef.current || gen !== genRef.current) return;
        setError(getRecipeErrorMessage(err));
        setPhase(recipeCollectionPhaseAfterFailure(recipesRef.current, { background: refresh }));
      } finally {
        // A newer first-page request owns the guard once it replaces this
        // generation. Obsolete completion must never release that newer guard.
        if (firstPageGenRef.current === gen) firstPageGenRef.current = null;
        if (mountedRef.current && owner === ownerRef.current && gen === genRef.current) setRefreshing(false);
      }
    },
    [queryFor, appliedFilters.sort, debouncedSearch, ownerKey]
  );

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage, searchRequestNonce]);

  const refreshCurrent = () => {
    if (filtersOpen || search.trim() !== debouncedSearch) return;
    loadFirstPage({ refresh: true });
  };

  useRecipeScreenRefresh(refreshCurrent);

  const loadMore = useCallback(async () => {
    if (firstPageGenRef.current === genRef.current) return;
    if (loadingMoreRef.current) return;
    if (phase !== 'ready' || !pagination) return;
    // Server totals and page boundaries already reflect the complete eligible
    // result set. Continue strictly against authoritative totalPages.
    if (pageLoaded >= (pagination.totalPages || 0)) return;

    loadingMoreRef.current = true;
    const owner = ownerRef.current;
    const gen = genRef.current;
    const nextPage = pageLoaded + 1;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const snapshot = queryFor(nextPage);
      const data = await listRecipes(snapshot);
      if (!mountedRef.current || owner !== ownerRef.current || gen !== genRef.current) return;
      setRecipes((prev) => mergeById(prev, data.recipes));
      setPagination(data.pagination);
      setPageLoaded(nextPage);
    } catch (err) {
      if (!mountedRef.current || owner !== ownerRef.current || gen !== genRef.current) return;
      setMoreError(getRecipeErrorMessage(err));
    } finally {
      // A first-page load may have superseded this request and already reset
      // both load-more flags. Stale cleanup must not interfere with a newer
      // generation (including a later load-more request).
      if (mountedRef.current && owner === ownerRef.current && gen === genRef.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [phase, pagination, pageLoaded, queryFor]);

  const openRecipe = (recipe) => {
    if (search.trim()) recordSearch(search);
    navigation.navigate('RecipeDetail', {
      recipeSource: 'api',
      recipeId: recipe.id,
      initialRecipe: recipe,
    });
  };

  // One honest reset for the two controls this screen owns. It deliberately
  // does not introduce or mutate any additional filter/persistence state.
  const clearAll = () => {
    invalidateForReplacement();
    setSearch('');
    setDebouncedSearch('');
    setAppliedFilters((current) => presetFilters('all', current.sort));
  };

  const applyPreset = (key) => {
    invalidateForReplacement();
    setAppliedFilters((current) => presetFilters(key, current.sort));
  };

  const clearAppliedIngredient = () => {
    invalidateForReplacement();
    setAppliedFilters((current) => {
      const { ingredient, ...next } = current;
      return next;
    });
  };

  const applyAdvancedFilters = (filters) => {
    if (filters.sort === 'relevance' && !search.trim()) {
      setRankingNotice('Enter a search term to sort by Relevance.');
      return;
    }
    invalidateForReplacement();
    setFiltersOpen(false);
    setAppliedFilters(filters);
  };

  const changeSearch = (value) => {
    const nextSemanticQuery = String(value || '').trim();
    const currentSemanticQuery = search.trim();
    if (nextSemanticQuery === currentSemanticQuery) {
      setSearch(value);
      return;
    }

    invalidateForReplacement();
    setSearch(value);
    // Returning to the already-debounced query cannot rely on a state change
    // to schedule its replacement request. The nonce starts exactly one new
    // request after the incompatible visible-query owner was invalidated.
    if (nextSemanticQuery === debouncedSearch) {
      setSearchRequestNonce((nonce) => nonce + 1);
    }
  };

  const runSearchNow = (rawValue, { record = false } = {}) => {
    const value = String(rawValue || '').trim();
    if (record && value) recordSearch(value);
    const currentSemanticQuery = search.trim();
    if (value === currentSemanticQuery && value === debouncedSearch) {
      setSearch(value);
      return;
    }
    if (value !== currentSemanticQuery) invalidateForReplacement();
    setSearch(value);
    if (value === debouncedSearch) {
      setSearchRequestNonce((nonce) => nonce + 1);
    } else {
      setDebouncedSearch(value);
    }
  };

  const changeSort = (sort) => {
    if (sort === appliedFilters.sort) return;
    if (sort === 'relevance' && !search.trim()) {
      setRankingNotice('Enter a search term to sort by Relevance.');
      return;
    }
    invalidateForReplacement();
    setAppliedFilters((current) => ({ ...current, sort }));
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
      <Pressable
        style={styles.rowMain}
        onPress={() => openRecipe(item)}
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.title}`}
      >
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
          <ActivityIndicator
            color={colors.sageDeep}
            accessible
            accessibilityLabel="Loading recipes"
            accessibilityState={{ busy: true }}
          />
          <Text style={styles.stateMessage}>Loading recipes…</Text>
        </View>
      );
    }
    if (phase === 'error') {
      return (
        <View style={styles.centerBox}>
          <View style={styles.stateIcon}>
            <Ionicons name="alert-circle-outline" size={22} color={colors.sageDeep} />
          </View>
          <Text style={styles.stateTitle}>We couldn’t load recipes</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            style={styles.retryBtn}
            onPress={() => loadFirstPage()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Retry loading recipes"
          >
            <Ionicons name="refresh" size={14} color={colors.sageDeep} />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      );
    }
    if (rankingNotice) return null;
    return (
      <View style={styles.centerBox}>
        <View style={styles.stateIcon}>
          <Ionicons name="search-outline" size={22} color={colors.sageDeep} />
        </View>
        <Text style={styles.stateTitle}>Nothing matches</Text>
        <Text style={styles.stateMessage}>
          {rankingNotice || (debouncedSearch
            ? `No recipes match “${debouncedSearch}”.`
            : 'No recipes match this filter yet.')}
        </Text>
      </View>
    );
  };

  const renderFooter = () => {
    if (loadingMore) {
      return (
        <View style={styles.footerBox}>
          <ActivityIndicator
            color={colors.sageDeep}
            accessible
            accessibilityLabel="Loading more recipes"
            accessibilityState={{ busy: true }}
          />
        </View>
      );
    }
    if (moreError) {
      return (
        <Pressable
          style={styles.footerBox}
          onPress={loadMore}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Retry loading more recipes"
        >
          <Text style={styles.errorText}>{moreError} Tap to retry.</Text>
        </Pressable>
      );
    }
    return null;
  };

  return (
    <View style={styles.root}>
      <TopBar mode="back" title="Search" onBack={() => navigation.goBack()} />

      <FlatList
        data={recipes}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={(
      <View style={styles.header}>
        <Text style={styles.pageSub}>Search our kitchen, then narrow it down.</Text>

        <View style={styles.searchRow}>
          <View style={styles.searchField}>
            <Ionicons name="search" size={15} color={colors.inkSoft} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search recipes..."
              placeholderTextColor={colors.inkFaint}
              value={search}
              onChangeText={changeSearch}
              onSubmitEditing={() => runSearchNow(search, { record: true })}
              accessibilityLabel="Search recipes"
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect={false}
              maxLength={150}
              returnKeyType="search"
            />
            {search.length > 0 && (
              <Pressable
                onPress={() => runSearchNow('')}
                style={styles.searchClear}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={16} color={colors.inkFaint} />
              </Pressable>
            )}
          </View>
          {(search.length > 0 || filterCount > 0) && (
            <Pressable
              onPress={clearAll}
              style={styles.clearAllButton}
              accessibilityRole="button"
              accessibilityLabel="Clear search and filters"
            >
              <Text style={styles.clearText}>Clear</Text>
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
            const isActive = f.key === activePresetKey;
            return (
              <Pressable
                key={f.key}
                onPress={() => applyPreset(f.key)}
                style={[styles.chip, isActive && styles.chipActive]}
                accessibilityRole="button"
                accessibilityLabel={`Filter recipes by ${f.label}`}
                accessibilityState={{ selected: isActive }}
              >
                <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => (filtersOpen ? setFiltersOpen(false) : setFiltersOpen(true))}
            style={[styles.filterButton, filterCount > 0 && styles.filterButtonActive]}
            accessibilityRole="button"
            accessibilityLabel={
              filterCount > 0 ? `Filters, ${filterCount} active` : 'Filters, none active'
            }
            accessibilityHint="Expands inline recipe filters"
          >
            <Ionicons
              name="options-outline"
              size={15}
              color={filterCount > 0 ? colors.onAccent : colors.sageDeep}
            />
            <Text
              style={[styles.filterButtonText, filterCount > 0 && styles.filterButtonTextActive]}
            >
              {`Filters · ${filterCount}`}
            </Text>
            {filterCount > 0 && (
              <View style={styles.filterCount} accessibilityElementsHidden>
                <Text style={styles.filterCountText}>{filterCount}</Text>
              </View>
            )}
          </Pressable>
        </ScrollView>

        {!search.trim() && recentSearches.length > 0 && (
          <View style={styles.recentWrap}>
            <View style={styles.recentHead}>
              <Text style={styles.groupLabel}>Recent</Text>
              <Pressable
                onPress={clearSearchHistory}
                style={styles.recentClear}
                accessibilityRole="button"
                accessibilityLabel="Clear recent searches"
              >
                <Text style={styles.clearText}>Clear recent searches</Text>
              </Pressable>
            </View>
            <View style={styles.recentChips}>
              {recentSearches.map((term) => (
                <Pressable
                  key={term.toLocaleLowerCase()}
                  style={styles.recentChip}
                  onPress={() => runSearchNow(term, { record: true })}
                  accessibilityRole="button"
                  accessibilityLabel={`Search for ${term}`}
                >
                  <Ionicons name="time-outline" size={14} color={colors.inkFaint} />
                  <Text style={styles.recentChipText} numberOfLines={1}>{term}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <DiscoverFiltersSheet
          visible={filtersOpen}
          appliedFilters={appliedFilters}
          onCancel={() => setFiltersOpen(false)}
          onApply={applyAdvancedFilters}
        />

        <View style={styles.sortGroup}>
          <Text style={styles.groupLabel}>Sort</Text>
          <View style={styles.sortChoices}>
            {DISCOVER_SORT_OPTIONS.map((option) => {
              const selected = appliedFilters.sort === option.value;
              return (
                <Pressable
                  key={option.value}
                  style={[styles.sortChoice, selected && styles.sortChoiceSelected]}
                  onPress={() => changeSort(option.value)}
                  accessibilityRole="radio"
                  accessibilityLabel={`Sort: ${option.label}`}
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.sortChoiceText, selected && styles.sortChoiceTextSelected]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {rankingNotice && (
            <Text style={styles.errorText} accessibilityLiveRegion="polite">
              {rankingNotice}
            </Text>
          )}
        </View>

        <View style={styles.appliedSummary}>
          {appliedFilters.ingredient && (
            <View style={styles.appliedIngredientPill}>
              <Text style={styles.appliedIngredientText}>{appliedFilters.ingredient.name}</Text>
              <Pressable
                onPress={clearAppliedIngredient}
                style={styles.appliedIngredientClear}
                accessibilityRole="button"
                accessibilityLabel={`Remove ingredient filter ${appliedFilters.ingredient.name}`}
              >
                <Ionicons name="close" size={16} color={colors.sageDeep} />
              </Pressable>
            </View>
          )}
          <View
            style={styles.appliedSortPill}
            accessible
            accessibilityLabel={`Sorted by ${appliedSortLabel}`}
          >
            <Ionicons name="swap-vertical-outline" size={14} color={colors.inkSoft} />
            <Text style={styles.appliedSortText}>{appliedSortLabel}</Text>
          </View>
        </View>

        {countLabel && (
          <View style={styles.countRow}>
            <Text style={styles.countLabel}>{countLabel} found</Text>
          </View>
        )}
      </View>
        )}
        onEndReached={() => {
          if (!filtersOpen && search.trim() === debouncedSearch) loadMore();
        }}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
                onRefresh={refreshCurrent}
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

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    header: {
      paddingHorizontal: spacing.xl,
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
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    searchField: {
      flex: 1,
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
    searchClear: {
      minWidth: 44,
      minHeight: 44,
      marginRight: -spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    clearAllButton: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    clearText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.sageDeep,
    },
    chipRow: { gap: spacing.sm, paddingTop: spacing.md, paddingRight: spacing.md },
    groupLabel: {
      fontFamily: typography.body.bold,
      fontSize: 11.5,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: colors.sageDeep,
    },
    recentWrap: { paddingTop: spacing.lg, gap: spacing.sm },
    recentHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    recentClear: { minHeight: 44, justifyContent: 'center' },
    recentChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    recentChip: {
      minHeight: 44,
      maxWidth: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.hairline,
      backgroundColor: colors.paper,
    },
    recentChipText: {
      flexShrink: 1,
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
    },
    sortGroup: { paddingTop: spacing.lg, gap: spacing.sm },
    sortChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    sortChoice: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.hairline,
      backgroundColor: colors.paper,
    },
    sortChoiceSelected: { backgroundColor: colors.sageDeep, borderColor: colors.sageDeep },
    sortChoiceText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
    },
    sortChoiceTextSelected: { color: colors.onAccent },
    chip: {
      minWidth: 44,
      minHeight: 44,
      justifyContent: 'center',
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
    filterButton: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.sageDeep,
      backgroundColor: colors.paper,
    },
    filterButtonActive: { backgroundColor: colors.sageDeep },
    filterButtonText: {
      fontFamily: typography.body.semibold,
      fontSize: 13,
      color: colors.sageDeep,
    },
    filterButtonTextActive: { color: colors.onAccent },
    filterCount: {
      minWidth: 20,
      height: 20,
      paddingHorizontal: 5,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.cream,
    },
    filterCountText: {
      fontFamily: typography.body.bold,
      fontSize: typography.sizes.xs,
      color: colors.sageDeep,
    },
    appliedSummary: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: spacing.sm,
      paddingTop: spacing.sm,
    },
    appliedIngredientPill: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingLeft: spacing.md,
      borderWidth: 1,
      borderColor: colors.sageDeep,
      borderRadius: radius.pill,
      backgroundColor: colors.sagePale,
    },
    appliedIngredientText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.ink,
    },
    appliedIngredientClear: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    appliedSortPill: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      borderWidth: 1,
      borderColor: colors.hairline,
      borderRadius: radius.pill,
      backgroundColor: colors.paper,
    },
    appliedSortText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
    },
    countRow: {
      alignSelf: 'flex-start',
      marginTop: spacing.lg,
      marginBottom: spacing.xs,
    },
    countLabel: {
      fontFamily: typography.body.bold,
      fontSize: 11.5,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: colors.sageDeep,
    },
    listContent: { paddingBottom: spacing.xxxl, flexGrow: 1 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.creamDeep,
      borderRadius: radius.lg,
      padding: 10,
      marginHorizontal: spacing.xl,
      marginBottom: spacing.md,
    },
    rowMain: {
      flex: 1,
      minHeight: 60,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    thumb: {
      width: 60,
      height: 60,
      borderRadius: 10,
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
    rowHeart: { minWidth: 44, minHeight: 44, paddingHorizontal: spacing.xs },
    centerBox: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.md,
      paddingVertical: spacing.xxxl,
      paddingHorizontal: spacing.lg,
    },
    stateIcon: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.sagePale,
    },
    stateTitle: {
      fontFamily: typography.display.fontFamily,
      fontSize: typography.sizes.lg,
      color: colors.ink,
      textAlign: 'center',
    },
    stateMessage: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      lineHeight: 19,
      color: colors.inkFaint,
      textAlign: 'center',
      maxWidth: 280,
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
    retryBtn: {
      minHeight: 44,
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
