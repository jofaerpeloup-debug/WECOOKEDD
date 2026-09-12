import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { typography, spacing } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import RecipeImage from '../components/RecipeImage';
import { useFavorites } from '../context/FavoritesContext';
import { useCollections } from '../context/CollectionsContext';

// Saved is the teammate "My Collections" shell (commit c1c86ed) ported onto
// real data — a collections BROWSER. It shows the real system collection
// "Favorites" (backed by FavoritesContext/the real API) first, followed by
// the user's real, backend-persisted Collections (M5A — CollectionsContext/
// collectionService). There are no hardcoded "smart" collections and no
// AsyncStorage-backed local collections: the teammate's 5 scanned-catalog
// collections have no WeCooked backend and are out of scope (see
// docs/architecture — Collections M5A final report).
//
// Tapping Favorites opens the real `CollectionDetail` route with
// `{ collectionType: 'favorites' }`; tapping a real collection opens it with
// `{ collectionType: 'user', collectionId }` — CollectionDetailScreen fetches
// authoritative data itself, so no recipe array is ever passed through
// navigation params.

export default function SavedScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { favorites, status: favoritesStatus, reload: reloadFavorites } = useFavorites();
  const {
    collections,
    status: collectionsStatus,
    error: collectionsError,
    reload: reloadCollections,
    createCollection,
  } = useCollections();
  const insets = useSafeAreaInsets();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  // Reconcile with server truth whenever Saved regains focus (e.g. returning
  // from CollectionDetail after a create/delete/membership change) so cards'
  // covers/counts stay current. Both reloads are generation-guarded.
  useFocusEffect(
    useCallback(() => {
      reloadFavorites();
      reloadCollections();
    }, [reloadFavorites, reloadCollections])
  );

  const openFavorites = () => navigation.navigate('CollectionDetail', { collectionType: 'favorites' });
  const openCollection = (collectionId) =>
    navigation.navigate('CollectionDetail', { collectionType: 'user', collectionId });

  const startCreate = () => {
    setCreateError(null);
    setAdding((v) => !v);
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreateError(null);
    setCreating(true);
    const result = await createCollection({ name: trimmed });
    setCreating(false);
    if (result.ok) {
      setName('');
      setAdding(false);
    } else {
      setCreateError(result.error || 'Couldn’t create that collection. Please try again.');
    }
  };

  const favoritesCover = favorites.slice(0, 4);

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Pressable style={styles.iconBtn} hitSlop={6} onPress={() => navigation.goBack()}>
              <Ionicons name="arrow-back" size={18} color={colors.ink} />
            </Pressable>
            <Text style={styles.title}>My Collections</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable style={styles.iconBtn} hitSlop={6} onPress={() => navigation.navigate('List')}>
              <Ionicons name="cart-outline" size={16} color={colors.ink} />
            </Pressable>
            <Pressable style={styles.iconBtn} hitSlop={6} onPress={startCreate}>
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
              onChangeText={(t) => {
                setName(t);
                setCreateError(null);
              }}
              autoFocus
              maxLength={60}
              onSubmitEditing={create}
              returnKeyType="done"
              editable={!creating}
            />
            <Pressable style={styles.createBtn} onPress={create} disabled={creating}>
              {creating ? (
                <ActivityIndicator size="small" color={colors.onAccent} />
              ) : (
                <Text style={styles.createText}>Create</Text>
              )}
            </Pressable>
          </View>
        )}
        {createError && <Text style={styles.formError}>{createError}</Text>}

        <View style={styles.grid}>
          <Pressable style={styles.card} onPress={openFavorites}>
            <View style={styles.cardImg}>
              {(favoritesStatus === 'loading' || favoritesStatus === 'idle') && favorites.length === 0 ? (
                <ActivityIndicator color={colors.sageDeep} />
              ) : favoritesStatus === 'error' && favorites.length === 0 ? (
                <Ionicons name="cloud-offline-outline" size={18} color={colors.inkFaint} />
              ) : favoritesCover.length === 0 ? (
                <Ionicons name="heart-outline" size={18} color={colors.inkFaint} />
              ) : favoritesCover.length === 1 ? (
                <RecipeImage source={favoritesCover[0].recipe.imageUrl} style={styles.coverFull} />
              ) : (
                <View style={styles.coverGrid}>
                  {favoritesCover.map((entry) => (
                    <RecipeImage
                      key={entry.recipe.id}
                      source={entry.recipe.imageUrl}
                      style={styles.coverQuad}
                    />
                  ))}
                </View>
              )}
            </View>
            <Text style={styles.cardTitle}>Favorites</Text>
            <Text style={styles.cardCount}>
              {favorites.length} {favorites.length === 1 ? 'recipe' : 'recipes'}
            </Text>
          </Pressable>

          {collections.map((c) => {
            const covers = c.coverImageUrls || [];
            return (
              <Pressable key={c.id} style={styles.card} onPress={() => openCollection(c.id)}>
                <View style={styles.cardImg}>
                  {covers.length === 0 ? (
                    <Ionicons name="albums-outline" size={18} color={colors.inkFaint} />
                  ) : covers.length === 1 ? (
                    <RecipeImage source={covers[0]} style={styles.coverFull} />
                  ) : (
                    <View style={styles.coverGrid}>
                      {covers.map((url, i) => (
                        <RecipeImage key={`${c.id}-${i}`} source={url} style={styles.coverQuad} />
                      ))}
                    </View>
                  )}
                </View>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {c.name}
                </Text>
                <Text style={styles.cardCount}>
                  {c.recipeCount} {c.recipeCount === 1 ? 'recipe' : 'recipes'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {collectionsStatus === 'error' && collections.length === 0 && (
          <Pressable style={styles.retryRow} onPress={() => reloadCollections()} hitSlop={8}>
            <Ionicons name="refresh" size={14} color={colors.sageDeep} />
            <Text style={styles.retryText}>
              {collectionsError || 'Couldn’t load your collections.'} Tap to retry.
            </Text>
          </Pressable>
        )}
      </ScrollView>
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
      backgroundColor: colors.paper,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.hairline,
      paddingHorizontal: spacing.md,
      height: 44,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.ink,
      outlineStyle: 'none',
    },
    createBtn: {
      backgroundColor: colors.sageDeep,
      borderRadius: 12,
      paddingHorizontal: spacing.lg,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    createText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.sm, color: colors.onAccent },
    formError: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.error,
      marginBottom: spacing.md,
    },
    grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', rowGap: 14 },
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
    cardTitle: { fontFamily: typography.body.semibold, fontSize: 13.5, color: colors.ink, marginTop: 8 },
    cardCount: { fontFamily: typography.body.fontFamily, fontSize: 11.5, color: colors.inkFaint, marginTop: 2 },
    retryRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.lg, alignSelf: 'center' },
    retryText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.sm, color: colors.sageDeep },
  });
}
