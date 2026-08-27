// Frontend-safe mirror of the backend ingredient enums.
//
// Source of truth: apps/api/src/modules/ingredients/ingredient.model.js
// (CATEGORIES, ALLERGEN_TAGS) and ingredient.validation.js (sort values).
// Keep these lists in sync with the backend — the API rejects any value it
// does not recognise with a 400 VALIDATION_ERROR. When packages/contracts
// starts carrying public API contracts, this belongs there.

export const INGREDIENT_CATEGORIES = [
  { value: 'produce', label: 'Produce' },
  { value: 'meat', label: 'Meat' },
  { value: 'seafood', label: 'Seafood' },
  { value: 'dairy', label: 'Dairy' },
  { value: 'egg', label: 'Egg' },
  { value: 'grain', label: 'Grain' },
  { value: 'legume', label: 'Legume' },
  { value: 'nutSeed', label: 'Nut / seed' },
  { value: 'herb', label: 'Herb' },
  { value: 'spice', label: 'Spice' },
  { value: 'oilFat', label: 'Oil / fat' },
  { value: 'sweetener', label: 'Sweetener' },
  { value: 'baking', label: 'Baking' },
  { value: 'condiment', label: 'Condiment' },
  { value: 'beverage', label: 'Beverage' },
  { value: 'other', label: 'Other' },
];

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