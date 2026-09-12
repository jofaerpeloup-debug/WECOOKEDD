const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collectionParamsSchema,
  collectionRecipeParamsSchema,
  createCollectionSchema,
  patchCollectionSchema,
  listCollectionRecipesSchema,
  addCollectionRecipeSchema,
} = require('../src/modules/collections/collection.validation');
const { NAME_MAX_LENGTH, DESCRIPTION_MAX_LENGTH } = require('../src/modules/collections/collection.model');

const VALID_ID = '507f1f77bcf86cd799439011';
const OTHER_ID = '507f1f77bcf86cd799439022';

test('collectionParamsSchema accepts a valid ObjectId', () => {
  const result = collectionParamsSchema.safeParse({ params: { collectionId: VALID_ID } });
  assert.equal(result.success, true);
});

test('collectionParamsSchema rejects an invalid ObjectId', () => {
  const result = collectionParamsSchema.safeParse({ params: { collectionId: 'not-an-id' } });
  assert.equal(result.success, false);
});

test('collectionParamsSchema rejects unknown params fields', () => {
  const result = collectionParamsSchema.safeParse({
    params: { collectionId: VALID_ID, userId: VALID_ID },
  });
  assert.equal(result.success, false);
});

test('collectionRecipeParamsSchema accepts two valid ObjectIds', () => {
  const result = collectionRecipeParamsSchema.safeParse({
    params: { collectionId: VALID_ID, recipeId: OTHER_ID },
  });
  assert.equal(result.success, true);
});

test('collectionRecipeParamsSchema rejects a malformed recipeId', () => {
  const result = collectionRecipeParamsSchema.safeParse({
    params: { collectionId: VALID_ID, recipeId: 'nope' },
  });
  assert.equal(result.success, false);
});

test('createCollectionSchema accepts a name-only body', () => {
  const result = createCollectionSchema.safeParse({ body: { name: 'My Weeknight Meals' } });
  assert.equal(result.success, true);
  assert.equal(result.data.body.name, 'My Weeknight Meals');
});

test('createCollectionSchema accepts an optional trimmed description', () => {
  const result = createCollectionSchema.safeParse({
    body: { name: 'Family Favorites', description: '  comfort food  ' },
  });
  assert.equal(result.success, true);
  assert.equal(result.data.body.description, 'comfort food');
});

test('createCollectionSchema rejects an empty/whitespace-only name', () => {
  const empty = createCollectionSchema.safeParse({ body: { name: '' } });
  assert.equal(empty.success, false);
  const whitespace = createCollectionSchema.safeParse({ body: { name: '   ' } });
  assert.equal(whitespace.success, false);
});

test('createCollectionSchema rejects a name over the max length', () => {
  const result = createCollectionSchema.safeParse({ body: { name: 'x'.repeat(NAME_MAX_LENGTH + 1) } });
  assert.equal(result.success, false);
});

test('createCollectionSchema accepts a name at exactly the max length', () => {
  const result = createCollectionSchema.safeParse({ body: { name: 'x'.repeat(NAME_MAX_LENGTH) } });
  assert.equal(result.success, true);
});

test('createCollectionSchema rejects a description over the max length', () => {
  const result = createCollectionSchema.safeParse({
    body: { name: 'Valid', description: 'x'.repeat(DESCRIPTION_MAX_LENGTH + 1) },
  });
  assert.equal(result.success, false);
});

test('createCollectionSchema rejects an unknown/sensitive field (userId, ownerId, mass assignment)', () => {
  const withUserId = createCollectionSchema.safeParse({ body: { name: 'Valid', userId: VALID_ID } });
  assert.equal(withUserId.success, false);
  const withOwnerId = createCollectionSchema.safeParse({ body: { name: 'Valid', ownerId: VALID_ID } });
  assert.equal(withOwnerId.success, false);
  const withRole = createCollectionSchema.safeParse({ body: { name: 'Valid', role: 'admin' } });
  assert.equal(withRole.success, false);
  const withRecipeIds = createCollectionSchema.safeParse({ body: { name: 'Valid', recipeIds: [VALID_ID] } });
  assert.equal(withRecipeIds.success, false);
});

test('patchCollectionSchema accepts a partial update of name only', () => {
  const result = patchCollectionSchema.safeParse({
    params: { collectionId: VALID_ID },
    body: { name: 'Renamed' },
  });
  assert.equal(result.success, true);
});

test('patchCollectionSchema accepts a partial update of description only', () => {
  const result = patchCollectionSchema.safeParse({
    params: { collectionId: VALID_ID },
    body: { description: 'Updated description' },
  });
  assert.equal(result.success, true);
});

test('patchCollectionSchema rejects an empty body', () => {
  const result = patchCollectionSchema.safeParse({ params: { collectionId: VALID_ID }, body: {} });
  assert.equal(result.success, false);
});

test('patchCollectionSchema rejects userId/ownerId/createdAt/recipeIds tampering', () => {
  const fields = ['userId', 'ownerId', 'createdAt', 'updatedAt', 'recipeIds', 'role'];
  for (const field of fields) {
    const result = patchCollectionSchema.safeParse({
      params: { collectionId: VALID_ID },
      body: { name: 'Valid', [field]: field === 'recipeIds' ? [VALID_ID] : VALID_ID },
    });
    assert.equal(result.success, false, `expected ${field} to be rejected`);
  }
});

test('listCollectionRecipesSchema defaults page/limit/sort when omitted', () => {
  const result = listCollectionRecipesSchema.safeParse({
    params: { collectionId: VALID_ID },
    query: {},
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.query, { page: 1, limit: 20, sort: 'newest' });
});

test('listCollectionRecipesSchema rejects limit above the max of 100', () => {
  const result = listCollectionRecipesSchema.safeParse({
    params: { collectionId: VALID_ID },
    query: { limit: '101' },
  });
  assert.equal(result.success, false);
});

test('listCollectionRecipesSchema rejects unknown query fields', () => {
  const result = listCollectionRecipesSchema.safeParse({
    params: { collectionId: VALID_ID },
    query: { userId: VALID_ID },
  });
  assert.equal(result.success, false);
});

test('addCollectionRecipeSchema accepts a recipeId-only body', () => {
  const result = addCollectionRecipeSchema.safeParse({
    params: { collectionId: VALID_ID },
    body: { recipeId: OTHER_ID },
  });
  assert.equal(result.success, true);
});

test('addCollectionRecipeSchema rejects an invalid recipeId', () => {
  const result = addCollectionRecipeSchema.safeParse({
    params: { collectionId: VALID_ID },
    body: { recipeId: 'not-an-id' },
  });
  assert.equal(result.success, false);
});

test('addCollectionRecipeSchema rejects userId/ownerId tampering in the body', () => {
  const result = addCollectionRecipeSchema.safeParse({
    params: { collectionId: VALID_ID },
    body: { recipeId: OTHER_ID, userId: VALID_ID, ownerId: VALID_ID },
  });
  assert.equal(result.success, false);
});
