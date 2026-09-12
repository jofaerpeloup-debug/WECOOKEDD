const test = require('node:test');
const assert = require('node:assert/strict');

const CookHistory = require('../src/modules/cook-history/cook-history.model');

const USER_ID = '507f1f77bcf86cd799439001';
const RECIPE_ID = '507f1f77bcf86cd799439099';

test('userId and recipeId are required and reference User/Recipe', () => {
  const userIdPath = CookHistory.schema.path('userId');
  const recipeIdPath = CookHistory.schema.path('recipeId');
  assert.equal(userIdPath.options.ref, 'User');
  assert.equal(userIdPath.options.required, true);
  assert.equal(recipeIdPath.options.ref, 'Recipe');
  assert.equal(recipeIdPath.options.required, true);
});

test('validation fails when userId or recipeId is missing', async () => {
  const missingBoth = new CookHistory({});
  await assert.rejects(() => missingBoth.validate(), (err) => {
    assert.ok(err.errors.userId);
    assert.ok(err.errors.recipeId);
    return true;
  });

  const missingRecipe = new CookHistory({ userId: USER_ID });
  await assert.rejects(() => missingRecipe.validate());
});

test('a complete document (without servings) passes validation', async () => {
  const entry = new CookHistory({ userId: USER_ID, recipeId: RECIPE_ID });
  await assert.doesNotReject(() => entry.validate());
});

test('completedAt defaults to a server-set Date without being supplied', async () => {
  const entry = new CookHistory({ userId: USER_ID, recipeId: RECIPE_ID });
  await entry.validate();
  assert.ok(entry.completedAt instanceof Date);
  assert.ok(!Number.isNaN(entry.completedAt.getTime()));
});

test('servings is optional, but when present must be a whole number within bounds', async () => {
  const withServings = new CookHistory({ userId: USER_ID, recipeId: RECIPE_ID, servings: 4 });
  await assert.doesNotReject(() => withServings.validate());

  const zero = new CookHistory({ userId: USER_ID, recipeId: RECIPE_ID, servings: 0 });
  await assert.rejects(() => zero.validate());

  const negative = new CookHistory({ userId: USER_ID, recipeId: RECIPE_ID, servings: -2 });
  await assert.rejects(() => negative.validate());

  const decimal = new CookHistory({ userId: USER_ID, recipeId: RECIPE_ID, servings: 2.5 });
  await assert.rejects(() => decimal.validate());

  const tooLarge = new CookHistory({ userId: USER_ID, recipeId: RECIPE_ID, servings: 101 });
  await assert.rejects(() => tooLarge.validate());
});

test('a user may cook the same recipe more than once — no unique constraint on { userId, recipeId }', () => {
  const index = CookHistory.schema
    .indexes()
    .find(([spec]) => spec.userId === 1 && spec.recipeId === 1);
  assert.ok(index, 'expected an index on { userId: 1, recipeId: 1 }');
  assert.notEqual(index[1] && index[1].unique, true);
});

test('there is a { userId, completedAt } index backing the newest/oldest history list', () => {
  const index = CookHistory.schema
    .indexes()
    .find(([spec]) => spec.userId === 1 && spec.completedAt === -1);
  assert.ok(index, 'expected an index on { userId: 1, completedAt: -1 }');
});

test('timestamps are enabled', () => {
  assert.equal(CookHistory.schema.options.timestamps, true);
});

test('the schema has no fields beyond userId/recipeId/servings/completedAt/timestamps', () => {
  const paths = Object.keys(CookHistory.schema.paths).filter((p) => p !== '_id' && p !== '__v');
  assert.deepEqual(
    paths.sort(),
    ['completedAt', 'createdAt', 'recipeId', 'servings', 'updatedAt', 'userId'].sort()
  );
});
