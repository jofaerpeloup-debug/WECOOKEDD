const Recipe = require('./recipe.model');
const { consumerPublicationFilter } = require('./recipe.visibility');

// Only the fields a populated ingredient summary is allowed to expose (see
// recipe.serializer.js) plus isActive, which the service needs to decide
// per-recipe usability but never forwards to the client.
const INGREDIENT_SUMMARY_FIELDS = 'name isActive';
const DUPLICATE_COMPARISON_FIELDS = '_id title ingredients instructions publicationStatus isActive updatedAt';

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

function duplicateLifecycleFilters(excludeId) {
  const withoutSelf = excludeId ? { _id: { $ne: excludeId } } : {};
  return [
    { ...withoutSelf, publicationStatus: 'published', isActive: true },
    { ...withoutSelf, publicationStatus: 'published', isActive: false },
    { ...withoutSelf, publicationStatus: null, isActive: true },
    { ...withoutSelf, publicationStatus: null, isActive: false },
    { ...withoutSelf, publicationStatus: 'draft', isActive: true },
  ];
}

function compareDuplicateCandidateOrder(left, right) {
  const updatedOrder = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  if (updatedOrder !== 0) return updatedOrder;
  const leftId = String(left._id);
  const rightId = String(right._id);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

async function findDuplicateCandidates({ excludeId, limit }) {
  const filters = duplicateLifecycleFilters(excludeId);
  const [branches, counts] = await Promise.all([
    Promise.all(filters.map((filter) => Recipe.find(filter, DUPLICATE_COMPARISON_FIELDS)
      .sort({ updatedAt: -1, _id: 1 })
      .limit(limit + 1)
      .lean())),
    Promise.all(filters.map((filter) => Recipe.countDocuments(filter))),
  ]);
  const candidateUniverseCount = counts.reduce((total, count) => total + count, 0);
  const candidates = branches.flat().sort(compareDuplicateCandidateOrder).slice(0, limit);
  return {
    candidates,
    candidateUniverseCount,
    comparedCount: candidates.length,
    truncated: candidateUniverseCount > candidates.length,
  };
}

async function hasActiveConsumerRecipeUsingIngredient(ingredientId) {
  const match = await Recipe.exists({
    isActive: true,
    'ingredients.ingredientId': ingredientId,
    ...consumerPublicationFilter(),
  });
  return Boolean(match);
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
  findDuplicateCandidates,
  hasActiveConsumerRecipeUsingIngredient,
};
