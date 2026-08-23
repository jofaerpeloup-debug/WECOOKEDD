import React from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Pressable, Share, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import Badge from '../components/Badge';
import Button from '../components/Button';
import { useSavedRecipes } from '../context/SavedRecipesContext';
import { useShoppingList } from '../context/ShoppingListContext';
import { ingredientSwaps } from '../data/mockData';

// Checked most-specific-first so e.g. "buttermilk" (which contains both
// "butter" and "milk") is matched as its own ingredient, not double-counted
// as a butter AND a milk swap.
const SWAP_TERMS = [
  { key: 'buttermilk', term: 'buttermilk' },
  { key: 'sour cream', term: 'sour cream' },
  { key: 'butter', term: 'butter' },
  { key: 'milk', term: 'milk' },
  { key: 'eggs', term: 'egg' },
  { key: 'sugar', term: 'sugar' },
  { key: 'flour', term: 'flour' },
  { key: 'honey', term: 'honey' },
];

function findSwappableIngredients(ingredients) {
  const foundKeys = new Set();
  const results = [];
  for (const ing of ingredients) {
    const lower = ing.toLowerCase();
    for (const { key, term } of SWAP_TERMS) {
      if (foundKeys.has(key) || !ingredientSwaps[key]) continue;
      if (lower.includes(term)) {
        foundKeys.add(key);
        results.push({ key, ingredient: ing });
        break;
      }
    }
  }
  return results;
}

function estimateCalories(recipe) {
  let base = 420;
  if (recipe.tags.includes('Dessert')) base += 160;
  if (recipe.tags.includes('Breakfast')) base -= 60;
  if (recipe.tags.includes('High-Protein')) base += 70;
  if (recipe.tags.includes('Vegan')) base -= 50;
  if (recipe.tags.includes('Quick')) base -= 40;
  return Math.round(base / 10) * 10;
}

function difficultyFromScore(score) {
  if (score === 'A') return 'Easy';
  if (score === 'B') return 'Medium';
  return 'Hard';
}

