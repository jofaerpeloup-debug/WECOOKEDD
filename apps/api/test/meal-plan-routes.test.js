process.env.NODE_ENV = 'test';
process.env.PORT = '4041';
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
const recipeService = require('../src/modules/recipes/recipe.service');
const mealPlanRepository = require('../src/modules/meal-plan/meal-plan.repository');
const { signAccessToken } = require('../src/shared/security/access-token');

const app = createApp();
const USER_ID = '507f1f77bcf86cd799439003';
const SESSION_ID = '507f1f77bcf86cd799439004';
const RECIPE_ID = '507f1f77bcf86cd799439099';
const ENTRY_ID = '507f1f77bcf86cd799439077';
const OTHER_USER_ID = '507f1f77bcf86cd799439088';
const OTHER_SESSION_ID = '507f1f77bcf86cd799439089';

function mockAuth(t, role = 'user') {
  t.mock.method(sessionRepository, 'findActiveById', async (id) => ({
    _id: id,
    userId: id === OTHER_SESSION_ID ? OTHER_USER_ID : USER_ID,
    revokedAt: null,
  }));
  t.mock.method(userRepository, 'findById', async (id) => ({ _id: id, role, status: 'active' }));
}

function token(role = 'user') {
  return signAccessToken({ userId: USER_ID, role, sessionId: SESSION_ID });
}

function otherUserToken(role = 'user') {
  return signAccessToken({ userId: OTHER_USER_ID, role, sessionId: OTHER_SESSION_ID });
}

function entry(overrides = {}) {
  return {
    _id: ENTRY_ID,
    userId: USER_ID,
    recipeId: RECIPE_ID,
    dateKey: '2026-09-14',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  };
}

function recipe() {
  return { _id: RECIPE_ID, title: 'Adobo', region: 'central-luzon', category: 'dinner', difficulty: 'easy', prepTimeMinutes: 10, cookTimeMinutes: 30, imageUrl: null };
}

test('all meal-plan routes require authentication', async () => {
  const responses = await Promise.all([
    request(app).get('/api/v1/meal-plan?startDate=2026-09-14&endDate=2026-09-20'),
    request(app).post('/api/v1/meal-plan').send({ dateKey: '2026-09-14', recipeId: RECIPE_ID }),
    request(app).delete(`/api/v1/meal-plan/${ENTRY_ID}`),
    request(app).delete('/api/v1/meal-plan?startDate=2026-09-14&endDate=2026-09-20'),
  ]);
  responses.forEach((response) => assert.equal(response.status, 401));
});

test('GET is bounded to the authenticated owner and safely serializes unavailable recipes', async (t) => {
  mockAuth(t);
  let args;
  t.mock.method(mealPlanRepository, 'findByUserAndRange', async (...value) => { args = value; return [entry()]; });
  t.mock.method(recipeService, 'findUsableRecipeById', async () => null);
  const response = await request(app).get('/api/v1/meal-plan?startDate=2026-09-14&endDate=2026-09-20').set('Authorization', `Bearer ${token()}`);
  assert.equal(response.status, 200);
  assert.deepEqual(args, [USER_ID, '2026-09-14', '2026-09-20']);
  assert.deepEqual(response.body.data.mealPlan[0].recipe, null);
  assert.equal(response.body.data.mealPlan[0].isAvailable, false);
  assert.equal('userId' in response.body.data.mealPlan[0], false);
  assert.equal('role' in response.body.data.mealPlan[0], false);
});

test('GET rejects malformed, impossible, inverted, oversized, and client-owned ranges', async (t) => {
  mockAuth(t);
  for (const query of [
    'startDate=2026-2-01&endDate=2026-02-07',
    'startDate=2026-02-30&endDate=2026-03-02',
    'startDate=2026-09-20&endDate=2026-09-14',
    'startDate=2026-01-01&endDate=2026-02-01',
    `startDate=2026-09-14&endDate=2026-09-20&userId=${USER_ID}`,
  ]) {
    const response = await request(app).get(`/api/v1/meal-plan?${query}`).set('Authorization', `Bearer ${token()}`);
    assert.equal(response.status, 400, query);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  }
});

