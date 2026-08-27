import React, { useMemo, useState } from 'react';
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
import { imageSource } from '../utils/image';

const BASE_SERVINGS = 4;
const MIN_SERVINGS = 1;
const MAX_SERVINGS = 20;

const FRACTION_GLYPHS = [
  [0.125, '⅛'],
  [0.25, '¼'],
  [0.333, '⅓'],
  [0.375, '⅜'],
  [0.5, '½'],
  [0.625, '⅝'],
  [0.667, '⅔'],
  [0.75, '¾'],
  [0.875, '⅞'],
];

function parseQuantity(token) {
  const mixed = token.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = token.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(token);
}

function formatQuantity(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const whole = Math.floor(value);
  const frac = value - whole;
  if (frac < 0.02) return String(whole);
  for (const [dec, glyph] of FRACTION_GLYPHS) {
    if (Math.abs(frac - dec) < 0.04) return whole > 0 ? `${whole} ${glyph}` : glyph;
  }
  return String(Math.round(value * 100) / 100);
}

// Estimates scaled quantities by parsing the leading number/fraction of an
// ingredient line — approximate by nature since it doesn't understand units.
function scaleIngredientText(text, ratio) {
  const match = text.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+)(\s.*)$/);
  if (!match) return text;
  const qty = parseQuantity(match[1]);
  const scaled = formatQuantity(qty * ratio);
  if (scaled === null) return text;
  return `${scaled}${match[2]}`;
}

const MEASURE_UNITS = new Set([
  'cup', 'cups', 'tbsp', 'tbsps', 'tablespoon', 'tablespoons',
  'tsp', 'tsps', 'teaspoon', 'teaspoons', 'oz', 'ounce', 'ounces',
  'lb', 'lbs', 'pound', 'pounds', 'g', 'gram', 'grams', 'kg',
  'kilogram', 'kilograms', 'ml', 'milliliter', 'milliliters',
  'l', 'liter', 'liters', 'pinch', 'pinches', 'dash', 'dashes',
  'clove', 'cloves', 'slice', 'slices', 'can', 'cans', 'package',
  'packages', 'stick', 'sticks', 'bunch', 'bunches', 'head', 'heads',
  'block', 'blocks', 'thumb', 'thumbs', 'knob', 'knobs',
  'handful', 'handfuls', 'splash', 'splashes',
]);

// Drops up to two leading words if they're a unit (optionally after a size
// descriptor like "whole"), e.g. "whole heads garlic" -> "garlic",
// "cups sugar" -> "sugar". Leaves plain descriptors like "large eggs" alone.
function stripLeadingUnitWords(text) {
  const words = text.split(' ');
  const clean = (w) => w?.toLowerCase().replace(/[.,]$/, '');
  if (MEASURE_UNITS.has(clean(words[0]))) {
    return words.slice(1).join(' ').replace(/^of\s+/i, '');
  }
  if (words.length > 1 && MEASURE_UNITS.has(clean(words[1]))) {
    return words.slice(2).join(' ').replace(/^of\s+/i, '');
  }
  return text;
}

// Strips the leading quantity ("2", "1/4", "1 1/2") and any unit words
// ("cups", "whole heads", "pinch of") — leaving just the ingredient itself,
// for a shopping list that doesn't care how much of it to buy.
function stripMeasurement(text) {
  const match = text.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+)\s+(.*)$/);
  const rest = stripLeadingUnitWords(match ? match[2] : text);
  if (!rest) return text;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

// Estimates a scaled cook time the same way calories are scaled — not
// physically accurate (doubling a batch doesn't double cook time), but
// matches the app's existing "estimate everything off servings" approach.
function scaleTime(timeText, ratio) {
  const match = timeText.match(/^(\d+)\s*(.*)$/);
  if (!match) return timeText;
  const minutes = Math.max(1, Math.round(Number(match[1]) * ratio));
  return `${minutes} ${match[2]}`.trim();
}

