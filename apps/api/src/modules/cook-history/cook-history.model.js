const mongoose = require('mongoose');

// One CookHistory document is one intentional CookMode completion (Finish) —
// an EVENT log, not a User -> Recipe relationship like Favorite/Review. A
// user may cook the same recipe many times, so this deliberately has NO
// unique index on { userId, recipeId }: each legitimate Finish creates its
// own row. See docs/architecture/backend.md for the cross-module rules this
// module also follows (Recipe eligibility resolved through RecipeService,
// never the Recipe model directly).
const SERVINGS_MIN = 1;
const SERVINGS_MAX = 100;

const cookHistorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    recipeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Recipe',
      required: true,
    },
    // Only the servings CookMode actually had selected for this completion —
    // never a recipe snapshot. Optional: a completion is still valid without
    // it.
    servings: {
      type: Number,
      min: SERVINGS_MIN,
      max: SERVINGS_MAX,
      validate: {
        validator: (value) => value === undefined || Number.isInteger(value),
        message: 'Servings must be a whole number.',
      },
    },
    // Server-authoritative completion time — always defaulted here, never
    // accepted from the client (see cook-history.validation.js's strict
    // create schema).
    completedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Backs the paginated newest/oldest history list for one user.
cookHistorySchema.index({ userId: 1, completedAt: -1 });
// Backs the per-recipe grouping stats aggregation uses (distinct recipes
// cooked by one user). Deliberately NOT unique — see the module comment.
cookHistorySchema.index({ userId: 1, recipeId: 1 });

const CookHistory = mongoose.model('CookHistory', cookHistorySchema);

module.exports = CookHistory;
module.exports.SERVINGS_MIN = SERVINGS_MIN;
module.exports.SERVINGS_MAX = SERVINGS_MAX;
