process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.JWT_ACCESS_SECRET = 'history-route-test-secret-at-least-32-chars';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.OPENAI_API_KEY = '';
process.env.OPENAI_MODEL = '';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const repo = require('../src/modules/assistant/assistant-history.repository');
const historyService = require('../src/modules/assistant/assistant-history.service');
const assistantService = require('../src/modules/assistant/assistant.service');
const sessionService = require('../src/modules/sessions/session.service');
const userService = require('../src/modules/users/user.service');
const { signAccessToken } = require('../src/shared/security/access-token');
const { AppError } = require('../src/shared/errors/app-error');
const base = '/api/v1/assistant/conversations';
const owner = '507f1f77bcf86cd799439011';
const other = '507f1f77bcf86cd799439012';
const sessionId = '507f1f77bcf86cd799439031';
const id = '507f1f77bcf86cd799439021';
const requestId = '6f476b68-91d7-4b16-99dc-5cc0b0dacdbb';
const start = new Date();
const parent = { _id: id, userId: owner, createRequestId: requestId, createdAt: start,
  updatedAt: start, expiresAt: new Date(+start + 2592000000), version: 0, privateField: 'hidden' };
function authorization(userId = owner) {
  return `Bearer ${signAccessToken({ userId, sessionId, role: 'user' })}`;
}
function identity(t, { status = 'active', deactivatedAt = null, userGeneration = 2,
  sessionGeneration = 2, missingSession = false, foreignSession = false } = {}) {
  t.mock.method(console, 'error', () => {});
  t.mock.method(sessionService, 'getActiveSessionById', async () => missingSession ? null : ({
    _id: sessionId, userId: foreignSession ? other : owner, securityGeneration: sessionGeneration,
  }));
  t.mock.method(userService, 'getUserById', async () => ({
    _id: owner, role: 'user', status, deactivatedAt, sessionGeneration: userGeneration,
  }));
}
function providerForbidden(t) {
  return t.mock.method(assistantService, 'chat', async () => assert.fail('CRUD called generation'));
}
function assertPrivateResponse(response, status = 200) {
  assert.equal(response.status, status);
  assert.equal(response.headers['cache-control'], 'no-store');
  // Validation may name a rejected caller field (the shared convention).
  // Success data must contain none of the private record fields.
  const json = JSON.stringify(response.body.success ? response.body.data : response.body);
  for (const privateText of ['hidden', 'userId', 'createRequestId', 'replaySnapshot', 'fingerprint', 'fence']) {
    if (!response.body.success && privateText !== 'hidden') continue;
    assert.equal(json.includes(privateText), false, privateText);
  }
}

test('real mounted CRUD honors exact envelope/status/identity, is no-store and never calls unconfigured AI1', async (t) => {
  identity(t);
  const spy = providerForbidden(t);
  let created = false;
  t.mock.method(repo, 'createConversation', async (input) => {
    assert.equal(input.userId, owner); assert.equal(input.requestId, requestId);
    assert.ok(input.now instanceof Date);
    const result = { row: parent, created: !created }; created = true; return result;
  });
  t.mock.method(repo, 'findConversations', async (input) => {
    assert.equal(input.userId, owner); assert.equal(input.limit, 20); return [parent];
  });
  t.mock.method(repo, 'findConversation', async (input) => {
    assert.equal(input.userId, owner); assert.equal(input.conversationId, id); return parent;
  });
  t.mock.method(repo, 'findMessages', async (input) => {
    assert.equal(input.userId, owner); assert.equal(input.conversationId, id);
    return [{ _id: other, userId: owner, conversationId: id, role: 'user', content: 'lentils',
      sequence: 0, createdAt: start, expiresAt: parent.expiresAt, status: 'failed', fingerprint: 'hidden' }];
  });
  t.mock.method(repo, 'deleteConversation', async (input) => {
    assert.equal(input.userId, owner); assert.equal(input.conversationId, id); return parent;
  });
  const app = createApp();
  const first = await request(app).post(base).set('Authorization', authorization()).send({ requestId });
  assertPrivateResponse(first, 201);
  assert.deepEqual(Object.keys(first.body.data), ['conversation']);
  assert.deepEqual(Object.keys(first.body.data.conversation), ['id', 'createdAt', 'updatedAt', 'expiresAt', 'version']);
  const replay = await request(app).post(base).set('Authorization', authorization()).send({ requestId });
  assertPrivateResponse(replay);
  assert.deepEqual(replay.body.data, first.body.data);
  const list = await request(app).get(base).set('Authorization', authorization());
  assertPrivateResponse(list);
  assert.deepEqual(list.body.data, { conversations: [first.body.data.conversation], pageInfo: { hasMore: false, nextCursor: null } });
  const open = await request(app).get(`${base}/${id}`).set('Authorization', authorization());
  assertPrivateResponse(open);
  assert.equal(open.body.data.messages[0].content, 'lentils');
  assert.equal(open.body.data.messages[0].status, 'failed');
  const deleted = await request(app).delete(`${base}/${id}`).set('Authorization', authorization());
  assertPrivateResponse(deleted);
  assert.deepEqual(deleted.body, { success: true, data: { deleted: true } });
  assert.equal(spy.mock.callCount(), 0);
});

