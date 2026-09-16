process.env.NODE_ENV = 'test';
process.env.PORT = '4038';
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
const cookHistoryRepository = require('../src/modules/cook-history/cook-history.repository');
const { signAccessToken } = require('../src/shared/security/access-token');

const app = createApp();

const USER_ID = '507f1f77bcf86cd799439003';
const USER_SESSION_ID = '507f1f77bcf86cd799439004';
const OTHER_USER_ID = '507f1f77bcf86cd799439005';
const OTHER_SESSION_ID = '507f1f77bcf86cd799439006';
const ADMIN_ID = '507f1f77bcf86cd799439007';
const ADMIN_SESSION_ID = '507f1f77bcf86cd799439008';
const CHICKEN_ID = '507f1f77bcf86cd799439011';
const RECIPE_ID = '507f1f77bcf86cd799439099';
const ENTRY_ID = '507f1f77bcf86cd799439044';

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

function fakeEntryDoc(overrides = {}) {
  return {
    _id: ENTRY_ID,
    userId: USER_ID,
    recipeId: RECIPE_ID,
    servings: undefined,
    completedAt: new Date(),
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

test('POST /api/v1/cook-history without a token is rejected', async () => {
  const response = await request(app).post('/api/v1/cook-history').send({ recipeId: RECIPE_ID });
  assert.equal(response.status, 401);
});

test('GET /api/v1/cook-history without a token is rejected', async () => {
  const response = await request(app).get('/api/v1/cook-history');
  assert.equal(response.status, 401);
});

test('GET /api/v1/cook-history/stats without a token is rejected', async () => {
  const response = await request(app).get('/api/v1/cook-history/stats');
  assert.equal(response.status, 401);
});

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

test('POST /api/v1/cook-history records a completion for the authenticated user', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  mockRecipeUsable(t);
  let capturedDoc;
  t.mock.method(cookHistoryRepository, 'create', async (doc) => {
    capturedDoc = doc;
    return fakeEntryDoc({ ...doc });
  });

  const response = await request(app)
    .post('/api/v1/cook-history')
    .set('Authorization', auth)
    .send({ recipeId: RECIPE_ID, servings: 6 });

  assert.equal(response.status, 201);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.cookHistory.servings, 6);
  assert.equal(response.body.data.cookHistory.recipe.title, 'Chicken Adobo');
  assert.equal(capturedDoc.userId, USER_ID);
});

test('POST /api/v1/cook-history works without servings', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  mockRecipeUsable(t);
  t.mock.method(cookHistoryRepository, 'create', async (doc) => fakeEntryDoc({ ...doc }));

  const response = await request(app)
    .post('/api/v1/cook-history')
    .set('Authorization', auth)
    .send({ recipeId: RECIPE_ID });

  assert.equal(response.status, 201);
  assert.equal(response.body.data.cookHistory.servings, null);
});

