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
  INGREDIENT_RESOLUTION_RATE_LIMIT,
  createIngredientResolutionRateLimiter,
  ASSISTANT_RATE_LIMITS,
  createAssistantRateLimiters,
  AVATAR_UPLOAD_RATE_LIMIT,
  createAvatarUploadRateLimiter,
} = require('../src/middleware/rate-limiter');
const { errorMiddleware } = require('../src/middleware/error.middleware');
const { createApp, configureProxyTrust } = require('../src/app');

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

test('avatar limiter has an isolated 10-per-15-minute counter keyed only by authenticated user', async () => {
  assert.deepEqual(AVATAR_UPLOAD_RATE_LIMIT, { windowMs: 15 * 60 * 1000, limit: 10 });
  const app = express();
  app.use((req, res, next) => { req.auth = { userId: req.get('X-Test-User') }; next(); });
  app.post('/avatar', createAvatarUploadRateLimiter(), (req, res) => res.json({ success: true }));
  app.post('/other-budget', createAvatarUploadRateLimiter(), (req, res) => res.json({ success: true }));
  app.use(errorMiddleware);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal((await request(app).post('/avatar').set('X-Test-User', 'user-a')).status, 200);
  }
  assert.equal((await request(app).post('/avatar').set('X-Test-User', 'user-a')).status, 429);
  assert.equal((await request(app).post('/avatar').set('X-Test-User', 'user-b')).status, 200);
  assert.equal((await request(app).post('/other-budget').set('X-Test-User', 'user-a')).status, 200);
});

test('authenticated social-link rate limiting keys by required user identity', () => {
  assert.equal(authenticatedUserKey({ auth: { userId: 'user-a' } }), 'user-a');
  assert.equal(authenticatedUserKey({ auth: { userId: 'user-b' } }), 'user-b');
  assert.throws(
    () => authenticatedUserKey({}),
    (error) => error.statusCode === 401 && error.code === 'AUTH_SESSION_INVALID'
  );
});

test('ingredient resolution has the frozen dedicated per-user budget', () => {
  assert.deepEqual(INGREDIENT_RESOLUTION_RATE_LIMIT, { windowMs: 15 * 60 * 1000, limit: 30 });
});

test('ingredient resolution permits 30 requests per user and rejects request 31 independently', async () => {
  const app = express();
  app.use((req, res, next) => { req.auth = { userId: req.get('X-Test-User') }; next(); });
  app.use(createIngredientResolutionRateLimiter());
  app.post('/resolve', (req, res) => res.json({ success: true }));
  app.use(errorMiddleware);
  for (let count = 1; count <= 30; count += 1) {
    const response = await request(app).post('/resolve').set('X-Test-User', 'moderator-a');
    assert.equal(response.status, 200, `request ${count}`);
  }
  const limited = await request(app).post('/resolve').set('X-Test-User', 'moderator-a');
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'RATE_LIMIT_EXCEEDED');
  const independent = await request(app).post('/resolve').set('X-Test-User', 'moderator-b');
  assert.equal(independent.status, 200);
});

function buildAssistantLimiterApp({ useUser, useIp }) {
  const limiters = createAssistantRateLimiters();
  const app = express();
  app.use((req, res, next) => {
    req.auth = { userId: req.get('X-Test-User') || 'user-a' };
    next();
  });
  if (useUser) app.use(limiters.user);
  if (useIp) app.use(limiters.ip);
  app.post('/chat', (req, res) => res.json({ success: true }));
  app.use(errorMiddleware);
  return app;
}

test('Assistant limiters have independent frozen user and IP budgets', async () => {
  assert.deepEqual(ASSISTANT_RATE_LIMITS, {
    user: { windowMs: 15 * 60 * 1000, limit: 10 },
    ip: { windowMs: 15 * 60 * 1000, limit: 20 },
  });

  const byUser = buildAssistantLimiterApp({ useUser: true, useIp: false });
  for (let count = 1; count <= 10; count += 1) {
    assert.equal((await request(byUser).post('/chat')).status, 200);
  }
  assert.equal((await request(byUser).post('/chat')).body.error.code, 'RATE_LIMIT_EXCEEDED');
  assert.equal(
    (await request(byUser).post('/chat').set('X-Test-User', 'user-b')).status,
    200
  );

  const byIp = buildAssistantLimiterApp({ useUser: false, useIp: true });
  for (let count = 1; count <= 20; count += 1) {
    assert.equal(
      (await request(byIp).post('/chat').set('X-Test-User', `user-${count}`)).status,
      200
    );
  }
  const limited = await request(byIp).post('/chat').set('X-Test-User', 'user-21');
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'RATE_LIMIT_EXCEEDED');
});

test('the existing global limiter permits 300 requests per IP and rejects request 301', async () => {
  const app = createApp();
  for (let count = 1; count <= 300; count += 1) {
    const response = await request(app).get('/api/v1/health');
    assert.equal(response.status, 200, `request ${count}`);
  }

  const limited = await request(app).get('/api/v1/health');
  assert.equal(limited.status, 429);
  assert.deepEqual(limited.body, {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please try again later.',
    },
  });
});
