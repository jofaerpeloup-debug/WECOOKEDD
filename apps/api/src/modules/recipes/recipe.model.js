const mongoose = require('mongoose');

const CUISINES = [
  'filipino',
  'chinese',
  'japanese',
  'korean',
  'thai',
  'vietnamese',
  'indian',
  'italian',
  'mexican',
  'american',
  'mediterranean',
  'middleEastern',
  'other',
];

const DIFFICULTIES = ['easy', 'medium', 'hard'];

const UNITS = [
  'g',
  'kg',
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

const DIETARY_TAGS = ['vegetarian', 'vegan', 'pescatarian', 'glutenFree', 'dairyFree', 'nutFree'];

const MAX_TITLE_LENGTH = 150;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_PREP_TIME_MINUTES = 1440;
const MAX_COOK_TIME_MINUTES = 1440;
const MAX_SERVINGS = 100;
const MAX_INGREDIENTS = 50;
const MAX_INSTRUCTIONS = 50;
const MAX_INSTRUCTION_LENGTH = 1000;
const MAX_INGREDIENT_NOTE_LENGTH = 200;
const MAX_IMAGE_URL_LENGTH = 2000;

function isPositiveFiniteNumber(value) {
  return Number.isFinite(value) && value > 0;
}

// One entry per (ingredientId, use) pair — the same canonical Ingredient may
// legitimately appear twice in the same recipe (e.g. garlic for a marinade
// and again for garnish), so entries are never deduplicated.
const recipeIngredientSchema = new mongoose.Schema(
  {
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
    note: {
      type: String,
      trim: true,
      maxlength: MAX_INGREDIENT_NOTE_LENGTH,
    },
    optional: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

// Cross-field rule that a plain per-path validator can't express: quantity
// is required and must be a finite number > 0 for every measurable unit,
// and must be absent for unit "toTaste" (e.g. "salt to taste"). A
// pre('validate') hook on the subdocument schema runs for every array
// element, unlike a per-path custom validator which Mongoose may skip when
// the value itself is undefined. Mongoose 9 middleware is promise-based —
// no `next` callback — so the hook just returns.
recipeIngredientSchema.pre('validate', function () {
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
});

function isNonEmptyStepArray(arr) {
  return (
    Array.isArray(arr) &&
    arr.length >= 1 &&
    arr.length <= MAX_INSTRUCTIONS &&
    arr.every((step) => typeof step === 'string' && step.length > 0)
  );
}

const recipeSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_TITLE_LENGTH,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_DESCRIPTION_LENGTH,
    },
    cuisine: {
      type: String,
      required: true,
      enum: CUISINES,
    },
    difficulty: {
      type: String,
      required: true,
      enum: DIFFICULTIES,
    },
    prepTimeMinutes: {
      type: Number,
      required: true,
      min: 0,
      max: MAX_PREP_TIME_MINUTES,
      validate: {
        validator: Number.isInteger,
        message: 'prepTimeMinutes must be an integer.',
      },
    },
    cookTimeMinutes: {
      type: Number,
      required: true,
      min: 0,
      max: MAX_COOK_TIME_MINUTES,
      validate: {
        validator: Number.isInteger,
        message: 'cookTimeMinutes must be an integer.',
      },
    },
    servings: {
      type: Number,
      required: true,
      min: 1,
      max: MAX_SERVINGS,
      validate: {
        validator: Number.isInteger,
        message: 'servings must be an integer.',
      },
    },
    ingredients: {
      type: [recipeIngredientSchema],
      required: true,
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length >= 1 && arr.length <= MAX_INGREDIENTS,
        message: `ingredients must contain between 1 and ${MAX_INGREDIENTS} entries.`,
      },
    },
    instructions: {
      type: [{ type: String, trim: true, maxlength: MAX_INSTRUCTION_LENGTH }],
      required: true,
      validate: {
        validator: isNonEmptyStepArray,
        message: `instructions must contain between 1 and ${MAX_INSTRUCTIONS} non-empty steps, in order.`,
      },
    },
    dietaryTags: {
      type: [{ type: String, enum: DIETARY_TAGS }],
      default: [],
    },
    imageUrl: {
      type: String,
      trim: true,
      maxlength: MAX_IMAGE_URL_LENGTH,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Primary list-filtering shapes; ingredients.ingredientId backs the
// "recipes using this ingredient" lookup (also useful for later
// recommendation logic); title backs titleAsc/titleDesc sort and search.
recipeSchema.index({ isActive: 1, cuisine: 1 });
recipeSchema.index({ isActive: 1, difficulty: 1 });
recipeSchema.index({ 'ingredients.ingredientId': 1 });
recipeSchema.index({ title: 1 });

const Recipe = mongoose.model('Recipe', recipeSchema);

module.exports = Recipe;
module.exports.CUISINES = CUISINES;
module.exports.DIFFICULTIES = DIFFICULTIES;
module.exports.UNITS = UNITS;
module.exports.DIETARY_TAGS = DIETARY_TAGS;
module.exports.MAX_TITLE_LENGTH = MAX_TITLE_LENGTH;
module.exports.MAX_DESCRIPTION_LENGTH = MAX_DESCRIPTION_LENGTH;
module.exports.MAX_PREP_TIME_MINUTES = MAX_PREP_TIME_MINUTES;
module.exports.MAX_COOK_TIME_MINUTES = MAX_COOK_TIME_MINUTES;
module.exports.MAX_SERVINGS = MAX_SERVINGS;
module.exports.MAX_INGREDIENTS = MAX_INGREDIENTS;
module.exports.MAX_INSTRUCTIONS = MAX_INSTRUCTIONS;
module.exports.MAX_INSTRUCTION_LENGTH = MAX_INSTRUCTION_LENGTH;
module.exports.MAX_INGREDIENT_NOTE_LENGTH = MAX_INGREDIENT_NOTE_LENGTH;
module.exports.MAX_IMAGE_URL_LENGTH = MAX_IMAGE_URL_LENGTH;