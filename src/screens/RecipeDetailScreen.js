import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Pressable, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { useSavedRecipes } from '../context/SavedRecipesContext';
import { useShoppingList } from '../context/ShoppingListContext';
import { useCookedRecipes } from '../context/CookedRecipesContext';
import { useReviews } from '../context/ReviewsContext';
import CollectionPickerSheet from '../components/CollectionPickerSheet';
import MealPlanSheet from '../components/MealPlanSheet';
import { scaleQty, estimateNutrition } from '../utils/recipe';
import { imageSource } from '../utils/image';
import { notify } from '../utils/alert';

const MIN_SERVINGS = 1;
const MAX_SERVINGS = 20;

export default function RecipeDetailScreen({ navigation, route }) {
  const { recipe } = route.params;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const { isSaved, toggleSaved } = useSavedRecipes();
  const { addFromRecipe } = useShoppingList();
  const { hasCooked } = useCookedRecipes();
  const { setRating, getRating, displayFor } = useReviews();
  const saved = isSaved(recipe.id);
  const cooked = hasCooked(recipe.id);
  const myRating = getRating(recipe.id);
  const shown = displayFor(recipe);

  const baseServings = recipe.servings || 4;
  const [servings, setServings] = useState(baseServings);
  const [nutritionOpen, setNutritionOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const ratio = servings / baseServings;

  const addToList = () => {
    addFromRecipe(recipe);
    notify('Added to Grocery List', `${recipe.ingredients.length} ingredients from ${recipe.title}.`);
  };

  const scaledIngredients = useMemo(
    () => recipe.ingredients.map((ing) => ({ ...ing, qty: scaleQty(ing.qty, ratio) })),
    [recipe, ratio]
  );
  const nutrition = useMemo(() => {
    const base = estimateNutrition(recipe);
    const per = servings / baseServings;
    return {
      calories: Math.round((base.calories * per) / 10) * 10,
      protein: Math.round(base.protein * per),
      carbs: Math.round(base.carbs * per),
      fat: Math.round(base.fat * per),
      sugar: Math.round(base.sugar * per),
      fiber: Math.round(base.fiber * per),
    };
  }, [recipe, servings, baseServings]);

  const share = () => {
    Share.share({ title: recipe.title, message: `${recipe.title} — ${recipe.description}` }).catch(() => {});
  };
  const dec = () => setServings((s) => Math.max(MIN_SERVINGS, s - 1));
  const inc = () => setServings((s) => Math.min(MAX_SERVINGS, s + 1));

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={styles.hero}>
          <Image source={imageSource(recipe.image)} style={styles.heroImg} />
          <View style={[styles.heroBtns, { top: insets.top + spacing.sm }]}>
            <Pressable style={styles.circleBtn} onPress={() => navigation.goBack()}>
              <Ionicons name="chevron-back" size={16} color="#FAF9F6" />
            </Pressable>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable style={styles.circleBtn} onPress={() => toggleSaved(recipe.id)}>
                <Ionicons
                  name={saved ? 'heart' : 'heart-outline'}
                  size={16}
                  color={saved ? colors.favorite : '#FAF9F6'}
                />
              </Pressable>
              <Pressable style={styles.circleBtn} onPress={() => setPickerOpen(true)}>
                <Ionicons name="albums-outline" size={15} color="#FAF9F6" />
              </Pressable>
              <Pressable style={styles.circleBtn} onPress={addToList}>
                <Ionicons name="cart-outline" size={15} color="#FAF9F6" />
              </Pressable>
              <Pressable style={styles.circleBtn} onPress={share}>
                <Ionicons name="share-social-outline" size={15} color="#FAF9F6" />
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.body}>
          <Text style={styles.title}>{recipe.title}</Text>

          <View style={styles.ratingRow}>
            <Ionicons name="star" size={13} color={colors.stone} />
            <Text style={styles.rating}>{shown.rating}</Text>
            <Text style={styles.reviews}>({shown.reviews} reviews)</Text>
            {cooked && (
              <View style={styles.cookedPill}>
                <Ionicons name="checkmark" size={11} color={colors.success} />
                <Text style={styles.cookedPillText}>Cooked</Text>
              </View>
            )}
          </View>

          <View style={styles.rateRow}>
            <Text style={styles.rateLabel}>{myRating ? 'Your rating' : 'Rate this recipe'}</Text>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable key={n} hitSlop={4} onPress={() => setRating(recipe.id, n)}>
                  <Ionicons
                    name={n <= myRating ? 'star' : 'star-outline'}
                    size={20}
                    color={n <= myRating ? colors.stone : colors.inkFaint}
                  />
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.metaRow}>
            <Meta value={`${recipe.minutes} min`} label="Time" styles={styles} />
            <Meta value={recipe.difficulty} label="Difficulty" styles={styles} />
            <Meta value={`${servings}`} label="Servings" styles={styles} />
          </View>

          <Text style={styles.description}>{recipe.description}</Text>

          <View style={styles.ingHeader}>
            <Text style={styles.eyebrow}>Ingredients</Text>
            <View style={styles.stepper}>
              <Pressable style={styles.stepBtn} onPress={dec} hitSlop={8} disabled={servings <= MIN_SERVINGS}>
                <Ionicons name="remove" size={15} color={servings <= MIN_SERVINGS ? colors.inkFaint : colors.sageDeep} />
              </Pressable>
              <Text style={styles.stepValue}>{servings}</Text>
              <Pressable style={styles.stepBtn} onPress={inc} hitSlop={8} disabled={servings >= MAX_SERVINGS}>
                <Ionicons name="add" size={15} color={servings >= MAX_SERVINGS ? colors.inkFaint : colors.sageDeep} />
              </Pressable>
            </View>
          </View>
          <View>
            {scaledIngredients.map((ing, i) => (
              <View key={i} style={styles.ingRow}>
                <View style={styles.ingLeft}>
                  <Text style={styles.plus}>+</Text>
                  <Text style={styles.ingName}>{ing.name}</Text>
                </View>
                <Text style={styles.ingQty}>{ing.qty}</Text>
              </View>
            ))}
          </View>

          <Pressable style={styles.nutritionCard} onPress={() => setNutritionOpen((v) => !v)}>
            <View style={styles.nutritionHead}>
              <Text style={styles.nutritionTitle}>Nutrition Info</Text>
              <Text style={styles.nutritionToggle}>
                {nutritionOpen ? 'Hide Info −' : 'Show Info +'}
              </Text>
            </View>
            {nutritionOpen && (
              <View style={styles.nutritionBody}>
                <Text style={styles.nutritionNote}>Estimated, per serving.</Text>
                {[
                  ['Calories', `${nutrition.calories}`],
                  ['Protein', `${nutrition.protein} g`],
                  ['Carbs', `${nutrition.carbs} g`],
                  ['Fat', `${nutrition.fat} g`],
                  ['Sugar', `${nutrition.sugar} g`],
                  ['Fiber', `${nutrition.fiber} g`],
                ].map(([k, v]) => (
                  <View key={k} style={styles.nutritionRow}>
                    <Text style={styles.nutritionKey}>{k}</Text>
                    <Text style={styles.nutritionVal}>{v}</Text>
                  </View>
                ))}
              </View>
            )}
          </Pressable>

          <Pressable style={styles.substituteRow} onPress={() => setPlanOpen(true)}>
            <View style={styles.substituteIcon}>
              <Ionicons name="calendar-outline" size={16} color={colors.stone} />
            </View>
            <Text style={styles.substituteText}>Add to meal plan</Text>
            <Ionicons name="chevron-forward" size={15} color={colors.inkFaint} />
          </Pressable>

          <Pressable
            style={styles.substituteRow}
            onPress={() => navigation.navigate('IngredientStudio', { recipe })}
          >
            <View style={styles.substituteIcon}>
              <Ionicons name="swap-horizontal" size={16} color={colors.stone} />
            </View>
            <Text style={styles.substituteText}>Need a substitute? Find swaps</Text>
            <Ionicons name="chevron-forward" size={15} color={colors.inkFaint} />
          </Pressable>
        </View>
      </ScrollView>

      <View style={[styles.ctaWrap, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Pressable style={styles.cta} onPress={() => navigation.navigate('CookMode', { recipe, servings })}>
          <Ionicons name="play" size={15} color={colors.onAccent} />
          <Text style={styles.ctaText}>Start Cooking</Text>
        </Pressable>
      </View>

      <CollectionPickerSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        recipeId={recipe.id}
      />
      <MealPlanSheet visible={planOpen} onClose={() => setPlanOpen(false)} recipeId={recipe.id} />
    </View>
  );
}

