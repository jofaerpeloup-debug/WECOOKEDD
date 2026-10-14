import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import Button from '../components/Button';
import RecipeImage from '../components/RecipeImage';
import FavoriteHeart from '../components/FavoriteHeart';
import { useFavorites } from '../context/FavoritesContext';
import { useCollections } from '../context/CollectionsContext';
import { useAuth } from '../context/AuthContext';
import * as collectionService from '../api/collectionService';
import { getCollectionErrorMessage } from '../api/collectionErrors';
import { getRecipeErrorMessage } from '../api/recipeErrors';
import { getSmartCollection, SMART_COLLECTION_DEFINITIONS } from '../api/recipeService';
import { recipeTimeLabel } from '../utils/recipe';
import { categoryLabel, regionLabel, difficultyLabel } from '../api/recipeOptions';

// CollectionDetail is the real stack destination Saved's "My Collections"
// grid navigates into (teammate `c1c86ed` CollectionDetailScreen row
// presentation, ported here). It supports two real collection types:
//   - { collectionType: 'favorites' }                          — the system
//     collection, backed solely by FavoritesContext/the real API.
//   - { collectionType: 'user', collectionId: '<mongo id>' }    — a real
//     user-created collection (M5A), backed by CollectionsContext/
//     collectionService. `collectionId` is always a real backend id, never
//     fabricated; this screen fetches authoritative data itself rather than
//     trusting anything passed through navigation params beyond the id.
// Any other/unknown collectionType shows an honest "isn't available yet" —
// nothing is ever fabricated for an unsupported case.

const USER_COLLECTION_RECIPE_LIMIT = 100;
const SMART_COLLECTION_PAGE_LIMIT = 20;

// Short classifier line: category, then region (both optional canonical slugs,
// absent on legacy records), then difficulty as a last resort. `cuisine` is
// retired. Never fabricated for a recipe that has none of these.
function metaLabel(recipe) {
  return (
    categoryLabel(recipe.category) ||
    regionLabel(recipe.region) ||
    difficultyLabel(recipe.difficulty) ||
    'Recipe'
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.md,
    },
    title: { fontFamily: typography.display.fontFamily, fontSize: 20, color: colors.ink },
    count: { fontFamily: typography.body.fontFamily, fontSize: 12, color: colors.inkFaint, marginTop: 1 },
    iconBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.creamDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    centerWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xxl,
      gap: spacing.md,
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
    scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl, gap: 10 },
    emptyScroll: { flexGrow: 1 },
    emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
    empty: {
      fontFamily: typography.body.fontFamily,
      fontSize: 13,
      color: colors.inkFaint,
      textAlign: 'center',
      paddingVertical: 32,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.creamDeep,
      borderRadius: 14,
      paddingRight: 8,
    },
    rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 },
    thumb: { width: 60, height: 60, borderRadius: 10, backgroundColor: colors.paper },
    rowTitle: { fontFamily: typography.body.semibold, fontSize: 13.5, color: colors.ink },
    rowMeta: { fontFamily: typography.body.fontFamily, fontSize: 11.5, color: colors.inkFaint, marginTop: 4 },
    rowRemove: { padding: 6 },
    listFooter: { paddingVertical: spacing.lg, alignItems: 'center', gap: spacing.sm },
  });
}

