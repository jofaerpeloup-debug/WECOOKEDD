import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import RecipeImage from '../components/RecipeImage';
import { listRecipes } from '../api/recipeService';
import { getRecipeErrorMessage } from '../api/recipeErrors';
import { DISCOVER_FILTERS, difficultyLabel } from '../api/recipeOptions';
import { recipeTimeLabel } from '../utils/recipe';

const PAGE_LIMIT = 20;
const FILTER_BY_KEY = Object.fromEntries(DISCOVER_FILTERS.map((f) => [f.key, f]));

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
  const [recipes, setRecipes] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [pageLoaded, setPageLoaded] = useState(0);
  const [phase, setPhase] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(null);

  // One monotonic generation per filter change / refresh. A response tagged
  // with a superseded generation is dropped instead of mutating the new list.
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
  // tap re-applies even when the value is unchanged.
  useEffect(() => {
    const key = route.params?.initialFilter;
    if (key && FILTER_BY_KEY[key]) {
      setActiveKey(key);
      navigation.setParams({ initialFilter: undefined });
    }
  }, [route.params?.initialFilter, navigation]);

  const queryFor = useCallback(
    (page) => ({ ...(FILTER_BY_KEY[activeKey]?.query || {}), page, limit: PAGE_LIMIT }),
    [activeKey]
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

  const renderItem = ({ item }) => (
    <Pressable style={styles.card} onPress={() => openRecipe(item)}>
      <RecipeImage source={item.imageUrl} style={styles.cardImage} />
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{item.title}</Text>
        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Ionicons name="time-outline" size={13} color={colors.inkFaint} />
            <Text style={styles.metaText}>{recipeTimeLabel(item)}</Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="stats-chart-outline" size={13} color={colors.inkFaint} />
            <Text style={styles.metaText}>{difficultyLabel(item.difficulty)}</Text>
          </View>
        </View>
      </View>
    </Pressable>
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
        <Text style={styles.emptyText}>No recipes match this filter yet.</Text>
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
      <TopBar mode="brand" />

      <View style={styles.filterRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.sm }}
        >
          {DISCOVER_FILTERS.map((f) => {
            const isActive = f.key === activeKey;
            return (
              <Pressable
                key={f.key}
                onPress={() => setActiveKey(f.key)}
                style={[styles.filterPill, isActive && styles.filterPillActive]}
              >
                <Text style={[styles.filterText, isActive && styles.filterTextActive]}>
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <FlatList
        data={recipes}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
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
        ListHeaderComponent={<Text style={styles.pageTitle}>Recipe Discovery</Text>}
        ListEmptyComponent={renderEmpty()}
        ListFooterComponent={renderFooter()}
      />
    </View>
  );
}

function makeStyles(colors, shadow) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    filterRow: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
    },
    filterPill: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.paper,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    filterPillActive: { backgroundColor: colors.sageDeep, borderColor: colors.sageDeep },
    filterText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
    },
    filterTextActive: { color: colors.onAccent },
    listContent: { padding: spacing.lg, paddingBottom: spacing.xxxl, flexGrow: 1 },
    pageTitle: {
      fontFamily: typography.display.fontFamily,
      fontSize: 22,
      color: colors.ink,
      marginBottom: spacing.lg,
    },
    card: {
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      overflow: 'hidden',
      marginBottom: spacing.xl,
      ...shadow.soft,
    },
    cardImage: { width: '100%', height: 190 },
    cardBody: { padding: spacing.lg },
    cardTitle: {
      fontFamily: typography.display.fontFamily,
      fontSize: 19,
      lineHeight: 24,
      color: colors.ink,
      marginBottom: spacing.sm,
    },
    metaRow: { flexDirection: 'row', gap: spacing.lg },
    metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    metaText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
    },
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