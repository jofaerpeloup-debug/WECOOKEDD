const Substitution = require('./substitution.model');

// Only the fields a populated ingredient summary is allowed to expose (see
// substitution.serializer.js) plus isActive, which the service needs to
// decide visibility but never forwards to the client.
const INGREDIENT_SUMMARY_FIELDS = 'name isActive';

function withIngredientSummaries(query) {
  return query
    .populate('sourceIngredientId', INGREDIENT_SUMMARY_FIELDS)
    .populate('substituteIngredientId', INGREDIENT_SUMMARY_FIELDS);
}

async function createSubstitution(data) {
  const doc = await Substitution.create(data);
  return doc.populate([
    { path: 'sourceIngredientId', select: INGREDIENT_SUMMARY_FIELDS },
    { path: 'substituteIngredientId', select: INGREDIENT_SUMMARY_FIELDS },
  ]);
}

// Unpopulated lookup for internal service logic (existence checks, patch
// merges) where sourceIngredientId/substituteIngredientId must stay raw
// ObjectIds rather than populated Ingredient documents.
function findRawById(id) {
  return Substitution.findById(id);
}

function findByIdWithIngredients(id) {
  return withIngredientSummaries(Substitution.findById(id));
}

function updateById(id, update) {
  return withIngredientSummaries(
    Substitution.findByIdAndUpdate(id, update, { new: true, runValidators: true })
  );
}

function archiveById(id) {
  return withIngredientSummaries(
    Substitution.findByIdAndUpdate(id, { $set: { isActive: false } }, { new: true })
  );
}

function findMany({ filter, sort, skip, limit }) {
  return withIngredientSummaries(Substitution.find(filter).sort(sort).skip(skip).limit(limit));
}

function countByFilter(filter) {
  return Substitution.countDocuments(filter);
}

module.exports = {
  createSubstitution,
  findRawById,
  findByIdWithIngredients,
  updateById,
  archiveById,
  findMany,
  countByFilter,
};