function Header({ styles, colors, insets, title, count, countText, onBack, onDelete, deleteDisabled = false }) {
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable style={styles.iconBtn} hitSlop={8} onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back">
        <Ionicons name="chevron-back" size={18} color={colors.ink} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} accessibilityRole="header">{title}</Text>
        {(count != null || countText) && (
          <Text style={styles.count}>
            {countText || `${count} ${count === 1 ? 'recipe' : 'recipes'}`}
          </Text>
        )}
      </View>
      {onDelete && (
        <Pressable hitSlop={8} onPress={onDelete} disabled={deleteDisabled} accessibilityRole="button" accessibilityLabel="Delete collection" accessibilityState={{ disabled: deleteDisabled }}>
          <Ionicons name="trash-outline" size={18} color={colors.error} />
        </Pressable>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Favorites branch — unchanged real behavior, backed solely by
// FavoritesContext/the real API.
// ---------------------------------------------------------------------------
function FavoritesCollectionDetail({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();

  const { favorites, status, error, reload } = useFavorites();
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  const openRecipe = (recipe) => {
    // The favorite's nested recipe IS the real backend summary (not a
    // teammate mock object) — hand it over as `initialRecipe` for immediate
    // paint while RecipeDetail performs its authoritative GET by `recipeId`,
    // which then fully replaces it.
    navigation.navigate('RecipeDetail', {
      recipeSource: 'api',
      recipeId: recipe.id,
      initialRecipe: recipe,
    });
  };

  const header = (title, count) => (
    <Header
      styles={styles}
      colors={colors}
      insets={insets}
      title={title}
      count={count}
      onBack={() => navigation.goBack()}
    />
  );

  // Initial load, nothing to show yet.
  if ((status === 'loading' || status === 'idle') && favorites.length === 0) {
    return (
      <View style={styles.root}>
        {header('Favorites', favorites.length)}
        <View style={styles.centerWrap}>
          <ActivityIndicator color={colors.sageDeep} />
        </View>
      </View>
    );
  }

  // Initial load failed with nothing to show.
  if (status === 'error' && favorites.length === 0) {
    return (
      <View style={styles.root}>
        {header('Favorites', favorites.length)}
        <View style={styles.centerWrap}>
          <Ionicons name="cloud-offline-outline" size={28} color={colors.inkFaint} />
          <Text style={styles.errorText}>{error || 'Couldn’t load your favorites.'}</Text>
          <Pressable style={styles.retryBtn} onPress={() => reload()} hitSlop={8}>
            <Ionicons name="refresh" size={14} color={colors.sageDeep} />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {header('Favorites', favorites.length)}
      {favorites.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyScroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.sageDeep}
              colors={[colors.sageDeep]}
            />
          }
        >
          <View style={styles.emptyWrap}>
            <Text style={styles.empty}>Nothing here yet.</Text>
            <Button
              title="Discover Recipes"
              variant="primary"
              onPress={() => navigation.navigate('Discover')}
              style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}
            />
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.sageDeep}
              colors={[colors.sageDeep]}
            />
          }
        >
          {favorites.map((entry) => (
            <View key={entry.recipe.id} style={styles.row}>
              <Pressable style={styles.rowMain} onPress={() => openRecipe(entry.recipe)}>
                <RecipeImage source={entry.recipe.imageUrl} style={styles.thumb} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {entry.recipe.title}
                  </Text>
                  <Text style={styles.rowMeta}>
                    {[recipeTimeLabel(entry.recipe), metaLabel(entry.recipe)].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </Pressable>
              <FavoriteHeart recipe={entry.recipe} size={18} variant="plain" style={styles.rowRemove} />
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// User collection branch (M5A) — real backend data via collectionService/
// CollectionsContext. Fetches its own recipe rows locally (CollectionsContext
// only tracks the Saved-screen card summaries, not full membership lists);
// mutations that affect the shared card (create/delete/recipeCount) go
// through CollectionsContext so Saved stays in sync on the next focus.
// Removing a recipe here NEVER calls Favorites' remove — Collections and
// Favorites are separate domains (see RecipeDetail's FavoriteHeart vs
// Collections icon).
// ---------------------------------------------------------------------------
function UserCollectionDetail({ navigation, collectionId }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const { status: authStatus, user } = useAuth();
  const ownerId = authStatus === 'authenticated' ? user?.id : null;
  const { deleteCollection, removeRecipeFromCollection } = useCollections();

  const [collection, setCollection] = useState(null);
  const [recipes, setRecipes] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [acceptedKey, setAcceptedKey] = useState(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [error, setError] = useState(null);
  const [failedKey, setFailedKey] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(null);
  const sessionRef = useRef(0);
  const focusEpochRef = useRef(0);
  const activeRef = useRef(false);
  const mountedRef = useRef(true);
  const pageOnePendingRef = useRef(false);
  const morePendingRef = useRef(false);
  const moreErrorRef = useRef(null);
  const removePendingRef = useRef(null);
  const mutationGenerationRef = useRef(0);
  const queuedRefreshKeyRef = useRef(null);
  const recipesRef = useRef([]);
  const paginationRef = useRef(null);
  const acceptedKeyRef = useRef(null);
  const currentKey = `${ownerId || ''}:${collectionId}`;
  const currentKeyRef = useRef(currentKey);
  currentKeyRef.current = currentKey;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadPageOne = useCallback(async ({ retainRows = false } = {}) => {
    if (!activeRef.current || !ownerId || pageOnePendingRef.current) return;
    if (removePendingRef.current?.key === currentKey) {
      queuedRefreshKeyRef.current = currentKey;
      return;
    }
    const session = ++sessionRef.current;
    pageOnePendingRef.current = true;
    morePendingRef.current = false;
    setLoadingMore(false);
    moreErrorRef.current = null;
    setMoreError(null);
    if (retainRows && acceptedKeyRef.current === currentKey) setRefreshing(true);
    else setStatus('loading');
    const stale = () => !activeRef.current || session !== sessionRef.current
      || currentKeyRef.current !== currentKey;
    try {
      const [collectionData, result] = await Promise.all([
        collectionService.getCollection(collectionId),
        collectionService.listCollectionRecipes(collectionId, {
          page: 1,
          limit: USER_COLLECTION_RECIPE_LIMIT,
          sort: 'newest',
        }),
      ]);
      if (stale()) return;
      const seen = new Set();
      const fetchedRecipes = result.recipes.filter((entry) => {
        const id = entry.recipe?.id || entry.id;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      recipesRef.current = fetchedRecipes;
      paginationRef.current = result.pagination;
      acceptedKeyRef.current = currentKey;
      setCollection(collectionData);
      setRecipes(fetchedRecipes);
      setPagination(result.pagination);
      setAcceptedKey(currentKey);
      setError(null);
      setFailedKey(null);
      setStatus('ready');
    } catch (err) {
      if (stale()) return;
      setError(getCollectionErrorMessage(err));
      setFailedKey(currentKey);
      setStatus(acceptedKeyRef.current === currentKey ? 'ready' : 'error');
    } finally {
      if (!stale()) {
        pageOnePendingRef.current = false;
        setRefreshing(false);
      }
    }
  }, [collectionId, currentKey, ownerId]);

  useFocusEffect(
    useCallback(() => {
      activeRef.current = true;
      focusEpochRef.current += 1;
      mutationGenerationRef.current += 1;
      removePendingRef.current = null;
      queuedRefreshKeyRef.current = null;
      setPendingRemoval(null);
      sessionRef.current += 1;
      pageOnePendingRef.current = false;
      morePendingRef.current = false;
      recipesRef.current = [];
      paginationRef.current = null;
      acceptedKeyRef.current = null;
      setCollection(null);
      setRecipes([]);
      setPagination(null);
      setAcceptedKey(null);
      setError(null);
      setFailedKey(null);
      moreErrorRef.current = null;
      setMoreError(null);
      setRefreshing(false);
      setLoadingMore(false);
      setStatus('loading');
      loadPageOne();
      return () => {
        activeRef.current = false;
        focusEpochRef.current += 1;
        mutationGenerationRef.current += 1;
        removePendingRef.current = null;
        queuedRefreshKeyRef.current = null;
        sessionRef.current += 1;
        pageOnePendingRef.current = false;
        morePendingRef.current = false;
      };
    }, [loadPageOne])
  );

  const onRefresh = useCallback(() => loadPageOne({ retainRows: true }), [loadPageOne]);

  const loadMore = useCallback(async () => {
    const current = paginationRef.current;
    if (!activeRef.current || !current || current.page >= current.totalPages
      || morePendingRef.current || pageOnePendingRef.current || acceptedKeyRef.current !== currentKey
      || removePendingRef.current?.key === currentKey) return;
    const session = sessionRef.current;
    const nextPage = current.page + 1;
    morePendingRef.current = true;
    setLoadingMore(true);
    const stale = () => !activeRef.current || session !== sessionRef.current
      || currentKeyRef.current !== currentKey;
    try {
      const result = await collectionService.listCollectionRecipes(collectionId, {
        page: nextPage, limit: USER_COLLECTION_RECIPE_LIMIT, sort: 'newest',
      });
      if (stale()) return;
      const seen = new Set(recipesRef.current.map((entry) => entry.recipe?.id || entry.id));
      const appended = result.recipes.filter((entry) => {
        const id = entry.recipe?.id || entry.id;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      const nextRecipes = [...recipesRef.current, ...appended];
      recipesRef.current = nextRecipes;
      paginationRef.current = result.pagination;
      setRecipes(nextRecipes);
      setPagination(result.pagination);
      moreErrorRef.current = null;
      setMoreError(null);
    } catch (err) {
      if (!stale()) {
        moreErrorRef.current = getCollectionErrorMessage(err);
        setMoreError(moreErrorRef.current);
      }
    } finally {
      if (!stale()) {
        morePendingRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [collectionId, currentKey]);

  const openRecipe = (recipe) => {
    navigation.navigate('RecipeDetail', {
      recipeSource: 'api',
      recipeId: recipe.id,
      initialRecipe: recipe,
    });
  };

  const removeRecipe = async (recipeId) => {
    if (!activeRef.current || !ownerId || currentKeyRef.current !== currentKey
      || acceptedKeyRef.current !== currentKey || removePendingRef.current) return;
    const focusEpoch = focusEpochRef.current;
    const mutation = { ownerId, collectionId, key: currentKey, focusEpoch,
      generation: ++mutationGenerationRef.current, recipeId };
    removePendingRef.current = mutation;
    setPendingRemoval(mutation);
    // A GET already in flight may have observed the pre-deletion membership.
    if (pageOnePendingRef.current) queuedRefreshKeyRef.current = currentKey;
    sessionRef.current += 1;
    pageOnePendingRef.current = false;
    morePendingRef.current = false;
    setRefreshing(false);
    setLoadingMore(false);
    let result;
    try {
      result = await removeRecipeFromCollection(collectionId, recipeId);
    } catch (err) {
      result = { ok: false, error: getCollectionErrorMessage(err) };
    }
    const ownsMutation = mountedRef.current && activeRef.current
      && currentKeyRef.current === mutation.key
      && focusEpochRef.current === mutation.focusEpoch
      && mutationGenerationRef.current === mutation.generation
      && removePendingRef.current === mutation;
    if (!ownsMutation) return;
    if (result.ok) {
      const remaining = recipesRef.current.filter((entry) => entry.recipe.id !== recipeId);
      recipesRef.current = remaining;
      paginationRef.current = null;
      setRecipes(remaining);
      setPagination(null);
    } else if (result.error) {
      Alert.alert('Couldn’t remove recipe', result.error);
    }
    removePendingRef.current = null;
    setPendingRemoval(null);
    const refreshWasQueued = queuedRefreshKeyRef.current === currentKey;
    if (refreshWasQueued) queuedRefreshKeyRef.current = null;
    if (result.ok || refreshWasQueued) {
      await loadPageOne({ retainRows: acceptedKeyRef.current === currentKey });
    }
  };

  const confirmDelete = () => {
    const name = (collection && collection.name) || 'this collection';
    Alert.alert('Delete collection', `Remove "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const result = await deleteCollection(collectionId);
          if (result.ok) {
            navigation.goBack();
          } else if (result.error) {
            Alert.alert('Couldn’t delete collection', result.error);
          }
        },
      },
    ]);
  };

  const header = (title, count, onDelete, countText, deleteDisabled) => (
    <Header
      styles={styles}
      colors={colors}
      insets={insets}
      title={title}
      count={count}
      countText={countText}
      onBack={() => navigation.goBack()}
      onDelete={onDelete}
      deleteDisabled={deleteDisabled}
    />
  );

  const trusted = acceptedKey === currentKey;
  const visibleCollection = trusted ? collection : null;
  const visibleRecipes = trusted ? recipes : [];
  const visiblePagination = trusted ? pagination : null;
  const count = visiblePagination && Number.isFinite(visiblePagination.total)
    ? visiblePagination.total : null;
  const activeRemoval = activeRef.current && pendingRemoval?.key === currentKey
    && pendingRemoval.focusEpoch === focusEpochRef.current
    && pendingRemoval.generation === mutationGenerationRef.current
    ? pendingRemoval : null;
  const removalPending = activeRemoval !== null;
  const countText = count == null
    ? `${visibleRecipes.length} loaded ${visibleRecipes.length === 1 ? 'recipe' : 'recipes'}`
    : `${count} collection ${count === 1 ? 'entry' : 'entries'}`;

  if (!visibleCollection && (status !== 'error' || failedKey !== currentKey)) {
    return (
      <View style={styles.root}>
        {header('Collection', null)}
        <View style={styles.centerWrap}>
          <ActivityIndicator color={colors.sageDeep} />
        </View>
      </View>
    );
  }

  if (status === 'error' && !visibleCollection) {
    return (
      <View style={styles.root}>
        {header('Collection', null)}
        <View style={styles.centerWrap}>
          <Ionicons name="cloud-offline-outline" size={28} color={colors.inkFaint} />
          <Text style={styles.errorText}>{error || 'Couldn’t load this collection.'}</Text>
          <Pressable style={styles.retryBtn} onPress={() => loadPageOne()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Retry loading collection">
            <Ionicons name="refresh" size={14} color={colors.sageDeep} />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {header(visibleCollection.name, null, confirmDelete, countText, removalPending)}
      {removalPending ? <View style={styles.listFooter} accessibilityRole="progressbar" accessibilityLabel="Updating collection" accessibilityState={{ busy: true }}><ActivityIndicator color={colors.sageDeep} /><Text style={styles.count}>Updating collection…</Text></View> : null}
      {visibleRecipes.length === 0 && (!visiblePagination || visiblePagination.total === 0) ? (
        <ScrollView
          contentContainerStyle={styles.emptyScroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              enabled={!removalPending}
              tintColor={colors.sageDeep}
              colors={[colors.sageDeep]}
            />
          }
        >
          <View style={styles.emptyWrap}>
            {error ? <Pressable style={styles.retryBtn} onPress={onRefresh} disabled={removalPending} accessibilityRole="button" accessibilityLabel="Retry refreshing collection" accessibilityState={{ disabled: removalPending }}><Text style={styles.retryText}>{error} Retry</Text></Pressable> : null}
            <Text style={styles.empty}>Add recipes from any recipe page.</Text>
          </View>
        </ScrollView>
      ) : (
        <FlatList
          data={visibleRecipes}
          keyExtractor={(entry) => entry.id || entry.recipe.id}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          onEndReached={() => { if (!moreErrorRef.current) loadMore(); }}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={visiblePagination?.total > 0 && visiblePagination.page >= visiblePagination.totalPages
            ? <Text style={styles.empty}>No available recipes in this collection.</Text> : null}
          ListHeaderComponent={error ? <Pressable style={styles.retryBtn} onPress={onRefresh} disabled={removalPending} accessibilityRole="button" accessibilityLabel="Retry refreshing collection" accessibilityState={{ disabled: removalPending }}><Text style={styles.retryText}>{error} Retry</Text></Pressable> : null}
          ListFooterComponent={loadingMore || moreError || (visiblePagination && visiblePagination.page < visiblePagination.totalPages) ? <View style={styles.listFooter}>
            {loadingMore ? <ActivityIndicator color={colors.sageDeep} accessibilityRole="progressbar" accessibilityLabel="Loading more collection recipes" /> : null}
            {moreError ? <Pressable style={styles.retryBtn} onPress={loadMore} disabled={removalPending} accessibilityRole="button" accessibilityLabel="Retry loading more collection recipes" accessibilityState={{ disabled: removalPending }}><Text style={styles.retryText}>{moreError} Retry</Text></Pressable> : null}
            {!loadingMore && !moreError && visiblePagination?.page < visiblePagination?.totalPages ? <Pressable style={styles.retryBtn} onPress={loadMore} disabled={removalPending} accessibilityRole="button" accessibilityLabel="Load more collection recipes" accessibilityState={{ disabled: removalPending }}><Text style={styles.retryText}>Load more recipes</Text></Pressable> : null}
          </View> : null}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              enabled={!removalPending}
              tintColor={colors.sageDeep}
              colors={[colors.sageDeep]}
            />
          }
          renderItem={({ item: entry }) => (
            <View style={styles.row}>
              <Pressable style={styles.rowMain} onPress={() => openRecipe(entry.recipe)}>
                <RecipeImage source={entry.recipe.imageUrl} style={styles.thumb} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {entry.recipe.title}
                  </Text>
                  <Text style={styles.rowMeta}>
                    {[recipeTimeLabel(entry.recipe), metaLabel(entry.recipe)].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </Pressable>
              <Pressable
                hitSlop={8}
                onPress={() => removeRecipe(entry.recipe.id)}
                disabled={removalPending}
                style={styles.rowRemove}
                accessibilityRole="button"
                accessibilityLabel={activeRemoval?.recipeId === entry.recipe.id ? `Removing ${entry.recipe.title} from collection` : `Remove ${entry.recipe.title} from collection`}
                accessibilityState={{ disabled: removalPending, busy: activeRemoval?.recipeId === entry.recipe.id }}
              >
                <Ionicons name="remove-circle-outline" size={20} color={colors.inkFaint} />
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
}

function SmartCollectionDetail({ navigation, groupKey }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const { status: authStatus, user } = useAuth();
  const authUserId = authStatus === 'authenticated' && user ? user.id : null;
  const stableDefinition = SMART_COLLECTION_DEFINITIONS.find(({ key }) => key === groupKey);

  const [smartCollection, setSmartCollection] = useState(null);
  const [recipes, setRecipes] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [ownerId, setOwnerId] = useState(null);
  const [acceptedGroupKey, setAcceptedGroupKey] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(null);

  const mountedRef = useRef(true);
  const authUserIdRef = useRef(authUserId);
  const groupKeyRef = useRef(groupKey);
  const sessionRef = useRef(0);
  const generationRef = useRef(0);
  const pageOneTokenRef = useRef(0);
  const pageOnePendingRef = useRef(false);
  const moreTokenRef = useRef(0);
  const morePendingRef = useRef(false);
  const acceptedRef = useRef(false);
  const recipesRef = useRef([]);
  const paginationRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionRef.current += 1;
      generationRef.current += 1;
      pageOneTokenRef.current += 1;
      pageOnePendingRef.current = false;
      moreTokenRef.current += 1;
      morePendingRef.current = false;
    };
  }, []);

  const loadPageOne = useCallback(async ({ retainRows = false } = {}) => {
    const requestOwnerId = authUserIdRef.current;
    const requestGroupKey = groupKeyRef.current;
    if (!requestOwnerId || !requestGroupKey || pageOnePendingRef.current) return;
    const session = sessionRef.current;
    const generation = ++generationRef.current;
    const pageOneToken = ++pageOneTokenRef.current;
    pageOnePendingRef.current = true;
    moreTokenRef.current += 1;
    morePendingRef.current = false;
    setLoadingMore(false);
    setMoreError(null);
    setError(null);
    if (retainRows && acceptedRef.current) setRefreshing(true);
    else setStatus('loading');

    const stale = () => !mountedRef.current
      || session !== sessionRef.current
      || generation !== generationRef.current
      || pageOneToken !== pageOneTokenRef.current
      || requestOwnerId !== authUserIdRef.current
      || requestGroupKey !== groupKeyRef.current;
    try {
      const result = await getSmartCollection(requestGroupKey, {
        page: 1,
        limit: SMART_COLLECTION_PAGE_LIMIT,
      });
      if (stale()) return;
      recipesRef.current = result.recipes;
      paginationRef.current = result.pagination;
      acceptedRef.current = true;
      setSmartCollection(result.smartCollection);
      setRecipes(result.recipes);
      setPagination(result.pagination);
      setOwnerId(requestOwnerId);
      setAcceptedGroupKey(requestGroupKey);
      setStatus('ready');
      setError(null);
    } catch (err) {
      if (stale()) return;
      setError(getRecipeErrorMessage(err));
      setStatus(acceptedRef.current ? 'ready' : 'error');
    } finally {
      if (!stale()) {
        pageOnePendingRef.current = false;
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    authUserIdRef.current = authUserId;
    groupKeyRef.current = groupKey;
    sessionRef.current += 1;
    generationRef.current += 1;
    pageOneTokenRef.current += 1;
    pageOnePendingRef.current = false;
    moreTokenRef.current += 1;
    morePendingRef.current = false;
    recipesRef.current = [];
    paginationRef.current = null;
    acceptedRef.current = false;
    setSmartCollection(null);
    setRecipes([]);
    setPagination(null);
    setOwnerId(authUserId);
    setAcceptedGroupKey(groupKey);
    setError(null);
    setMoreError(null);
    setRefreshing(false);
    setLoadingMore(false);
    if (!authUserId) {
      setStatus('loading');
      return;
    }
    setStatus('loading');
    loadPageOne();
  }, [authUserId, groupKey, loadPageOne]);

  const onRefresh = useCallback(() => loadPageOne({ retainRows: true }), [loadPageOne]);

  const loadMore = useCallback(async () => {
    const current = paginationRef.current;
    if (!current || current.page >= current.totalPages || morePendingRef.current || pageOnePendingRef.current || refreshing) return;
    const requestOwnerId = authUserIdRef.current;
    const requestGroupKey = groupKeyRef.current;
    const session = sessionRef.current;
    const generation = generationRef.current;
    const targetPage = current.page + 1;
    const token = ++moreTokenRef.current;
    morePendingRef.current = true;
    setLoadingMore(true);
    setMoreError(null);

    const stale = () => !mountedRef.current
      || session !== sessionRef.current
      || generation !== generationRef.current
      || token !== moreTokenRef.current
      || requestOwnerId !== authUserIdRef.current
      || requestGroupKey !== groupKeyRef.current;
    try {
      const result = await getSmartCollection(requestGroupKey, {
        page: targetPage,
        limit: SMART_COLLECTION_PAGE_LIMIT,
      });
      if (stale()) return;
      const seen = new Set(recipesRef.current.map(({ id }) => id));
      const appended = result.recipes.filter(({ id }) => !seen.has(id));
      const nextRecipes = [...recipesRef.current, ...appended];
      recipesRef.current = nextRecipes;
      paginationRef.current = result.pagination;
      setRecipes(nextRecipes);
      setPagination(result.pagination);
      setSmartCollection(result.smartCollection);
    } catch (err) {
      if (stale()) return;
      setMoreError(getRecipeErrorMessage(err));
    } finally {
      if (!stale()) {
        morePendingRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [refreshing]);

  const openRecipe = (recipe) => navigation.navigate('RecipeDetail', {
    recipeSource: 'api',
    recipeId: recipe.id,
    initialRecipe: recipe,
  });
  const trusted = Boolean(authUserId && ownerId === authUserId && acceptedGroupKey === groupKey);
  const visibleRecipes = trusted ? recipes : [];
  const visiblePagination = trusted ? pagination : null;
  const title = (trusted && smartCollection?.name) || stableDefinition.name;
  const header = <Header
    styles={styles}
    colors={colors}
    insets={insets}
    title={title}
    count={status === 'ready' && visiblePagination ? visiblePagination.total : null}
    onBack={() => navigation.goBack()}
  />;

  if (!trusted || (status === 'loading' && visibleRecipes.length === 0)) {
    return <View style={styles.root}>{header}<View
      style={styles.centerWrap}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Loading ${title}`}
      accessibilityState={{ busy: true }}
    >
      <ActivityIndicator color={colors.sageDeep} />
    </View></View>;
  }

  if (status === 'error' && visibleRecipes.length === 0) {
    return <View style={styles.root}>{header}<View style={styles.centerWrap}>
      <Ionicons name="cloud-offline-outline" size={28} color={colors.inkFaint} />
      <Text style={styles.errorText}>{error || 'Couldn\u2019t load this smart collection.'}</Text>
      <Pressable
        style={styles.retryBtn}
        onPress={() => loadPageOne()}
        accessibilityRole="button"
        accessibilityLabel="Retry loading smart collection"
      >
        <Ionicons name="refresh" size={14} color={colors.sageDeep} />
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
    </View></View>;
  }

  if (visiblePagination?.total === 0) {
    return <View style={styles.root}>{header}<ScrollView
      contentContainerStyle={styles.emptyScroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.sageDeep} colors={[colors.sageDeep]} />}
    ><View style={styles.emptyWrap}>
      <Text style={styles.empty}>No recipes in this smart collection yet.</Text>
      {error ? <Pressable style={styles.retryBtn} onPress={onRefresh} accessibilityRole="button"><Text style={styles.retryText}>Retry</Text></Pressable> : null}
    </View></ScrollView></View>;
  }

  return <View style={styles.root}>{header}<FlatList
    data={visibleRecipes}
    keyExtractor={(recipe) => recipe.id}
    contentContainerStyle={styles.scroll}
    showsVerticalScrollIndicator={false}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.sageDeep} colors={[colors.sageDeep]} />}
    onEndReached={loadMore}
    onEndReachedThreshold={0.4}
    renderItem={({ item: recipe }) => <View style={styles.row}>
      <Pressable
        style={styles.rowMain}
        onPress={() => openRecipe(recipe)}
        accessibilityRole="button"
        accessibilityLabel={`Open ${recipe.title}`}
      >
        <RecipeImage source={recipe.imageUrl} style={styles.thumb} />
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle} numberOfLines={1}>{recipe.title}</Text>
          <Text style={styles.rowMeta}>{[recipeTimeLabel(recipe), metaLabel(recipe)].filter(Boolean).join(' \u00b7 ')}</Text>
        </View>
      </Pressable>
    </View>}
    ListHeaderComponent={error ? <Pressable style={styles.retryBtn} onPress={onRefresh} accessibilityRole="button" accessibilityLabel="Retry refreshing smart collection">
      <Ionicons name="refresh" size={14} color={colors.sageDeep} /><Text style={styles.retryText}>{error} Retry</Text>
    </Pressable> : null}
    ListFooterComponent={loadingMore || moreError ? <View style={styles.listFooter}>
      {loadingMore ? <ActivityIndicator
        color={colors.sageDeep}
        accessibilityRole="progressbar"
        accessibilityLabel="Loading more recipes"
        accessibilityState={{ busy: true }}
      /> : null}
      {moreError ? <Pressable style={styles.retryBtn} onPress={loadMore} accessibilityRole="button" accessibilityLabel="Retry loading more recipes">
        <Ionicons name="refresh" size={14} color={colors.sageDeep} /><Text style={styles.retryText}>{moreError} Retry</Text>
      </Pressable> : null}
    </View> : null}
  /></View>;
}

// ---------------------------------------------------------------------------
// Unsupported branch — forward-compatible guard for any future/unknown
// collectionType. Nothing is ever fabricated here.
// ---------------------------------------------------------------------------
function UnsupportedCollectionDetail({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <Header
        styles={styles}
        colors={colors}
        insets={insets}
        title="Collection"
        count={null}
        onBack={() => navigation.goBack()}
      />
      <View style={styles.centerWrap}>
        <Text style={styles.errorText}>This collection isn’t available yet.</Text>
      </View>
    </View>
  );
}

export default function CollectionDetailScreen({ navigation, route }) {
  const collectionType = route?.params?.collectionType || 'favorites';

  if (collectionType === 'favorites') {
    return <FavoritesCollectionDetail navigation={navigation} />;
  }
  if (collectionType === 'user') {
    return <UserCollectionDetail navigation={navigation} collectionId={route?.params?.collectionId} />;
  }
  if (collectionType === 'smart') {
    const groupKey = route?.params?.groupKey;
    if (SMART_COLLECTION_DEFINITIONS.some(({ key }) => key === groupKey)) {
      return <SmartCollectionDetail navigation={navigation} groupKey={groupKey} />;
    }
  }
  return <UnsupportedCollectionDetail navigation={navigation} />;
}
