const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const MealPlanEntry = require('../src/modules/meal-plan/meal-plan.model');
const repository = require('../src/modules/meal-plan/meal-plan.repository');

const OLD = new Date('2026-09-14T08:30:00.000Z');
test('range read remains owner scoped and stably sorted', async (t) => {
  let filter; let sort;
  t.mock.method(MealPlanEntry, 'find', (value) => { filter = value; return { sort(valueToSort) { sort = valueToSort; return Promise.resolve([]); } }; });
  await repository.findByUserAndRange('owner', '2026-09-14', '2026-09-20');
  assert.deepEqual(filter, { userId: 'owner', dateKey: { $gte: '2026-09-14', $lte: '2026-09-20' } });
  assert.deepEqual(sort, { dateKey: 1, createdAt: 1, _id: 1 });
});

test('strict timestamp advances under same millisecond and clock rollback', () => {
  assert.equal(repository.nextUpdatedAt(OLD, new Date(OLD)).getTime(), OLD.getTime() + 1);
  assert.equal(repository.nextUpdatedAt(OLD, new Date(OLD.getTime() - 500)).getTime(), OLD.getTime() + 1);
  assert.throws(() => repository.nextUpdatedAt(new Date(8640000000000000), new Date(0)), RangeError);
});

test('actual updates use one owner/date/version/revision CAS and disable automatic timestamps', async (t) => {
  let args;
  t.mock.method(MealPlanEntry, 'findOneAndUpdate', async (...value) => { args = value; return { _id: 'entry' }; });
  await repository.updateObserved({ _id: 'entry', dateKey: '2026-09-14', updatedAt: OLD, reminderRevision: 0 }, 'owner', { dateKey: '2026-09-16', reminderRevision: 1 });
  assert.equal(args[0].userId, 'owner');
  assert.equal(args[0].updatedAt, OLD);
  assert.equal(args[0].dateKey, '2026-09-14');
  assert.deepEqual(args[0].$or, [{ reminderRevision: 0 }, { reminderRevision: { $exists: false } }]);
  assert.equal(args[1].$set.dateKey, '2026-09-16');
  assert.equal(args[1].$set.reminderRevision, 1);
  assert.ok(args[1].$set.updatedAt.getTime() > OLD.getTime());
  assert.equal(args[2].timestamps, false);
});

test('single removal is an exact owner-and-version atomic delete', async (t) => {
  let filter;
  t.mock.method(MealPlanEntry, 'findOneAndDelete', async (value) => { filter = value; return null; });
  await repository.deleteByIdAndUser('entry', 'owner', OLD.toISOString());
  assert.deepEqual(filter, { _id: 'entry', userId: 'owner', updatedAt: OLD });
});

test('Clear Week snapshot mismatch aborts transaction before any delete', async (t) => {
  let deleted = 0; let ended = 0;
  t.mock.method(mongoose, 'startSession', async () => ({
    withTransaction: async (fn) => fn(), endSession: async () => { ended += 1; },
  }));
  t.mock.method(MealPlanEntry, 'find', () => ({ session: async () => [{ _id: 'a', updatedAt: OLD, dateKey: '2026-09-14' }] }));
  t.mock.method(MealPlanEntry, 'deleteOne', async () => { deleted += 1; return { deletedCount: 1 }; });
  await assert.rejects(() => repository.deleteByUserAndRange('owner', '2026-09-14', '2026-09-20', []), (error) => error.code === 'MEAL_PLAN_ENTRY_STALE');
  assert.equal(deleted, 0);
  assert.equal(ended, 1);
});

test('Clear Week deletes only exact snapshotted versions inside one transaction', async (t) => {
  const deletes = [];
  let transactionCalls = 0;
  t.mock.method(mongoose, 'startSession', async () => ({
    withTransaction: async (fn) => { transactionCalls += 1; await fn(); }, endSession: async () => {},
  }));
  t.mock.method(MealPlanEntry, 'find', () => ({ session: async () => [{ _id: 'a', updatedAt: OLD, dateKey: '2026-09-14' }] }));
  t.mock.method(MealPlanEntry, 'deleteOne', async (...args) => { deletes.push(args); return { deletedCount: 1 }; });
  const result = await repository.deleteByUserAndRange('owner', '2026-09-14', '2026-09-20', [{ id: 'a', expectedUpdatedAt: OLD.toISOString() }]);
  assert.equal(result.deletedCount, 1);
  assert.equal(transactionCalls, 1);
  assert.equal(deletes[0][0].userId, 'owner');
  assert.equal(deletes[0][0].updatedAt, OLD);
  assert.ok(deletes[0][1].session);
});

test('Clear Week reports only the committed transaction count after a callback retry', async (t) => {
  t.mock.method(mongoose, 'startSession', async () => ({
    withTransaction: async (fn) => { await fn(); await fn(); },
    endSession: async () => {},
  }));
  t.mock.method(MealPlanEntry, 'find', () => ({ session: async () =>
    [{ _id: 'a', updatedAt: OLD, dateKey: '2026-09-14' }] }));
  t.mock.method(MealPlanEntry, 'deleteOne', async () => ({ deletedCount: 1 }));
  const result = await repository.deleteByUserAndRange('owner', '2026-09-14', '2026-09-20',
    [{ id: 'a', expectedUpdatedAt: OLD.toISOString() }]);
  assert.equal(result.deletedCount, 1);
});
