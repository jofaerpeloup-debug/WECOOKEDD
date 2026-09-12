const mongoose = require('mongoose');
const Review = require('./review.model');

function create(data) {
  return Review.create(data);
}

// Backs currentUserReview resolution — a single indexed lookup (the same
// { userId, recipeId } unique index that enforces one-review-per-user), never
// a scan over the paginated list.
function findOneByUserAndRecipe(userId, recipeId) {
  return Review.findOne({ userId, recipeId });
}

// Every owned-lookup is scoped by { _id, userId } in one atomic query — never
// findById followed by a manual ownership check — so a review belonging to
// another user reads as not-found, never as a permission error. Mirrors
// collection.repository.js#updateOwnedById/deleteOwnedById.
function updateOwnedById(id, userId, update) {
  return Review.findOneAndUpdate({ _id: id, userId }, { $set: update }, { returnDocument: 'after', runValidators: true });
}

function deleteOwnedById(id, userId) {
  return Review.findOneAndDelete({ _id: id, userId });
}

function findMany({ filter, sort, skip, limit }) {
  return Review.find(filter).sort(sort).skip(skip).limit(limit);
}

function countByFilter(filter) {
  return Review.countDocuments(filter);
}

// Authoritative average/count for one recipe, computed directly from Review
// documents (never denormalized/stored) — `recipeId` must already be an
// ObjectId (e.g. a resolved recipe's `_id`), since aggregation `$match` does
// not auto-cast query values the way `find`/`countDocuments` do. Returns null
// when the recipe has no reviews yet.
async function aggregateSummary(recipeId) {
  const objectId = recipeId instanceof mongoose.Types.ObjectId ? recipeId : new mongoose.Types.ObjectId(recipeId);
  const [row] = await Review.aggregate([
    { $match: { recipeId: objectId } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  return row || null;
}

module.exports = {
  create,
  findOneByUserAndRecipe,
  updateOwnedById,
  deleteOwnedById,
  findMany,
  countByFilter,
  aggregateSummary,
};
