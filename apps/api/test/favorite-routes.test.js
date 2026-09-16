process.env.NODE_ENV = 'test';
process.env.PORT = '4032';
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
const favoriteRepository = require('../src/modules/favorites/favorite.repository');
const { signAccessToken } = require('../src/shared/security/access-token');

const app = createApp();

const USER_ID = '507f1f77bcf86cd799439003';
const USER_SESSION_ID = '507f1f77bcf86cd799439004';
const OTHER_USER_ID = '507f1f77bcf86cd799439005';
const CHICKEN_ID = '507f1f77bcf86cd799439011';
const RECIPE_ID = '507f1f77bcf86cd799439099';

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

function mockAuth(t, { id, role = 'user', sessionId }) {
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: sessionId,
    userId: id,
    revokedAt: null,
  }));
  t.mock.method(userRepository, 'findById', async () => ({ _id: id, role, status: 'active' }));
}

function tokenFor({ id, role = 'user', sessionId }) {
  return signAccessToken({ userId: id, role, sessionId });
}

test('GET /api/v1/favorites without a token is rejected', async () => {
  const response = await request(app).get('/api/v1/favorites');
  assert.equal(response.status, 401);
});

test('POST /api/v1/favorites/:recipeId without a token is rejected', async () => {
  const response = await request(app).post(`/api/v1/favorites/${RECIPE_ID}`);
  assert.equal(response.status, 401);
});

test('DELETE /api/v1/favorites/:recipeId without a token is rejected', async () => {
  const response = await request(app).delete(`/api/v1/favorites/${RECIPE_ID}`);
  assert.equal(response.status, 401);
});

test('GET /api/v1/favorites returns the current user\'s favorites in the standard success envelope', async (t) => {
  mockAuth(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  let capturedFilter;
  t.mock.method(favoriteRepository, 'findMany', async ({ filter }) => {
    capturedFilter = filter;
    return [{ _id: 'fav1', userId: USER_ID, recipeId: RECIPE_ID, createdAt: new Date() }];
  });
  t.mock.method(favoriteRepository, 'countByFilter', async () => 1);
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => fakeRecipeDoc());

  const token = tokenFor({ id: USER_ID, sessionId: USER_SESSION_ID });
  const response = await request(app).get('/api/v1/favorites').set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.favorites[0].recipe.title, 'Chicken Adobo');
  // Favorite recipe summary follows the retired-cuisine target contract.
  assert.equal('cuisine' in response.body.data.favorites[0].recipe, false);
  assert.equal(response.body.data.favorites[0].recipe.region, 'central-luzon');
  assert.equal(response.body.data.favorites[0].recipe.category, 'main-dish');
  assert.deepEqual(response.body.data.pagination, { page: 1, limit: 20, total: 1, totalPages: 1 });
  // Ownership is derived from req.auth only — never from a client-supplied filter.
  assert.deepEqual(capturedFilter, { userId: USER_ID });
});

test('GET /api/v1/favorites never leaks a userId field on each favorite', async (t) => {
  mockAuth(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(favoriteRepository, 'findMany', async () => [
    { _id: 'fav1', userId: USER_ID, recipeId: RECIPE_ID, createdAt: new Date() },
  ]);
  t.mock.method(favoriteRepository, 'countByFilter', async () => 1);
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => fakeRecipeDoc());

  const token = tokenFor({ id: USER_ID, sessionId: USER_SESSION_ID });
  const response = await request(app).get('/api/v1/favorites').set('Authorization', `Bearer ${token}`);

  assert.equal('userId' in response.body.data.favorites[0], false);
});

test('GET /api/v1/favorites omits a favorite whose recipe has become archived/unusable', async (t) => {
  mockAuth(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(favoriteRepository, 'findMany', async () => [
    { _id: 'fav1', userId: USER_ID, recipeId: RECIPE_ID, createdAt: new Date() },
  ]);
  t.mock.method(favoriteRepository, 'countByFilter', async () => 1);
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => fakeRecipeDoc({ isActive: false }));

  const token = tokenFor({ id: USER_ID, sessionId: USER_SESSION_ID });
  const response = await request(app).get('/api/v1/favorites').set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.favorites.length, 0);
});

