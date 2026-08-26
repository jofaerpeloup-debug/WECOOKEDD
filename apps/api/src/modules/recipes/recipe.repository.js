const Recipe = require('./recipe.model');

// Only the fields a populated ingredient summary is allowed to expose (see
// recipe.serializer.js) plus isActive, which the service needs to decide
// per-recipe usability but never forwards to the client.
const INGREDIENT_SUMMARY_FIELDS = 'name isActive';

function withIngredientSummaries(query) {
  return query.populate('ingredients.ingredientId', INGREDIENT_SUMMARY_FIELDS);
}

async function createRecipe(data) {
  const doc = await Recipe.create(data);
  return doc.populate('ingredients.ingredientId', INGREDIENT_SUMMARY_FIELDS);
}

// Unpopulated lookup for internal service logic (existence checks, patch
// merges) where ingredients[].ingredientId must stay a raw ObjectId rather
// than a populated Ingredient document.
function findRawById(id) {
  return Recipe.findById(id);
}

function findByIdWithIngredients(id) {
  return withIngredientSummaries(Recipe.findById(id));
}

function updateById(id, update) {
  return withIngredientSummaries(Recipe.findByIdAndUpdate(id, update, { new: true, runValidators: true }));
}

function archiveById(id) {
  return withIngredientSummaries(Recipe.findByIdAndUpdate(id, { $set: { isActive: false } }, { new: true }));
}

function findMany({ filter, sort, skip, limit }) {
  return withIngredientSummaries(Recipe.find(filter).sort(sort).skip(skip).limit(limit));
}

function countByFilter(filter) {
  return Recipe.countDocuments(filter);
}

module.exports = {
  createRecipe,
  findRawById,
  findByIdWithIngredients,
  updateById,
  archiveById,
  findMany,
  countByFilter,
};