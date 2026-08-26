const mongoose = require('mongoose');
const { UNITS, validateQuantityForUnit } = require('../../shared/constants/measurement-units');

// V1 cap on embedded items — enforced primarily in ShoppingListService
// (SHOPPING_LIST_LIMIT_EXCEEDED) before any save, since the running total
// depends on merge logic no single request body can bound on its own. This
// schema-level max is a redundant safety net, the same defense-in-depth
// pattern as Recipe.MAX_INGREDIENTS/Ingredient.MAX_ALIASES — not reliance
// on MongoDB's document-size limit.
const MAX_ITEMS = 200;

// One embedded item per (ingredientId, unit) the user is shopping for.
// Keeps its own _id (unlike Recipe.recipeIngredientSchema) because items
// are addressed individually by PATCH/DELETE /shopping-list/items/:itemId.
const shoppingListItemSchema = new mongoose.Schema({
  ingredientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ingredient',
    required: true,
  },
  quantity: {
    type: Number,
  },
  unit: {
    type: String,
    required: true,
    enum: UNITS,
  },
  isChecked: {
    type: Boolean,
    default: false,
  },
});

// Same quantity/unit cross-field rule as Recipe.recipeIngredientSchema —
// required and positive for a measurable unit, absent for "toTaste".
shoppingListItemSchema.pre('validate', validateQuantityForUnit);

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
  { timestamps: true }
);

const ShoppingList = mongoose.model('ShoppingList', shoppingListSchema);

module.exports = ShoppingList;
module.exports.MAX_ITEMS = MAX_ITEMS;