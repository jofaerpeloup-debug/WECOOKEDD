const MealPlanEntry = require('./meal-plan.model');

function create(data) {
  return MealPlanEntry.create(data);
}

function findByUserAndRange(userId, startDate, endDate) {
  return MealPlanEntry.find({ userId, dateKey: { $gte: startDate, $lte: endDate } }).sort({
    dateKey: 1,
    createdAt: 1,
    _id: 1,
  });
}

function moveByIdAndUser(entryId, userId, dateKey, expectedUpdatedAt) {
  return MealPlanEntry.findOneAndUpdate(
    { _id: entryId, userId, updatedAt: new Date(expectedUpdatedAt), dateKey: { $ne: dateKey } },
    { $set: { dateKey } },
    { returnDocument: 'after', runValidators: true }
  );
}

function findByIdAndUser(entryId, userId) {
  return MealPlanEntry.findOne({ _id: entryId, userId });
}

function deleteByIdAndUser(entryId, userId) {
  return MealPlanEntry.findOneAndDelete({ _id: entryId, userId });
}

function deleteByUserAndRange(userId, startDate, endDate) {
  return MealPlanEntry.deleteMany({ userId, dateKey: { $gte: startDate, $lte: endDate } });
}

module.exports = {
  create,
  findByUserAndRange,
  moveByIdAndUser,
  findByIdAndUser,
  deleteByIdAndUser,
  deleteByUserAndRange,
};
