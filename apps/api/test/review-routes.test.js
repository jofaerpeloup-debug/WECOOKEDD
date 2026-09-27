process.env.NODE_ENV = 'test';
process.env.PORT = '4036';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createApp } = require('../src/app');
const userRepository = require('../src/modules/users/user.repository');
const sessionRepository = require('../src/modules/sessions/session.repository');
const recipeRepository = require('../src/modules/recipes/recipe.repository');
const reviewRepository = require('../src/modules/reviews/review.repository');
const cookHistoryRepository = require('../src/modules/cook-history/cook-history.repository');
const { signAccessToken } = require('../src/shared/security/access-token');

const app = createApp();

const USER_ID = '507f1f77bcf86cd799439003';
const USER_SESSION_ID = '507f1f77bcf86cd799439004';
const OTHER_USER_ID = '507f1f77bcf86cd799439005';
const OTHER_SESSION_ID = '507f1f77bcf86cd799439006';
const CHICKEN_ID = '507f1f77bcf86cd799439011';
const RECIPE_ID = '507f1f77bcf86cd799439099';
const REVIEW_ID = '507f1f77bcf86cd799439033';

function activeIngredient(id, name = 'Ingredient') {
  return { _id: id, name, isActive: true };
}

function fakeRecipeDoc(overrides = {}) {
  return {
    _id: RECIPE_ID,
    title: 'Chicken Adobo',
    description: 'A complete Filipino braised chicken recipe.',
    region: 'central-luzon',
    category: 'main-dish',
    difficulty: 'easy',
    prepTimeMinutes: 15,
    cookTimeMinutes: 40,
    servings: 4,
    ingredients: [{ ingredientId: activeIngredient(CHICKEN_ID, 'Chicken'), quantity: 1, unit: 'kg', optional: false }],
    instructions: ['Combine and simmer.'],
    dietaryTags: [],
    imageUrl: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeReviewDoc(overrides = {}) {
  return {
    _id: REVIEW_ID,
    userId: USER_ID,
    recipeId: RECIPE_ID,
    rating: 4,
    comment: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function mockAuth(t, { id, role = 'user', sessionId }) {
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: sessionId,
    userId: id,
    revokedAt: null,
  }));
  t.mock.method(userRepository, 'findById', async () => ({ _id: id, name: 'Kirby', role, status: 'active' }));
}

function tokenFor({ id, role = 'user', sessionId }) {
  return signAccessToken({ userId: id, role, sessionId });
}

function authHeader(t, identity) {
  mockAuth(t, identity);
  return `Bearer ${tokenFor(identity)}`;
}

function mockRecipeUsable(t, overrides = {}) {
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => fakeRecipeDoc(overrides));
}

// ---------------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------------

test('GET /api/v1/recipes/:recipeId/reviews without a token is rejected', async () => {
  const response = await request(app).get(`/api/v1/recipes/${RECIPE_ID}/reviews`);
  assert.equal(response.status, 401);
});

test('POST /api/v1/recipes/:recipeId/reviews without a token is rejected', async () => {
  const response = await request(app).post(`/api/v1/recipes/${RECIPE_ID}/reviews`).send({ rating: 5 });
  assert.equal(response.status, 401);
});

test('PATCH /api/v1/reviews/:reviewId without a token is rejected', async () => {
  const response = await request(app).patch(`/api/v1/reviews/${REVIEW_ID}`).send({ rating: 5 });
  assert.equal(response.status, 401);
});

test('DELETE /api/v1/reviews/:reviewId without a token is rejected', async () => {
  const response = await request(app).delete(`/api/v1/reviews/${REVIEW_ID}`);
  assert.equal(response.status, 401);
});

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

test('POST /api/v1/recipes/:recipeId/reviews creates a review for the authenticated user', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  mockRecipeUsable(t);
  t.mock.method(reviewRepository, 'findOneByUserAndRecipe', async () => null);
  t.mock.method(cookHistoryRepository, 'existsForUserAndRecipe', async (userId, recipeId) => (
    userId === USER_ID && String(recipeId) === RECIPE_ID
  ));
  let capturedDoc;
  t.mock.method(reviewRepository, 'create', async (doc) => {
    capturedDoc = doc;
    return fakeReviewDoc({ ...doc });
  });

  const response = await request(app)
    .post(`/api/v1/recipes/${RECIPE_ID}/reviews`)
    .set('Authorization', auth)
    .send({ rating: 5, comment: 'Amazing!' });

  assert.equal(response.status, 201);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.review.rating, 5);
  assert.equal(response.body.data.review.comment, 'Amazing!');
  assert.equal(response.body.data.review.author.name, 'Kirby');
  assert.equal(capturedDoc.userId, USER_ID);
});

