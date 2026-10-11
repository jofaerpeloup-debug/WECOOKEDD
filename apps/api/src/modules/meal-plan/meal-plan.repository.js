const mongoose = require('mongoose');
const MealPlanEntry = require('./meal-plan.model');

function create(data) { return MealPlanEntry.create(data); }
function findByUserAndRange(userId, startDate, endDate) {
  return MealPlanEntry.find({ userId, dateKey: { $gte: startDate, $lte: endDate } })
    .sort({ dateKey: 1, createdAt: 1, _id: 1 });
}
function findByIdAndUser(entryId, userId) { return MealPlanEntry.findOne({ _id: entryId, userId }); }

function nextUpdatedAt(observed, now = new Date()) {
  const oldMs = observed instanceof Date ? observed.getTime() : NaN;
  const nextMs = Math.max(now.getTime(), oldMs + 1);
  if (!Number.isSafeInteger(oldMs) || !Number.isSafeInteger(nextMs) || nextMs > 8640000000000000 || nextMs <= oldMs) {
    throw new RangeError('Meal plan entry timestamp cannot advance.');
  }
  return new Date(nextMs);
}

function revisionPredicate(entry) {
  return (entry.reminderRevision ?? 0) === 0
    ? { $or: [{ reminderRevision: 0 }, { reminderRevision: { $exists: false } }] }
    : { reminderRevision: entry.reminderRevision };
}

function updateObserved(entry, userId, fields) {
  return MealPlanEntry.findOneAndUpdate(
    { _id: entry._id, userId, dateKey: entry.dateKey, updatedAt: entry.updatedAt, ...revisionPredicate(entry) },
    { $set: { ...fields, updatedAt: nextUpdatedAt(entry.updatedAt) } },
    { returnDocument: 'after', runValidators: true, timestamps: false }
  );
}

function deleteByIdAndUser(entryId, userId, expectedUpdatedAt) {
  return MealPlanEntry.findOneAndDelete({ _id: entryId, userId, updatedAt: new Date(expectedUpdatedAt) });
}

function sameSnapshot(entries, expected) {
  if (entries.length !== expected.length) return false;
  const current = entries.map((entry) => ({ id: String(entry._id), expectedUpdatedAt: entry.updatedAt.toISOString() }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return current.every((item, index) => item.id === expected[index].id && item.expectedUpdatedAt === new Date(expected[index].expectedUpdatedAt).toISOString());
}

async function deleteByUserAndRange(userId, startDate, endDate, expectedEntries) {
  const session = await mongoose.startSession();
  try {
    let deletedCount = 0;
    await session.withTransaction(async () => {
      deletedCount = 0;
      const entries = await MealPlanEntry.find({ userId, dateKey: { $gte: startDate, $lte: endDate } }).session(session);
      if (!sameSnapshot(entries, expectedEntries)) throw Object.assign(new Error('Stale meal plan range.'), { code: 'MEAL_PLAN_ENTRY_STALE' });
      for (const entry of entries) {
        const result = await MealPlanEntry.deleteOne({ _id: entry._id, userId, updatedAt: entry.updatedAt, dateKey: entry.dateKey }, { session });
        if (result.deletedCount !== 1) throw Object.assign(new Error('Stale meal plan range.'), { code: 'MEAL_PLAN_ENTRY_STALE' });
        deletedCount += 1;
      }
    });
    return { deletedCount };
  } finally { await session.endSession(); }
}

module.exports = { create, findByUserAndRange, findByIdAndUser, nextUpdatedAt, updateObserved, deleteByIdAndUser, deleteByUserAndRange };
