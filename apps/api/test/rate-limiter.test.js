process.env.NODE_ENV = 'test';
process.env.PORT = '4003';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const {
  createRateLimiter,
  authenticatedUserKey,
  SOCIAL_RATE_LIMITS,
} = require('../src/middleware/rate-limiter');
const { errorMiddleware } = require('../src/middleware/error.middleware');
const { configureProxyTrust } = require('../src/app');

// A tiny test-only app with a 1-request limit, so the standardized 429
// behavior can be proven with two requests instead of hundreds.
function buildTestApp({ nodeEnv = 'test' } = {}) {
  const app = express();
  configureProxyTrust(app, nodeEnv);
  app.use(createRateLimiter({ windowMs: 60_000, limit: 1 }));
  app.get('/ping', (req, res) => res.json({ success: true, data: { pong: true, ip: req.ip } }));
  app.use(errorMiddleware);
  return app;
}

test('requests beyond the limit receive the standard 429 error envelope', async () => {
  const app = buildTestApp();

  const first = await request(app).get('/ping');
  assert.equal(first.status, 200);

  const second = await request(app).get('/ping');
  assert.equal(second.status, 429);
  assert.equal(second.body.success, false);
  assert.equal(second.body.error.code, 'RATE_LIMIT_EXCEEDED');
  assert.equal(second.body.error.message, 'Too many requests. Please try again later.');
});

test('Render proxy trust uses the first forwarded address as the intended client IP', async () => {
  const app = buildTestApp({ nodeEnv: 'production' });

  const response = await request(app)
    .get('/ping')
    .set('X-Forwarded-For', '203.0.113.10, 198.51.100.99');

  assert.equal(response.status, 200);
  assert.equal(response.body.data.ip, '203.0.113.10');
});

test('changing trailing spoofed forwarding entries cannot bypass a client rate limit', async () => {
  const app = buildTestApp({ nodeEnv: 'production' });

  const first = await request(app)
    .get('/ping')
    .set('X-Forwarded-For', '203.0.113.10, 198.51.100.1');
  const second = await request(app)
    .get('/ping')
    .set('X-Forwarded-For', '203.0.113.10, 192.0.2.200');

  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.equal(second.body.error.code, 'RATE_LIMIT_EXCEEDED');
});

test('proxied rate-limit keys remain independent for different intended clients', async () => {
  const app = buildTestApp({ nodeEnv: 'production' });

  const firstClient = await request(app)
    .get('/ping')
    .set('X-Forwarded-For', '203.0.113.10, 198.51.100.1');
  const secondClient = await request(app)
    .get('/ping')
    .set('X-Forwarded-For', '203.0.113.11, 198.51.100.1');

  assert.equal(firstClient.status, 200);
  assert.equal(secondClient.status, 200);
  assert.equal(firstClient.body.data.ip, '203.0.113.10');
  assert.equal(secondClient.body.data.ip, '203.0.113.11');
});

test('social authentication limiter definitions match the locked budgets', () => {
  assert.deepEqual(SOCIAL_RATE_LIMITS, {
    challenge: { windowMs: 15 * 60 * 1000, limit: 30 },
    googleLogin: { windowMs: 15 * 60 * 1000, limit: 20 },
    googleLinkIp: { windowMs: 15 * 60 * 1000, limit: 20 },
    googleLinkUser: { windowMs: 15 * 60 * 1000, limit: 10 },
    linkChallengeUser: { windowMs: 15 * 60 * 1000, limit: 10 },
  });
});

test('authenticated social-link rate limiting keys by required user identity', () => {
  assert.equal(authenticatedUserKey({ auth: { userId: 'user-a' } }), 'user-a');
  assert.equal(authenticatedUserKey({ auth: { userId: 'user-b' } }), 'user-b');
  assert.throws(
    () => authenticatedUserKey({}),
    (error) => error.statusCode === 401 && error.code === 'AUTH_SESSION_INVALID'
  );
});
