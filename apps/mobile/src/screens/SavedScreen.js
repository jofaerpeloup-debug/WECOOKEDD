import React, { useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { typography, spacing } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import RecipeImage from '../components/RecipeImage';
import { useFavorites } from '../context/FavoritesContext';

// Saved is the teammate "My Collections" shell (commit c1c86ed) ported onto
// real data — a collections BROWSER, not a favorites list. The teammate
// screen's 5 hardcoded "smart" collections (scanning the entire mock recipe
// catalog) and AsyncStorage-backed user collections have no WeCooked backend
// (Collections proper is M5), so only ONE real system collection is shown:
// "Favorites", backed exclusively by FavoritesContext/the real API.
//
// Tapping the Favorites card navigates to the real `CollectionDetail` stack
// route (teammate's own next screen — see CollectionDetailScreen.js), which
// owns the Favorites list/loading/error/empty presentation. This screen is
// only ever the grid/header shell — no nested in-screen pseudo-route, no
// BackHandler workaround; back/edge-swipe is real React Navigation stack
// behavior end to end.

export default function SavedScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { favorites, status, reload } = useFavorites();
  const insets = useSafeAreaInsets();

  // Reconcile with server truth whenever Saved regains focus (e.g. returning
  // from CollectionDetail after an unfavorite) so the card cover/count stay
  // current. `reload` is generation-guarded.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const collectionsUnavailable = () =>
    Alert.alert('Collections are coming soon', 'Creating your own collections isn’t available yet.');

  const openFavorites = () => navigation.navigate('CollectionDetail', { collectionType: 'favorites' });

  const cover = favorites.slice(0, 4);

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
            <Pressable style={styles.iconBtn} hitSlop={6} onPress={collectionsUnavailable}>
              <Ionicons name="add" size={18} color={colors.ink} />
            </Pressable>
          </View>
        </View>

        <View style={styles.grid}>
          <Pressable style={styles.card} onPress={openFavorites}>
            <View style={styles.cardImg}>
              {(status === 'loading' || status === 'idle') && favorites.length === 0 ? (
                <ActivityIndicator color={colors.sageDeep} />
              ) : status === 'error' && favorites.length === 0 ? (
                <Ionicons name="cloud-offline-outline" size={18} color={colors.inkFaint} />
              ) : cover.length === 0 ? (
                <Ionicons name="heart-outline" size={18} color={colors.inkFaint} />
              ) : cover.length === 1 ? (
                <RecipeImage source={cover[0].recipe.imageUrl} style={styles.coverFull} />
              ) : (
                <View style={styles.coverGrid}>
                  {cover.map((entry) => (
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
        </View>
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
    grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start' },
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
  });
}
