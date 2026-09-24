const mongoose = require('mongoose');
// Enum validation governs new values. MongoDB can still hydrate legacy
// `other` records so read paths remain compatible while writes retire it.
const { INGREDIENT_CATEGORIES: CATEGORIES } = require('@wecooked/contracts');

const ALLERGEN_TAGS = [
  'milk',
  'egg',
  'fish',
  'shellfish',
  'treeNut',
  'peanut',
  'wheat',
  'soy',
  'sesame',
];

const MAX_NAME_LENGTH = 100;
const MAX_ALIAS_LENGTH = 100;
const MAX_ALIASES = 20;

const ingredientSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_NAME_LENGTH,
    },
    // Lowercase, whitespace-collapsed form of name, used only to enforce
    // case/whitespace-insensitive uniqueness. select: false keeps it out of
    // normal query results as a second line of defense — the serializer
    // already never reads it either way (see ingredient.serializer.js).
    normalizedName: {
      type: String,
      required: true,
      unique: true,
      select: false,
    },
    aliases: {
      type: [{ type: String, trim: true, maxlength: MAX_ALIAS_LENGTH }],
      default: [],
      validate: {
        validator: (arr) => arr.length <= MAX_ALIASES,
        message: `aliases cannot contain more than ${MAX_ALIASES} entries.`,
      },
    },
    category: {
      type: String,
      required: true,
      enum: CATEGORIES,
    },
    allergenTags: {
      type: [{ type: String, enum: ALLERGEN_TAGS }],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Filtering/browsing by status+category is the primary list query shape;
// name backs the nameAsc/nameDesc sorts and the regex search prefix case.
ingredientSchema.index({ isActive: 1, category: 1 });
ingredientSchema.index({ name: 1 });

const Ingredient = mongoose.model('Ingredient', ingredientSchema);

module.exports = Ingredient;
module.exports.CATEGORIES = CATEGORIES;
module.exports.ALLERGEN_TAGS = ALLERGEN_TAGS;
module.exports.MAX_NAME_LENGTH = MAX_NAME_LENGTH;
module.exports.MAX_ALIAS_LENGTH = MAX_ALIAS_LENGTH;
module.exports.MAX_ALIASES = MAX_ALIASES;
