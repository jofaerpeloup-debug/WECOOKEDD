import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
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
import { recipeTimeLabel } from '../utils/recipe';
import { categoryLabel, regionLabel, difficultyLabel } from '../api/recipeOptions';

// CollectionDetail is the real stack destination the teammate "My Collections"
// grid (SavedScreen) navigates into (teammate `c1c86ed` CollectionDetailScreen
// row presentation, ported here). It supports exactly ONE real system
// collection for now — `route.params.collectionType === 'favorites'` — backed
// solely by FavoritesContext/the real API. Teammate's smart/user collections
// have no WeCooked backend (Collections proper is M5); `collectionType`
// (rather than a fabricated database id) lets M5 add real collection ids
// later without redesigning this screen.

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

export default function CollectionDetailScreen({ navigation, route }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const collectionType = route?.params?.collectionType || 'favorites';
  const supported = collectionType === 'favorites';

  const { favorites, status, error, reload } = useFavorites();
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (supported) reload();
    }, [supported, reload])
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
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable style={styles.iconBtn} hitSlop={8} onPress={() => navigation.goBack()}>
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
    </View>
  );

  // Forward-compatible guard: real collection ids arrive with M5. Nothing is
  // fabricated for an unsupported collectionType in the meantime.
  if (!supported) {
    return (
      <View style={styles.root}>
        {header('Collection', null)}
        <View style={styles.centerWrap}>
          <Text style={styles.errorText}>This collection isn’t available yet.</Text>
        </View>
      </View>
    );
  }

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
