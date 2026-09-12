const mongoose = require('mongoose');
const CookHistory = require('./cook-history.model');

function create(data) {
  return CookHistory.create(data);
}

function findMany({ filter, sort, skip, limit }) {
  return CookHistory.find(filter).sort(sort).skip(skip).limit(limit);
}

function countByFilter(filter) {
  return CookHistory.countDocuments(filter);
}

// Existence-only check for the RecipeDetail "Cooked" pill — never fetches or
// counts full documents, just whether at least one event exists for this
// user+recipe pair. `Model.exists()` resolves `{ _id }` or `null`; normalized
// to a plain boolean here so callers never depend on that shape.
async function existsForUserAndRecipe(userId, recipeId) {
  const found = await CookHistory.exists({ userId, recipeId });
  return found !== null;
}

// Authoritative totalCooks/uniqueRecipesCooked for one user, computed
// directly from CookHistory documents (never denormalized/stored). Returns
// null when the user has no history yet — the service turns that into
// deterministic zeroed stats.
async function aggregateStats(userId) {
  const objectId = userId instanceof mongoose.Types.ObjectId ? userId : new mongoose.Types.ObjectId(userId);
  const [row] = await CookHistory.aggregate([
    { $match: { userId: objectId } },
    { $group: { _id: null, totalCooks: { $sum: 1 }, uniqueRecipeIds: { $addToSet: '$recipeId' } } },
    { $project: { _id: 0, totalCooks: 1, uniqueRecipesCooked: { $size: '$uniqueRecipeIds' } } },
  ]);
  return row || null;
}

module.exports = {
  create,
  findMany,
  countByFilter,
  existsForUserAndRecipe,
  aggregateStats,
};
