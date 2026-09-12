const CollectionRecipe = require('./collection-recipe.model');

function createMembership(data) {
  return CollectionRecipe.create(data);
}

// Physically removes the membership row — like Favorite, this is ephemeral
// relationship data, never soft-archived.
function deleteByCollectionAndRecipe(collectionId, recipeId) {
  return CollectionRecipe.findOneAndDelete({ collectionId, recipeId });
}

// Cascade cleanup when a Collection itself is deleted (CollectionService).
function deleteAllByCollectionId(collectionId) {
  return CollectionRecipe.deleteMany({ collectionId });
}

function findMany({ filter, sort, skip, limit }) {
  return CollectionRecipe.find(filter).sort(sort).skip(skip).limit(limit);
}

function countByFilter(filter) {
  return CollectionRecipe.countDocuments(filter);
}

// The most-recently-added N membership rows for one collection, recipeId
// only — used for collection-card cover images. Deliberately Recipe-agnostic:
// resolving each id into a usable recipe (and dropping archived ones) is
// CollectionService's job via RecipeService, the same cross-module rule
// Favorites follows.
function findRecentRecipeIds(collectionId, limit) {
  return CollectionRecipe.find({ collectionId }).sort({ createdAt: -1 }).limit(limit).select('recipeId');
}

module.exports = {
  createMembership,
  deleteByCollectionAndRecipe,
  deleteAllByCollectionId,
  findMany,
  countByFilter,
  findRecentRecipeIds,
};