test('POST /api/v1/recipes/:recipeId/reviews rejects a client-supplied userId (mass assignment)', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .post(`/api/v1/recipes/${RECIPE_ID}/reviews`)
    .set('Authorization', auth)
    .send({ rating: 5, userId: OTHER_USER_ID });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/recipes/:recipeId/reviews rejects rating 0', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .post(`/api/v1/recipes/${RECIPE_ID}/reviews`)
    .set('Authorization', auth)
    .send({ rating: 0 });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/recipes/:recipeId/reviews rejects rating 6', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .post(`/api/v1/recipes/${RECIPE_ID}/reviews`)
    .set('Authorization', auth)
    .send({ rating: 6 });

  assert.equal(response.status, 400);
});

test('POST /api/v1/recipes/:recipeId/reviews rejects a decimal rating', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .post(`/api/v1/recipes/${RECIPE_ID}/reviews`)
    .set('Authorization', auth)
    .send({ rating: 3.5 });

  assert.equal(response.status, 400);
});

test('POST /api/v1/recipes/:recipeId/reviews rejects an overlong comment', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .post(`/api/v1/recipes/${RECIPE_ID}/reviews`)
    .set('Authorization', auth)
    .send({ rating: 4, comment: 'x'.repeat(1001) });

  assert.equal(response.status, 400);
});

test('POST /api/v1/recipes/:recipeId/reviews rejects an unknown sensitive field', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .post(`/api/v1/recipes/${RECIPE_ID}/reviews`)
    .set('Authorization', auth)
    .send({ rating: 4, averageRating: 5 });

  assert.equal(response.status, 400);
});

test('POST rejects spoofed cook authority fields before review eligibility is evaluated', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  for (const field of ['hasCooked', 'cookStatus', 'completedAt', 'cookHistoryEventId']) {
    const response = await request(app)
      .post(`/api/v1/recipes/${RECIPE_ID}/reviews`)
      .set('Authorization', auth)
      .send({ rating: 5, [field]: true });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  }
});

test('POST /api/v1/recipes/:recipeId/reviews returns 404 RECIPE_NOT_FOUND for a nonexistent recipe', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => null);

  const response = await request(app)
    .post(`/api/v1/recipes/${RECIPE_ID}/reviews`)
    .set('Authorization', auth)
    .send({ rating: 4 });

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'RECIPE_NOT_FOUND');
});

test('POST /api/v1/recipes/:recipeId/reviews returns 404 RECIPE_NOT_FOUND for an archived recipe', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  mockRecipeUsable(t, { isActive: false });

  const response = await request(app)
    .post(`/api/v1/recipes/${RECIPE_ID}/reviews`)
    .set('Authorization', auth)
    .send({ rating: 4 });

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'RECIPE_NOT_FOUND');
});

test('POST /api/v1/recipes/:recipeId/reviews returns 409 REVIEW_ALREADY_EXISTS for a duplicate review (also covers the unique-index race)', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  mockRecipeUsable(t);
  t.mock.method(reviewRepository, 'findOneByUserAndRecipe', async () => null);
  t.mock.method(cookHistoryRepository, 'existsForUserAndRecipe', async () => true);
  t.mock.method(reviewRepository, 'create', async () => {
    const err = new Error('duplicate key');
    err.code = 11000;
    throw err;
  });

  const response = await request(app)
    .post(`/api/v1/recipes/${RECIPE_ID}/reviews`)
    .set('Authorization', auth)
    .send({ rating: 4 });

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'REVIEW_ALREADY_EXISTS');
});

