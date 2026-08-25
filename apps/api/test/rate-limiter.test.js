process.env.NODE_ENV = 'test';
process.env.PORT = '4003';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const { createRateLimiter } = require('../src/middleware/rate-limiter');
const { errorMiddleware } = require('../src/middleware/error.middleware');

// A tiny test-only app with a 1-request limit, so the standardized 429
// behavior can be proven with two requests instead of hundreds.
function buildTestApp() {
  const app = express();
  app.use(createRateLimiter({ windowMs: 60_000, limit: 1 }));
  app.get('/ping', (req, res) => res.json({ success: true, data: { pong: true } }));
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
