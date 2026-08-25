process.env.NODE_ENV = 'test';
process.env.PORT = '4001';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const { errorMiddleware } = require('../src/middleware/error.middleware');
const { AppError } = require('../src/shared/errors/app-error');

// A minimal, test-only Express app that exercises the real errorMiddleware
// without adding a throwing route to the production app.
function buildTestApp(routeHandler) {
  const app = express();
  app.get('/boom', routeHandler);
  app.use(errorMiddleware);
  return app;
}

test('unexpected errors produce the standard 500 envelope', async () => {
  const app = buildTestApp((req, res, next) => next(new Error('unexpected failure')));

  const response = await request(app).get('/boom');

  assert.equal(response.status, 500);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error.code, 'INTERNAL_SERVER_ERROR');
  assert.equal(response.body.error.message, 'An unexpected error occurred.');
  assert.equal(response.body.error.message.includes('unexpected failure'), false);
});

test('AppError instances control status, code, and message', async () => {
  const app = buildTestApp((req, res, next) =>
    next(new AppError('Nope.', { statusCode: 418, code: 'IM_A_TEAPOT' }))
  );

  const response = await request(app).get('/boom');

  assert.equal(response.status, 418);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error.code, 'IM_A_TEAPOT');
  assert.equal(response.body.error.message, 'Nope.');
});
