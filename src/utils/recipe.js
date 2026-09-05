// Small recipe display + math helpers.
import { recipes, SPICE_LEVELS } from '../data/mockData';

export const metaLine = (r) => `${r.minutes} min · ${r.difficulty}`;

// Deterministic recipe set for a collection, so each opens to something
// sensible. `savedIds` is the Set from useSavedRecipes().
export function collectionRecipes(collection, savedIds) {
  const title = collection?.title || '';
  if (title === 'Favorites') return recipes.filter((r) => savedIds?.has(r.id));
  if (title === 'Quick Meals') return recipes.filter((r) => r.minutes <= 30);
  if (title === 'Healthy Meals') return recipes.filter((r) => r.dietary.length > 0);
  if (title === 'Breakfast') return recipes.filter((r) => r.category === 'breakfast');
  if (title === 'Dinner Ideas') return recipes.filter((r) => r.category === 'ulam');
  if (title === 'Weekend Cooking') return recipes.filter((r) => r.minutes >= 60);
  return recipes;
}

export function timeBucket(minutes) {
  if (minutes < 15) return 'lt15';
  if (minutes <= 30) return 'm1530';
  if (minutes <= 60) return 'm3060';
  return 'gt60';
}

// Seconds -> "m:ss"
export function fmtTimer(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// ---- servings scaling -----------------------------------------------------

const FRACTIONS = [
  [0.125, '⅛'], [0.25, '¼'], [0.333, '⅓'], [0.5, '½'],
  [0.667, '⅔'], [0.75, '¾'],
];

function parseAmount(token) {
  const mixed = token.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = token.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(token);
}

function formatAmount(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const whole = Math.floor(value + 1e-6);
  const frac = value - whole;
  if (frac < 0.06) return String(whole);
  for (const [dec, glyph] of FRACTIONS) {
    if (Math.abs(frac - dec) < 0.08) return whole > 0 ? `${whole} ${glyph}` : glyph;
  }
  return String(Math.round(value * 10) / 10);
}

// Scales the leading quantity in an ingredient qty string ("1/2 cup",
// "8 cloves", "40 g", "1"). Non-numeric strings pass through unchanged.
export function scaleQty(qty, ratio) {
  if (ratio === 1) return qty;
  const m = String(qty).match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+)(.*)$/);
  if (!m) return qty;
  const scaled = formatAmount(parseAmount(m[1]) * ratio);
  return scaled === null ? qty : `${scaled}${m[2]}`;
}

// ---- spice / chili heat -----------------------------------------------------

// Resolve a SPICE_LEVELS entry by key, falling back to "medium".
export function spiceLevel(key) {
  return (
    SPICE_LEVELS.find((l) => l.key === key) ||
    SPICE_LEVELS.find((l) => l.key === 'medium')
  );
}

// For a spice-adjustable recipe, scale the quantity of every chili ingredient
// (matched by recipe.spice.match) by the chosen level's factor. Returns a new
// ingredient array; recipes without a `spice` field pass through untouched.
export function applySpice(ingredients, recipe, levelKey) {
  if (!recipe?.spice) return ingredients;
  const level = spiceLevel(levelKey);
  if (level.factor === 1) return ingredients;
  let re;
  try {
    re = new RegExp(recipe.spice.match, 'i');
  } catch {
    return ingredients;
  }
  return ingredients.map((ing) =>
    re.test(ing.name) ? { ...ing, qty: scaleQty(ing.qty, level.factor) } : ing
  );
}

// ---- rough nutrition estimate ------------------------------------------------

export function estimateNutrition(recipe) {
  let base = 430;
  if (recipe.category === 'desserts') base += 150;
  if (recipe.category === 'breakfast') base -= 40;
  if (recipe.category === 'noodles') base += 30;
  if (recipe.difficulty === 'Hard') base += 40;
  if (recipe.dietary?.includes('vegan')) base -= 90;
  else if (recipe.dietary?.includes('vegetarian')) base -= 40;

  let proteinPct = 0.24, carbPct = 0.44, fatPct = 0.32;
  if (recipe.dietary?.includes('vegan') || recipe.dietary?.includes('vegetarian')) {
    proteinPct = 0.16; carbPct = 0.56; fatPct = 0.28;
  }
  if (recipe.category === 'desserts') {
    proteinPct = 0.08; carbPct = 0.62; fatPct = 0.3;
  }

  const calories = Math.round(base / 10) * 10;
  const carbs = Math.round((calories * carbPct) / 4);
  return {
    calories,
    protein: Math.round((calories * proteinPct) / 4),
    carbs,
    fat: Math.round((calories * fatPct) / 9),
    sugar: Math.round(carbs * (recipe.category === 'desserts' ? 0.5 : 0.15)),
    fiber: Math.round(carbs * (recipe.dietary?.length ? 0.18 : 0.1)),
  };
}
