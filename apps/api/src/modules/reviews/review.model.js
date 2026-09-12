const mongoose = require('mongoose');

// A user's rating (+ optional written comment) for one Recipe. Kept as its
// own collection rather than embedded on Recipe or User, matching Favorite /
// CollectionRecipe: it's a User -> Recipe relationship, but unlike those pure
// join rows it carries fields of its own (rating, comment) that belong to the
// review itself, not to either side of the relationship.
const COMMENT_MAX_LENGTH = 1000;

const reviewSchema = new mongoose.Schema(
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
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: {
        validator: Number.isInteger,
        message: 'Rating must be a whole number between 1 and 5.',
      },
    },
    comment: {
      type: String,
      trim: true,
      maxlength: COMMENT_MAX_LENGTH,
    },
  },
  { timestamps: true }
);

// A user may review a given recipe at most once — the source of truth for
// "one review per user per recipe", enforced here (a race loses this way,
// never with two rows) in addition to the service-level check. Also backs
// the "does this user already have a review for this recipe" lookup used to
// compute currentUserReview.
reviewSchema.index({ userId: 1, recipeId: 1 }, { unique: true });
// Backs the paginated newest/oldest review list for one recipe, and the
// average/count aggregation, both scoped by recipeId.
reviewSchema.index({ recipeId: 1, createdAt: -1 });

const Review = mongoose.model('Review', reviewSchema);

module.exports = Review;
module.exports.COMMENT_MAX_LENGTH = COMMENT_MAX_LENGTH;
