const test = require('node:test');
const assert = require('node:assert/strict');

const { favoriteParamsSchema, listFavoritesSchema } = require('../src/modules/favorites/favorite.validation');

const VALID_ID = '507f1f77bcf86cd799439011';

test('favoriteParamsSchema accepts a valid ObjectId', () => {
  const result = favoriteParamsSchema.safeParse({ params: { recipeId: VALID_ID } });
  assert.equal(result.success, true);
});

test('favoriteParamsSchema rejects an invalid ObjectId', () => {
  const result = favoriteParamsSchema.safeParse({ params: { recipeId: 'not-an-id' } });
  assert.equal(result.success, false);
});

test('favoriteParamsSchema rejects unknown params fields', () => {
  const result = favoriteParamsSchema.safeParse({ params: { recipeId: VALID_ID, userId: VALID_ID } });
  assert.equal(result.success, false);
});

test('listFavoritesSchema defaults page/limit/sort when omitted', () => {
  const result = listFavoritesSchema.safeParse({ query: {} });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.query, { page: 1, limit: 20, sort: 'newest' });
});

test('listFavoritesSchema accepts sort=oldest and coerces page/limit', () => {
  const result = listFavoritesSchema.safeParse({ query: { page: '2', limit: '5', sort: 'oldest' } });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.query, { page: 2, limit: 5, sort: 'oldest' });
});

test('listFavoritesSchema rejects an invalid sort value', () => {
  const result = listFavoritesSchema.safeParse({ query: { sort: 'titleAsc' } });
  assert.equal(result.success, false);
});

test('listFavoritesSchema rejects limit above the max of 100', () => {
  const result = listFavoritesSchema.safeParse({ query: { limit: '101' } });
  assert.equal(result.success, false);
});

test('listFavoritesSchema rejects page below 1', () => {
  const result = listFavoritesSchema.safeParse({ query: { page: '0' } });
  assert.equal(result.success, false);
});

test('listFavoritesSchema rejects unknown query fields', () => {
  const result = listFavoritesSchema.safeParse({ query: { userId: VALID_ID } });
  assert.equal(result.success, false);
});