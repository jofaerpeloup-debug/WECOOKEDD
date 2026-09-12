const reviewRepository = require('./review.repository');
const recipeService = require('../recipes/recipe.service');
const userService = require('../users/user.service');
const { AppError } = require('../../shared/errors/app-error');

const DUPLICATE_KEY_ERROR_CODE = 11000;

const SORT_MAP = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
};

function recipeNotFoundError() {
  return new AppError('Recipe not found.', { statusCode: 404, code: 'RECIPE_NOT_FOUND' });
}

function reviewNotFoundError() {
  return new AppError('Review not found.', { statusCode: 404, code: 'REVIEW_NOT_FOUND' });
}

function alreadyExistsError() {
  return new AppError('You have already reviewed this recipe.', {
    statusCode: 409,
    code: 'REVIEW_ALREADY_EXISTS',
  });
}

// Same cross-module rule Favorites/Collections follow: recipe eligibility is
// resolved through RecipeService only, never the Recipe model/repository
// directly. Applied uniformly to every review endpoint that takes a
// recipeId (create AND list) — a nonexistent or archived/unusable recipe
// reads as RECIPE_NOT_FOUND either way.
async function ensureUsableRecipe(recipeId) {
  const recipe = await recipeService.findUsableRecipeById(recipeId);
  if (!recipe) {
    throw recipeNotFoundError();
  }
  return recipe;
}

// Resolves the public author identity for a review through UserService only
// — the same cross-module boundary rule as recipe resolution, never a
// Mongoose populate() reaching across module lines. A missing user (should
// not normally happen; referential integrity is expected) degrades to a
// null author rather than throwing, since a review's own data is still
// valid and displayable.
async function attachAuthor(review) {
  const user = await userService.getUserById(review.userId);
  return { review, author: user ? { id: String(user._id), name: user.name } : null };
}

function toSummary(aggregate) {
  if (!aggregate || !aggregate.count) {
    return { averageRating: null, ratingCount: 0 };
  }
  // Rounded to one decimal place for presentation only — the underlying
  // aggregation always recomputes from full-precision review data, so no
  // precision is lost internally.
  return { averageRating: Math.round(aggregate.avg * 10) / 10, ratingCount: aggregate.count };
}

// Ownership is always the authenticated caller (`userId` from req.auth.userId
// in the controller) — never accepted from the request body. One review per
// user per recipe is enforced by the { userId, recipeId } unique index; a
// duplicate POST (including a concurrent-request race) is translated into a
// clean 409 here rather than surfacing as an unhandled 500. POST always
// creates — updating an existing review is PATCH's job (updateReview below).
async function createReview(userId, recipeId, { rating, comment }) {
  const recipe = await ensureUsableRecipe(recipeId);

  const doc = { userId, recipeId: recipe._id, rating };
  if (comment !== undefined) doc.comment = comment;

  let review;
  try {
    review = await reviewRepository.create(doc);
  } catch (err) {
    if (err && err.code === DUPLICATE_KEY_ERROR_CODE) {
      throw alreadyExistsError();
    }
    throw err;
  }

  return attachAuthor(review);
}

// Only ever writes allowlisted rating/comment fields (see review.validation.js
// for the strict schema upstream) and is scoped to { _id, userId } so a
// review belonging to another user is never found, let alone updated.
async function updateReview(userId, reviewId, patch) {
  const update = {};
  if (patch.rating !== undefined) update.rating = patch.rating;
  if (patch.comment !== undefined) update.comment = patch.comment;

  const updated = await reviewRepository.updateOwnedById(reviewId, userId, update);
  if (!updated) {
    throw reviewNotFoundError();
  }
  return attachAuthor(updated);
}

async function deleteReview(userId, reviewId) {
  const deleted = await reviewRepository.deleteOwnedById(reviewId, userId);
  if (!deleted) {
    throw reviewNotFoundError();
  }
  return deleted;
}

// Returns the paginated review list for one recipe, its authoritative
// average/count, AND the caller's own review (if any) in a single call —
// the narrowest shape that lets RecipeDetail show "your rating" without a
// second round trip or scanning the paginated rows for a match.
async function listReviews(userId, recipeId, { page, limit, sort }) {
  const recipe = await ensureUsableRecipe(recipeId);

  const filter = { recipeId: recipe._id };
  const skip = (page - 1) * limit;

  const [reviews, total, aggregate, myReview] = await Promise.all([
    reviewRepository.findMany({ filter, sort: SORT_MAP[sort], skip, limit }),
    reviewRepository.countByFilter(filter),
    reviewRepository.aggregateSummary(recipe._id),
    reviewRepository.findOneByUserAndRecipe(userId, recipe._id),
  ]);

  const items = await Promise.all(reviews.map(attachAuthor));
  const currentUserReview = myReview ? await attachAuthor(myReview) : null;

  return { items, total, page, limit, summary: toSummary(aggregate), currentUserReview };
}

module.exports = {
  createReview,
  updateReview,
  deleteReview,
  listReviews,
};
