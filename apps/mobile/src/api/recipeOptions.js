// Frontend-safe mirror of the backend Recipe enums + display labels.
//
// Source of truth (do not diverge — the API rejects unknown values with
// 400 VALIDATION_ERROR):
//   apps/api/src/modules/recipes/recipe.model.js       (CUISINES, DIFFICULTIES, DIETARY_TAGS)
//   apps/api/src/modules/recipes/recipe.validation.js  (sort enum)
//   apps/api/src/shared/constants/measurement-units.js (UNITS — shared with ShoppingList)
//
// Only enum values + human labels live here — no backend logic is duplicated.

export const RECIPE_CUISINES = [
  'filipino',
  'chinese',
  'japanese',
  'korean',
  'thai',
  'vietnamese',
  'indian',
  'italian',
  'mexican',
  'american',
  'mediterranean',
  'middleEastern',
  'other',
];

export const RECIPE_DIFFICULTIES = ['easy', 'medium', 'hard'];

export const RECIPE_DIETARY_TAGS = [
  'vegetarian',
  'vegan',
  'pescatarian',
  'glutenFree',
  'dairyFree',
  'nutFree',
];

export const RECIPE_UNITS = [
  'g',
  'kg',
  'ml',
  'l',
  'tsp',
  'tbsp',
  'cup',
  'piece',
  'clove',
  'slice',
  'can',
  'pack',
  'bunch',
  'pinch',
  'toTaste',
];

export const RECIPE_SORTS = ['titleAsc', 'titleDesc', 'newest', 'oldest', 'prepTimeAsc', 'prepTimeDesc'];

const CUISINE_LABELS = {
  filipino: 'Filipino',
  chinese: 'Chinese',
  japanese: 'Japanese',
  korean: 'Korean',
  thai: 'Thai',
  vietnamese: 'Vietnamese',
  indian: 'Indian',
  italian: 'Italian',
  mexican: 'Mexican',
  american: 'American',
  mediterranean: 'Mediterranean',
  middleEastern: 'Middle Eastern',
  other: 'Other',
};

const DIFFICULTY_LABELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

const DIETARY_TAG_LABELS = {
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  pescatarian: 'Pescatarian',
  glutenFree: 'Gluten-free',
  dairyFree: 'Dairy-free',
  nutFree: 'Nut-free',
};

// Terse measurement units render as-is except where a nicer casing helps.
const UNIT_LABELS = {
  g: 'g',
  kg: 'kg',
  ml: 'ml',
  l: 'L',
  tsp: 'tsp',
  tbsp: 'tbsp',
  cup: 'cup',
  piece: 'piece',
  clove: 'clove',
  slice: 'slice',
  can: 'can',
  pack: 'pack',
  bunch: 'bunch',
  pinch: 'pinch',
  toTaste: 'to taste',
};

export function cuisineLabel(value) {
  return CUISINE_LABELS[value] || value || '';
}

export function difficultyLabel(value) {
  return DIFFICULTY_LABELS[value] || value || '';
}

export function dietaryTagLabel(value) {
  return DIETARY_TAG_LABELS[value] || value || '';
}

export function unitLabel(value) {
  return UNIT_LABELS[value] || value || '';
}

// The Discover filter set for this slice. Each entry maps to an EXACT backend
// list query — no invented "Quick" / "High-Protein" / meal-type semantics.
export const DISCOVER_FILTERS = [
  { key: 'all', label: 'All', query: {} },
  { key: 'filipino', label: 'Filipino', query: { cuisine: 'filipino' } },
  { key: 'easy', label: 'Easy', query: { difficulty: 'easy' } },
  { key: 'vegetarian', label: 'Vegetarian', query: { dietaryTag: 'vegetarian' } },
  { key: 'vegan', label: 'Vegan', query: { dietaryTag: 'vegan' } },
];