const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createCookHistorySchema,
  listCookHistorySchema,
  cookHistoryStatsSchema,
  cookHistoryRecipeStatusSchema,
} = require('../src/modules/cook-history/cook-history.validation');

const VALID_ID = '507f1f77bcf86cd799439011';

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

test('createCookHistorySchema accepts a bare recipeId with no servings', () => {
  const result = createCookHistorySchema.safeParse({ body: { recipeId: VALID_ID } });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.body, { recipeId: VALID_ID });
});

test('createCookHistorySchema accepts recipeId + a valid integer servings', () => {
  const result = createCookHistorySchema.safeParse({ body: { recipeId: VALID_ID, servings: 4 } });
  assert.equal(result.success, true);
  assert.equal(result.data.body.servings, 4);
});

test('createCookHistorySchema rejects an invalid recipeId', () => {
  const result = createCookHistorySchema.safeParse({ body: { recipeId: 'not-an-id' } });
  assert.equal(result.success, false);
});

test('createCookHistorySchema requires recipeId', () => {
  const result = createCookHistorySchema.safeParse({ body: {} });
  assert.equal(result.success, false);
});

test('createCookHistorySchema rejects a string servings ("4") — never coerced', () => {
  const result = createCookHistorySchema.safeParse({ body: { recipeId: VALID_ID, servings: '4' } });
  assert.equal(result.success, false);
});

test('createCookHistorySchema rejects a decimal servings', () => {
  const result = createCookHistorySchema.safeParse({ body: { recipeId: VALID_ID, servings: 2.5 } });
  assert.equal(result.success, false);
});

test('createCookHistorySchema rejects zero and negative servings', () => {
  assert.equal(createCookHistorySchema.safeParse({ body: { recipeId: VALID_ID, servings: 0 } }).success, false);
  assert.equal(createCookHistorySchema.safeParse({ body: { recipeId: VALID_ID, servings: -1 } }).success, false);
});

test('createCookHistorySchema rejects an unreasonably large servings', () => {
  const result = createCookHistorySchema.safeParse({ body: { recipeId: VALID_ID, servings: 100000 } });
  assert.equal(result.success, false);
});

test('createCookHistorySchema rejects a client-supplied userId/ownerId (mass assignment)', () => {
  const withUserId = createCookHistorySchema.safeParse({
    body: { recipeId: VALID_ID, userId: VALID_ID },
  });
  assert.equal(withUserId.success, false);

  const withOwnerId = createCookHistorySchema.safeParse({
    body: { recipeId: VALID_ID, ownerId: VALID_ID },
  });
  assert.equal(withOwnerId.success, false);
});

test('createCookHistorySchema rejects a client-supplied completedAt/createdAt/updatedAt', () => {
  for (const field of ['completedAt', 'createdAt', 'updatedAt']) {
    const result = createCookHistorySchema.safeParse({
      body: { recipeId: VALID_ID, [field]: new Date().toISOString() },
    });
    assert.equal(result.success, false, `expected ${field} to be rejected`);
  }
});

test('createCookHistorySchema rejects a client-supplied role', () => {
  const result = createCookHistorySchema.safeParse({ body: { recipeId: VALID_ID, role: 'admin' } });
  assert.equal(result.success, false);
});

test('createCookHistorySchema rejects a fabricated recipe snapshot (recipeTitle/recipeImage)', () => {
  const result = createCookHistorySchema.safeParse({
    body: { recipeId: VALID_ID, recipeTitle: 'Adobo', recipeImage: 'https://example.com/x.jpg' },
  });
  assert.equal(result.success, false);
});

test('createCookHistorySchema rejects any other unknown field', () => {
  const result = createCookHistorySchema.safeParse({ body: { recipeId: VALID_ID, notes: 'delicious' } });
  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// LIST
// ---------------------------------------------------------------------------

test('listCookHistorySchema defaults page/limit/sort when omitted', () => {
  const result = listCookHistorySchema.safeParse({ query: {} });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.query, { page: 1, limit: 20, sort: 'newest' });
});

test('listCookHistorySchema accepts sort=oldest and coerces page/limit', () => {
  const result = listCookHistorySchema.safeParse({ query: { page: '2', limit: '5', sort: 'oldest' } });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.query, { page: 2, limit: 5, sort: 'oldest' });
});

test('listCookHistorySchema rejects an invalid sort value', () => {
  const result = listCookHistorySchema.safeParse({ query: { sort: 'byRating' } });
  assert.equal(result.success, false);
});

test('listCookHistorySchema rejects limit above the max of 100', () => {
  const result = listCookHistorySchema.safeParse({ query: { limit: '101' } });
  assert.equal(result.success, false);
});

test('listCookHistorySchema rejects page below 1', () => {
  const result = listCookHistorySchema.safeParse({ query: { page: '0' } });
  assert.equal(result.success, false);
});

test('listCookHistorySchema rejects a client-supplied userId query param', () => {
  const result = listCookHistorySchema.safeParse({ query: { userId: VALID_ID } });
  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// STATS
// ---------------------------------------------------------------------------

test('cookHistoryStatsSchema accepts an empty query', () => {
  const result = cookHistoryStatsSchema.safeParse({ query: {} });
  assert.equal(result.success, true);
});

test('cookHistoryStatsSchema rejects any query field, including userId', () => {
  const result = cookHistoryStatsSchema.safeParse({ query: { userId: VALID_ID } });
  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// RECIPE STATUS
// ---------------------------------------------------------------------------

test('cookHistoryRecipeStatusSchema accepts a valid recipeId with an empty query', () => {
  const result = cookHistoryRecipeStatusSchema.safeParse({ params: { recipeId: VALID_ID }, query: {} });
  assert.equal(result.success, true);
});

test('cookHistoryRecipeStatusSchema rejects an invalid recipeId', () => {
  const result = cookHistoryRecipeStatusSchema.safeParse({ params: { recipeId: 'not-an-id' }, query: {} });
  assert.equal(result.success, false);
});

test('cookHistoryRecipeStatusSchema rejects a client-supplied userId in params or query', () => {
  const inParams = cookHistoryRecipeStatusSchema.safeParse({
    params: { recipeId: VALID_ID, userId: VALID_ID },
    query: {},
  });
  assert.equal(inParams.success, false);

  const inQuery = cookHistoryRecipeStatusSchema.safeParse({
    params: { recipeId: VALID_ID },
    query: { userId: VALID_ID },
  });
  assert.equal(inQuery.success, false);
});
