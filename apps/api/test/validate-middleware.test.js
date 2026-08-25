process.env.NODE_ENV = 'test';
process.env.PORT = '4012';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { z } = require('zod');

const { validate } = require('../src/middleware/validate.middleware');
const { errorMiddleware } = require('../src/middleware/error.middleware');

const schema = z.object({
  body: z.object({ email: z.string().email('Invalid email address.') }).strict(),
});

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.post('/thing', validate(schema), (req, res) => {
    res.json({ success: true, data: req.body });
  });
  app.use(errorMiddleware);
  return app;
}

test('valid requests pass through with parsed body', async () => {
  const app = buildTestApp();
  const response = await request(app).post('/thing').send({ email: 'a@example.com' });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.email, 'a@example.com');
});

test('invalid requests are rejected with the standard VALIDATION_ERROR envelope', async () => {
  const app = buildTestApp();
  const response = await request(app).post('/thing').send({ email: 'not-an-email' });

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.deepEqual(response.body.error.details, [
    { field: 'email', message: 'Invalid email address.' },
  ]);
});

test('unknown fields are rejected rather than silently dropped', async () => {
  const app = buildTestApp();
  const response = await request(app)
    .post('/thing')
    .send({ email: 'a@example.com', role: 'admin' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

// Express 5 exposes req.query as a getter-only property (no setter) — the
// original implementation assigned `req.query = result.data.query`, which
// is a no-op/throw under Express 5. These tests exercise a real query
// schema through a real Express 5 app to prove the fix: validated/
// normalized query values are readable from req.validated.query, and
// req.query itself is never reassigned.
const querySchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
});

function buildQueryTestApp() {
  const app = express();
  app.get('/list', validate(querySchema), (req, res) => {
    res.json({
      success: true,
      data: { validatedQuery: req.validated.query, rawQuery: req.query },
    });
  });
  app.use(errorMiddleware);
  return app;
}

test('query values are validated/normalized and exposed via req.validated.query, without overwriting req.query', async () => {
  const response = await request(buildQueryTestApp()).get('/list?limit=5');

  assert.equal(response.status, 200);
  assert.equal(response.body.data.validatedQuery.limit, 5);
  // req.query is untouched by the middleware — still Express's own raw
  // string value, not the coerced number the schema produced.
  assert.equal(response.body.data.rawQuery.limit, '5');
});

test('query schema defaults are applied via req.validated.query when the param is omitted', async () => {
  const response = await request(buildQueryTestApp()).get('/list');

  assert.equal(response.status, 200);
  assert.equal(response.body.data.validatedQuery.limit, 20);
});

test('invalid query values are still rejected with the standard VALIDATION_ERROR envelope', async () => {
  const response = await request(buildQueryTestApp()).get('/list?limit=not-a-number');

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});
