process.env.NODE_ENV = 'test';
process.env.PORT = '4040';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');
const repository = require('../src/modules/meal-plan/meal-plan.repository');
const recipeService = require('../src/modules/recipes/recipe.service');
const service = require('../src/modules/meal-plan/meal-plan.service');

const OWNER = '507f1f77bcf86cd799439001';
const RECIPE = '507f1f77bcf86cd799439099';
const ENTRY = '507f1f77bcf86cd799439077';
const OLD = '2026-09-14T08:30:00.000Z';
const observed = (extra = {}) => ({ _id: ENTRY, userId: OWNER, recipeId: RECIPE, dateKey: '2026-09-14',
  createdAt: new Date('2026-09-01T00:00:00.000Z'), updatedAt: new Date(OLD), reminderRevision: 0, reminder: null, ...extra });

test('create checks recipe eligibility and derives ownership', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => ({ _id: RECIPE }));
  let data;
  t.mock.method(repository, 'create', async (value) => { data = value; return observed(); });
  await service.createEntry(OWNER, { dateKey: '2026-09-14', recipeId: RECIPE });
  assert.deepEqual(data, { userId: OWNER, dateKey: '2026-09-14', recipeId: RECIPE });
});

test('list and GET retain unavailable recipe while hiding foreign entries', async (t) => {
  t.mock.method(repository, 'findByUserAndRange', async () => [observed()]);
  t.mock.method(repository, 'findByIdAndUser', async (_id, owner) => owner === OWNER ? observed() : null);
  t.mock.method(recipeService, 'findUsableRecipeById', async () => null);
  assert.equal((await service.listEntries(OWNER, '2026-09-14', '2026-09-20'))[0].recipe, null);
  assert.equal((await service.getEntry(OWNER, ENTRY)).entry._id, ENTRY);
  await assert.rejects(() => service.getEntry('other', ENTRY), (error) => error.statusCode === 404);
});

test('identical reminder PUT and already-off DELETE do not mutate or churn versions', async (t) => {
  const reminder = { localTime: '09:00', timeZone: 'UTC', fireAt: new Date('2027-09-14T09:00:00.000Z') };
  let current = observed({ dateKey: '2027-09-14', reminder, reminderRevision: 2 });
  t.mock.method(repository, 'findByIdAndUser', async () => current);
  t.mock.method(recipeService, 'findUsableRecipeById', async () => null);
  const write = t.mock.method(repository, 'updateObserved', async () => { throw new Error('must not write'); });
  const body = { localTime: '09:00', timeZone: 'UTC', expectedUpdatedAt: OLD, expectedReminderRevision: 2 };
  const put = await service.putReminder(OWNER, ENTRY, body);
  assert.equal(put.entry, current);
  current = observed({ dateKey: '2027-09-14', reminder: null, reminderRevision: 2 });
  const deletion = await service.deleteReminder(OWNER, ENTRY, { expectedUpdatedAt: OLD, expectedReminderRevision: 2 });
  assert.equal(deletion.entry, current);
  assert.equal(write.mock.callCount(), 0);
});

test('actual reminder edit advances revision and stale preconditions reject even identical state', async (t) => {
  const current = observed({ dateKey: '2027-09-14' });
  t.mock.method(repository, 'findByIdAndUser', async () => current);
  t.mock.method(recipeService, 'findUsableRecipeById', async () => null);
  let fields;
  t.mock.method(repository, 'updateObserved', async (_entry, _owner, value) => { fields = value; return observed({ ...value, updatedAt: new Date('2026-09-14T08:30:00.001Z') }); });
  const result = await service.putReminder(OWNER, ENTRY, { localTime: '09:00', timeZone: 'UTC', expectedUpdatedAt: OLD, expectedReminderRevision: 0 });
  assert.equal(fields.reminderRevision, 1);
  assert.equal(result.entry.reminder.fireAt.toISOString(), '2027-09-14T09:00:00.000Z');
  await assert.rejects(() => service.putReminder(OWNER, ENTRY, { localTime: '09:00', timeZone: 'UTC', expectedUpdatedAt: OLD, expectedReminderRevision: 1 }), (error) => error.code === 'MEAL_PLAN_ENTRY_STALE');
});

test('move retains identity and atomically turns off a past reminder', async (t) => {
  const current = observed({ dateKey: '2026-09-14', reminder: { localTime: '09:00', timeZone: 'UTC', fireAt: new Date('2026-09-14T09:00:00.000Z') }, reminderRevision: 3 });
  t.mock.method(repository, 'findByIdAndUser', async () => current);
  t.mock.method(recipeService, 'findUsableRecipeById', async () => null);
  let fields;
  t.mock.method(repository, 'updateObserved', async (_entry, _owner, value) => { fields = value; return observed({ ...value }); });
  const result = await service.moveEntry(OWNER, ENTRY, { dateKey: '2026-01-01', expectedUpdatedAt: OLD });
  assert.equal(fields.dateKey, '2026-01-01');
  assert.equal(fields.reminder, null);
  assert.equal(fields.reminderRevision, 4);
  assert.equal(result.reminderTurnedOff, true);
});

test('same-date move is read-only and stale same-date move still conflicts', async (t) => {
  t.mock.method(repository, 'findByIdAndUser', async () => observed());
  t.mock.method(recipeService, 'findUsableRecipeById', async () => null);
  const write = t.mock.method(repository, 'updateObserved', async () => { throw new Error('must not write'); });
  assert.equal((await service.moveEntry(OWNER, ENTRY, { dateKey: '2026-09-14', expectedUpdatedAt: OLD })).entry.updatedAt.toISOString(), OLD);
  await assert.rejects(() => service.moveEntry(OWNER, ENTRY, { dateKey: '2026-09-14', expectedUpdatedAt: '2026-09-14T08:30:00.001Z' }), (error) => error.code === 'MEAL_PLAN_ENTRY_STALE');
  assert.equal(write.mock.callCount(), 0);
});

test('CAS miss and duplicate move classify without retry', async (t) => {
  t.mock.method(repository, 'findByIdAndUser', async () => observed());
  const write = t.mock.method(repository, 'updateObserved', async () => null);
  await assert.rejects(() => service.moveEntry(OWNER, ENTRY, { dateKey: '2026-09-16', expectedUpdatedAt: OLD }), (error) => error.code === 'MEAL_PLAN_ENTRY_STALE');
  assert.equal(write.mock.callCount(), 1);
  write.mock.mockImplementation(async () => { throw Object.assign(new Error('duplicate'), { code: 11000 }); });
  await assert.rejects(() => service.moveEntry(OWNER, ENTRY, { dateKey: '2026-09-16', expectedUpdatedAt: OLD }), (error) => error.code === 'MEAL_PLAN_ENTRY_ALREADY_EXISTS');
});

test('versioned remove and transactional clear classify stale owner-scope safely', async (t) => {
  t.mock.method(repository, 'deleteByIdAndUser', async () => null);
  t.mock.method(repository, 'findByIdAndUser', async () => observed());
  await assert.rejects(() => service.removeEntry(OWNER, ENTRY, { expectedUpdatedAt: OLD }), (error) => error.code === 'MEAL_PLAN_ENTRY_STALE');
  t.mock.method(repository, 'deleteByUserAndRange', async () => { throw Object.assign(new Error('write conflict'), { code: 112 }); });
  await assert.rejects(() => service.clearRange(OWNER, '2026-09-14', '2026-09-20', []), (error) => error.code === 'MEAL_PLAN_ENTRY_STALE');
});