test('POST /api/v1/cook-history rejects a client-supplied userId (mass assignment)', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .post('/api/v1/cook-history')
    .set('Authorization', auth)
    .send({ recipeId: RECIPE_ID, userId: OTHER_USER_ID });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/cook-history rejects a client-supplied completedAt', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .post('/api/v1/cook-history')
    .set('Authorization', auth)
    .send({ recipeId: RECIPE_ID, completedAt: '2020-01-01T00:00:00.000Z' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/cook-history rejects unknown/sensitive fields (role, recipeTitle)', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .post('/api/v1/cook-history')
    .set('Authorization', auth)
    .send({ recipeId: RECIPE_ID, role: 'admin', recipeTitle: 'Adobo' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/cook-history rejects a non-integer servings', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .post('/api/v1/cook-history')
    .set('Authorization', auth)
    .send({ recipeId: RECIPE_ID, servings: 'a lot' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/cook-history rejects a malformed recipeId with a controlled 400, never a 500', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .post('/api/v1/cook-history')
    .set('Authorization', auth)
    .send({ recipeId: 'not-an-id' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/cook-history returns 404 RECIPE_NOT_FOUND for a nonexistent recipe', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => null);

  const response = await request(app)
    .post('/api/v1/cook-history')
    .set('Authorization', auth)
    .send({ recipeId: RECIPE_ID });

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'RECIPE_NOT_FOUND');
});

test('POST /api/v1/cook-history returns 404 RECIPE_NOT_FOUND for an archived/inactive recipe', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  mockRecipeUsable(t, { isActive: false });

  const response = await request(app)
    .post('/api/v1/cook-history')
    .set('Authorization', auth)
    .send({ recipeId: RECIPE_ID });

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'RECIPE_NOT_FOUND');
});

test('POST /api/v1/cook-history twice for the same recipe creates two independent events (repeated cooking)', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  mockRecipeUsable(t);
  let createCount = 0;
  t.mock.method(cookHistoryRepository, 'create', async (doc) => {
    createCount += 1;
    return fakeEntryDoc({ ...doc, _id: `entry-${createCount}` });
  });

  const first = await request(app).post('/api/v1/cook-history').set('Authorization', auth).send({ recipeId: RECIPE_ID });
  const second = await request(app).post('/api/v1/cook-history').set('Authorization', auth).send({ recipeId: RECIPE_ID });

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual(first.body.data.cookHistory.id, second.body.data.cookHistory.id);
  assert.equal(createCount, 2);
});

test('POST /api/v1/cook-history surfaces an unexpected database failure as a generic 500, never leaking internals', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => {
    throw new Error('MongoServerSelectionError: connection timed out');
  });

  const response = await request(app)
    .post('/api/v1/cook-history')
    .set('Authorization', auth)
    .send({ recipeId: RECIPE_ID });

  assert.equal(response.status, 500);
  assert.equal(response.body.error.code, 'INTERNAL_SERVER_ERROR');
  assert.equal(/connection timed out/i.test(JSON.stringify(response.body)), false);
});

test('POST /api/v1/cook-history response never includes userId, email, or role', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  mockRecipeUsable(t);
  t.mock.method(cookHistoryRepository, 'create', async (doc) => fakeEntryDoc({ ...doc }));

  const response = await request(app)
    .post('/api/v1/cook-history')
    .set('Authorization', auth)
    .send({ recipeId: RECIPE_ID });

  const body = response.body.data.cookHistory;
  assert.equal('userId' in body, false);
  assert.equal('email' in body, false);
  assert.equal('role' in body, false);
  assert.equal('instructions' in body.recipe, false);
  assert.equal('ingredients' in body.recipe, false);
});

// ---------------------------------------------------------------------------
// LIST / BOLA
// ---------------------------------------------------------------------------

test('GET /api/v1/cook-history returns only the authenticated user\'s history, newest first by default', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  let capturedFilter;
  let capturedSort;
  t.mock.method(cookHistoryRepository, 'findMany', async ({ filter, sort }) => {
    capturedFilter = filter;
    capturedSort = sort;
    return [fakeEntryDoc()];
  });
  t.mock.method(cookHistoryRepository, 'countByFilter', async () => 1);
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => fakeRecipeDoc());

  const response = await request(app).get('/api/v1/cook-history').set('Authorization', auth);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.cookHistory.length, 1);
  assert.deepEqual(response.body.data.pagination, { page: 1, limit: 20, total: 1, totalPages: 1 });
  assert.deepEqual(capturedFilter, { userId: USER_ID });
  assert.deepEqual(capturedSort, { completedAt: -1 });
});

