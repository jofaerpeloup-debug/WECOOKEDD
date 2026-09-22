process.env.NODE_ENV = 'test';
process.env.PORT = '4000';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

// Importing app.js must not start a server or touch MongoDB.
const { createApp } = require('../src/app');

const app = createApp();

test('direct/local requests keep proxy trust disabled', async () => {
  const response = await request(app).get('/api/v1/health');

  assert.equal(response.status, 200);
  assert.equal(app.get('trust proxy'), false);
});

test('GET /api/v1/health returns the standard success envelope', async () => {
  const response = await request(app).get('/api/v1/health');

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.status, 'ok');
});

test('unknown routes return the standard 404 error envelope', async () => {
  const response = await request(app).get('/api/v1/does-not-exist');

  assert.equal(response.status, 404);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error.code, 'ROUTE_NOT_FOUND');
  assert.equal(response.body.error.message, 'Route not found.');
});

test('requests from an unlisted browser origin are rejected', async () => {
  const response = await request(app)
    .get('/api/v1/health')
    .set('Origin', 'https://evil.example.com');

  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'CORS_NOT_ALLOWED');
});

test('requests from a configured/allowed browser origin are accepted', async () => {
  const response = await request(app)
    .get('/api/v1/health')
    .set('Origin', 'http://localhost:5173');

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:5173');
});

test('requests with no Origin header (e.g. native clients) are allowed', async () => {
  const response = await request(app).get('/api/v1/health');

  assert.equal(response.status, 200);
});

// Body parsing runs ahead of routing (app.use(express.json()) precedes
// app.use('/api/v1', v1Routes)), so a malformed/oversized body is rejected
// before any route or rate limiter is consulted — any path exercises it.
test('malformed JSON body returns a safe 400 without echoing the body or leaking parser internals', async () => {
  const response = await request(app)
    .post('/api/v1/does-not-exist')
    .set('Content-Type', 'application/json')
    .send('{"unterminated": ');

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error.code, 'REQUEST_BODY_INVALID');
  assert.equal(response.body.error.message, 'Request body is invalid.');
  const raw = JSON.stringify(response.body);
  assert.equal(raw.includes('unterminated'), false);
  assert.equal(raw.includes('SyntaxError'), false);
  assert.equal(raw.includes('at JSON.parse'), false);
});

// Regression: body-parser attaches the raw, unparsed payload as `err.body`
// (body-parser/lib/read.js) so its own handlers can inspect it. Passing that
// error straight to console.error would print the raw payload — including a
// plaintext password from a malformed /auth/login body — to the server log.
test('malformed JSON body never logs the raw request payload (e.g. a submitted password) to the server console', async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args));

  const response = await request(app)
    .post('/api/v1/auth/login')
    .set('Content-Type', 'application/json')
    .send('{"email":"ada@example.com","password":"SuperSecret123');

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'REQUEST_BODY_INVALID');
  const serialized = JSON.stringify(logged);
  assert.equal(serialized.includes('SuperSecret123'), false);
  assert.equal(serialized.includes('ada@example.com'), false);
});

test('a JSON body over the 1mb limit returns a safe 413 without leaking parser internals', async () => {
  const oversizedPayload = JSON.stringify({ padding: 'a'.repeat(2 * 1024 * 1024) });

  const response = await request(app)
    .post('/api/v1/does-not-exist')
    .set('Content-Type', 'application/json')
    .send(oversizedPayload);

  assert.equal(response.status, 413);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error.code, 'REQUEST_BODY_TOO_LARGE');
  assert.equal(response.body.error.message, 'Request body is too large.');
  const raw = JSON.stringify(response.body);
  assert.equal(raw.includes('entity.too.large'), false);
  assert.equal(raw.includes('limit'), false);
});
