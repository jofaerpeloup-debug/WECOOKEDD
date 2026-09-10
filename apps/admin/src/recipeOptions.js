// Frontend-safe mirror of the backend recipe enums and limits.
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
// `cuisine` was retired from the Recipe domain in M3. `region` (Philippine
// region) and `category` are open canonical slug strings — no controlled
// vocabulary exists yet, so there is no enum here, just the slug rules and a
// `slugLabel` humanizer.

// Mirrors shared/validation/slug.js. A canonical slug: lowercase alphanumeric
// words joined by single hyphens, 1–64 chars. Case and internal whitespace
// are normalized by the backend; anything else is rejected.
export const SLUG_MAX_LENGTH = 64;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// "central-luzon" -> "Central Luzon". Returns '' for an empty/absent value —
// never fabricates a label.
export function slugLabel(value) {
  if (!value || typeof value !== 'string') return '';
  return value
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Client-side pre-check only — the backend Zod schema stays authoritative.
export function normalizeSlugInput(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
}

// PATCH diff for an optional slug field (`region` / `category`). Returns the
// value to put in the patch body, or `undefined` when the caller should omit
// the key entirely:
//   unchanged (incl. still-blank)  -> undefined   (omit)
//   populated field cleared to ""  -> null        (explicit unset; API $unsets)
//   changed to a new slug          -> the normalized slug
// This is the exact contract the backend PATCH accepts (recipe.validation.js
// updateRecipeSchema + recipe.service.js) — see the API PATCH tests.
export function slugPatchValue(current, formValue) {
  const next = normalizeSlugInput(formValue);
  const prev = current ?? '';
  if (next === prev) return undefined;
  return next === '' ? null : next;
}

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

export const DIFFICULTY_LABELS = Object.fromEntries(
  RECIPE_DIFFICULTIES.map((d) => [d.value, d.label]),
);
export const DIETARY_TAG_LABELS = Object.fromEntries(
  RECIPE_DIETARY_TAGS.map((t) => [t.value, t.label]),
);
export const UNIT_LABELS = Object.fromEntries(RECIPE_UNITS.map((u) => [u.value, u.label]));

export const DEFAULT_DIFFICULTY = 'easy';
export const DEFAULT_UNIT = 'g';