test('GET /api/v1/favorites rejects an invalid sort value', async (t) => {
  mockAuth(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  const token = tokenFor({ id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .get('/api/v1/favorites?sort=titleAsc')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('GET /api/v1/favorites rejects limit above 100', async (t) => {
  mockAuth(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  const token = tokenFor({ id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .get('/api/v1/favorites?limit=101')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 400);
});

test('GET /api/v1/favorites ignores a client-supplied userId query param (ownership is never client-controlled)', async (t) => {
  mockAuth(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const token = tokenFor({ id: USER_ID, sessionId: USER_SESSION_ID });
  // userId in the query string is not part of the strict query schema, so
  // this is rejected outright rather than silently accepted.
  const response = await request(app)
    .get(`/api/v1/favorites?userId=${OTHER_USER_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 400);
});

test('POST /api/v1/favorites/:recipeId adds a favorite for the authenticated user', async (t) => {
  mockAuth(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => fakeRecipeDoc());
  let capturedArgs;
  t.mock.method(favoriteRepository, 'createFavorite', async (args) => {
    capturedArgs = args;
    return { _id: 'fav1', ...args, createdAt: new Date() };
  });

  const token = tokenFor({ id: USER_ID, sessionId: USER_SESSION_ID });
  const response = await request(app)
    .post(`/api/v1/favorites/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 201);
  assert.equal(response.body.data.favorite.recipe.id, RECIPE_ID);
  assert.equal(capturedArgs.userId, USER_ID);
});

test('POST /api/v1/favorites/:recipeId returns 404 RECIPE_NOT_FOUND for an archived recipe', async (t) => {
  mockAuth(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => fakeRecipeDoc({ isActive: false }));

  const token = tokenFor({ id: USER_ID, sessionId: USER_SESSION_ID });
  const response = await request(app)
    .post(`/api/v1/favorites/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'RECIPE_NOT_FOUND');
});

test('POST /api/v1/favorites/:recipeId surfaces an unexpected database failure as a generic 500, never as RECIPE_NOT_FOUND', async (t) => {
  mockAuth(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => {
    throw new Error('MongoServerSelectionError: connection timed out');
  });

  const token = tokenFor({ id: USER_ID, sessionId: USER_SESSION_ID });
  const response = await request(app)
    .post(`/api/v1/favorites/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 500);
  assert.equal(response.body.error.code, 'INTERNAL_SERVER_ERROR');
  assert.equal(/connection timed out/i.test(JSON.stringify(response.body)), false);
});

test('POST /api/v1/favorites/:recipeId returns 409 FAVORITE_ALREADY_EXISTS for a duplicate', async (t) => {
  mockAuth(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => fakeRecipeDoc());
  t.mock.method(favoriteRepository, 'createFavorite', async () => {
    const err = new Error('duplicate key');
    err.code = 11000;
    throw err;
  });

  const token = tokenFor({ id: USER_ID, sessionId: USER_SESSION_ID });
  const response = await request(app)
    .post(`/api/v1/favorites/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'FAVORITE_ALREADY_EXISTS');
});

test('POST /api/v1/favorites/:recipeId rejects an invalid ObjectId param', async (t) => {
  mockAuth(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  const token = tokenFor({ id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .post('/api/v1/favorites/not-an-id')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('DELETE /api/v1/favorites/:recipeId removes the authenticated user\'s favorite', async (t) => {
  mockAuth(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  let capturedUserId;
  t.mock.method(favoriteRepository, 'deleteByUserAndRecipe', async (userId) => {
    capturedUserId = userId;
    return { _id: 'fav1' };
  });

  const token = tokenFor({ id: USER_ID, sessionId: USER_SESSION_ID });
  const response = await request(app)
    .delete(`/api/v1/favorites/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, { deleted: true });
  assert.equal(capturedUserId, USER_ID);
});

test('DELETE /api/v1/favorites/:recipeId returns 404 FAVORITE_NOT_FOUND when it does not belong to the caller', async (t) => {
  mockAuth(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(favoriteRepository, 'deleteByUserAndRecipe', async () => null);

  const token = tokenFor({ id: USER_ID, sessionId: USER_SESSION_ID });
  const response = await request(app)
    .delete(`/api/v1/favorites/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'FAVORITE_NOT_FOUND');
});

test('DELETE /api/v1/favorites/:recipeId still succeeds even if the recipe has since become archived', async (t) => {
  mockAuth(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(favoriteRepository, 'deleteByUserAndRecipe', async () => ({ _id: 'fav1' }));
  let recipeLookupCalled = false;
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => {
    recipeLookupCalled = true;
    return fakeRecipeDoc({ isActive: false });
  });

  const token = tokenFor({ id: USER_ID, sessionId: USER_SESSION_ID });
  const response = await request(app)
    .delete(`/api/v1/favorites/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(recipeLookupCalled, false);
});