test('POST creates for req.auth.userId and returns only a safe entry plus recipe summary', async (t) => {
  mockAuth(t);
  t.mock.method(recipeService, 'findUsableRecipeById', async () => recipe());
  let created;
  t.mock.method(mealPlanRepository, 'create', async (data) => { created = data; return entry(data); });
  const response = await request(app).post('/api/v1/meal-plan').set('Authorization', `Bearer ${token()}`).send({ dateKey: '2026-09-14', recipeId: RECIPE_ID });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.mealPlanEntry.recipe.title, 'Adobo');
  assert.deepEqual(created, { userId: USER_ID, dateKey: '2026-09-14', recipeId: RECIPE_ID });
  assert.equal('userId' in response.body.data.mealPlanEntry, false);
});

test('POST rejects malformed recipe ids and all mass-assignment fields', async (t) => {
  mockAuth(t);
  const malformed = await request(app).post('/api/v1/meal-plan').set('Authorization', `Bearer ${token()}`).send({ dateKey: '2026-09-14', recipeId: 'bad' });
  assert.equal(malformed.status, 400);
  for (const field of ['userId', 'ownerId', 'mealType', 'servings', 'recipeTitle', 'updatedAt']) {
    const response = await request(app).post('/api/v1/meal-plan').set('Authorization', `Bearer ${token()}`).send({ dateKey: '2026-09-14', recipeId: RECIPE_ID, [field]: 'x' });
    assert.equal(response.status, 400, field);
  }
});

test('DELETE by id remains owner-scoped for both user and admin accounts', async (t) => {
  mockAuth(t, 'admin');
  let args;
  t.mock.method(mealPlanRepository, 'deleteByIdAndUser', async (...value) => { args = value; return null; });
  const response = await request(app).delete(`/api/v1/meal-plan/${ENTRY_ID}`).set('Authorization', `Bearer ${token('admin')}`);
  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'MEAL_PLAN_ENTRY_NOT_FOUND');
  assert.deepEqual(args, [ENTRY_ID, USER_ID]);
});

// BOLA regression: User B's token must never let them delete User A's entry.
// The repository is the real ownership boundary (deleteByIdAndUser scopes its
// query by both id AND userId) — this stubs it to behave that way and proves
// User B's request is scoped to User B's id, so it can only ever "find"
// (and therefore delete) an entry that is also User B's.
test('DELETE /api/v1/meal-plan/:entryId never lets User B delete User A\'s entry (BOLA)', async (t) => {
  mockAuth(t);
  t.mock.method(mealPlanRepository, 'deleteByIdAndUser', async (entryId, userId) =>
    userId === USER_ID ? entry({ _id: entryId, userId }) : null
  );

  const asOtherUser = await request(app)
    .delete(`/api/v1/meal-plan/${ENTRY_ID}`)
    .set('Authorization', `Bearer ${otherUserToken()}`);
  assert.equal(asOtherUser.status, 404);
  assert.equal(asOtherUser.body.error.code, 'MEAL_PLAN_ENTRY_NOT_FOUND');

  const asOwner = await request(app)
    .delete(`/api/v1/meal-plan/${ENTRY_ID}`)
    .set('Authorization', `Bearer ${token()}`);
  assert.equal(asOwner.status, 200);
  assert.equal(asOwner.body.data.deleted, true);
});

test('DELETE range clears only the authenticated owner and returns an exact count', async (t) => {
  mockAuth(t);
  let args;
  t.mock.method(mealPlanRepository, 'deleteByUserAndRange', async (...value) => { args = value; return { deletedCount: 2 }; });
  const response = await request(app).delete('/api/v1/meal-plan?startDate=2026-09-14&endDate=2026-09-20').set('Authorization', `Bearer ${token()}`);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, { deletedCount: 2 });
  assert.deepEqual(args, [USER_ID, '2026-09-14', '2026-09-20']);
});
