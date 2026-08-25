process.env.NODE_ENV = 'test';
process.env.PORT = '4017';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const { authorize } = require('../src/middleware/authorize.middleware');
const { errorMiddleware } = require('../src/middleware/error.middleware');

function buildTestApp({ role, allowedRoles }) {
  const app = express();
  app.get(
    '/restricted',
    (req, res, next) => {
      if (role) {
        req.auth = { userId: 'user-1', role, sessionId: 'session-1' };
      }
      next();
    },
    authorize(...allowedRoles),
    (req, res) => res.json({ success: true, data: { ok: true } })
  );
  app.use(errorMiddleware);
  return app;
}

test('an allowed role passes through', async () => {
  const response = await request(buildTestApp({ role: 'admin', allowedRoles: ['admin'] })).get(
    '/restricted'
  );
  assert.equal(response.status, 200);
});

test('a disallowed role is rejected with 403 FORBIDDEN', async () => {
  const response = await request(buildTestApp({ role: 'user', allowedRoles: ['admin'] })).get(
    '/restricted'
  );
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'FORBIDDEN');
});

test('multiple allowed roles all pass', async () => {
  const response = await request(
    buildTestApp({ role: 'user', allowedRoles: ['user', 'admin'] })
  ).get('/restricted');
  assert.equal(response.status, 200);
});

test('missing req.auth (unauthenticated) is rejected with AUTH_TOKEN_MISSING', async () => {
  const response = await request(buildTestApp({ role: null, allowedRoles: ['admin'] })).get(
    '/restricted'
  );
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_TOKEN_MISSING');
});
