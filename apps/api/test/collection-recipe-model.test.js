const test = require('node:test');
const assert = require('node:assert/strict');

const CollectionRecipe = require('../src/modules/collections/collection-recipe.model');

const COLLECTION_ID = '507f1f77bcf86cd799439002';
const RECIPE_ID = '507f1f77bcf86cd799439099';

test('collectionId and recipeId are required and reference Collection/Recipe', () => {
  const collectionIdPath = CollectionRecipe.schema.path('collectionId');
  const recipeIdPath = CollectionRecipe.schema.path('recipeId');
  assert.equal(collectionIdPath.options.ref, 'Collection');
  assert.equal(collectionIdPath.options.required, true);
  assert.equal(recipeIdPath.options.ref, 'Recipe');
  assert.equal(recipeIdPath.options.required, true);
});

test('validation fails when collectionId or recipeId is missing', async () => {
  const missingBoth = new CollectionRecipe({});
  await assert.rejects(() => missingBoth.validate(), (err) => {
    assert.ok(err.errors.collectionId);
    assert.ok(err.errors.recipeId);
    return true;
  });
});

test('a complete document passes validation', async () => {
  const membership = new CollectionRecipe({ collectionId: COLLECTION_ID, recipeId: RECIPE_ID });
  await assert.doesNotReject(() => membership.validate());
});

test('there is a unique compound index on { collectionId, recipeId } preventing duplicate membership', () => {
  const index = CollectionRecipe.schema
    .indexes()
    .find(([spec]) => spec.collectionId === 1 && spec.recipeId === 1);
  assert.ok(index, 'expected a compound index on { collectionId, recipeId }');
  assert.equal(index[1].unique, true);
});

test('there is a { collectionId, createdAt } index backing sort + cover-image lookups', () => {
  const index = CollectionRecipe.schema
    .indexes()
    .find(([spec]) => spec.collectionId === 1 && spec.createdAt === -1 && Object.keys(spec).length === 2);
  assert.ok(index, 'expected an index on { collectionId: 1, createdAt: -1 }');
});

test('timestamps are enabled', () => {
  assert.equal(CollectionRecipe.schema.options.timestamps, true);
});

test('the schema has no other persisted fields beyond collectionId/recipeId/timestamps', () => {
  const paths = Object.keys(CollectionRecipe.schema.paths).filter((p) => p !== '_id' && p !== '__v');
  assert.deepEqual(paths.sort(), ['collectionId', 'createdAt', 'recipeId', 'updatedAt'].sort());
});
