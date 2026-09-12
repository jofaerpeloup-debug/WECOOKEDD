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

function deleteByIdAndUser(entryId, userId) {
  return MealPlanEntry.findOneAndDelete({ _id: entryId, userId });
}

function deleteByUserAndRange(userId, startDate, endDate) {
  return MealPlanEntry.deleteMany({ userId, dateKey: { $gte: startDate, $lte: endDate } });
}

module.exports = { create, findByUserAndRange, deleteByIdAndUser, deleteByUserAndRange };
