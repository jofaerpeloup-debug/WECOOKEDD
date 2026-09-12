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
