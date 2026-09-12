const test = require('node:test');
const assert = require('node:assert/strict');

const {
  recipeReviewParamsSchema,
  reviewParamsSchema,
  listReviewsSchema,
  createReviewSchema,
  patchReviewSchema,
} = require('../src/modules/reviews/review.validation');
const { COMMENT_MAX_LENGTH } = require('../src/modules/reviews/review.model');

const VALID_ID = '507f1f77bcf86cd799439011';
const OTHER_ID = '507f1f77bcf86cd799439022';

test('recipeReviewParamsSchema accepts a valid ObjectId', () => {
  const result = recipeReviewParamsSchema.safeParse({ params: { recipeId: VALID_ID } });
  assert.equal(result.success, true);
});

test('recipeReviewParamsSchema rejects an invalid ObjectId', () => {
  const result = recipeReviewParamsSchema.safeParse({ params: { recipeId: 'not-an-id' } });
  assert.equal(result.success, false);
});

test('reviewParamsSchema accepts a valid ObjectId and rejects a malformed one', () => {
  assert.equal(reviewParamsSchema.safeParse({ params: { reviewId: VALID_ID } }).success, true);
  assert.equal(reviewParamsSchema.safeParse({ params: { reviewId: 'nope' } }).success, false);
});

test('createReviewSchema accepts a rating-only body', () => {
  const result = createReviewSchema.safeParse({ params: { recipeId: VALID_ID }, body: { rating: 4 } });
  assert.equal(result.success, true);
  assert.equal(result.data.body.rating, 4);
});

test('createReviewSchema accepts an optional trimmed comment', () => {
  const result = createReviewSchema.safeParse({
    params: { recipeId: VALID_ID },
    body: { rating: 5, comment: '  So good!  ' },
  });
  assert.equal(result.success, true);
  assert.equal(result.data.body.comment, 'So good!');
});

test('createReviewSchema rejects rating 0', () => {
  const result = createReviewSchema.safeParse({ params: { recipeId: VALID_ID }, body: { rating: 0 } });
  assert.equal(result.success, false);
});

test('createReviewSchema rejects rating 6', () => {
  const result = createReviewSchema.safeParse({ params: { recipeId: VALID_ID }, body: { rating: 6 } });
  assert.equal(result.success, false);
});

test('createReviewSchema rejects a decimal rating', () => {
  const result = createReviewSchema.safeParse({ params: { recipeId: VALID_ID }, body: { rating: 3.5 } });
  assert.equal(result.success, false);
});

test('createReviewSchema rejects a string rating (no silent coercion)', () => {
  const result = createReviewSchema.safeParse({ params: { recipeId: VALID_ID }, body: { rating: '4' } });
  assert.equal(result.success, false);
});

test('createReviewSchema rejects NaN/null ratings', () => {
  assert.equal(
    createReviewSchema.safeParse({ params: { recipeId: VALID_ID }, body: { rating: NaN } }).success,
    false
  );
  assert.equal(
    createReviewSchema.safeParse({ params: { recipeId: VALID_ID }, body: { rating: null } }).success,
    false
  );
});

test('createReviewSchema rejects a missing rating', () => {
  const result = createReviewSchema.safeParse({ params: { recipeId: VALID_ID }, body: {} });
  assert.equal(result.success, false);
});

test('createReviewSchema rejects a comment over the max length', () => {
  const result = createReviewSchema.safeParse({
    params: { recipeId: VALID_ID },
    body: { rating: 4, comment: 'x'.repeat(COMMENT_MAX_LENGTH + 1) },
  });
  assert.equal(result.success, false);
});

test('createReviewSchema accepts a comment at exactly the max length', () => {
  const result = createReviewSchema.safeParse({
    params: { recipeId: VALID_ID },
    body: { rating: 4, comment: 'x'.repeat(COMMENT_MAX_LENGTH) },
  });
  assert.equal(result.success, true);
});

test('createReviewSchema rejects unknown/sensitive fields (mass assignment)', () => {
  const fields = ['userId', 'ownerId', 'recipeId', 'averageRating', 'ratingCount', 'createdAt', 'updatedAt', 'role'];
  for (const field of fields) {
    const result = createReviewSchema.safeParse({
      params: { recipeId: VALID_ID },
      body: { rating: 4, [field]: VALID_ID },
    });
    assert.equal(result.success, false, `expected ${field} to be rejected`);
  }
});

test('patchReviewSchema accepts a rating-only update', () => {
  const result = patchReviewSchema.safeParse({ params: { reviewId: VALID_ID }, body: { rating: 3 } });
  assert.equal(result.success, true);
});

test('patchReviewSchema accepts a comment-only update, including clearing it to empty', () => {
  const result = patchReviewSchema.safeParse({ params: { reviewId: VALID_ID }, body: { comment: '' } });
  assert.equal(result.success, true);
  assert.equal(result.data.body.comment, '');
});

test('patchReviewSchema rejects an empty body', () => {
  const result = patchReviewSchema.safeParse({ params: { reviewId: VALID_ID }, body: {} });
  assert.equal(result.success, false);
});

test('patchReviewSchema rejects rating 0, 6, and decimals', () => {
  assert.equal(patchReviewSchema.safeParse({ params: { reviewId: VALID_ID }, body: { rating: 0 } }).success, false);
  assert.equal(patchReviewSchema.safeParse({ params: { reviewId: VALID_ID }, body: { rating: 6 } }).success, false);
  assert.equal(
    patchReviewSchema.safeParse({ params: { reviewId: VALID_ID }, body: { rating: 2.5 } }).success,
    false
  );
});

test('patchReviewSchema rejects userId/recipeId tampering (ownership/recipe cannot move via PATCH)', () => {
  const fields = ['userId', 'ownerId', 'recipeId', 'averageRating', 'ratingCount'];
  for (const field of fields) {
    const result = patchReviewSchema.safeParse({
      params: { reviewId: VALID_ID },
      body: { rating: 3, [field]: OTHER_ID },
    });
    assert.equal(result.success, false, `expected ${field} to be rejected`);
  }
});

test('listReviewsSchema defaults page/limit/sort when omitted', () => {
  const result = listReviewsSchema.safeParse({ params: { recipeId: VALID_ID }, query: {} });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.query, { page: 1, limit: 20, sort: 'newest' });
});

test('listReviewsSchema accepts sort=oldest and rejects an arbitrary sort value', () => {
  assert.equal(
    listReviewsSchema.safeParse({ params: { recipeId: VALID_ID }, query: { sort: 'oldest' } }).success,
    true
  );
  assert.equal(
    listReviewsSchema.safeParse({ params: { recipeId: VALID_ID }, query: { sort: 'topRated' } }).success,
    false
  );
});

test('listReviewsSchema rejects limit above the max of 100', () => {
  const result = listReviewsSchema.safeParse({ params: { recipeId: VALID_ID }, query: { limit: '101' } });
  assert.equal(result.success, false);
});

test('listReviewsSchema rejects unknown query fields (no arbitrary query passthrough to Mongo)', () => {
  const result = listReviewsSchema.safeParse({
    params: { recipeId: VALID_ID },
    query: { userId: VALID_ID },
  });
  assert.equal(result.success, false);
});
