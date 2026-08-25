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
