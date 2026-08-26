const mongoose = require('mongoose');

// A Favorite is a private User -> Recipe relationship, kept as its own
// collection rather than an array embedded in User: two independent
// entities may each favorite the same Recipe, and favoriting is ephemeral
// relationship data with no fields of its own beyond the pair itself. See
// docs/architecture/favorites-shopping-list.md.
const favoriteSchema = new mongoose.Schema(
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
  },
  { timestamps: true }
);

// A user may favorite a given recipe at most once; two different users may
// each favorite the same recipe independently. Also backs the per-user
// list query itself.
favoriteSchema.index({ userId: 1, recipeId: 1 }, { unique: true });
// Backs the newest/oldest sort of one user's favorites list.
favoriteSchema.index({ userId: 1, createdAt: -1 });

const Favorite = mongoose.model('Favorite', favoriteSchema);

module.exports = Favorite;