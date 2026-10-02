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

const USER_ID = '507f1f77bcf86cd799439001';
const RECIPE_ID = '507f1f77bcf86cd799439099';
const ENTRY_ID = '507f1f77bcf86cd799439077';
const UPDATED_AT = '2026-09-14T08:30:00.000Z';

test('create validates recipe eligibility through RecipeService and derives ownership from its argument', async (t) => {
  const recipe = { _id: RECIPE_ID, title: 'Adobo' };
  t.mock.method(recipeService, 'findUsableRecipeById', async () => recipe);
  let persisted;
  t.mock.method(repository, 'create', async (data) => { persisted = data; return { _id: 'entry', ...data }; });
  const result = await service.createEntry(USER_ID, { dateKey: '2026-09-14', recipeId: RECIPE_ID });
  assert.deepEqual(persisted, { userId: USER_ID, dateKey: '2026-09-14', recipeId: RECIPE_ID });
  assert.equal(result.recipe, recipe);
});

test('create rejects missing and archived/unusable recipes identically', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => null);
  await assert.rejects(() => service.createEntry(USER_ID, { dateKey: '2026-09-14', recipeId: RECIPE_ID }), (err) => err.code === 'RECIPE_NOT_FOUND' && err.statusCode === 404);
});

test('duplicate-key races become a clean meal-plan conflict', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => ({ _id: RECIPE_ID }));
  t.mock.method(repository, 'create', async () => { const err = new Error('E11000 private details'); err.code = 11000; throw err; });
  await assert.rejects(() => service.createEntry(USER_ID, { dateKey: '2026-09-14', recipeId: RECIPE_ID }), (err) => err.code === 'MEAL_PLAN_ENTRY_ALREADY_EXISTS' && !err.message.includes('E11000'));
});

test('range reads retain unavailable entries with a null recipe', async (t) => {
  t.mock.method(repository, 'findByUserAndRange', async () => [
    { _id: 'one', recipeId: RECIPE_ID, dateKey: '2026-09-14' },
    { _id: 'two', recipeId: '507f1f77bcf86cd799439088', dateKey: '2026-09-14' },
  ]);
  t.mock.method(recipeService, 'findUsableRecipeById', async (id) => id === RECIPE_ID ? { _id: id } : null);
  const items = await service.listEntries(USER_ID, '2026-09-14', '2026-09-20');
  assert.equal(items.length, 2);
  assert.equal(items[1].recipe, null);
});

test('move preserves the returned entry identity and allows an unavailable recipe', async (t) => {
  const createdAt = new Date('2026-09-01T00:00:00.000Z');
  const moved = {
    _id: ENTRY_ID,
    userId: USER_ID,
    recipeId: RECIPE_ID,
    dateKey: '2026-09-16',
    createdAt,
    updatedAt: new Date('2026-09-14T08:31:00.000Z'),
  };
  let args;
  t.mock.method(repository, 'moveByIdAndUser', async (...value) => { args = value; return moved; });
  t.mock.method(recipeService, 'findUsableRecipeById', async () => null);
  const result = await service.moveEntry(USER_ID, ENTRY_ID, {
    dateKey: '2026-09-16',
    expectedUpdatedAt: UPDATED_AT,
  });
  assert.deepEqual(args, [ENTRY_ID, USER_ID, '2026-09-16', UPDATED_AT]);
  assert.equal(result.entry._id, ENTRY_ID);
  assert.equal(result.entry.recipeId, RECIPE_ID);
  assert.equal(result.entry.createdAt, createdAt);
  assert.notEqual(result.entry.updatedAt.toISOString(), UPDATED_AT);
  assert.equal(result.recipe, null);
});

test('move classifies an owner version mismatch as stale without retrying', async (t) => {
  let moveCalls = 0;
  t.mock.method(repository, 'moveByIdAndUser', async () => { moveCalls += 1; return null; });
  t.mock.method(repository, 'findByIdAndUser', async () => ({ _id: ENTRY_ID, userId: USER_ID }));
  await assert.rejects(
    () => service.moveEntry(USER_ID, ENTRY_ID, { dateKey: '2026-09-16', expectedUpdatedAt: UPDATED_AT }),
    (err) => err.code === 'MEAL_PLAN_ENTRY_STALE' && err.statusCode === 409
  );
  assert.equal(moveCalls, 1);
});