test('all mounted history operations deny unauthenticated access before storage/provider', async (t) => {
  t.mock.method(console, 'error', () => {});
  const spy = providerForbidden(t);
  for (const method of ['createConversation', 'findConversations', 'findConversation', 'findMessages', 'deleteConversation']) {
    t.mock.method(repo, method, () => assert.fail('Unauthenticated storage access'));
  }
  const app = createApp();
  for (const [method, path] of [['post', base], ['get', base], ['get', `${base}/${id}`], ['delete', `${base}/${id}`]]) {
    const result = await request(app)[method](path).send({ userId: other });
    assertPrivateResponse(result, 401);
    assert.equal(result.body.error.code, 'AUTH_TOKEN_MISSING');
  }
  assert.equal(spy.mock.callCount(), 0);
});

for (const [name, state] of [
  ['suspended', { status: 'suspended' }], ['deactivated', { deactivatedAt: new Date() }],
  ['revoked/missing', { missingSession: true }], ['stale generation', { sessionGeneration: 1 }],
  ['foreign session', { foreignSession: true }],
]) {
  test(`ACCOUNT2 ${name} sessions cannot touch history`, async (t) => {
    identity(t, state);
    providerForbidden(t);
    const spy = t.mock.method(repo, 'findConversations', () => assert.fail('Invalid session touched history'));
    const response = await request(createApp()).get(base).set('Authorization', authorization());
    assertPrivateResponse(response, 401);
    assert.equal(response.body.error.code, 'AUTH_SESSION_INVALID');
    assert.equal(spy.mock.callCount(), 0);
  });
}

test('strict unknown fields/malformed IDs/foreign cursors fail safely before storage', async (t) => {
  identity(t); providerForbidden(t);
  for (const method of ['createConversation', 'findConversations', 'findConversation', 'findMessages', 'deleteConversation']) {
    t.mock.method(repo, method, () => assert.fail('Invalid input touched storage'));
  }
  const app = createApp();
  for (const [method, path, body] of [
    ['post', base, { requestId, userId: other }], ['post', `${base}?owner=${other}`, { requestId }],
    ['get', `${base}/bad`, undefined], ['get', `${base}?limit=51`, undefined],
    ['get', `${base}?cursor=forged`, undefined], ['get', `${base}/${id}?cursor=forged`, undefined],
    ['delete', `${base}/${id}?limit=20`, {}], ['delete', `${base}/${id}`, { expiresAt: 'tomorrow' }],
  ]) {
    const call = request(app)[method](path).set('Authorization', authorization());
    if (body) call.send(body);
    const response = await call;
    assertPrivateResponse(response, 400); assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  }
});

test('well-formed foreign/missing/expired conversations have identical opaque errors', async (t) => {
  identity(t); providerForbidden(t);
  t.mock.method(repo, 'findConversation', async () => null);
  t.mock.method(repo, 'deleteConversation', async () => null);
  t.mock.method(repo, 'createConversation', async () => ({ row: { ...parent, expiresAt: new Date(0) }, created: false }));
  const app = createApp();
  const bodies = [];
  for (const [method, path] of [['get', `${base}/${id}`], ['get', `${base}/${other}`], ['delete', `${base}/${id}`], ['post', base]]) {
    const call = request(app)[method](path).set('Authorization', authorization());
    if (method === 'post') call.send({ requestId });
    const response = await call;
    assertPrivateResponse(response, 404);
    assert.deepEqual(response.body.error, { code: 'ASSISTANT_CONVERSATION_NOT_FOUND', message: 'Conversation not found.' });
    bodies.push(response.body);
  }
  assert.ok(bodies.every((body) => JSON.stringify(body) === JSON.stringify(bodies[0])));
});

test('history CRUD does not consume the existing shared Assistant user allowance', async (t) => {
  identity(t);
  t.mock.method(repo, 'findConversations', async () => []);
  const chat = t.mock.method(assistantService, 'chat', async () => 'real normalized test reply');
  const app = createApp();
  for (let count = 0; count < 12; count += 1) {
    const response = await request(app).get(base).set('Authorization', authorization());
    assertPrivateResponse(response);
  }
  assert.equal(chat.mock.callCount(), 0);
  for (let count = 0; count < 10; count += 1) {
    const response = await request(app).post('/api/v1/assistant/chat').set('Authorization', authorization())
      .send({ messages: [{ role: 'user', content: 'lentils' }] });
    assert.equal(response.status, 200);
    assert.equal(response.headers['cache-control'], undefined);
  }
  const limit = await request(app).post('/api/v1/assistant/chat').set('Authorization', authorization())
    .send({ messages: [{ role: 'user', content: 'lentils' }] });
  assert.equal(limit.status, 429);
  assert.equal(limit.headers['cache-control'], undefined);
  assert.equal(chat.mock.callCount(), 10);
});

