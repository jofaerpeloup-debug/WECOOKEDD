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

function mutationFilter(id, expectedUpdatedAt) {
  const filter = { _id: id };
  if (expectedUpdatedAt) filter.updatedAt = new Date(expectedUpdatedAt);
  return filter;
}

function updateById(id, update, { expectedUpdatedAt } = {}) {
  return withIngredientSummaries(
    Recipe.findOneAndUpdate(mutationFilter(id, expectedUpdatedAt), update, {
      returnDocument: 'after',
      runValidators: true,
    })
  );
}

function publishById(id, { actorId, publishedAt, expectedUpdatedAt }) {
  return withIngredientSummaries(
    Recipe.findOneAndUpdate(
      {
        ...mutationFilter(id, expectedUpdatedAt),
        isActive: true,
        publicationStatus: 'draft',
      },
      {
        $set: {
          publicationStatus: 'published',
          publishedBy: actorId,
          publishedAt,
          updatedBy: actorId,
        },
      },
      { returnDocument: 'after', runValidators: true }
    )
  );
}

function archiveById(id, { actorId, expectedUpdatedAt } = {}) {
  const update = { isActive: false };
  if (actorId) update.updatedBy = actorId;
  return withIngredientSummaries(
    Recipe.findOneAndUpdate(mutationFilter(id, expectedUpdatedAt), { $set: update }, { returnDocument: 'after' })
  );
}

function restoreById(id, { actorId, expectedUpdatedAt } = {}) {
  const update = { isActive: true };
  if (actorId) update.updatedBy = actorId;
  return withIngredientSummaries(
    Recipe.findOneAndUpdate(mutationFilter(id, expectedUpdatedAt), { $set: update }, { returnDocument: 'after' })
  );
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
  publishById,
  archiveById,
  restoreById,
  findMany,
  countByFilter,
};
