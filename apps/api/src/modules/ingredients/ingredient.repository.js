const Ingredient = require('./ingredient.model');

function createIngredient(data) {
  return Ingredient.create(data);
}

function findById(id) {
  return Ingredient.findById(id);
}

function updateById(id, update) {
  return Ingredient.findByIdAndUpdate(id, update, { returnDocument: 'after', runValidators: true });
}

function updateByIdIfActiveState(id, expectedIsActive, update, { runValidators = true } = {}) {
  return Ingredient.findOneAndUpdate(
    { _id: id, isActive: expectedIsActive },
    update,
    { returnDocument: 'after', runValidators }
  );
}

function findMany({ filter, sort, skip, limit }) {
  return Ingredient.find(filter).sort(sort).skip(skip).limit(limit);
}

function countByFilter(filter) {
  return Ingredient.countDocuments(filter);
}

function findActiveResolutionCatalog() {
  return Ingredient.find({ isActive: true })
    .select({ _id: 1, name: 1, aliases: 1, category: 1 })
    .sort({ normalizedName: 1, _id: 1 })
    .lean();
}

function findAliasCollisionCatalog() {
  return Ingredient.find({})
    .select({ _id: 1, name: 1, aliases: 1, isActive: 1 })
    .sort({ normalizedName: 1, _id: 1 })
    .lean();
}

module.exports = {
  createIngredient,
  findById,
  updateById,
  updateByIdIfActiveState,
  findMany,
  countByFilter,
  findActiveResolutionCatalog,
  findAliasCollisionCatalog,
};
