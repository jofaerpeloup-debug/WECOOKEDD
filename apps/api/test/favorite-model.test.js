const test = require('node:test');
const assert = require('node:assert/strict');

const Favorite = require('../src/modules/favorites/favorite.model');

const USER_ID = '507f1f77bcf86cd799439001';
const RECIPE_ID = '507f1f77bcf86cd799439099';

test('userId and recipeId are required and reference User/Recipe', () => {
  const userIdPath = Favorite.schema.path('userId');
  const recipeIdPath = Favorite.schema.path('recipeId');
  assert.equal(userIdPath.options.ref, 'User');
  assert.equal(userIdPath.options.required, true);
  assert.equal(recipeIdPath.options.ref, 'Recipe');
  assert.equal(recipeIdPath.options.required, true);
});

test('validation fails when userId or recipeId is missing', async () => {
  const missingBoth = new Favorite({});
  await assert.rejects(() => missingBoth.validate(), (err) => {
    assert.ok(err.errors.userId);
    assert.ok(err.errors.recipeId);
    return true;
  });

  const missingRecipe = new Favorite({ userId: USER_ID });
  await assert.rejects(() => missingRecipe.validate());
});

test('a complete document passes validation', async () => {
  const favorite = new Favorite({ userId: USER_ID, recipeId: RECIPE_ID });
  await assert.doesNotReject(() => favorite.validate());
});

test('there is a unique compound index on { userId, recipeId } preventing double-favoriting', () => {
  const index = Favorite.schema.indexes().find(([spec]) => spec.userId === 1 && spec.recipeId === 1);
  assert.ok(index, 'expected a compound index on { userId, recipeId }');
  assert.equal(index[1].unique, true);
});

test('there is a { userId, createdAt } index backing the newest/oldest sort of one user\'s list', () => {
  const index = Favorite.schema
    .indexes()
    .find(([spec]) => spec.userId === 1 && spec.createdAt === -1 && Object.keys(spec).length === 2);
  assert.ok(index, 'expected an index on { userId: 1, createdAt: -1 }');
});

test('timestamps are enabled', () => {
  assert.equal(Favorite.schema.options.timestamps, true);
});

test('the schema has no other persisted fields beyond userId/recipeId/timestamps', () => {
  const paths = Object.keys(Favorite.schema.paths).filter((p) => p !== '_id' && p !== '__v');
  assert.deepEqual(paths.sort(), ['createdAt', 'recipeId', 'updatedAt', 'userId'].sort());
});