const mongoose = require('mongoose');
const { UNITS, validateQuantityForUnit } = require('../../shared/constants/measurement-units');
const { SLUG_MAX_LENGTH, SLUG_PATTERN } = require('../../shared/validation/slug');
const { isPublicHttpsUrl } = require('../../shared/validation/public-https-url');

const DIFFICULTIES = ['easy', 'medium', 'hard'];
const PUBLICATION_STATUSES = ['draft', 'published'];

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
const MAX_IMAGE_ASSET_ID_LENGTH = 255;

function collapseWhitespace(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : value;
}

function hasUnicodeLetter(value) {
  return typeof value === 'string' && /\p{L}/u.test(value);
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
// the value itself is undefined. Shared with ShoppingList.items, which
// pairs the same quantity/unit semantics — see
// shared/constants/measurement-units.js.
recipeIngredientSchema.pre('validate', validateQuantityForUnit);

function isStructurallyValidStepArray(arr) {
  return (
    Array.isArray(arr) &&
    arr.length <= MAX_INSTRUCTIONS &&
    arr.every((step) => typeof step === 'string' && step.length >= 3 && hasUnicodeLetter(step))
  );
}

const recipeSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      set: collapseWhitespace,
      minlength: 2,
      maxlength: MAX_TITLE_LENGTH,
      validate: {
        validator: (value) => typeof value === 'string' && (value.match(/\p{L}/gu) || []).length >= 2,
        message: 'Title must contain at least 2 letters.',
      },
    },
    description: {
      type: String,
      trim: true,
      maxlength: MAX_DESCRIPTION_LENGTH,
    },
    // Philippine `region` and recipe `category` — conservative optional
    // canonical slugs, not enums (no approved taxonomy yet). Legacy recipes
    // predating this field remain valid with neither set. See
    // docs/architecture/recipes.md and shared/validation/slug.js.
    region: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: SLUG_MAX_LENGTH,
      match: SLUG_PATTERN,
    },
    category: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: SLUG_MAX_LENGTH,
      match: SLUG_PATTERN,
    },
    difficulty: {
      type: String,
      enum: DIFFICULTIES,
    },
    prepTimeMinutes: {
      type: Number,
      min: 1,
      max: MAX_PREP_TIME_MINUTES,
      validate: {
        validator: Number.isInteger,
        message: 'prepTimeMinutes must be an integer.',
      },
    },
    cookTimeMinutes: {
      type: Number,
      required() { return this.publicationStatus === 'published'; },
      min: 3,
      max: MAX_COOK_TIME_MINUTES,
      validate: {
        validator: Number.isInteger,
        message: 'cookTimeMinutes must be an integer.',
      },
    },
    servings: {
      type: Number,
      min: 1,
      max: MAX_SERVINGS,
      validate: {
        validator: Number.isInteger,
        message: 'servings must be an integer.',
      },
    },
    ingredients: {
      type: [recipeIngredientSchema],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length <= MAX_INGREDIENTS,
        message: `ingredients must contain no more than ${MAX_INGREDIENTS} entries.`,
      },
    },
    instructions: {
      type: [{ type: String, trim: true, maxlength: MAX_INSTRUCTION_LENGTH }],
      validate: {
        validator: isStructurallyValidStepArray,
        message: `instructions must contain no more than ${MAX_INSTRUCTIONS} non-empty steps, in order.`,
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
      validate: {
        validator: (value) => value == null || isPublicHttpsUrl(value),
        message: 'imageUrl must be a public HTTPS URL without credentials.',
      },
    },
    // Internal Cloudinary management metadata. It is intentionally absent
    // from recipe.serializer.js and requires no migration for legacy records.
    imageAssetId: {
      type: String,
      trim: true,
      maxlength: MAX_IMAGE_ASSET_ID_LENGTH,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Intentionally has no default. During the M20 transition, a missing
    // value identifies a legacy complete recipe and is treated as published
    // by explicit service/query compatibility logic. New authoring writes
    // always set this field.
    publicationStatus: {
      type: String,
      enum: PUBLICATION_STATUSES,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    publishedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

recipeSchema.pre('validate', function validateManagedImageConsistency() {
  if (this.imageAssetId != null && !this.imageUrl) {
    this.invalidate('imageAssetId', 'imageAssetId requires imageUrl.');
  }
});

// Primary list-filtering shapes; ingredients.ingredientId backs the
// "recipes using this ingredient" lookup (also useful for later
// recommendation logic); title backs titleAsc/titleDesc sort and search.
recipeSchema.index({ isActive: 1, region: 1 });
recipeSchema.index({ isActive: 1, category: 1 });
recipeSchema.index({ isActive: 1, difficulty: 1 });
recipeSchema.index({ isActive: 1, publicationStatus: 1, createdAt: -1 });
recipeSchema.index({ publicationStatus: 1, isActive: 1, updatedAt: -1 });
recipeSchema.index({ 'ingredients.ingredientId': 1 });
recipeSchema.index({ title: 1 });

const Recipe = mongoose.model('Recipe', recipeSchema);

module.exports = Recipe;
module.exports.DIFFICULTIES = DIFFICULTIES;
module.exports.PUBLICATION_STATUSES = PUBLICATION_STATUSES;
module.exports.UNITS = UNITS;
module.exports.DIETARY_TAGS = DIETARY_TAGS;
module.exports.SLUG_MAX_LENGTH = SLUG_MAX_LENGTH;
module.exports.SLUG_PATTERN = SLUG_PATTERN;
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
module.exports.MAX_IMAGE_ASSET_ID_LENGTH = MAX_IMAGE_ASSET_ID_LENGTH;