test('POST returns REVIEW_ALREADY_EXISTS before cook eligibility for an existing legacy review', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  mockRecipeUsable(t);
  t.mock.method(reviewRepository, 'findOneByUserAndRecipe', async () => fakeReviewDoc());
  let cookChecked = false;
  t.mock.method(cookHistoryRepository, 'existsForUserAndRecipe', async () => {
    cookChecked = true;
    return false;
  });

  const response = await request(app)
    .post(`/api/v1/recipes/${RECIPE_ID}/reviews`)
    .set('Authorization', auth)
    .send({ rating: 4 });

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'REVIEW_ALREADY_EXISTS');
  assert.equal(cookChecked, false);
});

test('POST returns safe REVIEW_COOK_REQUIRED when no matching completion exists', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  mockRecipeUsable(t);
  t.mock.method(reviewRepository, 'findOneByUserAndRecipe', async () => null);
  t.mock.method(cookHistoryRepository, 'existsForUserAndRecipe', async () => false);

  const response = await request(app)
    .post(`/api/v1/recipes/${RECIPE_ID}/reviews`)
    .set('Authorization', auth)
    .send({ rating: 4, comment: 'Tried it.' });

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'REVIEW_COOK_REQUIRED');
  assert.equal(response.body.error.message, 'Complete this recipe in WeCooked before rating or reviewing it.');
});

test('POST /api/v1/recipes/:recipeId/reviews rejects a malformed recipeId with a controlled 400, never a 500', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .post('/api/v1/recipes/not-an-id/reviews')
    .set('Authorization', auth)
    .send({ rating: 4 });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

// ---------------------------------------------------------------------------
// LIST
// ---------------------------------------------------------------------------

test('GET /api/v1/recipes/:recipeId/reviews returns only safe public author fields, paginated, with the aggregate', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  mockRecipeUsable(t);
  t.mock.method(reviewRepository, 'findMany', async () => [fakeReviewDoc()]);
  t.mock.method(reviewRepository, 'countByFilter', async () => 1);
  t.mock.method(reviewRepository, 'aggregateSummary', async () => ({ avg: 4, count: 1 }));
  t.mock.method(reviewRepository, 'findOneByUserAndRecipe', async () => null);

  const response = await request(app).get(`/api/v1/recipes/${RECIPE_ID}/reviews`).set('Authorization', auth);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.summary, { averageRating: 4, ratingCount: 1 });
  assert.equal(response.body.data.reviews.length, 1);
  assert.deepEqual(Object.keys(response.body.data.reviews[0].author).sort(), ['id', 'name']);
  assert.equal('email' in response.body.data.reviews[0].author, false);
  assert.equal('role' in response.body.data.reviews[0].author, false);
  assert.deepEqual(response.body.data.pagination, { page: 1, limit: 20, total: 1, totalPages: 1 });
  assert.equal(response.body.data.currentUserReview, null);
});

test('GET /api/v1/recipes/:recipeId/reviews returns a deterministic empty aggregate (null average, zero count)', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  mockRecipeUsable(t);
  t.mock.method(reviewRepository, 'findMany', async () => []);
  t.mock.method(reviewRepository, 'countByFilter', async () => 0);
  t.mock.method(reviewRepository, 'aggregateSummary', async () => null);
  t.mock.method(reviewRepository, 'findOneByUserAndRecipe', async () => null);

  const response = await request(app).get(`/api/v1/recipes/${RECIPE_ID}/reviews`).set('Authorization', auth);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.summary, { averageRating: null, ratingCount: 0 });
  assert.deepEqual(response.body.data.reviews, []);
});

test('GET /api/v1/recipes/:recipeId/reviews includes currentUserReview when the caller already reviewed', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  mockRecipeUsable(t);
  t.mock.method(reviewRepository, 'findMany', async () => [fakeReviewDoc()]);
  t.mock.method(reviewRepository, 'countByFilter', async () => 1);
  t.mock.method(reviewRepository, 'aggregateSummary', async () => ({ avg: 4, count: 1 }));
  t.mock.method(reviewRepository, 'findOneByUserAndRecipe', async () => fakeReviewDoc());

  const response = await request(app).get(`/api/v1/recipes/${RECIPE_ID}/reviews`).set('Authorization', auth);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.currentUserReview.id, REVIEW_ID);
  assert.equal(response.body.data.currentUserReview.rating, 4);
});

