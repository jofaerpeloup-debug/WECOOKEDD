import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
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
import * as collectionService from '../api/collectionService';
import { getCollectionErrorMessage } from '../api/collectionErrors';
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

// Fetches at most this many recipes for a user collection's detail view —
// generous enough that no real collection is likely to exceed it, and
// consistent with this screen's Favorites branch (via FavoritesContext),
// which also has no infinite-scroll/load-more UI of its own.
const USER_COLLECTION_RECIPE_LIMIT = 100;

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
  });
}

function Header({ styles, colors, insets, title, count, onBack, onDelete }) {
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable style={styles.iconBtn} hitSlop={8} onPress={onBack}>
        <Ionicons name="chevron-back" size={18} color={colors.ink} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        {count != null && (
          <Text style={styles.count}>
            {count} {count === 1 ? 'recipe' : 'recipes'}
          </Text>
        )}
      </View>
      {onDelete && (
        <Pressable hitSlop={8} onPress={onDelete}>
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
  const { deleteCollection, removeRecipeFromCollection } = useCollections();

  const [collection, setCollection] = useState(null);
  const [recipes, setRecipes] = useState([]);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const genRef = useRef(0);

  const load = useCallback(async () => {
    const gen = ++genRef.current;
    try {
      const [collectionData, { recipes: fetchedRecipes }] = await Promise.all([
        collectionService.getCollection(collectionId),
        collectionService.listCollectionRecipes(collectionId, {
          page: 1,
          limit: USER_COLLECTION_RECIPE_LIMIT,
          sort: 'newest',
        }),
      ]);
      if (gen !== genRef.current) return;
      setCollection(collectionData);
      setRecipes(fetchedRecipes);
      setError(null);
      setStatus('ready');
    } catch (err) {
      if (gen !== genRef.current) return;
      setError(getCollectionErrorMessage(err));
      setStatus('error');
    }
  }, [collectionId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const openRecipe = (recipe) => {
    navigation.navigate('RecipeDetail', {
      recipeSource: 'api',
      recipeId: recipe.id,
      initialRecipe: recipe,
    });
  };

  const removeRecipe = async (recipeId) => {
    const result = await removeRecipeFromCollection(collectionId, recipeId);
    if (result.ok) {
      setRecipes((list) => list.filter((entry) => entry.recipe.id !== recipeId));
    } else if (result.error) {
      Alert.alert('Couldn’t remove recipe', result.error);
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

  const header = (title, count, onDelete) => (
    <Header
      styles={styles}
      colors={colors}
      insets={insets}
      title={title}
      count={count}
      onBack={() => navigation.goBack()}
      onDelete={onDelete}
    />
  );

  if (status === 'loading' && !collection) {
    return (
      <View style={styles.root}>
        {header('Collection', null)}
        <View style={styles.centerWrap}>
          <ActivityIndicator color={colors.sageDeep} />
        </View>
      </View>
    );
  }

  if (status === 'error' && !collection) {
    return (
      <View style={styles.root}>
        {header('Collection', null)}
        <View style={styles.centerWrap}>
          <Ionicons name="cloud-offline-outline" size={28} color={colors.inkFaint} />
          <Text style={styles.errorText}>{error || 'Couldn’t load this collection.'}</Text>
          <Pressable style={styles.retryBtn} onPress={() => load()} hitSlop={8}>
            <Ionicons name="refresh" size={14} color={colors.sageDeep} />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {header(collection.name, recipes.length, confirmDelete)}
      {recipes.length === 0 ? (
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
            <Text style={styles.empty}>Add recipes from any recipe page.</Text>
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
          {recipes.map((entry) => (
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
              <Pressable
                hitSlop={8}
                onPress={() => removeRecipe(entry.recipe.id)}
                style={styles.rowRemove}
              >
                <Ionicons name="remove-circle-outline" size={20} color={colors.inkFaint} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
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
  return <UnsupportedCollectionDetail navigation={navigation} />;
}