test('GET /api/v1/cook-history ignores a client-supplied userId query param (ownership is never client-controlled)', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .get(`/api/v1/cook-history?userId=${OTHER_USER_ID}`)
    .set('Authorization', auth);

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('GET /api/v1/cook-history never returns User A\'s history for User B (BOLA)', async (t) => {
  let capturedFilter;
  t.mock.method(cookHistoryRepository, 'findMany', async ({ filter }) => {
    capturedFilter = filter;
    return [];
  });
  t.mock.method(cookHistoryRepository, 'countByFilter', async () => 0);

  const authA = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  await request(app).get('/api/v1/cook-history').set('Authorization', authA);
  assert.deepEqual(capturedFilter, { userId: USER_ID });

  const authB = authHeader(t, { id: OTHER_USER_ID, sessionId: OTHER_SESSION_ID });
  await request(app).get('/api/v1/cook-history').set('Authorization', authB);
  assert.deepEqual(capturedFilter, { userId: OTHER_USER_ID });
});

test('GET /api/v1/cook-history: an admin token still only sees their own history, no implicit bypass', async (t) => {
  let capturedFilter;
  t.mock.method(cookHistoryRepository, 'findMany', async ({ filter }) => {
    capturedFilter = filter;
    return [];
  });
  t.mock.method(cookHistoryRepository, 'countByFilter', async () => 0);

  const authAdmin = authHeader(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  const response = await request(app).get('/api/v1/cook-history').set('Authorization', authAdmin);

  assert.equal(response.status, 200);
  assert.deepEqual(capturedFilter, { userId: ADMIN_ID });
});

test('GET /api/v1/cook-history supports pagination and oldest sort', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  let capturedSkip;
  let capturedSort;
  t.mock.method(cookHistoryRepository, 'findMany', async ({ sort, skip }) => {
    capturedSort = sort;
    capturedSkip = skip;
    return [];
  });
  t.mock.method(cookHistoryRepository, 'countByFilter', async () => 45);

  const response = await request(app)
    .get('/api/v1/cook-history?page=3&limit=20&sort=oldest')
    .set('Authorization', auth);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.pagination, { page: 3, limit: 20, total: 45, totalPages: 3 });
  assert.deepEqual(capturedSort, { completedAt: 1 });
  assert.equal(capturedSkip, 40);
});

test('GET /api/v1/cook-history omits an entry whose recipe has since become archived', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(cookHistoryRepository, 'findMany', async () => [fakeEntryDoc()]);
  t.mock.method(cookHistoryRepository, 'countByFilter', async () => 1);
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => fakeRecipeDoc({ isActive: false }));

  const response = await request(app).get('/api/v1/cook-history').set('Authorization', auth);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.cookHistory.length, 0);
});

// ---------------------------------------------------------------------------
// STATS / BOLA
// ---------------------------------------------------------------------------

test('GET /api/v1/cook-history/stats returns deterministic empty stats for a new user', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(cookHistoryRepository, 'aggregateStats', async () => null);

  const response = await request(app).get('/api/v1/cook-history/stats').set('Authorization', auth);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.stats, { totalCooks: 0, uniqueRecipesCooked: 0 });
});

test('GET /api/v1/cook-history/stats returns the authoritative total/unique counts', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(cookHistoryRepository, 'aggregateStats', async () => ({
    totalCooks: 4,
    uniqueRecipesCooked: 2,
  }));

  const response = await request(app).get('/api/v1/cook-history/stats').set('Authorization', auth);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.stats, { totalCooks: 4, uniqueRecipesCooked: 2 });
});

test('GET /api/v1/cook-history/stats rejects a client-supplied userId query param', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .get(`/api/v1/cook-history/stats?userId=${OTHER_USER_ID}`)
    .set('Authorization', auth);

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('GET /api/v1/cook-history/stats scopes strictly to the authenticated user (BOLA)', async (t) => {
  let capturedUserId;
  t.mock.method(cookHistoryRepository, 'aggregateStats', async (userId) => {
    capturedUserId = userId;
    return null;
  });

  const authB = authHeader(t, { id: OTHER_USER_ID, sessionId: OTHER_SESSION_ID });
  await request(app).get('/api/v1/cook-history/stats').set('Authorization', authB);

  assert.equal(capturedUserId, OTHER_USER_ID);
});

// ---------------------------------------------------------------------------
// RECIPE STATUS (RecipeDetail "Cooked" pill) / BOLA
// ---------------------------------------------------------------------------

test('GET /api/v1/cook-history/recipes/:recipeId/status without a token is rejected', async () => {
  const response = await request(app).get(`/api/v1/cook-history/recipes/${RECIPE_ID}/status`);
  assert.equal(response.status, 401);
});

test('GET /api/v1/cook-history/recipes/:recipeId/status returns hasCooked: false for a never-cooked recipe', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  mockRecipeUsable(t);
  t.mock.method(cookHistoryRepository, 'existsForUserAndRecipe', async () => false);

  const response = await request(app)
    .get(`/api/v1/cook-history/recipes/${RECIPE_ID}/status`)
    .set('Authorization', auth);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, { hasCooked: false });
});

