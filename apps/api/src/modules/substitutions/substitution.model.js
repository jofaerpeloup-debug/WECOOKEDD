const mongoose = require('mongoose');

const MAX_CONTEXTS = 10;
const MAX_CONTEXT_LENGTH = 40;
const MAX_NOTES_LENGTH = 500;

function isPositiveFiniteNumber(value) {
  return Number.isFinite(value) && value > 0;
}

const ratioSchema = new mongoose.Schema(
  {
    sourceAmount: {
      type: Number,
      required: true,
      validate: {
        validator: isPositiveFiniteNumber,
        message: 'ratio.sourceAmount must be a finite number greater than zero.',
      },
    },
    substituteAmount: {
      type: Number,
      required: true,
      validate: {
        validator: isPositiveFiniteNumber,
        message: 'ratio.substituteAmount must be a finite number greater than zero.',
      },
    },
  },
  { _id: false }
);

const substitutionSchema = new mongoose.Schema(
  {
    sourceIngredientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ingredient',
      required: true,
    },
    substituteIngredientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ingredient',
      required: true,
    },
    // { sourceAmount: 1, substituteAmount: 0.75 } means: use 0.75 parts
    // substitute for every 1 part source. No unit conversion is attempted
    // here — that belongs to future recipe/substitution logic.
    ratio: {
      type: ratioSchema,
      required: true,
    },
    contexts: {
      type: [{ type: String, trim: true, maxlength: MAX_CONTEXT_LENGTH }],
      default: [],
      validate: {
        validator: (arr) => arr.length <= MAX_CONTEXTS,
        message: `contexts cannot contain more than ${MAX_CONTEXTS} entries.`,
      },
    },
    notes: {
      type: String,
      trim: true,
      maxlength: MAX_NOTES_LENGTH,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// One directed relationship per ordered (source, substitute) pair.
// Butter -> Olive Oil and Olive Oil -> Butter are distinct pairs and may
// both exist independently.
substitutionSchema.index({ sourceIngredientId: 1, substituteIngredientId: 1 }, { unique: true });
substitutionSchema.index({ substituteIngredientId: 1 });

const Substitution = mongoose.model('Substitution', substitutionSchema);

module.exports = Substitution;
module.exports.MAX_CONTEXTS = MAX_CONTEXTS;
module.exports.MAX_CONTEXT_LENGTH = MAX_CONTEXT_LENGTH;
module.exports.MAX_NOTES_LENGTH = MAX_NOTES_LENGTH;