test('same-date move returns the exact current owner entry without a second mutation or timestamp churn', async (t) => {
  const current = {
    _id: ENTRY_ID,
    userId: USER_ID,
    recipeId: RECIPE_ID,
    dateKey: '2026-09-14',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date(UPDATED_AT),
  };
  const moveCall = t.mock.method(repository, 'moveByIdAndUser', async () => null);
  const findCall = t.mock.method(repository, 'findByIdAndUser', async () => current);
  t.mock.method(recipeService, 'findUsableRecipeById', async () => null);

  const result = await service.moveEntry(USER_ID, ENTRY_ID, {
    dateKey: current.dateKey,
    expectedUpdatedAt: UPDATED_AT,
  });

  assert.equal(moveCall.mock.callCount(), 1);
  assert.equal(findCall.mock.callCount(), 1);
  assert.equal(result.entry, current);
  assert.equal(result.entry._id, ENTRY_ID);
  assert.equal(result.entry.recipeId, RECIPE_ID);
  assert.equal(result.entry.createdAt.toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(result.entry.updatedAt.toISOString(), UPDATED_AT);
});

test('same-date move still rejects a stale expectedUpdatedAt', async (t) => {
  t.mock.method(repository, 'moveByIdAndUser', async () => null);
  t.mock.method(repository, 'findByIdAndUser', async () => ({
    _id: ENTRY_ID,
    userId: USER_ID,
    dateKey: '2026-09-14',
    updatedAt: new Date('2026-09-14T09:00:00.000Z'),
  }));

  await assert.rejects(
    () => service.moveEntry(USER_ID, ENTRY_ID, { dateKey: '2026-09-14', expectedUpdatedAt: UPDATED_AT }),
    (err) => err.code === 'MEAL_PLAN_ENTRY_STALE' && err.statusCode === 409
  );
});

test('move hides absent, foreign, and concurrently deleted entries behind the same 404', async (t) => {
  t.mock.method(repository, 'moveByIdAndUser', async () => null);
  t.mock.method(repository, 'findByIdAndUser', async () => null);
  await assert.rejects(
    () => service.moveEntry(USER_ID, ENTRY_ID, { dateKey: '2026-09-16', expectedUpdatedAt: UPDATED_AT }),
    (err) => err.code === 'MEAL_PLAN_ENTRY_NOT_FOUND' && err.statusCode === 404
  );
});

test('move maps the atomic duplicate race without a delete, recreate, or eligibility check', async (t) => {
  const moveCall = t.mock.method(repository, 'moveByIdAndUser', async () => { const err = new Error('private duplicate'); err.code = 11000; throw err; });
  const createCall = t.mock.method(repository, 'create', async () => { throw new Error('must not create'); });
  const deleteCall = t.mock.method(repository, 'deleteByIdAndUser', async () => { throw new Error('must not delete'); });
  const classifyCall = t.mock.method(repository, 'findByIdAndUser', async () => { throw new Error('must not classify duplicate'); });
  const recipeLookup = t.mock.method(recipeService, 'findUsableRecipeById', async () => ({ _id: RECIPE_ID }));
  await assert.rejects(
    () => service.moveEntry(USER_ID, ENTRY_ID, { dateKey: '2026-09-16', expectedUpdatedAt: UPDATED_AT }),
    (err) => err.code === 'MEAL_PLAN_ENTRY_ALREADY_EXISTS' && err.statusCode === 409 && !err.message.includes('private')
  );
  assert.equal(moveCall.mock.callCount(), 1);
  assert.equal(createCall.mock.callCount(), 0);
  assert.equal(deleteCall.mock.callCount(), 0);
  assert.equal(classifyCall.mock.callCount(), 0);
  assert.equal(recipeLookup.mock.callCount(), 0);
});

test('remove uses owner-scoped repository deletion and hides foreign entries as not found', async (t) => {
  let args;
  t.mock.method(repository, 'deleteByIdAndUser', async (...value) => { args = value; return null; });
  await assert.rejects(() => service.removeEntry(USER_ID, 'entry'), (err) => err.code === 'MEAL_PLAN_ENTRY_NOT_FOUND');
  assert.deepEqual(args, ['entry', USER_ID]);
});

test('clear reports the repository deleted count for only the supplied owner/range', async (t) => {
  let args;
  t.mock.method(repository, 'deleteByUserAndRange', async (...value) => { args = value; return { deletedCount: 3 }; });
  assert.deepEqual(await service.clearRange(USER_ID, '2026-09-14', '2026-09-20'), { deletedCount: 3 });
  assert.deepEqual(args, [USER_ID, '2026-09-14', '2026-09-20']);
});
