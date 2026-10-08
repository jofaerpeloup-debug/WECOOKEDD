import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import RecipeImage from '../components/RecipeImage';
import { useFavorites } from '../context/FavoritesContext';
import { useCollections } from '../context/CollectionsContext';
import { useAuth } from '../context/AuthContext';
import { getRecipeErrorMessage } from '../api/recipeErrors';
import {
  listSmartCollections,
  SMART_COLLECTION_DEFINITIONS,
} from '../api/recipeService';

// Teammate-inspired "My Collections" browser over WeCooked's real API state.
// Favorites and user collections stay separate backend domains; detail screens
// fetch their own authoritative recipe data from ids rather than route arrays.
export default function SavedScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const { status: authStatus, user } = useAuth();
  const authUserId = authStatus === 'authenticated' && user ? user.id : null;
  const {
    favorites,
    status: favoritesStatus,
    error: favoritesError,
    reload: reloadFavorites,
  } = useFavorites();
  const {
    collections,
    status: collectionsStatus,
    error: collectionsError,
    reload: reloadCollections,
    createCollection,
  } = useCollections();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [smartCollections, setSmartCollections] = useState([]);
  const [smartOwnerId, setSmartOwnerId] = useState(null);
  const [smartStatus, setSmartStatus] = useState('idle');
  const [smartError, setSmartError] = useState(null);
  const createPendingRef = useRef(false);
  const mountedRef = useRef(true);
  const smartSessionRef = useRef(0);
  const smartGenerationRef = useRef(0);
  const smartDataRef = useRef([]);
  const authUserIdRef = useRef(authUserId);
  const initialSmartFocusRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      smartSessionRef.current += 1;
      smartGenerationRef.current += 1;
    };
  }, []);

  const loadSmartCards = useCallback(async (generation, session, ownerId) => {
    const stale = () => !mountedRef.current
      || generation !== smartGenerationRef.current
      || session !== smartSessionRef.current
      || ownerId !== authUserIdRef.current;
    try {
      const { smartCollections: fetched } = await listSmartCollections();
      if (stale()) return;
      smartDataRef.current = fetched;
      setSmartCollections(fetched);
      setSmartOwnerId(ownerId);
      setSmartError(null);
      setSmartStatus('ready');
    } catch (err) {
      if (stale()) return;
      setSmartError(getRecipeErrorMessage(err));
      setSmartStatus(smartDataRef.current.length > 0 ? 'ready' : 'error');
    }
  }, []);

  const reloadSmartCollections = useCallback(() => {
    const ownerId = authUserIdRef.current;
    if (!ownerId) return Promise.resolve();
    const generation = ++smartGenerationRef.current;
    const session = smartSessionRef.current;
    setSmartError(null);
    if (smartDataRef.current.length === 0) setSmartStatus('loading');
    return loadSmartCards(generation, session, ownerId);
  }, [loadSmartCards]);

  useEffect(() => {
    authUserIdRef.current = authUserId;
    smartSessionRef.current += 1;
    smartGenerationRef.current += 1;
    smartDataRef.current = [];
    setSmartCollections([]);
    setSmartOwnerId(authUserId);
    setSmartError(null);
    if (!authUserId) {
      setSmartStatus('idle');
      return;
    }
    setSmartStatus('loading');
    loadSmartCards(smartGenerationRef.current, smartSessionRef.current, authUserId);
  }, [authUserId, loadSmartCards]);

  useFocusEffect(
    useCallback(() => {
      reloadFavorites();
      reloadCollections();
      if (initialSmartFocusRef.current) initialSmartFocusRef.current = false;
      else reloadSmartCollections();
    }, [reloadFavorites, reloadCollections, reloadSmartCollections])
  );

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([reloadFavorites(), reloadCollections(), reloadSmartCollections()]);
    } finally {
      setRefreshing(false);
    }
  }, [reloadFavorites, reloadCollections, reloadSmartCollections]);

  const openFavorites = () =>
    navigation.navigate('CollectionDetail', { collectionType: 'favorites' });
  const openCollection = (collectionId) =>
    navigation.navigate('CollectionDetail', { collectionType: 'user', collectionId });
  const openSmartCollection = (groupKey) =>
    navigation.navigate('CollectionDetail', { collectionType: 'smart', groupKey });

  const startCreate = () => {
    setCreateError(null);
    setAdding((value) => !value);
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || creating || createPendingRef.current) return;

    setCreateError(null);
    createPendingRef.current = true;
    setCreating(true);
    try {
      const result = await createCollection({ name: trimmed });
      if (result.ok) {
        setName('');
        setAdding(false);
      } else {
        setCreateError(result.error || 'Couldn’t create that collection. Please try again.');
      }
    } finally {
      createPendingRef.current = false;
      setCreating(false);
    }
  };

  const favoritesCover = favorites.slice(0, 4);
  const smartTrusted = Boolean(authUserId && smartOwnerId === authUserId);
  const visibleSmartCollections = smartTrusted && smartCollections.length > 0
    ? smartCollections
    : SMART_COLLECTION_DEFINITIONS.map(({ key, name }) => ({ key, name }));
  const cards = [
    { id: 'favorites', type: 'favorites', name: 'Favorites', recipeCount: favorites.length },
    ...visibleSmartCollections.map((collection) => ({ ...collection, id: collection.key, type: 'smart' })),
    ...collections.map((collection) => ({ ...collection, type: 'user' })),
  ];

  const renderCover = (item) => {
    if (item.type === 'favorites') {
      if (
        (favoritesStatus === 'loading' || favoritesStatus === 'idle') &&
        favorites.length === 0
      ) {
        return <ActivityIndicator color={colors.sageDeep} />;
      }
      if (favoritesCover.length === 0) {
        return (
          <Ionicons
            name={favoritesStatus === 'error' ? 'cloud-offline-outline' : 'heart-outline'}
            size={18}
            color={colors.inkFaint}
          />
        );
      }
      if (favoritesCover.length === 1) {
        return <RecipeImage source={favoritesCover[0].recipe.imageUrl} style={styles.coverFull} />;
      }
      return (
        <View style={styles.coverGrid}>
          {favoritesCover.map((entry) => (
            <RecipeImage
              key={entry.recipe.id}
              source={entry.recipe.imageUrl}
              style={styles.coverQuad}
            />
          ))}
        </View>
      );
    }

    if (item.type === 'smart' && (!smartTrusted || smartStatus === 'loading' || smartStatus === 'idle')) {
      return <ActivityIndicator
        color={colors.sageDeep}
        accessibilityRole="progressbar"
        accessibilityLabel={`Loading ${item.name}`}
        accessibilityState={{ busy: true }}
      />;
    }
    const covers = item.coverImageUrls || [];
    if (covers.length === 0) {
      return (
        <Ionicons
          name={item.type === 'smart' && smartStatus === 'error' ? 'cloud-offline-outline' : 'albums-outline'}
          size={18}
          color={colors.inkFaint}
        />
      );
    }
    if (covers.length === 1) {
      return <RecipeImage source={covers[0]} style={styles.coverFull} />;
    }
    return (
      <View style={styles.coverGrid}>
        {covers.slice(0, 4).map((url, index) => (
          <RecipeImage key={`${item.id}-${index}`} source={url} style={styles.coverQuad} />
        ))}
      </View>
    );
  };

  const renderCard = ({ item }) => (
    <Pressable
      style={styles.card}
      onPress={() => {
        if (item.type === 'favorites') openFavorites();
        else if (item.type === 'smart') openSmartCollection(item.key);
        else openCollection(item.id);
      }}
      disabled={item.type === 'smart' && (!smartTrusted || smartStatus !== 'ready')}
      accessibilityRole="button"
      accessibilityLabel={item.recipeCount == null
        ? item.name
        : `${item.name}, ${item.recipeCount} ${item.recipeCount === 1 ? 'recipe' : 'recipes'}`}
      accessibilityState={{ disabled: item.type === 'smart' && (!smartTrusted || smartStatus !== 'ready') }}
    >
      <View style={styles.cardImg}>{renderCover(item)}</View>
      <Text style={styles.cardTitle} numberOfLines={1}>
        {item.name}
      </Text>
      {item.recipeCount != null ? (
        <Text style={styles.cardCount}>
          {item.recipeCount} {item.recipeCount === 1 ? 'recipe' : 'recipes'}
        </Text>
      ) : null}
    </Pressable>
  );

  return (
    <View style={styles.root}>
      <FlatList
        style={styles.flex}
        data={cards}
        keyExtractor={(item) => `${item.type}:${item.id}`}
        renderItem={renderCard}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.xl }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshing={refreshing}
        onRefresh={refreshAll}
        ListHeaderComponent={
          <>
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <Pressable
                  style={styles.iconBtn}
                  hitSlop={6}
                  onPress={() => navigation.goBack()}
                  accessibilityRole="button"
                  accessibilityLabel="Go back"
                >
                  <Ionicons name="arrow-back" size={18} color={colors.ink} />
                </Pressable>
                <Text style={styles.title} accessibilityRole="header">
                  My Collections
                </Text>
              </View>
              <View style={styles.headerActions}>
                <Pressable
                  style={styles.iconBtn}
                  hitSlop={6}
                  onPress={() => navigation.navigate('List')}
                  accessibilityRole="button"
                  accessibilityLabel="Grocery list"
                >
                  <Ionicons name="cart-outline" size={16} color={colors.ink} />
                </Pressable>
                <Pressable
                  style={styles.iconBtn}
                  hitSlop={6}
                  onPress={startCreate}
                  accessibilityRole="button"
                  accessibilityLabel={adding ? 'Cancel new collection' : 'New collection'}
                >
                  <Ionicons name={adding ? 'close' : 'add'} size={18} color={colors.ink} />
                </Pressable>
              </View>
            </View>

            {adding && (
              <View style={styles.newRow}>
                <TextInput
                  style={styles.input}
                  placeholder="New collection name"
                  placeholderTextColor={colors.inkFaint}
                  value={name}
                  onChangeText={(value) => {
                    setName(value);
                    setCreateError(null);
                  }}
                  autoFocus
                  maxLength={60}
                  onSubmitEditing={create}
                  returnKeyType="done"
                  editable={!creating}
                  accessibilityLabel="New collection name"
                />
                <Pressable
                  style={styles.createBtn}
                  onPress={create}
                  disabled={creating || !name.trim()}
                  accessibilityRole="button"
                  accessibilityLabel="Create collection"
                  accessibilityState={{ disabled: creating || !name.trim() }}
                >
                  {creating ? (
                    <ActivityIndicator size="small" color={colors.onAccent} />
                  ) : (
                    <Text style={styles.createText}>Create</Text>
                  )}
                </Pressable>
              </View>
            )}
            {createError ? <Text style={styles.formError}>{createError}</Text> : null}
          </>
        }
        ListFooterComponent={
          <>
            {collectionsStatus === 'loading' && collections.length === 0 ? (
              <ActivityIndicator style={styles.footerStatus} color={colors.sageDeep} />
            ) : null}
            {favoritesError ? (
              <Pressable
                style={styles.retryRow}
                onPress={reloadFavorites}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Retry loading favorites"
              >
                <Ionicons name="refresh" size={14} color={colors.sageDeep} />
                <Text style={styles.retryText}>Favorites: {favoritesError} Tap to retry.</Text>
              </Pressable>
            ) : null}
            {collectionsError ? (
              <Pressable
                style={styles.retryRow}
                onPress={reloadCollections}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Retry loading collections"
              >
                <Ionicons name="refresh" size={14} color={colors.sageDeep} />
                <Text style={styles.retryText}>Collections: {collectionsError} Tap to retry.</Text>
              </Pressable>
            ) : null}
            {smartError ? (
              <Pressable
                style={styles.retryRow}
                onPress={reloadSmartCollections}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Smart collections: ${smartError}. Tap to retry.`}
              >
                <Ionicons name="refresh" size={14} color={colors.sageDeep} />
                <Text style={styles.retryText}>Smart collections: {smartError} Tap to retry.</Text>
              </Pressable>
            ) : null}
          </>
        }
      />
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    flex: { flex: 1 },
    scroll: { paddingHorizontal: spacing.xl, paddingBottom: 120 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.lg,
    },
    title: { fontFamily: typography.display.fontFamily, fontSize: 24, color: colors.ink },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    headerActions: { flexDirection: 'row', gap: 8 },
    iconBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.creamDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    newRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
    input: {
      flex: 1,
      height: 44,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.hairline,
      paddingHorizontal: spacing.md,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.ink,
      outlineStyle: 'none',
    },
    createBtn: {
      paddingHorizontal: spacing.lg,
      height: 44,
      borderRadius: radius.md,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    createText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.onAccent,
    },
    formError: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.error,
      marginBottom: spacing.md,
    },
    gridRow: { justifyContent: 'space-between', marginBottom: 14 },
    card: { width: '47.5%' },
    cardImg: {
      height: 96,
      borderRadius: 14,
      backgroundColor: colors.creamDeep,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    },
    coverFull: { width: '100%', height: '100%' },
    coverGrid: { width: '100%', height: '100%', flexDirection: 'row', flexWrap: 'wrap' },
    coverQuad: { width: '50%', height: '50%' },
    cardTitle: {
      fontFamily: typography.body.semibold,
      fontSize: 13.5,
      color: colors.ink,
      marginTop: 8,
    },
    cardCount: {
      fontFamily: typography.body.fontFamily,
      fontSize: 11.5,
      color: colors.inkFaint,
      marginTop: 2,
    },
    footerStatus: { marginTop: spacing.md },
    retryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: spacing.lg,
      alignSelf: 'center',
    },
    retryText: {
      flexShrink: 1,
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.sageDeep,
      textAlign: 'center',
    },
  });
}
