// Frontend-safe mirror of the backend recipe enums and limits.
//
// Source of truth:
//   apps/api/src/modules/recipes/recipe.model.js
//     (CUISINES, DIFFICULTIES, DIETARY_TAGS, MAX_* limits)
//   apps/api/src/modules/recipes/recipe.validation.js
//     (status / sort enums)
//   apps/api/src/shared/constants/measurement-units.js
//     (UNITS — the single quantity/unit contract, shared with ShoppingList)
//
// Keep these in sync with the backend — the API rejects any value it does not
// recognise with a 400 VALIDATION_ERROR. When packages/contracts starts
// carrying public API contracts, this belongs there (same note as
// ingredientOptions.js / substitutionOptions.js).

// cuisine is a plain controlled field — NOT Filipino-only. Filipino is just the
// natural default for WeCooked's initial content focus; the schema stays
// cuisine-agnostic (see docs/architecture/recipes.md).
export const RECIPE_CUISINES = [
  { value: 'filipino', label: 'Filipino' },
  { value: 'chinese', label: 'Chinese' },
  { value: 'japanese', label: 'Japanese' },
  { value: 'korean', label: 'Korean' },
  { value: 'thai', label: 'Thai' },
  { value: 'vietnamese', label: 'Vietnamese' },
  { value: 'indian', label: 'Indian' },
  { value: 'italian', label: 'Italian' },
  { value: 'mexican', label: 'Mexican' },
  { value: 'american', label: 'American' },
  { value: 'mediterranean', label: 'Mediterranean' },
  { value: 'middleEastern', label: 'Middle Eastern' },
  { value: 'other', label: 'Other' },
];

export const RECIPE_DIFFICULTIES = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

export const RECIPE_DIETARY_TAGS = [
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'pescatarian', label: 'Pescatarian' },
  { value: 'glutenFree', label: 'Gluten-free' },
  { value: 'dairyFree', label: 'Dairy-free' },
  { value: 'nutFree', label: 'Nut-free' },
];

// The controlled measurement-unit set. `toTaste` is special: it means the
// quantity is deliberately unspecified ("salt to taste"), and the backend
// rejects a `toTaste` entry that carries a quantity. Every other unit REQUIRES
// a finite quantity greater than zero. No unit conversion is done anywhere.
export const TO_TASTE_UNIT = 'toTaste';

export const RECIPE_UNITS = [
  { value: 'g', label: 'g' },
  { value: 'kg', label: 'kg' },
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

export const CUISINE_LABELS = Object.fromEntries(RECIPE_CUISINES.map((c) => [c.value, c.label]));
export const DIFFICULTY_LABELS = Object.fromEntries(
  RECIPE_DIFFICULTIES.map((d) => [d.value, d.label]),
);
export const DIETARY_TAG_LABELS = Object.fromEntries(
  RECIPE_DIETARY_TAGS.map((t) => [t.value, t.label]),
);
export const UNIT_LABELS = Object.fromEntries(RECIPE_UNITS.map((u) => [u.value, u.label]));

export const DEFAULT_CUISINE = 'filipino';
export const DEFAULT_DIFFICULTY = 'easy';
export const DEFAULT_UNIT = 'g';

// Donut-chart colours for the Overview cuisine breakdown, drawn from the
// existing admin palette so nothing new is introduced visually.
export const CUISINE_COLORS = [
  '#4A5D4E', '#C9962E', '#B15A3E', '#6B8069', '#8C8577',
  '#7C9478', '#D9A64B', '#9DBB9C', '#A39C8C', '#C97558',
  '#5B6E5F', '#B8842A', '#8a6a16',
];