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

module.exports = {
  createIngredient,
  findById,
  updateById,
  updateByIdIfActiveState,
  findMany,
  countByFilter,
};
