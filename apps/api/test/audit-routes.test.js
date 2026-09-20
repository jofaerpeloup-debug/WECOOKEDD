process.env.NODE_ENV = 'test';
process.env.PORT = '4063';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createApp } = require('../src/app');
const auditLogRepository = require('../src/modules/audit/audit-log.repository');
const sessionRepository = require('../src/modules/sessions/session.repository');
const userRepository = require('../src/modules/users/user.repository');
const { signAccessToken } = require('../src/shared/security/access-token');

const app = createApp();
const PATH = '/api/v1/admin/audit-logs';

const IDENTITIES = Object.freeze({
  admin: Object.freeze({
    id: '507f1f77bcf86cd799439401',
    sessionId: '507f1f77bcf86cd799439402',
    role: 'admin',
  }),
  moderator: Object.freeze({
    id: '507f1f77bcf86cd799439403',
    sessionId: '507f1f77bcf86cd799439404',
    role: 'moderator',
  }),
  user: Object.freeze({
    id: '507f1f77bcf86cd799439405',
    sessionId: '507f1f77bcf86cd799439406',
    role: 'user',
  }),
});

const TARGET_ID = '507f1f77bcf86cd799439407';
const APPLICATION_ID = '507f1f77bcf86cd799439408';

function tokenFor(identity) {
  return signAccessToken({
    userId: identity.id,
    role: identity.role,
    sessionId: identity.sessionId,
  });
}

function authorize(requestBuilder, identity) {
  return requestBuilder.set('Authorization', `Bearer ${tokenFor(identity)}`);
}

function mockIdentity(t, identity) {
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: identity.sessionId,
    userId: identity.id,
    revokedAt: null,
  }));
  t.mock.method(userRepository, 'findById', async () => ({
    _id: identity.id,
    role: identity.role,
    status: 'active',
  }));
}

function auditDocument(eventType, metadata, overrides = {}) {
  return {
    _id: overrides._id ?? '507f1f77bcf86cd799439409',
    eventType,
    actorUserId: IDENTITIES.admin.id,
    actorRole: 'admin',
    targetType:
      eventType === 'admin.staff.application_rejected' ? 'moderator_application' : 'user',
    targetId:
      eventType === 'admin.staff.application_rejected' ? APPLICATION_ID : TARGET_ID,
    outcome: 'success',
    reasonCode: undefined,
    metadata,
    createdAt: new Date('2026-09-20T01:02:03.000Z'),
    __v: 99,
    email: 'never@example.com',
    name: 'Never Expose',
    passwordHash: 'forbidden-password-hash',
    token: 'forbidden-token',
    request: { headers: { authorization: 'Bearer forbidden' } },
    ...overrides,
  };
}

test('GET audit logs requires authentication and sets no-store on the 401', async () => {
  const response = await request(app).get(PATH);
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_TOKEN_MISSING');
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('GET audit logs allows Admin and applies defaults', async (t) => {
  mockIdentity(t, IDENTITIES.admin);
  let options;
  t.mock.method(auditLogRepository, 'findMany', async (value) => {
    options = value;
    return [];
  });
  t.mock.method(auditLogRepository, 'countByFilter', async () => 0);

  const response = await authorize(request(app).get(PATH), IDENTITIES.admin);

  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.body, {
    success: true,
    data: {
      auditLogs: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    },
  });
  assert.deepEqual(options, { filter: {}, skip: 0, limit: 20 });
});

test('GET audit logs denies Moderator and User with no-store', async (t) => {
  for (const role of ['moderator', 'user']) {
    await t.test(role, async (t) => {
      mockIdentity(t, IDENTITIES[role]);
      const response = await authorize(request(app).get(PATH), IDENTITIES[role]);
      assert.equal(response.status, 403);
      assert.equal(response.body.error.code, 'FORBIDDEN');
      assert.equal(response.headers['cache-control'], 'no-store');
    });
  }
});

test('authentication and authorization run before query validation', async (t) => {
  const unauthenticated = await request(app).get(`${PATH}?actorRole=admin&page=0`);
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.headers['cache-control'], 'no-store');

  mockIdentity(t, IDENTITIES.moderator);
  const forbidden = await authorize(
    request(app).get(`${PATH}?actorRole=admin&page=0`),
    IDENTITIES.moderator
  );
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers['cache-control'], 'no-store');
});

test('validation failures are 400 and carry no-store for an authorized Admin', async (t) => {
  mockIdentity(t, IDENTITIES.admin);
  for (const query of ['page=0', 'page=1&page=2', 'actorRole=admin', 'from=not-a-date']) {
    const response = await authorize(request(app).get(`${PATH}?${query}`), IDENTITIES.admin);
    assert.equal(response.status, 400, `expected ${query} rejected`);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    assert.equal(response.headers['cache-control'], 'no-store');
  }
});

