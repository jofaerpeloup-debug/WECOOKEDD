import {
  RECIPE_REGIONS,
  RECIPE_REGION_LABELS,
  RECIPE_CATEGORIES,
  RECIPE_CATEGORY_LABELS,
  RECIPE_DIETARY_TAGS,
  RECIPE_DIETARY_TAG_LABELS,
} from '@wecooked/contracts';

export { RECIPE_REGIONS, RECIPE_CATEGORIES, RECIPE_DIETARY_TAGS };

// Frontend-safe recipe enums + display labels.
//
// Source of truth (do not diverge — the API rejects unknown values with
// 400 VALIDATION_ERROR):
//   apps/api/src/modules/recipes/recipe.model.js       (DIFFICULTIES, DIETARY_TAGS)
//   apps/api/src/modules/recipes/recipe.validation.js  (sort enum, region/category slugs)
//   apps/api/src/shared/constants/measurement-units.js (UNITS — shared with ShoppingList)
//
// Only enum values + human labels live here — no backend logic is duplicated.
//
// `cuisine` remains retired. Canonical Recipe metadata comes from the shared
// workspace contract above.

export const RECIPE_DIFFICULTIES = ['easy', 'medium', 'hard'];

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
export const RECIPE_TOTAL_TIME_BUCKETS = ['under-15', '15-to-30', '31-to-60', 'over-60'];

export const DISCOVER_SORT_OPTIONS = [
  { value: 'titleAsc', label: 'Title: A-Z' },
  { value: 'titleDesc', label: 'Title: Z-A' },
  { value: 'newest', label: 'Newest added' },
  { value: 'oldest', label: 'Oldest added' },
  { value: 'prepTimeAsc', label: 'Prep time: low to high' },
  { value: 'prepTimeDesc', label: 'Prep time: high to low' },
];

const DIFFICULTY_LABELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

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

export function regionLabel(value) { return RECIPE_REGION_LABELS[value] || ''; }
export function categoryLabel(value) { return RECIPE_CATEGORY_LABELS[value] || ''; }

export function difficultyLabel(value) {
  return DIFFICULTY_LABELS[value] || value || '';
}

export function dietaryTagLabel(value) {
  return RECIPE_DIETARY_TAG_LABELS[value] || value || '';
}

export function discoverSortLabel(value) {
  return DISCOVER_SORT_OPTIONS.find((option) => option.value === value)?.label || '';
}

export function unitLabel(value) {
  return UNIT_LABELS[value] || value || '';
}

// The Discover filter set for this slice. Each entry maps to an EXACT backend
// list query — no invented "Quick" / "High-Protein" / meal-type semantics.
// No cuisine/region/category quick-filter entry: cuisine was retired in M3,
// while Region and category now use the canonical selectors in the expanded
// discovery-filter sheet rather than duplicating them as browse chips.
export const DISCOVER_FILTERS = [
  { key: 'all', label: 'All', query: {} },
  { key: 'easy', label: 'Easy', query: { difficulty: 'easy' } },
  { key: 'vegetarian', label: 'Vegetarian', query: { dietaryTags: ['vegetarian'] } },
  { key: 'vegan', label: 'Vegan', query: { dietaryTags: ['vegan'] } },
];