function estimateMacros(calories, recipe) {
  let proteinPct = 0.2;
  let carbPct = 0.5;
  let fatPct = 0.3;
  if (recipe.tags.includes('High-Protein')) {
    proteinPct = 0.35;
    carbPct = 0.4;
    fatPct = 0.25;
  }
  if (recipe.tags.includes('Vegan')) {
    proteinPct = 0.18;
    carbPct = 0.57;
    fatPct = 0.25;
  }
  if (recipe.tags.includes('Dessert')) {
    proteinPct = 0.1;
    carbPct = 0.6;
    fatPct = 0.3;
  }
  const carbs = Math.round((calories * carbPct) / 4);
  const sugarRatio = recipe.tags.includes('Dessert') ? 0.45 : 0.15;
  const fiberRatio = recipe.tags.includes('Vegan') ? 0.18 : 0.1;

  return {
    protein: Math.round((calories * proteinPct) / 4),
    carbs,
    fat: Math.round((calories * fatPct) / 9),
    sugar: Math.round(carbs * sugarRatio),
    fiber: Math.round(carbs * fiberRatio),
  };
}

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

  const [servings, setServings] = useState(BASE_SERVINGS);
  const [macrosOpen, setMacrosOpen] = useState(false);

  const ratio = servings / BASE_SERVINGS;
  const scaledIngredients = useMemo(
    () => ingredients.map((ing) => scaleIngredientText(ing, ratio)),
    [ingredients, ratio]
  );

  const calories = Math.round(estimateCalories(recipe) * ratio);
  const macros = useMemo(() => estimateMacros(calories, recipe), [calories, recipe]);

  const stats = [
    { icon: 'time-outline', value: scaleTime(recipe.time, ratio), label: 'Time' },
    { icon: 'stats-chart-outline', value: difficultyFromScore(recipe.score), label: 'Difficulty' },
    { icon: 'people-outline', value: String(servings), label: 'Servings' },
  ];

  const share = () => {
    Share.share({
      title: recipe.title,
      message: `${recipe.title} — ${recipe.description}`,
    }).catch(() => {});
  };

  const startCooking = () => {
    navigation.navigate('CookMode', { recipe, ingredients: scaledIngredients, servings });
  };

  const addToShoppingList = () => {
    addIngredients(recipe.title, scaledIngredients.map(stripMeasurement));
    navigation.navigate('List');
  };

  const decrementServings = () => setServings((s) => Math.max(MIN_SERVINGS, s - 1));
  const incrementServings = () => setServings((s) => Math.min(MAX_SERVINGS, s + 1));

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
          <Image source={imageSource(recipe.image)} style={styles.image} />
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
            <View style={styles.stepper}>
              <Pressable
                onPress={decrementServings}
                hitSlop={8}
                style={styles.stepperBtn}
                disabled={servings <= MIN_SERVINGS}
              >
                <Ionicons
                  name="remove"
                  size={16}
                  color={servings <= MIN_SERVINGS ? colors.inkFaint : colors.error}
                />
              </Pressable>
              <Text style={styles.stepperValue}>{servings}</Text>
              <Pressable
                onPress={incrementServings}
                hitSlop={8}
                style={styles.stepperBtn}
                disabled={servings >= MAX_SERVINGS}
              >
                <Ionicons
                  name="add"
                  size={16}
                  color={servings >= MAX_SERVINGS ? colors.inkFaint : colors.error}
                />
              </Pressable>
            </View>
          </View>

          <View style={styles.ingredientsCard}>
            {scaledIngredients.map((ing, i) => (
              <View key={i} style={styles.ingredientRow}>
                <View style={styles.bullet} />
                <Text style={styles.ingredientText}>{ing}</Text>
              </View>
            ))}
          </View>

          <View style={styles.nutritionCard}>
            <Pressable
              style={styles.nutritionHeader}
              onPress={() => setMacrosOpen((v) => !v)}
              hitSlop={4}
            >
              <Text style={styles.nutritionTitle}>Nutrition Info</Text>
              <View style={styles.nutritionToggle}>
                <Text style={styles.nutritionToggleText}>
                  {macrosOpen ? 'Hide Info' : 'Show Info'}
                </Text>
                <Ionicons name={macrosOpen ? 'remove' : 'add'} size={16} color={colors.error} />
              </View>
            </Pressable>

            {macrosOpen && (
              <View>
                {[
                  { label: 'calories', value: String(calories) },
                  { label: 'fat', value: `${macros.fat}g` },
                  { label: 'carbs', value: `${macros.carbs}g` },
                  { label: 'protein', value: `${macros.protein}g` },
                  { label: 'sugar', value: `${macros.sugar}g` },
                  { label: 'fiber', value: `${macros.fiber}g` },
                ].map((row) => (
                  <View key={row.label} style={styles.nutritionRow}>
                    <Text style={styles.nutritionRowLabel}>{row.label}</Text>
                    <Text style={styles.nutritionRowValue}>{row.value}</Text>
                  </View>
                ))}
              </View>
            )}
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
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.hairline,
      borderRadius: radius.pill,
      paddingHorizontal: 4,
      gap: spacing.sm,
    },
    stepperBtn: {
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepperValue: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.ink,
      minWidth: 16,
      textAlign: 'center',
    },
    ingredientsCard: {
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      padding: spacing.lg,
      marginBottom: spacing.lg,
    },
    ingredientRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 6 },
    bullet: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.sageDeep },
    ingredientText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.ink,
    },
    nutritionCard: {
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      padding: spacing.lg,
      marginBottom: spacing.xxl,
    },
    nutritionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    nutritionTitle: {
      fontFamily: typography.display.fontFamily,
      fontSize: typography.sizes.lg,
      color: colors.ink,
    },
    nutritionToggle: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    nutritionToggleText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.error,
    },
    nutritionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.hairline,
      marginTop: spacing.md,
    },
    nutritionRowLabel: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.inkSoft,
    },
    nutritionRowValue: {
      fontFamily: typography.body.semibold,
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