test('database failure and late controller expiry do not expose success or raw errors', async (t) => {
  identity(t); providerForbidden(t);
  t.mock.method(repo, 'deleteConversation', async () => { throw new Error('private database detail'); });
  const app = createApp();
  const failed = await request(app).delete(`${base}/${id}`).set('Authorization', authorization());
  assertPrivateResponse(failed, 500);
  assert.equal(JSON.stringify(failed.body).includes('private database detail'), false);
  t.mock.method(historyService, 'open', async () => ({ conversation: { expiresAt: new Date(0).toISOString() },
    messages: [{ content: 'private content' }], pageInfo: { hasMore: false, nextCursor: null } }));
  const expired = await request(app).get(`${base}/${id}`).set('Authorization', authorization());
  assertPrivateResponse(expired, 404);
  assert.equal(JSON.stringify(expired.body).includes('private content'), false);
});

test('malformed JSON history failure uses no-store before parsing rejects it', async (t) => {
  identity(t); providerForbidden(t);
  const response = await request(createApp()).post(base).set('Authorization', authorization())
    .set('Content-Type', 'application/json').send('{');
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'REQUEST_BODY_INVALID');
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('global 300/301 history limiter failure uses no-store without changing its limit', async (t) => {
  t.mock.method(console, 'error', () => {}); providerForbidden(t);
  const app = createApp();
  for (let count = 0; count < 300; count += 1) {
    const response = await request(app).get(base);
    assert.equal(response.status, 401);
  }
  const response = await request(app).get(base);
  assert.equal(response.status, 429);
  assert.equal(response.body.error.code, 'RATE_LIMIT_EXCEEDED');
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('history CORS rejection, allowed origin and preflight retain CORS behavior and no-store', async (t) => {
  t.mock.method(console, 'error', () => {});
  const spy = providerForbidden(t);
  const app = createApp();
  // CORS must still reject before malformed JSON reaches the parser.
  const denied = await request(app).post(`${base}/${id}`)
    .set('Origin', 'https://unapproved.example').set('Content-Type', 'application/json').send('{');
  assertPrivateResponse(denied, 403);
  assert.equal(denied.body.error.code, 'CORS_NOT_ALLOWED');
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
  const allowed = await request(app).get(`${base}/?limit=20`).set('Origin', 'http://localhost:5173');
  assertPrivateResponse(allowed, 401);
  assert.equal(allowed.body.error.code, 'AUTH_TOKEN_MISSING');
  assert.equal(allowed.headers['access-control-allow-origin'], 'http://localhost:5173');
  assert.equal(allowed.headers['access-control-allow-credentials'], 'true');
  const preflight = await request(app).options(base).set('Origin', 'http://localhost:5173')
    .set('Access-Control-Request-Method', 'POST');
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['cache-control'], 'no-store');
  assert.equal(preflight.headers['access-control-allow-origin'], 'http://localhost:5173');
  assert.equal(spy.mock.callCount(), 0);
});

test('oversized history JSON still rejects at the unchanged parser bound with no-store', async (t) => {
  t.mock.method(console, 'error', () => {}); providerForbidden(t);
  const response = await request(createApp()).post(base).send({ content: 'x'.repeat(1024 * 1024) });
  assertPrivateResponse(response, 413);
  assert.equal(response.body.error.code, 'REQUEST_BODY_TOO_LARGE');
});

test('unrelated routes, prefix lookalikes and AI1 rejection do not receive history headers', async (t) => {
  t.mock.method(console, 'error', () => {});
  const spy = providerForbidden(t);
  const app = createApp();
  for (const path of ['/api/v1/health', `${base}-extra`, '/api/v1/assistant/conversationsExtra']) {
    const response = await request(app).get(path);
    assert.equal(response.status, path === '/api/v1/health' ? 200 : 404);
    assert.equal(response.headers['cache-control'], undefined, path);
  }
  const malformedChat = await request(app).post('/api/v1/assistant/chat')
    .set('Content-Type', 'application/json').send('{');
  assert.equal(malformedChat.status, 400);
  assert.equal(malformedChat.body.error.code, 'REQUEST_BODY_INVALID');
  assert.equal(malformedChat.headers['cache-control'], undefined);
  const unauthenticatedChat = await request(app).post('/api/v1/assistant/chat').send({ messages: [] });
  assert.equal(unauthenticatedChat.status, 401);
  assert.equal(unauthenticatedChat.body.error.code, 'AUTH_TOKEN_MISSING');
  assert.equal(unauthenticatedChat.headers['cache-control'], undefined);
  const unrelatedCors = await request(app).get('/api/v1/health').set('Origin', 'https://unapproved.example');
  assert.equal(unrelatedCors.status, 403);
  assert.equal(unrelatedCors.body.error.code, 'CORS_NOT_ALLOWED');
  assert.equal(unrelatedCors.headers['cache-control'], undefined);
  assert.equal(spy.mock.callCount(), 0);
});
