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
import { useFocusEffect } from '@react-navigation/native';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import Button from '../components/Button';
import RecipeImage from '../components/RecipeImage';
import FavoriteHeart from '../components/FavoriteHeart';
import { useFavorites } from '../context/FavoritesContext';
import { recipeTimeLabel } from '../utils/recipe';
import { cuisineLabel, difficultyLabel } from '../api/recipeOptions';

// The authenticated Saved tab is backed entirely by the real Favorites REST API
// (via FavoritesProvider) — no SavedRecipesContext, no mockData, no mock recipe
// lookup. The favorite's nested recipe is a SUMMARY: only
// { id, title, cuisine, difficulty, prepTimeMinutes, cookTimeMinutes, imageUrl }
// are available here — description / servings / ingredients / instructions are
// NOT, and are never fabricated. Opening a recipe navigates cold to the API
// Recipe Detail, which performs the authoritative GET /api/v1/recipes/:id.

function metaLabel(recipe) {
  return cuisineLabel(recipe.cuisine) || difficultyLabel(recipe.difficulty) || 'Recipe';
}

export default function SavedScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = makeStyles(colors, shadow);
  const { favorites, status, error, reload } = useFavorites();
  const [refreshing, setRefreshing] = useState(false);

  // Reconcile with server truth whenever the tab regains focus. An add/remove
  // made on another screen already propagated through the shared provider; this
  // also picks up a favorite whose recipe was archived server-side. `reload` is
  // generation-guarded, so a focus that lands during the provider's initial
  // load simply supersedes it rather than racing it.
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
    // Cold navigation: pass ONLY the source + id. The summary is not a full
    // PublicRecipe, so it must not be handed over as `initialRecipe`.
    navigation.navigate('RecipeDetail', { recipeSource: 'api', recipeId: recipe.id });
  };

  // Initial load, nothing to show yet.
  if ((status === 'loading' || status === 'idle') && favorites.length === 0) {
    return (
      <View style={styles.root}>
        <TopBar mode="brand" />
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
        <TopBar mode="brand" />
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

  const [featured, ...rest] = favorites;

  return (
    <View style={styles.root}>
      <TopBar mode="brand" />

      {!featured ? (
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
            <View style={styles.emptyIcon}>
              <Ionicons name="heart-outline" size={26} color={colors.sageDeep} />
            </View>
            <Text style={styles.emptyTitle}>No saved recipes yet</Text>
            <Text style={styles.emptySub}>Tap the heart icon on any recipe to save it here.</Text>
            <Button
              title="Discover Recipes"
              variant="primary"
              onPress={() => navigation.navigate('Discover')}
              style={{ marginTop: spacing.xl, alignSelf: 'stretch' }}
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
          <View style={styles.featuredCard}>
            <Pressable onPress={() => openRecipe(featured.recipe)}>
              <RecipeImage source={featured.recipe.imageUrl} style={styles.featuredImage} />
              <View style={styles.featuredTextWrap}>
                <Text style={styles.featuredTitle} numberOfLines={2}>
                  {featured.recipe.title}
                </Text>
                <View style={styles.metaRow}>
                  <Ionicons name="time-outline" size={12} color={colors.inkFaint} />
                  <Text style={styles.metaText}>{recipeTimeLabel(featured.recipe)}</Text>
                  <Text style={styles.metaDot}>·</Text>
                  <Text style={styles.metaText}>{metaLabel(featured.recipe)}</Text>
                </View>
              </View>
            </Pressable>
            <FavoriteHeart
              recipe={featured.recipe}
              size={16}
              variant="overlay"
              style={styles.saveIconFeatured}
            />
          </View>

          <View style={styles.grid}>
            {rest.map((entry) => (
              <View key={entry.recipe.id} style={styles.gridCard}>
                <Pressable onPress={() => openRecipe(entry.recipe)}>
                  <RecipeImage source={entry.recipe.imageUrl} style={styles.gridImage} />
                  <View style={styles.gridTextWrap}>
                    <Text style={styles.gridTitle} numberOfLines={1}>
                      {entry.recipe.title}
                    </Text>
                    <View style={styles.metaRow}>
                      <Ionicons name="time-outline" size={11} color={colors.inkFaint} />
                      <Text style={styles.metaTextSm}>{recipeTimeLabel(entry.recipe)}</Text>
                    </View>
                  </View>
                </Pressable>
                <FavoriteHeart
                  recipe={entry.recipe}
                  size={13}
                  variant="overlay"
                  style={styles.saveIconGrid}
                />
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function makeStyles(colors, shadow) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    emptyScroll: { flexGrow: 1 },
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
    emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
    emptyIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.lg,
    },
    emptyTitle: {
      fontFamily: typography.display.fontFamily,
      fontSize: 20,
      color: colors.ink,
      marginBottom: spacing.sm,
    },
    emptySub: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      textAlign: 'center',
      lineHeight: 19,
      maxWidth: '80%',
    },
    featuredCard: {
      borderRadius: radius.lg,
      overflow: 'hidden',
      marginBottom: spacing.lg,
      backgroundColor: colors.paper,
      ...shadow.soft,
    },
    featuredImage: { width: '100%', height: 170 },
    saveIconFeatured: {
      position: 'absolute',
      top: spacing.md,
      right: spacing.md,
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: 'rgba(255,255,255,0.92)',
    },
    featuredTextWrap: { padding: spacing.lg },
    featuredTitle: {
      fontFamily: typography.display.fontFamily,
      fontSize: 19,
      color: colors.ink,
      marginBottom: spacing.sm,
    },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
    gridCard: {
      width: '47%',
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      overflow: 'hidden',
      ...shadow.soft,
    },
    gridImage: { width: '100%', height: 110 },
    saveIconGrid: {
      position: 'absolute',
      top: spacing.sm,
      right: spacing.sm,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: 'rgba(255,255,255,0.92)',
    },
    gridTextWrap: { padding: spacing.md },
    gridTitle: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.ink,
      marginBottom: 4,
    },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    metaText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
    },
    metaTextSm: {
      fontFamily: typography.body.fontFamily,
      fontSize: 10,
      color: colors.inkFaint,
    },
    metaDot: { color: colors.inkFaint, fontSize: 10 },
  });
}
