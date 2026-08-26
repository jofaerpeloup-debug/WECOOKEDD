const Favorite = require('./favorite.model');

function createFavorite(data) {
  return Favorite.create(data);
}

// Physically removes the Favorite document — favorites are ephemeral
// relationship data, never soft-archived. Returns the deleted document, or
// null when the current user has no such favorite.
function deleteByUserAndRecipe(userId, recipeId) {
  return Favorite.findOneAndDelete({ userId, recipeId });
}

function findMany({ filter, sort, skip, limit }) {
  return Favorite.find(filter).sort(sort).skip(skip).limit(limit);
}

function countByFilter(filter) {
  return Favorite.countDocuments(filter);
}

module.exports = {
  createFavorite,
  deleteByUserAndRecipe,
  findMany,
  countByFilter,
};