import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { listRecipes } from '../api/recipeService';
import { getRecipeErrorMessage } from '../api/recipeErrors';
import FavoriteHeart from '../components/FavoriteHeart';
import RecipeImage from '../components/RecipeImage';
import TopBar from '../components/TopBar';
import { useAuth } from '../context/AuthContext';
import useRecipeScreenRefresh from '../hooks/useRecipeScreenRefresh';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing, typography } from '../theme/theme';

const PAGE_LIMIT = 20;

function dedupeById(rows) {
  const seen = new Set();
  return (rows || []).filter((row) => {
    if (!row || seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

function mergeById(current, incoming) {
  const seen = new Set(current.map((row) => row.id));
  const merged = current.slice();
  for (const row of incoming || []) {
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged;
}

export default function TrendingScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { user } = useAuth();
  const ownerKey = String(user?.id || '');

  const [recipes, setRecipes] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [phase, setPhase] = useState('loading');
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(null);

  const mountedRef = useRef(true);
  const ownerRef = useRef(ownerKey);
  const generationRef = useRef(0);
  const firstPageRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const recipesRef = useRef([]);
  const paginationRef = useRef(null);
  ownerRef.current = ownerKey;

  useEffect(() => () => {
    mountedRef.current = false;
    generationRef.current += 1;
    firstPageRef.current = null;
    loadingMoreRef.current = false;
  }, []);

  const loadFirstPage = useCallback(async ({ refresh = false } = {}) => {
    const owner = ownerKey;
    const generation = ++generationRef.current;
    firstPageRef.current = generation;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setMoreError(null);
    if (refresh) {
      setRefreshing(true);
    } else {
      recipesRef.current = [];
      paginationRef.current = null;
      setRecipes([]);
      setPagination(null);
      setPhase('loading');
    }
    try {
      const data = await listRecipes({ sort: 'topRated', page: 1, limit: PAGE_LIMIT });
      if (!mountedRef.current || owner !== ownerRef.current || generation !== generationRef.current) return;
      const next = dedupeById(data.recipes);
      recipesRef.current = next;
      paginationRef.current = data.pagination;
      setRecipes(next);
      setPagination(data.pagination);
      setError(null);
      setPhase('ready');
    } catch (err) {
      if (!mountedRef.current || owner !== ownerRef.current || generation !== generationRef.current) return;
      setError(getRecipeErrorMessage(err));
      setPhase(refresh && recipesRef.current.length > 0 ? 'ready' : 'error');
    } finally {
      if (firstPageRef.current === generation) firstPageRef.current = null;
      if (mountedRef.current && owner === ownerRef.current && generation === generationRef.current) {
        setRefreshing(false);
      }
    }
  }, [ownerKey]);

  useEffect(() => {
    generationRef.current += 1;
    recipesRef.current = [];
    paginationRef.current = null;
    loadFirstPage();
  }, [loadFirstPage]);

  useRecipeScreenRefresh(() => loadFirstPage({ refresh: recipesRef.current.length > 0 }));

  const loadMore = useCallback(async () => {
    const currentPagination = paginationRef.current;
    if (firstPageRef.current === generationRef.current || loadingMoreRef.current) return;
    if (phase !== 'ready' || !currentPagination) return;
    if (currentPagination.page >= currentPagination.totalPages) return;

    const owner = ownerRef.current;
    const generation = generationRef.current;
    const nextPage = currentPagination.page + 1;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const data = await listRecipes({ sort: 'topRated', page: nextPage, limit: PAGE_LIMIT });
      if (!mountedRef.current || owner !== ownerRef.current || generation !== generationRef.current) return;
      const merged = mergeById(recipesRef.current, data.recipes);
      recipesRef.current = merged;
      paginationRef.current = data.pagination;
      setRecipes(merged);
      setPagination(data.pagination);
    } catch (err) {
      if (!mountedRef.current || owner !== ownerRef.current || generation !== generationRef.current) return;
      setMoreError(getRecipeErrorMessage(err));
    } finally {
      if (mountedRef.current && owner === ownerRef.current && generation === generationRef.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [phase]);

  const openRecipe = (recipe) => navigation.navigate('RecipeDetail', {
    recipeSource: 'api',
    recipeId: recipe.id,
    initialRecipe: recipe,
  });

  const renderRecipe = ({ item }) => (
    <View style={styles.card}>
      <Pressable
        style={styles.cardMain}
        onPress={() => openRecipe(item)}
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.title}`}
      >
        <RecipeImage source={item.imageUrl} style={styles.image} />
        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
          <Text style={styles.rating}>
            {`★ ${item.ratingSummary.averageRating.toFixed(1)} · ${item.ratingSummary.ratingCount} rating${item.ratingSummary.ratingCount === 1 ? '' : 's'}`}
          </Text>
        </View>
      </Pressable>
      <FavoriteHeart recipe={item} size={17} variant="plain" style={styles.heart} />
    </View>
  );

  const empty = () => {
    if (phase === 'loading') {
      return <View style={styles.state}><ActivityIndicator color={colors.sageDeep} /><Text style={styles.message}>Loading Trending Meals…</Text></View>;
    }
    if (phase === 'error') {
      return (
        <View style={styles.state}>
          <Ionicons name="alert-circle-outline" size={28} color={colors.sageDeep} />
          <Text style={styles.message}>{error}</Text>
          <Pressable style={styles.retry} onPress={() => loadFirstPage()} accessibilityRole="button" accessibilityLabel="Retry Trending Meals">
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      );
    }
    return <View style={styles.state}><Text style={styles.message}>No rated recipes yet.</Text></View>;
  };

  const footer = () => {
    if (loadingMore) return <ActivityIndicator style={styles.footer} color={colors.sageDeep} accessibilityLabel="Loading more Trending Meals" />;
    if (!moreError) return null;
    return (
      <Pressable style={styles.footer} onPress={loadMore} accessibilityRole="button" accessibilityLabel="Retry loading more Trending Meals">
        <Text style={styles.message}>{moreError} Tap to retry.</Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.root}>
      <TopBar mode="back" title="Trending Meals" onBack={() => navigation.goBack()} />
      <FlatList
        data={recipes}
        keyExtractor={(item) => item.id}
        renderItem={renderRecipe}
        contentContainerStyle={styles.list}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        onEndReached={loadMore}
        onEndReachedThreshold={0.35}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadFirstPage({ refresh: true })} tintColor={colors.sageDeep} />}
      />
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    list: { flexGrow: 1, padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxxl },
    card: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.lg, backgroundColor: colors.paper, padding: spacing.sm },
    cardMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    image: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.creamDeep },
    copy: { flex: 1 },
    title: { fontFamily: typography.body.semibold, fontSize: typography.sizes.base, color: colors.ink },
    rating: { marginTop: spacing.xs, fontFamily: typography.body.medium, fontSize: typography.sizes.sm, color: colors.inkSoft },
    heart: { marginLeft: spacing.sm },
    state: { flex: 1, minHeight: 280, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
    message: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.sm, color: colors.inkSoft, textAlign: 'center' },
    retry: { minHeight: 44, minWidth: 88, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.pill },
    retryText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.sm, color: colors.sageDeep },
    footer: { minHeight: 52, alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  });
}
