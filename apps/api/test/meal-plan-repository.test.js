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

test('move is one atomic owner-and-version-scoped update that sets only dateKey', async (t) => {
  let captured;
  const updatedAt = '2026-09-14T08:30:00.000Z';
  t.mock.method(MealPlanEntry, 'findOneAndUpdate', async (...args) => { captured = args; return { _id: 'entry-a' }; });
  await repository.moveByIdAndUser('entry-a', 'user-a', '2026-09-16', updatedAt);
  assert.deepEqual(captured[0], {
    _id: 'entry-a',
    userId: 'user-a',
    updatedAt: new Date(updatedAt),
    dateKey: { $ne: '2026-09-16' },
  });
  assert.deepEqual(captured[1], { $set: { dateKey: '2026-09-16' } });
  assert.deepEqual(captured[2], { returnDocument: 'after', runValidators: true });
});

test('duplicate rejection comes from the one atomic update without a second mutation', async (t) => {
  const duplicate = Object.assign(new Error('duplicate'), { code: 11000 });
  const update = t.mock.method(MealPlanEntry, 'findOneAndUpdate', async () => { throw duplicate; });

  await assert.rejects(
    () => repository.moveByIdAndUser('entry-a', 'user-a', '2026-09-16', '2026-09-14T08:30:00.000Z'),
    (err) => err === duplicate
  );
  assert.equal(update.mock.callCount(), 1);
});

test('failed conditional moves are classified through an owner-scoped existence read', async (t) => {
  let filter;
  t.mock.method(MealPlanEntry, 'findOne', async (value) => { filter = value; return null; });
  await repository.findByIdAndUser('entry-a', 'user-a');
  assert.deepEqual(filter, { _id: 'entry-a', userId: 'user-a' });
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