function Meta({ value, label, styles }) {
  return (
    <View>
      <Text style={styles.metaValue}>{value}</Text>
      <Text style={styles.metaLabel}>{label}</Text>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    hero: { position: 'relative', height: 280, backgroundColor: colors.creamDeep },
    heroImg: { width: '100%', height: '100%' },
    heroBtns: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
    circleBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: 'rgba(18,22,14,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    body: { padding: spacing.xl },
    title: { fontFamily: typography.display.fontFamily, fontSize: 24, lineHeight: 29, color: colors.ink },
    ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 },
    rating: { fontFamily: typography.body.semibold, fontSize: 13, color: colors.ink },
    reviews: { fontFamily: typography.body.fontFamily, fontSize: 12.5, color: colors.inkFaint },
    cookedPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      marginLeft: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radius.pill,
      backgroundColor: colors.successBg,
    },
    cookedPillText: { fontFamily: typography.body.bold, fontSize: 10.5, color: colors.success },
    rateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.sageLight,
    },
    rateLabel: { fontFamily: typography.body.semibold, fontSize: 12.5, color: colors.inkSoft },
    substituteRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginTop: spacing.lg,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.sageLight,
    },
    substituteIcon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.stoneLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    substituteText: { flex: 1, fontFamily: typography.body.semibold, fontSize: 13.5, color: colors.ink },
    metaRow: { flexDirection: 'row', gap: 20, marginTop: 16 },
    metaValue: { fontFamily: typography.body.semibold, fontSize: 13.5, color: colors.ink },
    metaLabel: { fontFamily: typography.body.fontFamily, fontSize: 11, color: colors.inkFaint, marginTop: 1 },
    description: { fontFamily: typography.body.fontFamily, fontSize: 13.5, lineHeight: 21, color: colors.inkSoft, marginTop: 16 },
    ingHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 24,
      marginBottom: spacing.md,
    },
    eyebrow: {
      fontFamily: typography.body.bold,
      fontSize: 11.5,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: colors.inkFaint,
    },
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.creamDeep,
      borderRadius: radius.pill,
      paddingHorizontal: 6,
      paddingVertical: 5,
    },
    stepBtn: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepValue: { fontFamily: typography.body.bold, fontSize: 13, color: colors.ink, minWidth: 14, textAlign: 'center' },
    ingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 11,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
    },
    ingLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
    plus: { fontFamily: typography.body.semibold, fontSize: 15, color: colors.sageDeep },
    ingName: { fontFamily: typography.body.fontFamily, fontSize: 14, color: colors.ink, flex: 1 },
    ingQty: { fontFamily: typography.body.fontFamily, fontSize: 13, color: colors.inkFaint },
    nutritionCard: {
      marginTop: spacing.xl,
      borderWidth: 1,
      borderColor: colors.hairline,
      borderRadius: radius.md,
      padding: spacing.lg,
    },
    nutritionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    nutritionTitle: { fontFamily: typography.display.fontFamily, fontSize: 16, color: colors.ink },
    nutritionToggle: { fontFamily: typography.body.bold, fontSize: 12.5, color: colors.sageDeep },
    nutritionBody: { marginTop: spacing.md },
    nutritionNote: { fontFamily: typography.body.fontFamily, fontSize: 11.5, color: colors.inkFaint, marginBottom: spacing.sm },
    nutritionRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 9,
      borderTopWidth: 1,
      borderTopColor: colors.hairline,
    },
    nutritionKey: { fontFamily: typography.body.fontFamily, fontSize: 13.5, color: colors.inkSoft },
    nutritionVal: { fontFamily: typography.body.semibold, fontSize: 13.5, color: colors.ink },
    ctaWrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      backgroundColor: colors.cream,
    },
    cta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      height: 52,
      borderRadius: radius.pill,
      backgroundColor: colors.sageDeep,
    },
    ctaText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.md, color: colors.onAccent },
  });
}
