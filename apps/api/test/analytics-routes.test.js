process.env.NODE_ENV = 'test';
process.env.PORT = '4069';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const service = require('../src/modules/analytics/analytics.service');
const repository = require('../src/modules/analytics/analytics.repository');
const sessions = require('../src/modules/sessions/session.repository');
const users = require('../src/modules/users/user.repository');
const { signAccessToken } = require('../src/shared/security/access-token');

const app = createApp();
const PATH = '/api/v1/admin/analytics/overview';
const USER_ID = '507f1f77bcf86cd799439401';
const SESSION_ID = '507f1f77bcf86cd799439402';

function authorized(suffix = '') {
  const token = signAccessToken({ userId: USER_ID, role: 'admin', sessionId: SESSION_ID });
  return request(app).get(PATH + suffix).set('Authorization', `Bearer ${token}`);
}

function identity(t, role = 'admin') {
  t.mock.method(sessions, 'findActiveById', async () => ({
    _id: SESSION_ID, userId: USER_ID, securityGeneration: 0,
  }));
  t.mock.method(users, 'findById', async () => ({
    _id: USER_ID, role, status: 'active', sessionGeneration: 0,
  }));
}

test('no-store precedes authentication and malformed query rejection', async (t) => {
  const noToken = await request(app).get(`${PATH}?from=2026-01-01`);
  assert.equal(noToken.status, 401);
  assert.equal(noToken.headers['cache-control'], 'no-store');
  identity(t);
  for (const suffix of ['?from=2026-01-01', '?role=admin', '?x=1&x=2', '?%00=1']) {
    const response = await authorized(suffix);
    assert.equal(response.status, 400, suffix);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    assert.equal(response.headers['cache-control'], 'no-store');
  }
});

test('Moderator and consumer cannot reach the overview service', async (t) => {
  let role = 'moderator';
  t.mock.method(sessions, 'findActiveById', async () => ({
    _id: SESSION_ID, userId: USER_ID, securityGeneration: 0,
  }));
  t.mock.method(users, 'findById', async () => ({
    _id: USER_ID, role, status: 'active', sessionGeneration: 0,
  }));
  let called = false;
  t.mock.method(service, 'getOverview', async () => { called = true; return {}; });
  for (role of ['moderator', 'user']) {
    const forbidden = await authorized();
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.headers['cache-control'], 'no-store');
    assert.equal(called, false);
  }
});

test('expired or missing active Session denies before any analytics query', async (t) => {
  t.mock.method(sessions, 'findActiveById', async () => null);
  let called = false;
  t.mock.method(service, 'getOverview', async () => { called = true; return {}; });
  const response = await authorized();
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_SESSION_INVALID');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(called, false);
});

test('successful response uses the fixed envelope and no-store', async (t) => {
  identity(t);
  const data = { periodEndUtc: '2026-10-12T00:00:00.000Z', accounts: { total: 0 } };
  t.mock.method(service, 'getOverview', async () => data);
  const response = await authorized();
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { success: true, data });
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('demotion after initial authentication and before final fence releases no aggregates', async (t) => {
  let reads = 0;
  t.mock.method(sessions, 'findActiveById', async () => ({
    _id: SESSION_ID, userId: USER_ID, securityGeneration: 0,
  }));
  t.mock.method(users, 'findById', async () => ({
    _id: USER_ID, role: ++reads === 1 ? 'admin' : 'moderator',
    status: 'active', sessionGeneration: 0,
  }));
  for (const name of ['accountSnapshot', 'postSnapshot', 'accountPeriods', 'postPeriods']) {
    t.mock.method(repository, name, async () => null);
  }
  const response = await authorized();
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'FORBIDDEN');
  assert.equal(response.body.data, undefined);
  assert.equal(reads, 2);
});

test('revoked session or final Mongo read failure releases no aggregates', async (t) => {
  let reads = 0;
  let fail = false;
  t.mock.method(sessions, 'findActiveById', async () => {
    reads += 1;
    if (reads === 2 && fail) throw new Error('private Mongo detail');
    return reads === 2 ? null : { _id: SESSION_ID, userId: USER_ID, securityGeneration: 0 };
  });
  t.mock.method(users, 'findById', async () => ({
    _id: USER_ID, role: 'admin', status: 'active', sessionGeneration: 0,
  }));
  for (const name of ['accountSnapshot', 'postSnapshot', 'accountPeriods', 'postPeriods']) {
    t.mock.method(repository, name, async () => null);
  }
  const revoked = await authorized();
  assert.equal(revoked.status, 401);
  assert.equal(revoked.body.data, undefined);
  reads = 0;
  fail = true;
  const error = await authorized();
  assert.equal(error.status, 500);
  assert.equal(error.body.error.code, 'INTERNAL_SERVER_ERROR');
  assert.doesNotMatch(JSON.stringify(error.body), /private Mongo detail/);
});
