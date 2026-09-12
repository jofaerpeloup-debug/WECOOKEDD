const test = require('node:test');
const assert = require('node:assert/strict');

const Review = require('../src/modules/reviews/review.model');

const USER_ID = '507f1f77bcf86cd799439001';
const RECIPE_ID = '507f1f77bcf86cd799439099';

test('userId and recipeId are required and reference User/Recipe', () => {
  const userIdPath = Review.schema.path('userId');
  const recipeIdPath = Review.schema.path('recipeId');
  assert.equal(userIdPath.options.ref, 'User');
  assert.equal(userIdPath.options.required, true);
  assert.equal(recipeIdPath.options.ref, 'Recipe');
  assert.equal(recipeIdPath.options.required, true);
});

test('rating is required, bounded 1-5', () => {
  const ratingPath = Review.schema.path('rating');
  assert.equal(ratingPath.options.required, true);
  assert.equal(ratingPath.options.min, 1);
  assert.equal(ratingPath.options.max, 5);
});

test('comment is optional, trimmed, and bounded', () => {
  const commentPath = Review.schema.path('comment');
  assert.equal(!!commentPath.options.required, false);
  assert.equal(commentPath.options.trim, true);
  assert.equal(commentPath.options.maxlength, Review.COMMENT_MAX_LENGTH);
});

test('validation fails when userId, recipeId, or rating is missing', async () => {
  const missingAll = new Review({});
  await assert.rejects(() => missingAll.validate(), (err) => {
    assert.ok(err.errors.userId);
    assert.ok(err.errors.recipeId);
    assert.ok(err.errors.rating);
    return true;
  });
});

test('validation fails for rating 0', async () => {
  const review = new Review({ userId: USER_ID, recipeId: RECIPE_ID, rating: 0 });
  await assert.rejects(() => review.validate());
});

test('validation fails for rating 6', async () => {
  const review = new Review({ userId: USER_ID, recipeId: RECIPE_ID, rating: 6 });
  await assert.rejects(() => review.validate());
});

test('validation fails for a decimal rating', async () => {
  const review = new Review({ userId: USER_ID, recipeId: RECIPE_ID, rating: 3.5 });
  await assert.rejects(() => review.validate());
});

test('a complete document passes validation', async () => {
  const review = new Review({ userId: USER_ID, recipeId: RECIPE_ID, rating: 5 });
  await assert.doesNotReject(() => review.validate());
});

test('a document with a comment passes validation', async () => {
  const review = new Review({ userId: USER_ID, recipeId: RECIPE_ID, rating: 4, comment: 'Great recipe!' });
  await assert.doesNotReject(() => review.validate());
});

test('a comment over the max length fails validation', async () => {
  const review = new Review({
    userId: USER_ID,
    recipeId: RECIPE_ID,
    rating: 4,
    comment: 'x'.repeat(Review.COMMENT_MAX_LENGTH + 1),
  });
  await assert.rejects(() => review.validate());
});

test('there is a unique compound index on { userId, recipeId } preventing double-reviewing', () => {
  const index = Review.schema.indexes().find(([spec]) => spec.userId === 1 && spec.recipeId === 1);
  assert.ok(index, 'expected a compound index on { userId, recipeId }');
  assert.equal(index[1].unique, true);
});

test('there is a { recipeId, createdAt } index backing the per-recipe review list/aggregate', () => {
  const index = Review.schema
    .indexes()
    .find(([spec]) => spec.recipeId === 1 && spec.createdAt === -1 && Object.keys(spec).length === 2);
  assert.ok(index, 'expected an index on { recipeId: 1, createdAt: -1 }');
});

test('timestamps are enabled', () => {
  assert.equal(Review.schema.options.timestamps, true);
});

test('the schema has no other persisted fields beyond userId/recipeId/rating/comment/timestamps', () => {
  const paths = Object.keys(Review.schema.paths).filter((p) => p !== '_id' && p !== '__v');
  assert.deepEqual(
    paths.sort(),
    ['comment', 'createdAt', 'rating', 'recipeId', 'updatedAt', 'userId'].sort()
  );
});

test('the schema never persists averageRating/ratingCount (computed only, never stored)', () => {
  const paths = Object.keys(Review.schema.paths);
  assert.equal(paths.includes('averageRating'), false);
  assert.equal(paths.includes('ratingCount'), false);
});
