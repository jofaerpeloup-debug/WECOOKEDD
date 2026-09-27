import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TopBar from '../components/TopBar';
import { getHistory } from '../api/cookHistoryService';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing, typography } from '../theme/theme';

const PAGE_LIMIT = 20;

function formatLabel(value) {
  if (!value) return null;
  return value.replace(/-/g, ' ');
}

function formatCompletedAt(completedAt) {
  return new Date(completedAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function metadataFor(item) {
  const { recipe } = item;
  const labels = [formatLabel(recipe.region), formatLabel(recipe.category), formatLabel(recipe.difficulty)]
    .filter(Boolean);
  const minutes = [recipe.prepTimeMinutes, recipe.cookTimeMinutes]
    .filter((value) => typeof value === 'number')
    .reduce((total, value) => total + value, 0);
  if (minutes > 0) labels.push(`${minutes} min`);
  if (item.servings !== null) labels.push(`${item.servings} serving${item.servings === 1 ? '' : 's'}`);
  return labels.join(' · ');
}

function historyErrorMessage(error) {
  if (error?.code === 'INVALID_COOK_HISTORY_PAYLOAD') {
    return 'Cooking history is temporarily unavailable because the server response was unexpected.';
  }
  return error?.message || 'Check your connection and try again.';
}

export default function CookingHistoryScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [phase, setPhase] = useState('loading');
  const [history, setHistory] = useState([]);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(null);

  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const firstPageGenerationRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const historyRef = useRef([]);
  const paginationRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  const loadFirstPage = useCallback(async ({ refresh = false } = {}) => {
    const generation = ++generationRef.current;
    firstPageGenerationRef.current = generation;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setLoadMoreError(null);
    if (refresh) {
      setRefreshing(true);
    } else {
      historyRef.current = [];
      setHistory([]);
      paginationRef.current = null;
      setError(null);
      setPhase('loading');
    }

    try {
      let nextPage = 1;
      let accumulated = [];
      let pagination = null;

      do {
        const result = await getHistory({ page: nextPage, limit: PAGE_LIMIT, sort: 'newest' });
        if (!mountedRef.current || generation !== generationRef.current) return false;
        accumulated = accumulated.concat(result.cookHistory);
        pagination = result.pagination;
        nextPage = pagination.page + 1;
      } while (accumulated.length === 0 && pagination.page < pagination.totalPages);

      historyRef.current = accumulated;
      setHistory(accumulated);
      paginationRef.current = pagination;
      setError(null);
      setPhase('ready');
      return true;
    } catch (requestError) {
      if (!mountedRef.current || generation !== generationRef.current) return false;
      setError(historyErrorMessage(requestError));
      setPhase(refresh && historyRef.current.length > 0 ? 'ready' : 'error');
      return false;
    } finally {
      if (firstPageGenerationRef.current === generation) firstPageGenerationRef.current = null;
      if (mountedRef.current && generation === generationRef.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (firstPageGenerationRef.current === generationRef.current) return;
    const currentPagination = paginationRef.current;
    if (loadingMoreRef.current || phase !== 'ready' || !currentPagination) return;
    if (currentPagination.page >= currentPagination.totalPages) return;

    const generation = generationRef.current;
    let nextPage = currentPagination.page + 1;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);

    try {
      let appended = [];
      let pagination = currentPagination;
      do {
        const result = await getHistory({ page: nextPage, limit: PAGE_LIMIT, sort: 'newest' });
        if (!mountedRef.current || generation !== generationRef.current) return;
        appended = appended.concat(result.cookHistory);
        pagination = result.pagination;
        nextPage = pagination.page + 1;
      } while (appended.length === 0 && pagination.page < pagination.totalPages);

      const merged = historyRef.current.concat(appended);
      historyRef.current = merged;
      setHistory(merged);
      paginationRef.current = pagination;
    } catch (requestError) {
      if (!mountedRef.current || generation !== generationRef.current) return;
      setLoadMoreError(historyErrorMessage(requestError));
    } finally {
      if (mountedRef.current && generation === generationRef.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [phase]);

  const renderHistoryItem = ({ item }) => {
    const completedDate = formatCompletedAt(item.completedAt);
    const metadata = metadataFor(item);
    return (
      <Pressable
        style={styles.card}
        onPress={() => navigation.navigate('RecipeDetail', {
          recipeSource: 'api',
          recipeId: item.recipe.id,
        })}
        accessibilityRole="button"
        accessibilityLabel={`${item.recipe.title}, cooked ${completedDate}`}
        accessibilityHint="Opens recipe details"
      >
        {item.recipe.imageUrl ? (
          <Image source={{ uri: item.recipe.imageUrl }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={styles.imageFallback} accessibilityElementsHidden>
            <Ionicons name="restaurant-outline" size={24} color={colors.sageDeep} />
          </View>
        )}
        <View style={styles.cardBody}>
          <Text style={styles.title} numberOfLines={2}>{item.recipe.title}</Text>
          {metadata ? <Text style={styles.meta} numberOfLines={2}>{metadata}</Text> : null}
          <Text style={styles.date}>Cooked {completedDate}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />
      </Pressable>
    );
  };

  const renderEmpty = () => {
    if (phase === 'loading') {
      return (
        <View style={styles.stateBox} accessibilityState={{ busy: true }}>
          <ActivityIndicator color={colors.sageDeep} accessibilityLabel="Loading cooking history" />
          <Text style={styles.stateText}>Loading cooking history…</Text>
        </View>
      );
    }
    if (phase === 'error') {
      return (
        <View style={styles.stateBox}>
          <Ionicons name="alert-circle-outline" size={28} color={colors.error} />
          <Text style={styles.stateTitle}>We couldn’t load cooking history</Text>
          <Text style={styles.stateText}>{error}</Text>
          <Pressable
            style={styles.retryButton}
            onPress={() => loadFirstPage()}
            accessibilityRole="button"
            accessibilityLabel="Retry loading cooking history"
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.stateBox}>
        <Ionicons name="restaurant-outline" size={28} color={colors.sageDeep} />
        <Text style={styles.stateTitle}>No cooking history yet</Text>
        <Text style={styles.stateText}>Recipes you finish in Cook Mode will appear here.</Text>
      </View>
    );
  };

  const renderFooter = () => {
    if (loadingMore) {
      return <ActivityIndicator style={styles.footer} color={colors.sageDeep} accessibilityLabel="Loading more cooking history" />;
    }
    if (loadMoreError) {
      return (
        <Pressable
          style={styles.footer}
          onPress={loadMore}
          accessibilityRole="button"
          accessibilityLabel="Retry loading more cooking history"
        >
          <Text style={styles.inlineError}>{loadMoreError} Tap to retry.</Text>
        </Pressable>
      );
    }
    return <View style={styles.footerSpace} />;
  };

  return (
    <View style={styles.root} accessibilityState={{ busy: refreshing }}>
      <TopBar mode="back" title="History" onBack={() => navigation.goBack()} />
      <FlatList
        data={history}
        keyExtractor={(item) => item.id}
        renderItem={renderHistoryItem}
        ListHeaderComponent={(
          <View style={styles.header}>
            <Text style={styles.heading} accessibilityRole="header">Cooking history</Text>
            <Text style={styles.subheading}>Your completed recipes, newest first.</Text>
            {error && phase === 'ready' ? <Text style={styles.inlineError}>{error}</Text> : null}
          </View>
        )}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        contentContainerStyle={styles.content}
        onEndReached={loadMore}
        onEndReachedThreshold={0.35}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadFirstPage({ refresh: true })}
            tintColor={colors.sageDeep}
            colors={[colors.sageDeep]}
            accessibilityLabel="Refresh cooking history"
          />
        )}
      />
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, flexGrow: 1 },
    header: { paddingTop: spacing.lg, paddingBottom: spacing.lg },
    heading: { fontFamily: typography.display.fontFamily, fontSize: typography.sizes.xxl, color: colors.ink },
    subheading: { marginTop: spacing.xs, fontFamily: typography.body.fontFamily, fontSize: typography.sizes.sm, color: colors.inkSoft },
    card: { minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md, padding: spacing.sm, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.lg },
    image: { width: 76, height: 76, borderRadius: radius.md, backgroundColor: colors.creamDeep },
    imageFallback: { width: 76, height: 76, borderRadius: radius.md, backgroundColor: colors.sagePale, alignItems: 'center', justifyContent: 'center' },
    cardBody: { flex: 1, minWidth: 0 },
    title: { fontFamily: typography.body.semibold, fontSize: typography.sizes.base, color: colors.ink },
    meta: { marginTop: spacing.xs, fontFamily: typography.body.fontFamily, fontSize: typography.sizes.xs, lineHeight: 16, color: colors.inkSoft, textTransform: 'capitalize' },
    date: { marginTop: spacing.sm, fontFamily: typography.body.medium, fontSize: typography.sizes.xs, color: colors.sageDeep },
    stateBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxxl, paddingHorizontal: spacing.lg, gap: spacing.sm },
    stateTitle: { fontFamily: typography.body.bold, fontSize: typography.sizes.md, color: colors.ink, textAlign: 'center' },
    stateText: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.sm, color: colors.inkSoft, textAlign: 'center' },
    retryButton: { marginTop: spacing.sm, minHeight: 44, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.sageDeep, paddingHorizontal: spacing.lg },
    retryText: { fontFamily: typography.body.semibold, color: colors.sageDeep },
    inlineError: { marginTop: spacing.sm, fontFamily: typography.body.fontFamily, fontSize: typography.sizes.sm, color: colors.error, textAlign: 'center' },
    footer: { paddingVertical: spacing.lg },
    footerSpace: { height: spacing.lg },
  });
}
