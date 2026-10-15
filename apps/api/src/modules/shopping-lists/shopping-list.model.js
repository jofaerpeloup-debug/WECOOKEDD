const mongoose = require('mongoose');
const { UNITS, validateQuantityForUnit } = require('../../shared/constants/measurement-units');
const { normalizeCustomLabel } = require('./shopping-list.custom-label');

// Shared cap on embedded Ingredient and Custom rows — enforced primarily in ShoppingListService
// (SHOPPING_LIST_LIMIT_EXCEEDED) before any save, since the running total
// depends on merge logic no single request body can bound on its own. This
// schema-level max is a redundant safety net, the same defense-in-depth
// pattern as Recipe.MAX_INGREDIENTS/Ingredient.MAX_ALIASES — not reliance
// on MongoDB's document-size limit.
const MAX_ITEMS = 200;
const INGREDIENT_ROW_FIELDS = new Set([
  '_id', 'type', 'ingredientId', 'quantity', 'unit', 'isChecked',
  'originKind', 'sourceRecipeIds', 'quantityEdited',
]);
const CUSTOM_ROW_FIELDS = new Set(['_id', 'type', 'label', 'isChecked']);
const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

function validObjectId(value) {
  return value instanceof mongoose.Types.ObjectId
    || (typeof value === 'string' && OBJECT_ID_RE.test(value));
}

function isValidShoppingRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)
    || !validObjectId(row._id) || !Object.hasOwn(row, 'isChecked')
    || typeof row.isChecked !== 'boolean') return false;

  if (row.type === 'custom') {
    return Object.keys(row).every((field) => CUSTOM_ROW_FIELDS.has(field))
      && typeof row.label === 'string'
      && normalizeCustomLabel(row.label) === row.label;
  }
  if (row.type !== undefined && row.type !== 'ingredient') return false;
  if (!Object.keys(row).every((field) => INGREDIENT_ROW_FIELDS.has(field))
    || !validObjectId(row.ingredientId) || !UNITS.includes(row.unit)) return false;
  if (row.unit === 'toTaste') {
    if (row.quantity != null) return false;
  } else if (typeof row.quantity !== 'number'
    || !Number.isFinite(row.quantity) || row.quantity <= 0) return false;

  const hasOrigin = Object.hasOwn(row, 'originKind');
  const hasSources = Object.hasOwn(row, 'sourceRecipeIds');
  const hasEdited = Object.hasOwn(row, 'quantityEdited');
  if (hasOrigin && !['manual', 'recipe'].includes(row.originKind)) return false;
  if (hasSources && !Array.isArray(row.sourceRecipeIds)) return false;
  const sources = hasSources ? row.sourceRecipeIds : [];
  if ((hasSources && sources.length === 0) || sources.length > 8
    || sources.some((id) => !validObjectId(id))
    || new Set(sources.map(String)).size !== sources.length) return false;
  return sources.length > 0
    ? row.originKind === 'recipe' && hasEdited && typeof row.quantityEdited === 'boolean'
    : row.originKind !== 'recipe' && !hasEdited;
}

// Ingredient rows merge per (ingredientId, unit); Custom rows remain distinct.
// Keeps its own _id (unlike Recipe.recipeIngredientSchema) because items
// are addressed individually by PATCH/DELETE /shopping-list/items/:itemId.
const shoppingListItemSchema = new mongoose.Schema({
  type: { type: String, enum: ['ingredient', 'custom'] },
  ingredientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ingredient',
    required() { return this.type !== 'custom'; },
  },
  quantity: {
    type: Number,
  },
  unit: {
    type: String,
    required() { return this.type !== 'custom'; },
    enum: UNITS,
  },
  isChecked: {
    type: Boolean,
    default: false,
  },
  label: { type: String },
  originKind: { type: String, enum: ['manual', 'recipe'] },
  sourceRecipeIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Recipe' }], default: undefined },
  quantityEdited: { type: Boolean },
});

// Hydration applies defaults and may discard failed casts. Keep the result of
// checking the raw persisted row before either can hide a malformed field.
shoppingListItemSchema.pre('init', function captureStoredShape(raw) {
  this.$locals.shoppingStoredShapeValid = isValidShoppingRow(raw);
});

// Same quantity/unit cross-field rule as Recipe.recipeIngredientSchema —
// required and positive for a measurable unit, absent for "toTaste".
shoppingListItemSchema.pre('validate', function validateShoppingRow() {
  if (!isValidShoppingRow(this.toObject({ depopulate: true }))) {
    this.invalidate('type', 'Invalid shopping row shape.');
  }
  if (this.type !== undefined && this.type !== 'ingredient' && this.type !== 'custom') {
    this.invalidate('type', 'Invalid shopping row type.');
    return;
  }
  if (this.type === 'custom') {
    if (normalizeCustomLabel(this.label) !== this.label || this.ingredientId !== undefined
      || this.quantity !== undefined || this.unit !== undefined || this.originKind !== undefined
      || this.sourceRecipeIds !== undefined || this.quantityEdited !== undefined) {
      this.invalidate('type', 'Custom row contains invalid fields.');
    }
    return;
  }
  if (this.label != null) this.invalidate('label', 'Ingredient row cannot have a label.');
  validateQuantityForUnit.call(this);
  const sources = this.sourceRecipeIds || [];
  if (sources.length > 8 || new Set(sources.map(String)).size !== sources.length) {
    this.invalidate('sourceRecipeIds', 'Invalid Recipe sources.');
  }
  if ((sources.length && typeof this.quantityEdited !== 'boolean')
    || (!sources.length && this.quantityEdited != null)
    || (sources.length && this.originKind !== 'recipe')
    || (this.originKind === 'recipe' && !sources.length)) {
    this.invalidate('quantityEdited', 'Recipe source history requires a boolean flag.');
  }
});

// One ShoppingList per User — every list mutation therefore touches a
// single document, which MongoDB updates atomically with no multi-document
// transaction needed. See docs/architecture/favorites-shopping-list.md.
const shoppingListSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    items: {
      type: [shoppingListItemSchema],
      default: [],
      validate: {
        validator: (arr) => arr.length <= MAX_ITEMS,
        message: `items cannot contain more than ${MAX_ITEMS} entries.`,
      },
    },
  },
  { timestamps: true, optimisticConcurrency: true }
);

// Mongoose can default a missing persisted items field to [] or cast another
// raw shape into an array. Keep the pre-cast result off the persisted schema.
shoppingListSchema.pre('init', function captureStoredItemsShape(raw) {
  this.$locals.shoppingStoredItemsArray = Object.hasOwn(raw, 'items') && Array.isArray(raw.items);
});

const ShoppingList = mongoose.model('ShoppingList', shoppingListSchema);

module.exports = ShoppingList;
module.exports.MAX_ITEMS = MAX_ITEMS;
module.exports.isValidShoppingRow = isValidShoppingRow;
