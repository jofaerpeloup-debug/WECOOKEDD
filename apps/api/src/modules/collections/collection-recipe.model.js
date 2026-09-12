const mongoose = require('mongoose');

// A membership row joining one Collection to one Recipe — the same
// join-collection shape as Favorite (see favorite.model.js), not an embedded
// recipeIds[] array on Collection: a collection can grow without bound, and
// membership is relationship data with no fields of its own beyond the pair
// itself and when it was added.
const collectionRecipeSchema = new mongoose.Schema(
  {
    collectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Collection',
      required: true,
    },
    recipeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Recipe',
      required: true,
    },
  },
  { timestamps: true }
);

// A recipe may appear in a given collection at most once. Also backs the
// per-collection membership list query itself.
collectionRecipeSchema.index({ collectionId: 1, recipeId: 1 }, { unique: true });
// Backs the newest/oldest sort of one collection's recipe list, and the
// "most recent N" lookup used for collection-card cover images.
collectionRecipeSchema.index({ collectionId: 1, createdAt: -1 });

const CollectionRecipe = mongoose.model('CollectionRecipe', collectionRecipeSchema);

module.exports = CollectionRecipe;