test('GET /api/v1/recipes/:recipeId/reviews returns 404 RECIPE_NOT_FOUND for a nonexistent recipe', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => null);

  const response = await request(app).get(`/api/v1/recipes/${RECIPE_ID}/reviews`).set('Authorization', auth);

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'RECIPE_NOT_FOUND');
});

test('GET /api/v1/recipes/:recipeId/reviews rejects a malformed recipeId with a controlled 400, never a 500', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app).get('/api/v1/recipes/not-an-id/reviews').set('Authorization', auth);

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('GET /api/v1/recipes/:recipeId/reviews rejects limit above 100 and unknown query fields', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const overLimit = await request(app)
    .get(`/api/v1/recipes/${RECIPE_ID}/reviews`)
    .query({ limit: 101 })
    .set('Authorization', auth);
  assert.equal(overLimit.status, 400);

  const unknownField = await request(app)
    .get(`/api/v1/recipes/${RECIPE_ID}/reviews`)
    .query({ userId: USER_ID })
    .set('Authorization', auth);
  assert.equal(unknownField.status, 400);
});

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

test('PATCH /api/v1/reviews/:reviewId lets the owner update rating/comment', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  let capturedUpdate;
  t.mock.method(reviewRepository, 'updateOwnedById', async (id, userId, update) => {
    capturedUpdate = update;
    return fakeReviewDoc({ ...update });
  });

  const response = await request(app)
    .patch(`/api/v1/reviews/${REVIEW_ID}`)
    .set('Authorization', auth)
    .send({ rating: 2, comment: 'Changed my mind.' });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.review.rating, 2);
  assert.deepEqual(Object.keys(capturedUpdate).sort(), ['comment', 'rating']);
});

test('PATCH /api/v1/reviews/:reviewId denies another user (BOLA) with REVIEW_NOT_FOUND', async (t) => {
  const auth = authHeader(t, { id: OTHER_USER_ID, sessionId: OTHER_SESSION_ID });
  let capturedArgs;
  t.mock.method(reviewRepository, 'updateOwnedById', async (id, userId) => {
    capturedArgs = { id, userId };
    return null;
  });

  const response = await request(app)
    .patch(`/api/v1/reviews/${REVIEW_ID}`)
    .set('Authorization', auth)
    .send({ rating: 1 });

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'REVIEW_NOT_FOUND');
  assert.deepEqual(capturedArgs, { id: REVIEW_ID, userId: OTHER_USER_ID });
});

test('PATCH /api/v1/reviews/:reviewId rejects userId/recipeId tampering', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .patch(`/api/v1/reviews/${REVIEW_ID}`)
    .set('Authorization', auth)
    .send({ rating: 3, recipeId: '507f1f77bcf86cd799439077' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('PATCH /api/v1/reviews/:reviewId rejects an empty body', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app).patch(`/api/v1/reviews/${REVIEW_ID}`).set('Authorization', auth).send({});

  assert.equal(response.status, 400);
});

test('PATCH /api/v1/reviews/:reviewId rejects a malformed reviewId with a controlled 400', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .patch('/api/v1/reviews/not-an-id')
    .set('Authorization', auth)
    .send({ rating: 3 });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

test('DELETE /api/v1/reviews/:reviewId succeeds for the owner', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(reviewRepository, 'deleteOwnedById', async () => fakeReviewDoc());

  const response = await request(app).delete(`/api/v1/reviews/${REVIEW_ID}`).set('Authorization', auth);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, { deleted: true });
});

test('DELETE /api/v1/reviews/:reviewId denies another user (BOLA), never deletes', async (t) => {
  const auth = authHeader(t, { id: OTHER_USER_ID, sessionId: OTHER_SESSION_ID });
  let capturedArgs;
  t.mock.method(reviewRepository, 'deleteOwnedById', async (id, userId) => {
    capturedArgs = { id, userId };
    return null;
  });

  const response = await request(app).delete(`/api/v1/reviews/${REVIEW_ID}`).set('Authorization', auth);

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'REVIEW_NOT_FOUND');
  assert.deepEqual(capturedArgs, { id: REVIEW_ID, userId: OTHER_USER_ID });
});

test('DELETE /api/v1/reviews/:reviewId rejects a malformed reviewId with a controlled 400, never a 500', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app).delete('/api/v1/reviews/not-an-id').set('Authorization', auth);

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});
