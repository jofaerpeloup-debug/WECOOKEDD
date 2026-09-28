// Frontend-safe mirror of the backend Recipe enums + display labels.
//
// Source of truth (do not diverge — the API rejects unknown values with
// 400 VALIDATION_ERROR):
//   apps/api/src/modules/recipes/recipe.model.js       (DIFFICULTIES, DIETARY_TAGS)
//   apps/api/src/modules/recipes/recipe.validation.js  (sort enum, region/category slugs)
//   apps/api/src/shared/constants/measurement-units.js (UNITS — shared with ShoppingList)
//
// Only enum values + human labels live here — no backend logic is duplicated.
//
// `cuisine` was retired from the Recipe domain in M3. `region` (Philippine
// region) and `category` are open canonical slug strings — there is no
// controlled vocabulary yet, so there is no enum here, only a humanizer
// (`slugLabel`) for whatever slug the backend returns.

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
  'lb',
  'oz',
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
  lb: 'lb',
  oz: 'oz',
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

// Humanizes an open canonical slug for display: "central-luzon" -> "Central
// Luzon". Used for `region` and `category`, which have no controlled
// vocabulary yet. Returns '' for an empty/absent value — never fabricates.
export function slugLabel(value) {
  if (!value || typeof value !== 'string') return '';
  return value
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export const regionLabel = slugLabel;
export const categoryLabel = slugLabel;

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
// No cuisine/region/category entry: cuisine was retired in M3 and region/
// category have no vocabulary yet, so a browse chip for them would be
// guesswork. Real category + Philippine-region browsing arrives with a
// content milestone.
export const DISCOVER_FILTERS = [
  { key: 'all', label: 'All', query: {} },
  { key: 'easy', label: 'Easy', query: { difficulty: 'easy' } },
  { key: 'vegetarian', label: 'Vegetarian', query: { dietaryTag: 'vegetarian' } },
  { key: 'vegan', label: 'Vegan', query: { dietaryTag: 'vegan' } },
];