export default function RecipeDetailScreen({ navigation, route }) {
  const { recipe } = route.params;
  const { colors, shadow } = useTheme();
  const styles = makeStyles(colors, shadow);
  const insets = useSafeAreaInsets();
  const { isSaved, toggleSaved } = useSavedRecipes();
  const { addIngredients } = useShoppingList();
  const saved = isSaved(recipe.id);

  const ingredients = recipe.ingredients || [];
  const swappable = findSwappableIngredients(ingredients);

  const stats = [
    { icon: 'time-outline', value: recipe.time, label: 'Time' },
    { icon: 'stats-chart-outline', value: difficultyFromScore(recipe.score), label: 'Difficulty' },
    { icon: 'people-outline', value: '4', label: 'Servings' },
    { icon: 'flame-outline', value: String(estimateCalories(recipe)), label: 'Calories' },
  ];

  const share = () => {
    Share.share({
      title: recipe.title,
      message: `${recipe.title} — ${recipe.description}`,
    }).catch(() => {});
  };

  const startCooking = () => {
    navigation.navigate('CookMode', { recipe, ingredients });
  };

  const addToShoppingList = () => {
    addIngredients(recipe.title, ingredients);
    navigation.navigate('List');
  };

  const openMore = () => {
    Alert.alert(recipe.title, undefined, [
      { text: 'Share', onPress: share },
      { text: 'Report Recipe', style: 'destructive' },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xxxl }}>
        <View style={styles.imageWrap}>
          <Image source={{ uri: recipe.image }} style={styles.image} />
          <Pressable
            style={[styles.iconBtn, styles.backBtn, { top: insets.top + spacing.sm }]}
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <View style={[styles.topRightBtns, { top: insets.top + spacing.sm }]}>
            <Pressable style={styles.iconBtn} onPress={() => toggleSaved(recipe.id)}>
              <Ionicons
                name={saved ? 'heart' : 'heart-outline'}
                size={18}
                color={saved ? colors.sageDeep : '#fff'}
              />
            </Pressable>
            <Pressable style={styles.iconBtn} onPress={openMore}>
              <Ionicons name="ellipsis-horizontal" size={18} color="#fff" />
            </Pressable>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.tagRow}>
            {recipe.tags.map((tag) => (
              <Badge key={tag} label={tag} tone="sage" />
            ))}
          </View>
          <Text style={styles.title}>{recipe.title}</Text>
          <Text style={styles.description}>{recipe.description}</Text>

          <View style={styles.statsRow}>
            {stats.map((s, i) => (
              <React.Fragment key={s.label}>
                {i > 0 && <View style={styles.statDivider} />}
                <View style={styles.statItem}>
                  <View style={styles.statTop}>
                    <Ionicons name={s.icon} size={14} color={colors.sageDeep} />
                    <Text style={styles.statValue}>{s.value}</Text>
                  </View>
                  <Text style={styles.statLabel}>{s.label}</Text>
                </View>
              </React.Fragment>
            ))}
          </View>

          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>Ingredients</Text>
            <Text style={styles.servingsBadge}>4 servings</Text>
          </View>
          <View style={styles.ingredientsCard}>
            {ingredients.map((ing, i) => (
              <View key={i} style={styles.ingredientRow}>
                <View style={styles.bullet} />
                <Text style={styles.ingredientText}>{ing}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.sectionLabel}>Need a Substitute?</Text>
          {swappable.length > 0 ? (
            <View style={{ gap: spacing.sm }}>
              {swappable.map(({ key, ingredient }) => (
                <Pressable
                  key={key}
                  style={styles.swapPromptCard}
                  onPress={() => navigation.navigate('IngredientStudio', { ingredientKey: key })}
                >
                  <View style={styles.swapPromptIcon}>
                    <Ionicons name="swap-horizontal" size={18} color={colors.sageDeep} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.swapPromptTitle}>{ingredientSwaps[key].name}</Text>
                    <Text style={styles.swapPromptSub} numberOfLines={1}>
                      {ingredient}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />
                </Pressable>
              ))}
            </View>
          ) : (
            <Pressable
              style={styles.swapPromptCard}
              onPress={() => navigation.navigate('IngredientStudio')}
            >
              <View style={styles.swapPromptIcon}>
                <Ionicons name="swap-horizontal" size={18} color={colors.sageDeep} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.swapPromptTitle}>Explore Artistic Swaps</Text>
                <Text style={styles.swapPromptSub}>Find substitutes for any ingredient</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />
            </Pressable>
          )}

          <View style={styles.ctaRow}>
            <Button
              title="Start Cooking"
              variant="primary"
              style={{ flex: 1 }}
              onPress={startCooking}
            />
            <Pressable style={styles.shareBtn} onPress={share}>
              <Ionicons name="share-social-outline" size={19} color={colors.ink} />
            </Pressable>
          </View>

          <Button
            title="Add All to Shopping List"
            variant="outline"
            style={{ marginTop: spacing.md }}
            onPress={addToShoppingList}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors, shadow) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    imageWrap: { position: 'relative' },
    image: { width: '100%', height: 300 },
    iconBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    backBtn: { position: 'absolute', left: spacing.lg },
    topRightBtns: {
      position: 'absolute',
      right: spacing.lg,
      flexDirection: 'row',
      gap: spacing.sm,
    },
    body: { padding: spacing.lg },
    tagRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
    title: {
      fontFamily: typography.display.fontFamily,
      fontSize: 26,
      lineHeight: 32,
      color: colors.ink,
      marginBottom: spacing.sm,
    },
    description: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.md,
      lineHeight: 22,
      color: colors.inkSoft,
      marginBottom: spacing.lg,
    },
    statsRow: {
      flexDirection: 'row',
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      paddingVertical: spacing.md,
      marginBottom: spacing.xxl,
    },
    statDivider: { width: 1, backgroundColor: colors.hairline, marginVertical: 2 },
    statItem: { flex: 1, alignItems: 'center', gap: 4 },
    statTop: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    statValue: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.ink,
    },
    statLabel: {
      fontFamily: typography.body.fontFamily,
      fontSize: 10,
      color: colors.inkFaint,
    },
    sectionHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.md,
    },
    sectionLabel: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.lg,
      color: colors.ink,
    },
    servingsBadge: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.xs,
      color: colors.sageDeep,
    },
    ingredientsCard: {
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      padding: spacing.lg,
      marginBottom: spacing.xxl,
    },
    ingredientRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 6 },
    bullet: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.sageDeep },
    ingredientText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.ink,
    },
    swapPromptCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.sagePale,
      borderRadius: radius.lg,
      padding: spacing.lg,
      ...shadow.soft,
    },
    swapPromptIcon: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: colors.paper,
      alignItems: 'center',
      justifyContent: 'center',
    },
    swapPromptTitle: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.md,
      color: colors.sage,
    },
    swapPromptSub: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkSoft,
      marginTop: 2,
    },
    ctaRow: {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: spacing.sm,
      marginTop: spacing.xl,
    },
    shareBtn: {
      width: 52,
      borderRadius: radius.pill,
      backgroundColor: colors.paper,
      borderWidth: 1,
      borderColor: colors.hairline,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
