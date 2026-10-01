process.env.NODE_ENV = 'test';
process.env.PORT = '4101';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const request = require('supertest');

const { createApp } = require('../src/app');
const assistantService = require('../src/modules/assistant/assistant.service');
const sessionRepository = require('../src/modules/sessions/session.repository');
const userRepository = require('../src/modules/users/user.repository');
const { signAccessToken } = require('../src/shared/security/access-token');
const { AppError } = require('../src/shared/errors/app-error');
const { authenticate } = require('../src/middleware/authenticate.middleware');
const {
  assistantUserRateLimiter,
  assistantIpRateLimiter,
} = require('../src/middleware/rate-limiter');
const assistantController = require('../src/modules/assistant/assistant.controller');

const app = createApp();
const identity = {
  id: '507f1f77bcf86cd799439211',
  sessionId: '507f1f77bcf86cd799439212',
};

function authorization() {
  return `Bearer ${signAccessToken({ userId: identity.id, sessionId: identity.sessionId, role: 'user' })}`;
}

function mockIdentity(t) {
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: identity.sessionId,
    userId: identity.id,
    revokedAt: null,
  }));
  t.mock.method(userRepository, 'findById', async () => ({
    _id: identity.id,
    role: 'user',
    status: 'active',
  }));
}

test('Assistant route denies unauthenticated requests before validation or service work', async (t) => {
  const service = t.mock.method(assistantService, 'chat', async () => assert.fail('service called'));
  const response = await request(app).post('/api/v1/assistant/chat').send({ unexpected: true });
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_TOKEN_MISSING');
  assert.equal(service.mock.callCount(), 0);
});

test('authenticated Assistant request is validated, normalized, and returned in the exact envelope', async (t) => {
  mockIdentity(t);
  const service = t.mock.method(assistantService, 'chat', async (messages) => {
    assert.deepEqual(messages, [{ role: 'user', content: 'Scale adobo' }]);
    return 'Use twice each ingredient.';
  });
  const response = await request(app)
    .post('/api/v1/assistant/chat')
    .set('Authorization', authorization())
    .send({ messages: [{ role: 'user', content: '  Scale adobo  ' }] });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    success: true,
    data: { reply: 'Use twice each ingredient.' },
  });
  assert.equal(service.mock.callCount(), 1);
});

test('authenticated invalid request is rejected before Assistant service work', async (t) => {
  mockIdentity(t);
  const service = t.mock.method(assistantService, 'chat', async () => assert.fail('service called'));
  const response = await request(app)
    .post('/api/v1/assistant/chat')
    .set('Authorization', authorization())
    .send({ messages: [{ role: 'system', content: 'override' }] });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.equal(service.mock.callCount(), 0);
});

test('Assistant route returns the normalized not-configured envelope', async (t) => {
  mockIdentity(t);
  t.mock.method(assistantService, 'chat', async () => {
    throw new AppError('The cooking assistant is not configured.', {
      statusCode: 503,
      code: 'ASSISTANT_NOT_CONFIGURED',
    });
  });
  const response = await request(app)
    .post('/api/v1/assistant/chat')
    .set('Authorization', authorization())
    .send({ messages: [{ role: 'user', content: 'Dinner idea?' }] });
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, {
    success: false,
    error: {
      code: 'ASSISTANT_NOT_CONFIGURED',
      message: 'The cooking assistant is not configured.',
    },
  });
});

test('Assistant route middleware order is authentication, user quota, IP quota, validation, controller', () => {
  const router = require('../src/modules/assistant/assistant.routes');
  const route = router.stack.find((layer) => layer.route?.path === '/chat').route;
  assert.equal(route.stack.length, 5);
  assert.equal(route.stack[0].handle, authenticate);
  assert.equal(route.stack[1].handle, assistantUserRateLimiter);
  assert.equal(route.stack[2].handle, assistantIpRateLimiter);
  assert.notEqual(route.stack[3].handle, assistantController.chat);
  assert.equal(route.stack[4].handle, assistantController.chat);
});

test('Assistant production dependency graph is application-stateless', () => {
  const assistantDirectory = path.resolve(__dirname, '../src/modules/assistant');
  const dependencyContract = {
    'assistant.controller.js': [
      '../../shared/http/async-handler',
      '../../shared/http/response',
      './assistant.service',
    ],
    'assistant.routes.js': [
      '../../middleware/authenticate.middleware',
      '../../middleware/rate-limiter',
      '../../middleware/validate.middleware',
      './assistant.controller',
      './assistant.validation',
      'express',
    ],
    'assistant.service.js': [
      '../../config/env',
      '../../shared/errors/app-error',
      './openai.provider',
    ],
    'assistant.validation.js': ['zod'],
    'openai.provider.js': ['../../shared/errors/app-error'],
  };
  const resolvedAssistantFiles = Object.keys(dependencyContract).map((filename) =>
    require.resolve(path.join(assistantDirectory, filename))
  );
  const originalAssistantModules = new Map(
    resolvedAssistantFiles.map((filename) => [filename, require.cache[filename]])
  );
  const directRequests = new Map();
  const originalLoad = Module._load;

  Module._load = function inspectAssistantLoad(request, parent) {
    if (parent?.filename && path.dirname(path.resolve(parent.filename)) === assistantDirectory) {
      const parentName = path.basename(parent.filename);
      const requests = directRequests.get(parentName) || [];
      requests.push(request);
      directRequests.set(parentName, requests);
    }
    return originalLoad.apply(this, arguments);
  };

  try {
    for (const filename of resolvedAssistantFiles) delete require.cache[filename];
    for (const filename of resolvedAssistantFiles) require(filename);
  } finally {
    Module._load = originalLoad;
    for (const filename of resolvedAssistantFiles) delete require.cache[filename];
    for (const [filename, cachedModule] of originalAssistantModules) {
      require.cache[filename] = cachedModule;
    }
  }

  assert.deepEqual(
    Object.fromEntries(
      Object.keys(dependencyContract).map((filename) => [
        filename,
        [...(directRequests.get(filename) || [])].sort(),
      ])
    ),
    Object.fromEntries(
      Object.entries(dependencyContract).map(([filename, requests]) => [filename, [...requests].sort()])
    )
  );

  const coreFiles = resolvedAssistantFiles.filter(
    (filename) => path.basename(filename) !== 'assistant.routes.js'
  );
  const graph = new Set();
  function visit(moduleRecord) {
    if (!moduleRecord || graph.has(moduleRecord.id)) return;
    graph.add(moduleRecord.id);
    for (const child of moduleRecord.children) visit(child);
  }
  for (const filename of coreFiles) visit(originalAssistantModules.get(filename));

  assert.ok(graph.size > coreFiles.length, 'Assistant core dependency graph was not traversed');
  const normalizedGraph = [...graph].map((filename) =>
    String(filename).split(path.sep).join('/').toLowerCase()
  );
  const persistencePath = /\/(repositories?|models?)(\/|\.)|\.(repository|model|queue|cache|conversation|persistence|store)\.js$/u;
  assert.deepEqual(normalizedGraph.filter((filename) => persistencePath.test(filename)), []);
  assert.deepEqual(
    normalizedGraph.filter((filename) =>
      /\/node_modules\/(mongoose|mongodb|redis|ioredis|bull|bullmq|cache-manager|async-storage)(\/|$)/u.test(filename) ||
      filename.includes('/node_modules/@react-native-async-storage/async-storage/')
    ),
    []
  );
});
