import contracts from '@wecooked/contracts';

// @wecooked/contracts is CommonJS. Vite's browser dependency optimizer exposes
// its module.exports object as the default export; requesting newly-added
// properties as ESM named exports can leave them undefined in the dev runtime.
const {
  RECIPE_REGIONS: CONTRACT_RECIPE_REGIONS,
  RECIPE_REGION_LABELS,
  RECIPE_CATEGORIES: CONTRACT_RECIPE_CATEGORIES,
  RECIPE_CATEGORY_LABELS,
  RECIPE_DIETARY_TAGS: CONTRACT_RECIPE_DIETARY_TAGS,
  RECIPE_DIETARY_TAG_LABELS,
} = contracts;

// Frontend-safe recipe options and limits.
//
// Source of truth:
//   apps/api/src/modules/recipes/recipe.model.js
//     (DIFFICULTIES, DIETARY_TAGS, SLUG_MAX_LENGTH, MAX_* limits)
//   apps/api/src/modules/recipes/recipe.validation.js
//     (status / sort enums, region/category slug rules)
//   apps/api/src/shared/constants/measurement-units.js
//     (UNITS — the single quantity/unit contract, shared with ShoppingList)
//
// Keep these in sync with the backend — the API rejects any value it does not
// recognise with a 400 VALIDATION_ERROR. When packages/contracts starts
// carrying public API contracts, this belongs there (same note as
// ingredientOptions.js / substitutionOptions.js).
//
// `cuisine` remains retired. Region, category, and dietary metadata below are
// projected directly from the dependency-free shared contract.

export const RECIPE_DIFFICULTIES = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

export const RECIPE_DIETARY_TAGS = [
  ...CONTRACT_RECIPE_DIETARY_TAGS.map((value) => ({ value, label: RECIPE_DIETARY_TAG_LABELS[value] })),
];

export const RECIPE_REGIONS = CONTRACT_RECIPE_REGIONS.map((value) => ({
  value, label: RECIPE_REGION_LABELS[value],
}));
export const RECIPE_CATEGORIES = CONTRACT_RECIPE_CATEGORIES.map((value) => ({
  value, label: RECIPE_CATEGORY_LABELS[value],
}));
export function regionLabel(value) { return RECIPE_REGION_LABELS[value] || ''; }
export function categoryLabel(value) { return RECIPE_CATEGORY_LABELS[value] || ''; }

// The controlled measurement-unit set. `toTaste` is special: it means the
// quantity is deliberately unspecified ("salt to taste"), and the backend
// rejects a `toTaste` entry that carries a quantity. Every other unit REQUIRES
// a finite quantity greater than zero. No unit conversion is done anywhere.
export const TO_TASTE_UNIT = 'toTaste';

export const RECIPE_UNITS = [
  { value: 'g', label: 'g' },
  { value: 'kg', label: 'kg' },
  { value: 'lb', label: 'lb' },
  { value: 'oz', label: 'oz' },
  { value: 'ml', label: 'ml' },
  { value: 'l', label: 'L' },
  { value: 'tsp', label: 'tsp' },
  { value: 'tbsp', label: 'tbsp' },
  { value: 'cup', label: 'cup' },
  { value: 'piece', label: 'piece' },
  { value: 'clove', label: 'clove' },
  { value: 'slice', label: 'slice' },
  { value: 'can', label: 'can' },
  { value: 'pack', label: 'pack' },
  { value: 'bunch', label: 'bunch' },
  { value: 'pinch', label: 'pinch' },
  { value: TO_TASTE_UNIT, label: 'to taste' },
];

// sort maps to the backend `sort` list query param — a fixed named set, never
// raw Mongo sort syntax. (The ingredient nameAsc/nameDesc values are NOT valid
// here.)
export const RECIPE_SORTS = [
  { value: 'titleAsc', label: 'Title (A–Z)' },
  { value: 'titleDesc', label: 'Title (Z–A)' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'prepTimeAsc', label: 'Prep time (low–high)' },
  { value: 'prepTimeDesc', label: 'Prep time (high–low)' },
];

// status maps to the backend `status` list query param. "inactive" and "all"
// are admin-only server-side — fine here because the whole dashboard is
// admin-gated.
export const RECIPE_STATUS_FILTERS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Archived' },
  { value: 'all', label: 'All' },
];

// Mirrors recipe.model.js. Used only for client-side UX validation — the
// backend Zod schema remains authoritative.
export const MAX_TITLE_LENGTH = 150;
export const MAX_DESCRIPTION_LENGTH = 2000;
export const MAX_PREP_TIME_MINUTES = 1440;
export const MAX_COOK_TIME_MINUTES = 1440;
export const MAX_SERVINGS = 100;
export const MAX_INGREDIENTS = 50;
export const MAX_INSTRUCTIONS = 50;
export const MAX_INSTRUCTION_LENGTH = 1000;
export const MAX_INGREDIENT_NOTE_LENGTH = 200;
export const MAX_IMAGE_URL_LENGTH = 2000;

export const DIFFICULTY_LABELS = Object.fromEntries(
  RECIPE_DIFFICULTIES.map((d) => [d.value, d.label]),
);
export const DIETARY_TAG_LABELS = Object.fromEntries(
  RECIPE_DIETARY_TAGS.map((t) => [t.value, t.label]),
);
export const UNIT_LABELS = Object.fromEntries(RECIPE_UNITS.map((u) => [u.value, u.label]));

export const DEFAULT_DIFFICULTY = 'easy';
export const DEFAULT_UNIT = 'g';