test('GET audit logs constructs only approved filters and pagination', async (t) => {
  mockIdentity(t, IDENTITIES.admin);
  let findOptions;
  let countFilter;
  t.mock.method(auditLogRepository, 'findMany', async (value) => {
    findOptions = value;
    return [];
  });
  t.mock.method(auditLogRepository, 'countByFilter', async (value) => {
    countFilter = value;
    return 21;
  });

  const query =
    `eventType=admin.user.status_changed&actorUserId=${IDENTITIES.admin.id}` +
    `&targetType=user&targetId=${TARGET_ID}&outcome=partial_failure` +
    '&from=2026-09-01T00%3A00%3A00Z&to=2026-09-20T23%3A59%3A59%2B08%3A00' +
    '&page=2&limit=10';
  const response = await authorize(request(app).get(`${PATH}?${query}`), IDENTITIES.admin);

  assert.equal(response.status, 200);
  assert.equal(findOptions.skip, 10);
  assert.equal(findOptions.limit, 10);
  assert.deepEqual(findOptions.filter, countFilter);
  assert.deepEqual(findOptions.filter, {
    eventType: 'admin.user.status_changed',
    actorUserId: IDENTITIES.admin.id,
    targetType: 'user',
    targetId: TARGET_ID,
    outcome: 'partial_failure',
    createdAt: {
      $gte: new Date('2026-09-01T00:00:00Z'),
      $lte: new Date('2026-09-20T23:59:59+08:00'),
    },
  });
  assert.deepEqual(response.body.data.pagination, {
    page: 2,
    limit: 10,
    total: 21,
    totalPages: 3,
  });
});

test('GET audit logs serializes exact fields and event-specific metadata only', async (t) => {
  mockIdentity(t, IDENTITIES.admin);
  const documents = [
    auditDocument(
      'admin.user.status_changed',
      { fromStatus: 'active', toStatus: 'suspended', email: 'hidden@example.com' },
      { outcome: 'partial_failure', reasonCode: 'SESSION_REVOCATION_FAILED' }
    ),
    auditDocument(
      'admin.staff.moderator_approved',
      { applicationId: APPLICATION_ID, fromRole: 'user', toRole: 'moderator', token: 'hidden' },
      { _id: '507f1f77bcf86cd799439410' }
    ),
    auditDocument(
      'admin.staff.application_rejected',
      { applicationId: APPLICATION_ID, reason: 'private rejection text' },
      { _id: '507f1f77bcf86cd799439411' }
    ),
    auditDocument(
      'admin.staff.moderator_demoted',
      { fromRole: 'moderator', toRole: 'user', request: { password: 'hidden' } },
      { _id: '507f1f77bcf86cd799439412' }
    ),
  ];
  t.mock.method(auditLogRepository, 'findMany', async () => documents);
  t.mock.method(auditLogRepository, 'countByFilter', async () => documents.length);

  const response = await authorize(request(app).get(PATH), IDENTITIES.admin);

  assert.equal(response.status, 200);
  const logs = response.body.data.auditLogs;
  assert.equal(logs.length, 4);
  for (const log of logs) {
    assert.deepEqual(Object.keys(log).sort(), [
      'actorRole',
      'actorUserId',
      'createdAt',
      'eventType',
      'id',
      'metadata',
      'outcome',
      'reasonCode',
      'targetId',
      'targetType',
    ]);
    assert.equal(log.actorUserId, IDENTITIES.admin.id);
    assert.equal(log.createdAt, '2026-09-20T01:02:03.000Z');
  }
  assert.deepEqual(logs.map((log) => Object.keys(log.metadata)), [
    ['fromStatus', 'toStatus'],
    ['applicationId', 'fromRole', 'toRole'],
    ['applicationId'],
    ['fromRole', 'toRole'],
  ]);
  assert.equal(logs[1].metadata.applicationId, APPLICATION_ID);
  const serialized = JSON.stringify(response.body);
  for (const forbidden of [
    '__v',
    'never@example.com',
    'Never Expose',
    'forbidden-password-hash',
    'forbidden-token',
    'hidden@example.com',
    'private rejection text',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `must strip ${forbidden}`);
  }
});

test('database read failures propagate to central error handling', async (t) => {
  mockIdentity(t, IDENTITIES.admin);
  t.mock.method(auditLogRepository, 'findMany', async () => {
    throw new Error('private database read details');
  });
  t.mock.method(auditLogRepository, 'countByFilter', async () => 0);
  t.mock.method(console, 'error', () => {});

  const response = await authorize(request(app).get(PATH), IDENTITIES.admin);
  assert.equal(response.status, 500);
  assert.equal(response.body.error.code, 'INTERNAL_SERVER_ERROR');
  assert.equal(JSON.stringify(response.body).includes('private database read details'), false);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('audit endpoint exposes no mutation routes', async () => {
  for (const method of ['post', 'put', 'patch', 'delete']) {
    const response = await request(app)[method](PATH).send({});
    assert.equal(response.status, 404, `${method.toUpperCase()} must not exist`);
    assert.equal(response.body.error.code, 'ROUTE_NOT_FOUND');
  }
});

test('audit endpoint exposes no item mutation routes', async () => {
  for (const method of ['put', 'patch', 'delete']) {
    const response = await request(app)[method](`${PATH}/${TARGET_ID}`).send({});
    assert.equal(response.status, 404, `${method.toUpperCase()} /:id must not exist`);
    assert.equal(response.body.error.code, 'ROUTE_NOT_FOUND');
  }
});
