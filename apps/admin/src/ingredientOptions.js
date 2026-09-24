// Shared category values and labels come from @wecooked/contracts.
//
// Allergen and sort options remain frontend mirrors of their API enums and
// must stay in sync because the API rejects unrecognized values.

import {
  INGREDIENT_CATEGORIES as INGREDIENT_CATEGORY_VALUES,
  INGREDIENT_CATEGORY_LABELS,
} from '@wecooked/contracts';

if (!Array.isArray(INGREDIENT_CATEGORY_VALUES)) {
  throw new TypeError('@wecooked/contracts must provide INGREDIENT_CATEGORIES as an array.');
}

if (
  !INGREDIENT_CATEGORY_LABELS
  || typeof INGREDIENT_CATEGORY_LABELS !== 'object'
  || Array.isArray(INGREDIENT_CATEGORY_LABELS)
) {
  throw new TypeError('@wecooked/contracts must provide INGREDIENT_CATEGORY_LABELS as an object.');
}

for (const value of INGREDIENT_CATEGORY_VALUES) {
  if (typeof INGREDIENT_CATEGORY_LABELS[value] !== 'string' || !INGREDIENT_CATEGORY_LABELS[value].trim()) {
    throw new TypeError(`@wecooked/contracts must provide a label for ingredient category "${value}".`);
  }
}

// API validation and the Mongoose enum consume this same shared allowlist.
// The Staff Portal only derives the select-friendly presentation shape.
export const INGREDIENT_CATEGORIES = INGREDIENT_CATEGORY_VALUES.map((value) => ({
  value,
  label: INGREDIENT_CATEGORY_LABELS[value],
}));

export const INGREDIENT_ALLERGEN_TAGS = [
  { value: 'milk', label: 'Milk' },
  { value: 'egg', label: 'Egg' },
  { value: 'fish', label: 'Fish' },
  { value: 'shellfish', label: 'Shellfish' },
  { value: 'treeNut', label: 'Tree nut' },
  { value: 'peanut', label: 'Peanut' },
  { value: 'wheat', label: 'Wheat' },
  { value: 'soy', label: 'Soy' },
  { value: 'sesame', label: 'Sesame' },
];

export const INGREDIENT_SORTS = [
  { value: 'nameAsc', label: 'Name (A–Z)' },
  { value: 'nameDesc', label: 'Name (Z–A)' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
];

// status maps to the backend `status` list query param. "inactive" and "all"
// are admin-only server-side.
export const INGREDIENT_STATUS_FILTERS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Archived' },
  { value: 'all', label: 'All' },
];

export const CATEGORY_LABELS = Object.fromEntries(
  INGREDIENT_CATEGORIES.map((c) => [c.value, c.label]),
);

export const ALLERGEN_LABELS = Object.fromEntries(
  INGREDIENT_ALLERGEN_TAGS.map((a) => [a.value, a.label]),
);

export const DEFAULT_CATEGORY = INGREDIENT_CATEGORIES[0].value;
