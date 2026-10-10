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
const repository = require('../src/modules/meal-plan/meal-plan.repository');
const { signAccessToken } = require('../src/shared/security/access-token');

const app = createApp();
const OWNER = '507f1f77bcf86cd799439003';
const FOREIGN = '507f1f77bcf86cd799439088';
const SESSION = '507f1f77bcf86cd799439004';
const RECIPE = '507f1f77bcf86cd799439099';
const ENTRY = '507f1f77bcf86cd799439077';
const VERSION = '2026-09-01T00:00:00.000Z';
const entry = () => ({ _id: ENTRY, userId: OWNER, recipeId: RECIPE, dateKey: '2027-09-14',
  createdAt: new Date(VERSION), updatedAt: new Date(VERSION), reminder: null, reminderRevision: 0 });
function auth(t) {
  t.mock.method(sessionRepository, 'findActiveById', async () => ({ _id: SESSION, userId: OWNER, revokedAt: null }));
  t.mock.method(userRepository, 'findById', async () => ({ _id: OWNER, role: 'user', status: 'active' }));
}
const token = () => signAccessToken({ userId: OWNER, role: 'user', sessionId: SESSION });
const bearer = () => ({ Authorization: `Bearer ${token()}` });

test('authentication precedes validation on every new and amended route', async () => {
  const paths = [
    ['get', `/api/v1/meal-plan/${ENTRY}?x=1`],
    ['put', `/api/v1/meal-plan/${ENTRY}/reminder`],
    ['delete', `/api/v1/meal-plan/${ENTRY}/reminder`],
    ['delete', `/api/v1/meal-plan/${ENTRY}`],
    ['delete', '/api/v1/meal-plan?startDate=bad'],
  ];
  for (const [method, path] of paths) {
    const response = await request(app)[method](path).send({ ownerId: FOREIGN });
    assert.equal(response.status, 401, path);
  }
});

test('owner-scoped GET returns complete entry and no-store; foreign is opaque 404', async (t) => {
  auth(t);
  t.mock.method(repository, 'findByIdAndUser', async (id, owner) => id === ENTRY && owner === OWNER ? entry() : null);
  t.mock.method(recipeService, 'findUsableRecipeById', async () => null);
  const response = await request(app).get(`/api/v1/meal-plan/${ENTRY}`).set(bearer());
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.body.data.mealPlanEntry.ownerId, OWNER);
  assert.equal(response.body.data.mealPlanEntry.reminder, null);
  assert.equal(response.body.data.mealPlanEntry.reminderRevision, 0);
  const foreign = await request(app).get(`/api/v1/meal-plan/${FOREIGN}`).set(bearer());
  assert.equal(foreign.status, 404);
});

test('reminder PUT requires exact body and rejects malicious fields and unknown zone', async (t) => {
  auth(t);
  t.mock.method(repository, 'findByIdAndUser', async () => entry());
  const path = `/api/v1/meal-plan/${ENTRY}/reminder`;
  const body = { localTime: '09:00', timeZone: 'UTC', expectedUpdatedAt: VERSION, expectedReminderRevision: 0 };
  for (const bad of [{ ...body, userId: FOREIGN }, { ...body, fireAt: '2027-09-14T09:00:00.000Z' }, { ...body, localTime: '25:00' }]) {
    assert.equal((await request(app).put(path).set(bearer()).send(bad)).status, 400);
  }
  assert.equal((await request(app).put(path).set(bearer()).send({ ...body, timeZone: 'Mars/Olympus' })).status, 400);
});

test('real reminder PUT uses owner-scoped CAS and returns revision; stale write returns 409', async (t) => {
  auth(t);
  t.mock.method(repository, 'findByIdAndUser', async () => entry());
  let fields;
  t.mock.method(repository, 'updateObserved', async (_entry, owner, value) => { assert.equal(owner, OWNER); fields = value;
    return { ...entry(), ...value, updatedAt: new Date('2026-09-01T00:00:00.001Z') }; });
  t.mock.method(recipeService, 'findUsableRecipeById', async () => null);
  const path = `/api/v1/meal-plan/${ENTRY}/reminder`;
  const body = { localTime: '09:00', timeZone: 'UTC', expectedUpdatedAt: VERSION, expectedReminderRevision: 0 };
  const response = await request(app).put(path).set(bearer()).send(body);
  assert.equal(response.status, 200);
  assert.equal(fields.reminderRevision, 1);
  assert.equal(response.body.data.mealPlanEntry.reminderRevision, 1);
  assert.equal((await request(app).put(path).set(bearer()).send({ ...body, expectedReminderRevision: 1 })).status, 409);
});

test('versioned single DELETE and complete Clear Week snapshot bind to authenticated owner', async (t) => {
  auth(t);
  let single; let range;
  t.mock.method(repository, 'deleteByIdAndUser', async (...args) => { single = args; return entry(); });
  t.mock.method(repository, 'deleteByUserAndRange', async (...args) => { range = args; return { deletedCount: 1 }; });
  const singleResponse = await request(app).delete(`/api/v1/meal-plan/${ENTRY}`).set(bearer()).send({ expectedUpdatedAt: VERSION });
  assert.equal(singleResponse.status, 200);
  assert.deepEqual(single, [ENTRY, OWNER, VERSION]);
  const expectedEntries = [{ id: ENTRY, expectedUpdatedAt: VERSION }];
  const clear = await request(app).delete('/api/v1/meal-plan?startDate=2027-09-14&endDate=2027-09-20').set(bearer()).send({ expectedEntries });
  assert.equal(clear.status, 200);
  assert.deepEqual(range, [OWNER, '2027-09-14', '2027-09-20', expectedEntries]);
  assert.equal((await request(app).delete('/api/v1/meal-plan?startDate=2027-09-14&endDate=2027-09-20').set(bearer()).send({ expectedEntries: [...expectedEntries, ...expectedEntries] })).status, 400);
});
