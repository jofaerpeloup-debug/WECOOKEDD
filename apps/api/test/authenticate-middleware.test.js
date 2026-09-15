process.env.NODE_ENV = 'test';
process.env.PORT = '4016';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const sessionService = require('../src/modules/sessions/session.service');
const userService = require('../src/modules/users/user.service');
const { authenticate } = require('../src/middleware/authenticate.middleware');
const { errorMiddleware } = require('../src/middleware/error.middleware');
const { signAccessToken } = require('../src/shared/security/access-token');

const USER_ID = '507f1f77bcf86cd799439011';
const SESSION_ID = '507f1f77bcf86cd799439012';
const OTHER_USER_ID = '507f1f77bcf86cd799439099';

function buildTestApp() {
  const app = express();
  app.get('/protected', authenticate, (req, res) => {
    res.json({ success: true, data: { auth: req.auth } });
  });
  app.use(errorMiddleware);
  return app;
}

test('a missing Authorization header is rejected with AUTH_TOKEN_MISSING', async () => {
  const response = await request(buildTestApp()).get('/protected');

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_TOKEN_MISSING');
});

test('a non-Bearer Authorization header is rejected with AUTH_TOKEN_MISSING', async () => {
  const response = await request(buildTestApp())
    .get('/protected')
    .set('Authorization', 'Basic dXNlcjpwYXNz');

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_TOKEN_MISSING');
});

test('a malformed/garbage access token is rejected with AUTH_TOKEN_INVALID', async () => {
  const response = await request(buildTestApp())
    .get('/protected')
    .set('Authorization', 'Bearer not-a-real-token');

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_TOKEN_INVALID');
});

test('an expired access token is rejected with AUTH_TOKEN_INVALID', async () => {
  const now = Math.floor(Date.now() / 1000);
  const expiredToken = jwt.sign(
    { sub: USER_ID, role: 'user', sessionId: SESSION_ID, iat: now - 120, exp: now - 60 },
    'test-suite-access-secret-at-least-32-chars-long',
    { algorithm: 'HS256', issuer: 'wecooked-api', audience: 'wecooked-client' }
  );

  const response = await request(buildTestApp())
    .get('/protected')
    .set('Authorization', `Bearer ${expiredToken}`);

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_TOKEN_INVALID');
});

test('a well-signed token with a malformed sessionId claim is rejected with AUTH_SESSION_INVALID, without touching the database', async (t) => {
  let called = false;
  t.mock.method(sessionService, 'getActiveSessionById', async () => {
    called = true;
    return null;
  });
  const token = signAccessToken({ userId: USER_ID, role: 'user', sessionId: 'not-a-valid-object-id' });

  const response = await request(buildTestApp())
    .get('/protected')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_SESSION_INVALID');
  assert.equal(called, false, 'expected the malformed id to be rejected before any repository lookup');
});

test('a well-signed token with a malformed sub (user id) claim is rejected with AUTH_SESSION_INVALID', async () => {
  const token = signAccessToken({ userId: 'not-a-valid-object-id', role: 'user', sessionId: SESSION_ID });

  const response = await request(buildTestApp())
    .get('/protected')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_SESSION_INVALID');
});

test('a valid token whose session has been revoked/expired is rejected with AUTH_SESSION_INVALID', async (t) => {
  t.mock.method(sessionService, 'getActiveSessionById', async () => null);
  const token = signAccessToken({ userId: USER_ID, role: 'user', sessionId: SESSION_ID });

  const response = await request(buildTestApp())
    .get('/protected')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_SESSION_INVALID');
});

test('a valid token whose session belongs to a different user is rejected with AUTH_SESSION_INVALID', async (t) => {
  t.mock.method(sessionService, 'getActiveSessionById', async () => ({
    _id: SESSION_ID,
    userId: OTHER_USER_ID,
  }));
  let userLookupCalled = false;
  t.mock.method(userService, 'getUserById', async () => {
    userLookupCalled = true;
    return { _id: OTHER_USER_ID, role: 'user', status: 'active' };
  });
  const token = signAccessToken({ userId: USER_ID, role: 'user', sessionId: SESSION_ID });

  const response = await request(buildTestApp())
    .get('/protected')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_SESSION_INVALID');
  assert.equal(userLookupCalled, false, 'expected ownership mismatch to short-circuit before loading the user');
});

