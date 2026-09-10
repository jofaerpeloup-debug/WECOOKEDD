// View helpers for backend (PublicRecipe) recipes. Pure functions — no
// fabricated fields (no score/rating/nutrition/author/mealType), no unit
// conversion, server order preserved.

import { categoryLabel, regionLabel, dietaryTagLabel, unitLabel } from '../api/recipeOptions';

export function totalTimeMinutes(recipe) {
  const prep = Number(recipe && recipe.prepTimeMinutes) || 0;
  const cook = Number(recipe && recipe.cookTimeMinutes) || 0;
  return prep + cook;
}

export function formatMinutes(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  return `${m} min`;
}

// "45 min" from prep + cook — the only time figure the backend supports.
export function recipeTimeLabel(recipe) {
  return formatMinutes(totalTimeMinutes(recipe));
}

// Badges for an API recipe: the recipe's classifier first (category, else
// region — both optional canonical slugs, absent on legacy records), then
// each dietary tag, as readable labels. `cuisine` is retired and never read.
// Never includes mock-only tags (Dinner, Quick, High-Protein, …) and never
// fabricates a classifier for a recipe that has none.
export function recipeBadges(recipe) {
  const badges = [];
  const classifier = categoryLabel(recipe && recipe.category) || regionLabel(recipe && recipe.region);
  if (classifier) badges.push(classifier);
  for (const tag of (recipe && recipe.dietaryTags) || []) badges.push(dietaryTagLabel(tag));
  return badges;
}

// Structured quantity scaling: only when `quantity` is a finite number.
// scaledQuantity = quantity * (selectedServings / baseServings). No unit math.
export function scaleQuantity(quantity, selectedServings, baseServings) {
  if (quantity == null || !Number.isFinite(quantity)) return null;
  if (!Number.isFinite(baseServings) || baseServings <= 0) return quantity;
  if (!Number.isFinite(selectedServings) || selectedServings <= 0) return quantity;
  return quantity * (selectedServings / baseServings);
}

export function formatQuantity(value) {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  // Trim floating-point noise from scaling; keep up to 3 decimals.
  return String(Math.round(value * 1000) / 1000);
}

// The primary display line for one structured ingredient usage entry:
//   unit "toTaste"  -> "Black Pepper — to taste"   (quantity is always null)
//   measurable      -> "1 kg Chicken"
//   null ingredient -> null  (caller skips the row — never fabricate a name)
export function ingredientPrimaryLine(entry, opts = {}) {
  if (!entry || !entry.ingredient || !entry.ingredient.name) return null;
  const name = entry.ingredient.name;

  if (entry.unit === 'toTaste') {
    return `${name} — to taste`;
  }

  const hasScale = opts.selectedServings != null && opts.baseServings != null;
  const quantity = hasScale
    ? scaleQuantity(entry.quantity, opts.selectedServings, opts.baseServings)
    : entry.quantity;
  const qty = formatQuantity(quantity);
  const unit = entry.unit ? unitLabel(entry.unit) : '';
  const head = [qty, unit].filter(Boolean).join(' ');
  return head ? `${head} ${name}` : name;
}

// Full display text including the optional note and an optional marker.
// Parentheses for the note (reads cleanly even after the "— to taste" suffix);
// a middle-dot suffix for optional entries.
export function ingredientDisplayText(entry, opts = {}) {
  const base = ingredientPrimaryLine(entry, opts);
  if (!base) return null;
  let text = base;
  if (entry.note) text += ` (${entry.note})`;
  if (entry.optional) text += ' · optional';
  return text;
}

// Plain ingredient names for the (still local) shopping list — no amounts, no
// string parser run against structured data.
export function ingredientNames(recipe) {
  return ((recipe && recipe.ingredients) || [])
    .map((entry) => entry && entry.ingredient && entry.ingredient.name)
    .filter(Boolean);
}

// View adapter: backend ordered instruction strings -> CookMode's step shape.
// A pure view transform — no persisted Instruction entity or id is invented,
// server order is preserved by array position.
export function instructionsToSteps(instructions) {
  return ((instructions) || []).map((text, index) => ({
    title: `Step ${index + 1}`,
    description: text,
  }));
}