const test = require('node:test');
const assert = require('node:assert/strict');
const MealPlanEntry = require('../src/modules/meal-plan/meal-plan.model');
const repository = require('../src/modules/meal-plan/meal-plan.repository');

test('range reads are owner-scoped, bounded, and deterministically sorted', async (t) => {
  let filter;
  let sort;
  t.mock.method(MealPlanEntry, 'find', (value) => {
    filter = value;
    return { sort(valueToSort) { sort = valueToSort; return Promise.resolve([]); } };
  });
  await repository.findByUserAndRange('user-a', '2026-09-14', '2026-09-20');
  assert.deepEqual(filter, { userId: 'user-a', dateKey: { $gte: '2026-09-14', $lte: '2026-09-20' } });
  assert.deepEqual(sort, { dateKey: 1, createdAt: 1, _id: 1 });
});

test('entry deletion scopes id and owner in one database operation', async (t) => {
  let filter;
  t.mock.method(MealPlanEntry, 'findOneAndDelete', async (value) => { filter = value; return null; });
  await repository.deleteByIdAndUser('entry-a', 'user-a');
  assert.deepEqual(filter, { _id: 'entry-a', userId: 'user-a' });
});

test('range deletion cannot cross the authenticated owner boundary', async (t) => {
  let filter;
  t.mock.method(MealPlanEntry, 'deleteMany', async (value) => { filter = value; return { deletedCount: 0 }; });
  await repository.deleteByUserAndRange('user-a', '2026-09-14', '2026-09-20');
  assert.deepEqual(filter, { userId: 'user-a', dateKey: { $gte: '2026-09-14', $lte: '2026-09-20' } });
});