test('GET /api/v1/cook-history/recipes/:recipeId/status returns hasCooked: true after one completion', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  mockRecipeUsable(t);
  t.mock.method(cookHistoryRepository, 'existsForUserAndRecipe', async () => true);

  const response = await request(app)
    .get(`/api/v1/cook-history/recipes/${RECIPE_ID}/status`)
    .set('Authorization', auth);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, { hasCooked: true });
});

test('GET /api/v1/cook-history/recipes/:recipeId/status still returns hasCooked: true after repeated completions', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  mockRecipeUsable(t);
  // The existence check itself doesn't care how many rows exist — this
  // asserts the endpoint never turns "cooked more than once" into anything
  // but the same boolean.
  t.mock.method(cookHistoryRepository, 'existsForUserAndRecipe', async () => true);

  const response = await request(app)
    .get(`/api/v1/cook-history/recipes/${RECIPE_ID}/status`)
    .set('Authorization', auth);

  assert.deepEqual(response.body.data, { hasCooked: true });
});

test('GET /api/v1/cook-history/recipes/:recipeId/status never returns User A\'s cooked state for User B (BOLA)', async (t) => {
  let capturedUserId;
  mockRecipeUsable(t);
  t.mock.method(cookHistoryRepository, 'existsForUserAndRecipe', async (userId) => {
    capturedUserId = userId;
    // Only USER_ID has actually cooked this recipe.
    return userId === USER_ID;
  });

  const authA = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  const responseA = await request(app)
    .get(`/api/v1/cook-history/recipes/${RECIPE_ID}/status`)
    .set('Authorization', authA);
  assert.deepEqual(responseA.body.data, { hasCooked: true });
  assert.equal(capturedUserId, USER_ID);

  const authB = authHeader(t, { id: OTHER_USER_ID, sessionId: OTHER_SESSION_ID });
  const responseB = await request(app)
    .get(`/api/v1/cook-history/recipes/${RECIPE_ID}/status`)
    .set('Authorization', authB);
  assert.deepEqual(responseB.body.data, { hasCooked: false });
  assert.equal(capturedUserId, OTHER_USER_ID);
});

test('GET /api/v1/cook-history/recipes/:recipeId/status rejects a malformed recipeId with a controlled 400, never a 500', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .get('/api/v1/cook-history/recipes/not-an-id/status')
    .set('Authorization', auth);

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('GET /api/v1/cook-history/recipes/:recipeId/status returns 404 RECIPE_NOT_FOUND for a nonexistent recipe, never a fabricated hasCooked', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => null);

  const response = await request(app)
    .get(`/api/v1/cook-history/recipes/${RECIPE_ID}/status`)
    .set('Authorization', auth);

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'RECIPE_NOT_FOUND');
});

test('GET /api/v1/cook-history/recipes/:recipeId/status returns 404 RECIPE_NOT_FOUND for an archived recipe', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  mockRecipeUsable(t, { isActive: false });

  const response = await request(app)
    .get(`/api/v1/cook-history/recipes/${RECIPE_ID}/status`)
    .set('Authorization', auth);

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'RECIPE_NOT_FOUND');
});

test('GET /api/v1/cook-history/recipes/:recipeId/status rejects a client-supplied userId query param', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .get(`/api/v1/cook-history/recipes/${RECIPE_ID}/status?userId=${OTHER_USER_ID}`)
    .set('Authorization', auth);

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('GET /api/v1/cook-history/recipes/:recipeId/status response is boolean-only — no event id, recipe detail, or ownership data', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  mockRecipeUsable(t);
  t.mock.method(cookHistoryRepository, 'existsForUserAndRecipe', async () => true);

  const response = await request(app)
    .get(`/api/v1/cook-history/recipes/${RECIPE_ID}/status`)
    .set('Authorization', auth);

  assert.deepEqual(Object.keys(response.body.data), ['hasCooked']);
});