test('a valid token/session but a suspended user is rejected with AUTH_SESSION_INVALID', async (t) => {
  t.mock.method(sessionService, 'getActiveSessionById', async () => ({
    _id: SESSION_ID,
    userId: USER_ID,
  }));
  t.mock.method(userService, 'getUserById', async () => ({
    _id: USER_ID,
    role: 'user',
    status: 'suspended',
  }));
  const token = signAccessToken({ userId: USER_ID, role: 'user', sessionId: SESSION_ID });

  const response = await request(buildTestApp())
    .get('/protected')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_SESSION_INVALID');
});

test('a genuine repository/database failure propagates as a 500, not AUTH_SESSION_INVALID', async (t) => {
  t.mock.method(sessionService, 'getActiveSessionById', async () => {
    throw new Error('MongoDB connection timed out');
  });
  const token = signAccessToken({ userId: USER_ID, role: 'user', sessionId: SESSION_ID });

  const response = await request(buildTestApp())
    .get('/protected')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 500);
  assert.equal(response.body.error.code, 'INTERNAL_SERVER_ERROR');
});

test('a genuine database failure loading the user also propagates as a 500', async (t) => {
  t.mock.method(sessionService, 'getActiveSessionById', async () => ({
    _id: SESSION_ID,
    userId: USER_ID,
  }));
  t.mock.method(userService, 'getUserById', async () => {
    throw new Error('MongoDB connection timed out');
  });
  const token = signAccessToken({ userId: USER_ID, role: 'user', sessionId: SESSION_ID });

  const response = await request(buildTestApp())
    .get('/protected')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 500);
  assert.equal(response.body.error.code, 'INTERNAL_SERVER_ERROR');
});

test('a fully valid token attaches a safe req.auth identity and never leaks passwordHash', async (t) => {
  t.mock.method(sessionService, 'getActiveSessionById', async () => ({
    _id: SESSION_ID,
    userId: USER_ID,
  }));
  t.mock.method(userService, 'getUserById', async () => ({
    _id: USER_ID,
    role: 'admin',
    status: 'active',
    passwordHash: 'should-never-leak',
  }));
  const token = signAccessToken({ userId: USER_ID, role: 'admin', sessionId: SESSION_ID });

  const response = await request(buildTestApp())
    .get('/protected')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.auth, { userId: USER_ID, role: 'admin', sessionId: SESSION_ID });
  assert.equal(JSON.stringify(response.body).includes('should-never-leak'), false);
});

test('current MongoDB moderator role overrides a stale access-token role in req.auth', async (t) => {
  t.mock.method(sessionService, 'getActiveSessionById', async () => ({
    _id: SESSION_ID,
    userId: USER_ID,
  }));
  t.mock.method(userService, 'getUserById', async () => ({
    _id: USER_ID,
    role: 'moderator',
    status: 'active',
  }));
  const token = signAccessToken({ userId: USER_ID, role: 'user', sessionId: SESSION_ID });

  const response = await request(buildTestApp())
    .get('/protected')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.auth, {
    userId: USER_ID,
    role: 'moderator',
    sessionId: SESSION_ID,
  });
});

test('current MongoDB user role overrides a stale privileged access-token role in req.auth', async (t) => {
  t.mock.method(sessionService, 'getActiveSessionById', async () => ({
    _id: SESSION_ID,
    userId: USER_ID,
  }));
  t.mock.method(userService, 'getUserById', async () => ({
    _id: USER_ID,
    role: 'user',
    status: 'active',
  }));
  const token = signAccessToken({ userId: USER_ID, role: 'admin', sessionId: SESSION_ID });

  const response = await request(buildTestApp())
    .get('/protected')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.auth, {
    userId: USER_ID,
    role: 'user',
    sessionId: SESSION_ID,
  });
});
