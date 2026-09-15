process.env.NODE_ENV = 'test';
process.env.PORT = '4042';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const { requireCapability } = require('../src/middleware/require-capability.middleware');
const { CAPABILITIES } = require('../src/shared/security/capabilities');
const { errorMiddleware } = require('../src/middleware/error.middleware');

function buildTestApp({ role, capability = CAPABILITIES.CATALOG_WRITE, includeAuth = true }) {
  const app = express();
  app.use(express.json());
  app.post(
    '/restricted',
    (req, res, next) => {
      if (includeAuth) {
        req.auth = { userId: 'user-1', role, sessionId: 'session-1' };
      }
      next();
    },
    requireCapability(capability),
    (req, res) => res.json({ success: true, data: { ok: true } })
  );
  app.use(errorMiddleware);
  return app;
}

test('an authenticated role with the required capability passes', async () => {
  const response = await request(buildTestApp({ role: 'moderator' }))
    .post('/restricted')
    .send({});
  assert.equal(response.status, 200);
});

test('an authenticated role without the capability gets stable 403 FORBIDDEN', async () => {
  const response = await request(buildTestApp({ role: 'admin' }))
    .post('/restricted')
    .send({});
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'FORBIDDEN');
});

test('unknown and missing roles are denied with 403 FORBIDDEN', async () => {
  for (const role of ['superadmin', undefined]) {
    const response = await request(buildTestApp({ role })).post('/restricted').send({});
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'FORBIDDEN');
  }
});

test('missing req.auth is rejected as unauthenticated', async () => {
  const response = await request(buildTestApp({ includeAuth: false }))
    .post('/restricted')
    .send({});
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_TOKEN_MISSING');
});

test('request body, query, and headers cannot influence authorization', async () => {
  const response = await request(buildTestApp({ role: 'user' }))
    .post('/restricted?role=moderator')
    .set('X-Role', 'moderator')
    .send({ role: 'moderator' });
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'FORBIDDEN');
});
