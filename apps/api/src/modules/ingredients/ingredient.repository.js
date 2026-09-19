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

function archiveById(id) {
  return Ingredient.findByIdAndUpdate(id, { $set: { isActive: false } }, { returnDocument: 'after' });
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
  archiveById,
  findMany,
  countByFilter,
};