// Canonical measurement-unit set shared by every embedded schema that
// pairs a `quantity` with a `unit` — currently Recipe.ingredients and
// ShoppingList.items. A single source of truth keeps the two from drifting
// into incompatible unit systems; unit conversion between them is
// explicitly out of scope (see docs/architecture/favorites-shopping-list.md
// and docs/architecture/recipes.md).
const UNITS = [
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

function isPositiveFiniteNumber(value) {
  return Number.isFinite(value) && value > 0;
}

// Cross-field rule shared by any embedded quantity/unit pair drawn from
// UNITS: quantity is required and must be a finite number > 0 for every
// measurable unit, and must be absent for "toTaste" (e.g. "salt to taste").
// Meant to be used as a subdocument schema's own pre('validate') hook
// (`schema.pre('validate', validateQuantityForUnit)`) so `this` is the
// subdocument itself and `this.invalidate` reports against it directly.
function validateQuantityForUnit() {
  const hasQuantity = this.quantity !== undefined && this.quantity !== null;
  if (this.unit === 'toTaste') {
    if (hasQuantity) {
      this.invalidate('quantity', 'quantity must be omitted when unit is "toTaste".', this.quantity);
    }
  } else if (!hasQuantity || !isPositiveFiniteNumber(this.quantity)) {
    this.invalidate(
      'quantity',
      'quantity is required and must be a finite number greater than zero unless unit is "toTaste".',
      this.quantity
    );
  }
}

module.exports = { UNITS, isPositiveFiniteNumber, validateQuantityForUnit };
