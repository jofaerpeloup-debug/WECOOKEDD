process.env.NODE_ENV = 'test';
process.env.PORT = '4032';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

// Only the repository layer (the real Mongoose/DB boundary) is ever stubbed —
// the full validation -> authenticate -> authorize -> controller -> service
// chain runs unmodified. Same approach as auth-routes / ingredient-routes.
const { createApp } = require('../src/app');
const userRepository = require('../src/modules/users/user.repository');
const sessionRepository = require('../src/modules/sessions/session.repository');
const { signAccessToken } = require('../src/shared/security/access-token');

const app = createApp();

const ADMIN_ID = '507f1f77bcf86cd799439001';
const ADMIN_SESSION_ID = '507f1f77bcf86cd799439002';
const USER_ID = '507f1f77bcf86cd799439003';
const USER_SESSION_ID = '507f1f77bcf86cd799439004';
const TARGET_USER_ID = '507f1f77bcf86cd799439005';
const TARGET_ADMIN_ID = '507f1f77bcf86cd799439006';
const MISSING_ID = '507f1f77bcf86cd7994390ee';

const FORBIDDEN_HASH = '$2b$10$FORBIDDENhashFORBIDDENhashFORBIDDENhashFOO';

function userDoc({
  id = TARGET_USER_ID,
  email = 'person@example.com',
  name = 'Person',
  role = 'user',
  status = 'active',
} = {}) {
  return {
    _id: id,
    name,
    email,
    passwordHash: FORBIDDEN_HASH,
    authIdentities: [
      {
        provider: 'google',
        subject: 'private-subject',
        linkedAt: new Date('2026-03-02T03:04:05.000Z'),
      },
    ],
    role,
    status,
    preferences: {
      dietaryPreferences: ['vegan'],
      allergies: ['peanuts'],
      notifications: { enabled: true },
    },
    emailVerified: false,
    createdAt: new Date('2026-01-02T03:04:05.000Z'),
    updatedAt: new Date('2026-02-02T03:04:05.000Z'),
  };
}

const adminDoc = (o = {}) => userDoc({ id: ADMIN_ID, email: 'admin@wecooked.test', role: 'admin', ...o });

/**
 * Wires the authenticate middleware and the users repository.
 * - `caller` is the authenticated user (its DB role/status is what authorize
 *   and authenticate actually see — never the token's claims).
 * - `directory` maps id -> doc for the target lookup the service performs.
 * - `noSession` simulates findActiveById returning nothing (revoked/expired).
 */
function mockContext(t, { caller, directory = {}, noSession = false } = {}) {
  const table = { [String(caller._id)]: caller, ...directory };
  t.mock.method(sessionRepository, 'findActiveById', async (id) =>
    noSession ? null : { _id: String(id), userId: String(caller._id), revokedAt: null }
  );
  t.mock.method(userRepository, 'findById', async (id) => table[String(id)] ?? null);
}

function tokenFor(doc, sessionId, roleOverride) {
  return signAccessToken({
    userId: String(doc._id),
    role: roleOverride ?? doc.role,
    sessionId,
  });
}

const adminToken = () => tokenFor(adminDoc(), ADMIN_SESSION_ID);
const userToken = () => tokenFor(userDoc({ id: USER_ID }), USER_SESSION_ID);

// ===========================================================================
// GET /api/v1/users
// ===========================================================================

test('GET /api/v1/users without a token is rejected', async () => {
  const res = await request(app).get('/api/v1/users');
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'AUTH_TOKEN_MISSING');
});

test('GET /api/v1/users is forbidden for a normal authenticated user', async (t) => {
  mockContext(t, { caller: userDoc({ id: USER_ID }) });
  const res = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${userToken()}`);
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('GET /api/v1/users returns a paginated list for an admin', async (t) => {
  mockContext(t, { caller: adminDoc() });
  t.mock.method(userRepository, 'findMany', async () => [
    userDoc({ id: TARGET_USER_ID, name: 'Ada', email: 'ada@example.com' }),
    userDoc({ id: USER_ID, name: 'Bo', email: 'bo@example.com', role: 'admin', status: 'suspended' }),
  ]);
  t.mock.method(userRepository, 'countByFilter', async () => 2);

  const res = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${adminToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.users.length, 2);
  assert.deepEqual(res.body.data.pagination, { page: 1, limit: 20, total: 2, totalPages: 1 });
});

test('GET /api/v1/users passes page/limit/sort/role/status/search through to the repository', async (t) => {
  mockContext(t, { caller: adminDoc() });
  let filter;
  let opts;
  t.mock.method(userRepository, 'findMany', async (args) => {
    filter = args.filter;
    opts = args;
    return [];
  });
  t.mock.method(userRepository, 'countByFilter', async () => 0);

  const res = await request(app)
    .get('/api/v1/users?page=2&limit=5&sort=nameDesc&role=moderator&status=active&search=a%2Bb')
    .set('Authorization', `Bearer ${adminToken()}`);

  assert.equal(res.status, 200);
  assert.equal(filter.role, 'moderator');
  assert.equal(filter.status, 'active');
  assert.equal(filter.$or[0].name.source, 'a\\+b'); // regex-escaped
  assert.equal(filter.$or[1].email.source, 'a\\+b');
  assert.deepEqual(opts.sort, { name: -1, _id: 1 });
  assert.equal(opts.skip, 5);
  assert.equal(opts.limit, 5);
  assert.deepEqual(res.body.data.pagination, { page: 2, limit: 5, total: 0, totalPages: 0 });
});

test('GET /api/v1/users rejects an invalid sort value', async (t) => {
  mockContext(t, { caller: adminDoc() });
  const res = await request(app)
    .get('/api/v1/users?sort=createdAt')
    .set('Authorization', `Bearer ${adminToken()}`);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('GET /api/v1/users rejects an out-of-range page/limit', async (t) => {
  mockContext(t, { caller: adminDoc() });
  for (const q of ['page=0', 'limit=0', 'limit=101', 'page=abc']) {
    const res = await request(app)
      .get(`/api/v1/users?${q}`)
      .set('Authorization', `Bearer ${adminToken()}`);
    assert.equal(res.status, 400, `expected ${q} rejected`);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
});

test('GET /api/v1/users rejects an unknown query parameter (strict)', async (t) => {
  mockContext(t, { caller: adminDoc() });
  const res = await request(app)
    .get('/api/v1/users?isActive=true')
    .set('Authorization', `Bearer ${adminToken()}`);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('GET /api/v1/users rejects a role/status outside the User enum', async (t) => {
  mockContext(t, { caller: adminDoc() });
  const bad = await request(app)
    .get('/api/v1/users?role=superadmin')
    .set('Authorization', `Bearer ${adminToken()}`);
  assert.equal(bad.status, 400);
  const bad2 = await request(app)
    .get('/api/v1/users?status=inactive')
    .set('Authorization', `Bearer ${adminToken()}`);
  assert.equal(bad2.status, 400);
});

test('GET /api/v1/users never serializes passwordHash or other private fields', async (t) => {
  mockContext(t, { caller: adminDoc() });
  t.mock.method(userRepository, 'findMany', async () => [userDoc()]);
  t.mock.method(userRepository, 'countByFilter', async () => 1);

  const res = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${adminToken()}`);

  assert.equal(res.status, 200);
  const raw = JSON.stringify(res.body);
  assert.equal(raw.includes('passwordHash'), false);
  assert.equal(raw.includes(FORBIDDEN_HASH), false);
  assert.equal(raw.includes('authIdentities'), false);
  assert.equal(raw.includes('private-subject'), false);
  assert.equal(raw.includes('preferences'), false);
  assert.equal(raw.includes('allergies'), false);
  assert.equal(raw.includes('__v'), false);

  assert.deepEqual(Object.keys(res.body.data.users[0]).sort(), [
    'createdAt',
    'email',
    'emailVerified',
    'id',
    'name',
    'role',
    'status',
    'updatedAt',
  ]);
});

// ===========================================================================
// PATCH /api/v1/users/:userId
// ===========================================================================

test('PATCH /api/v1/users/:userId without a token is rejected', async () => {
  const res = await request(app)
    .patch(`/api/v1/users/${TARGET_USER_ID}`)
    .send({ status: 'suspended' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'AUTH_TOKEN_MISSING');
});

test('PATCH /api/v1/users/:userId is forbidden for a normal user', async (t) => {
  mockContext(t, { caller: userDoc({ id: USER_ID }) });
  const res = await request(app)
    .patch(`/api/v1/users/${TARGET_USER_ID}`)
    .set('Authorization', `Bearer ${userToken()}`)
    .send({ status: 'suspended' });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('PATCH /api/v1/users/:userId rejects a malformed ObjectId', async (t) => {
  mockContext(t, { caller: adminDoc() });
  const res = await request(app)
    .patch('/api/v1/users/not-an-id')
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ status: 'active' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('PATCH /api/v1/users/:userId returns USER_NOT_FOUND for a valid but missing id', async (t) => {
  mockContext(t, { caller: adminDoc() });
  const res = await request(app)
    .patch(`/api/v1/users/${MISSING_ID}`)
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ status: 'active' });
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'USER_NOT_FOUND');
});

test('PATCH /api/v1/users/:userId rejects an empty body', async (t) => {
  mockContext(t, { caller: adminDoc(), directory: { [TARGET_USER_ID]: userDoc() } });
  const res = await request(app)
    .patch(`/api/v1/users/${TARGET_USER_ID}`)
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('PATCH /api/v1/users/:userId rejects unknown / profile body fields', async (t) => {
  mockContext(t, { caller: adminDoc(), directory: { [TARGET_USER_ID]: userDoc() } });
  for (const body of [
    { name: 'Mallory' },
    { email: 'm@example.com' },
    { password: 'hunter2hunter2' },
    { passwordHash: '$2b$10$x' },
    { emailVerified: true },
    { preferences: {} },
    { allergies: [] },
    { authIdentities: [{ provider: 'google', subject: 'attacker-controlled' }] },
    { authProviders: ['google'] },
    { foo: 1 },
    { status: 'active', foo: 1 },
    { role: 'admin', createdAt: '2020-01-01' },
  ]) {
    const res = await request(app)
      .patch(`/api/v1/users/${TARGET_USER_ID}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(body);
    assert.equal(res.status, 400, `expected ${JSON.stringify(body)} rejected`);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
});

// Role is no longer part of the PATCH contract for anyone — a `role` key is a
// 400 VALIDATION_ERROR (an unrecognized field), never a 403. There is no
// runtime promote/demote capability.
test('PATCH /api/v1/users/:userId rejects a role-only body with 400 and never writes', async (t) => {
  mockContext(t, {
    caller: adminDoc(),
    directory: { [TARGET_USER_ID]: userDoc({ role: 'user', status: 'active' }) },
  });
  let updated = false;
  let revoked = false;
  t.mock.method(userRepository, 'updateById', async () => {
    updated = true;
    return userDoc();
  });
  t.mock.method(sessionRepository, 'revokeAllForUser', async () => {
    revoked = true;
    return 0;
  });

  for (const body of [{ role: 'admin' }, { role: 'moderator' }, { role: 'user' }]) {
    const res = await request(app)
      .patch(`/api/v1/users/${TARGET_USER_ID}`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(body);
    assert.equal(res.status, 400, `expected ${JSON.stringify(body)} -> 400`);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
  assert.equal(updated, false, 'no write on a rejected role body');
  assert.equal(revoked, false);
});

test('PATCH /api/v1/users/:userId rejects a combined role + status body atomically (status not applied)', async (t) => {
  mockContext(t, {
    caller: adminDoc(),
    directory: { [TARGET_USER_ID]: userDoc({ role: 'user', status: 'active' }) },
  });
  let updated = false;
  let revoked = false;
  t.mock.method(userRepository, 'updateById', async () => {
    updated = true;
    return userDoc({ status: 'suspended' });
  });
  t.mock.method(sessionRepository, 'revokeAllForUser', async () => {
    revoked = true;
    return 0;
  });

  const res = await request(app)
    .patch(`/api/v1/users/${TARGET_USER_ID}`)
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ role: 'admin', status: 'suspended' });

  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  assert.equal(updated, false, 'the status change must NOT be applied when role is present');
  assert.equal(revoked, false);
});

test('PATCH /api/v1/users/:userId suspending an active user persists status THEN revokes sessions', async (t) => {
  mockContext(t, {
    caller: adminDoc(),
    directory: { [TARGET_USER_ID]: userDoc({ status: 'active' }) },
  });
  const order = [];
  t.mock.method(userRepository, 'updateById', async (id, update) => {
    order.push('update');
    return userDoc({ id, status: update.$set.status });
  });
  let revokedFor;
  t.mock.method(sessionRepository, 'revokeAllForUser', async (userId) => {
    order.push('revoke');
    revokedFor = String(userId);
    return 3;
  });

  const res = await request(app)
    .patch(`/api/v1/users/${TARGET_USER_ID}`)
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ status: 'suspended' });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.user.status, 'suspended');
  // Role is still serialized in the admin response (read-only — never mutated here).
  assert.equal(res.body.data.user.role, 'user');
  assert.deepEqual(order, ['update', 'revoke']);
  assert.equal(revokedFor, TARGET_USER_ID);
});

test('PATCH /api/v1/users/:userId reactivating a suspended user revokes sessions BEFORE persisting active', async (t) => {
  mockContext(t, {
    caller: adminDoc(),
    directory: { [TARGET_USER_ID]: userDoc({ status: 'suspended' }) },
  });
  const order = [];
  t.mock.method(sessionRepository, 'revokeAllForUser', async () => {
    order.push('revoke');
    return 2;
  });
  t.mock.method(userRepository, 'updateById', async (id, update) => {
    order.push('update');
    return userDoc({ id, status: update.$set.status });
  });

  const res = await request(app)
    .patch(`/api/v1/users/${TARGET_USER_ID}`)
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ status: 'active' });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.user.status, 'active');
  assert.deepEqual(order, ['revoke', 'update']);
});

test('PATCH /api/v1/users/:userId reactivation is aborted (user stays suspended) if revocation fails', async (t) => {
  mockContext(t, {
    caller: adminDoc(),
    directory: { [TARGET_USER_ID]: userDoc({ status: 'suspended' }) },
  });
  let updateCalled = false;
  t.mock.method(userRepository, 'updateById', async () => {
    updateCalled = true;
    return userDoc({ status: 'active' });
  });
  t.mock.method(sessionRepository, 'revokeAllForUser', async () => {
    throw new Error('session store unavailable');
  });

  const res = await request(app)
    .patch(`/api/v1/users/${TARGET_USER_ID}`)
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ status: 'active' });

  assert.equal(res.status, 500);
  assert.equal(res.body.error.code, 'INTERNAL_SERVER_ERROR');
  assert.equal(res.body.error.message.includes('session store'), false); // no raw internals
  assert.equal(updateCalled, false);
});

test('PATCH /api/v1/users/:userId applies a status-only change and $sets nothing but status', async (t) => {
  mockContext(t, {
    caller: adminDoc(),
    directory: { [TARGET_ADMIN_ID]: userDoc({ id: TARGET_ADMIN_ID, role: 'admin', status: 'active' }) },
  });
  let capturedSet;
  t.mock.method(userRepository, 'updateById', async (id, update) => {
    capturedSet = update.$set;
    return userDoc({ id, role: 'admin', status: update.$set.status });
  });
  t.mock.method(sessionRepository, 'revokeAllForUser', async () => 1);

  const res = await request(app)
    .patch(`/api/v1/users/${TARGET_ADMIN_ID}`)
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ status: 'suspended' });

  assert.equal(res.status, 200);
  assert.deepEqual(capturedSet, { status: 'suspended' });
  // The target's role is untouched — it is not a field this endpoint can write.
  assert.equal(res.body.data.user.role, 'admin');
  assert.equal(res.body.data.user.status, 'suspended');
});

test('PATCH /api/v1/users/:userId active -> active is a no-op with no session revocation', async (t) => {
  mockContext(t, {
    caller: adminDoc(),
    directory: { [TARGET_USER_ID]: userDoc({ status: 'active' }) },
  });
  let revoked = false;
  t.mock.method(sessionRepository, 'revokeAllForUser', async () => {
    revoked = true;
    return 0;
  });
  t.mock.method(userRepository, 'updateById', async (id, update) =>
    userDoc({ id, status: update.$set.status })
  );

  const res = await request(app)
    .patch(`/api/v1/users/${TARGET_USER_ID}`)
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ status: 'active' });

  assert.equal(res.status, 200);
  assert.equal(revoked, false);
});

test('PATCH /api/v1/users/:userId rejects an admin trying to change their own role with 400 (role is not a field)', async (t) => {
  mockContext(t, { caller: adminDoc() });
  let updated = false;
  t.mock.method(userRepository, 'updateById', async () => {
    updated = true;
    return adminDoc({ role: 'user' });
  });
  const res = await request(app)
    .patch(`/api/v1/users/${ADMIN_ID}`)
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ role: 'user' });
  // Not 403 ADMIN_CANNOT_MODIFY_SELF — role is not part of the contract for
  // anyone, so it fails validation before the self-check is ever reached.
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  assert.equal(updated, false);
});

test('PATCH /api/v1/users/:userId rejects an admin suspending themselves', async (t) => {
  mockContext(t, { caller: adminDoc() });
  const res = await request(app)
    .patch(`/api/v1/users/${ADMIN_ID}`)
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ status: 'suspended' });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'ADMIN_CANNOT_MODIFY_SELF');
});

test('PATCH /api/v1/users/:userId self-protection cannot be bypassed by upper-casing the id in the path', async (t) => {
  mockContext(t, { caller: adminDoc() });
  let updated = false;
  t.mock.method(userRepository, 'updateById', async () => {
    updated = true;
    return adminDoc({ role: 'user' });
  });
  t.mock.method(sessionRepository, 'revokeAllForUser', async () => 0);

  const res = await request(app)
    .patch(`/api/v1/users/${ADMIN_ID.toUpperCase()}`)
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ status: 'suspended' });

  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'ADMIN_CANNOT_MODIFY_SELF');
  assert.equal(updated, false);
});

test('PATCH /api/v1/users/:userId still works when a different target id is upper-cased', async (t) => {
  mockContext(t, {
    caller: adminDoc(),
    directory: { [TARGET_USER_ID]: userDoc({ role: 'user', status: 'active' }) },
  });
  t.mock.method(sessionRepository, 'revokeAllForUser', async () => 0);
  t.mock.method(userRepository, 'updateById', async (id, update) =>
    userDoc({ id: String(id), status: update.$set.status })
  );

  const res = await request(app)
    .patch(`/api/v1/users/${TARGET_USER_ID.toUpperCase()}`)
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ status: 'suspended' });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.user.status, 'suspended');
  assert.equal(res.body.data.user.id, TARGET_USER_ID); // canonical lower-case in the response
});

// ===========================================================================
// Session / status security (integration)
// ===========================================================================

test('a suspended admin cannot use the authenticated admin access path', async (t) => {
  mockContext(t, { caller: adminDoc({ status: 'suspended' }) });
  const res = await request(app)
    .get('/api/v1/users')
    .set('Authorization', `Bearer ${adminToken()}`);
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'AUTH_SESSION_INVALID');
});

test('a suspended user cannot refresh (rotation never attempted)', async (t) => {
  t.mock.method(sessionRepository, 'findActiveByHash', async () => ({
    _id: 'session-x',
    userId: TARGET_USER_ID,
  }));
  t.mock.method(userRepository, 'findById', async () => userDoc({ status: 'suspended' }));
  let rotated = false;
  t.mock.method(sessionRepository, 'rotateByHash', async () => {
    rotated = true;
    return null;
  });

  const res = await request(app)
    .post('/api/v1/auth/refresh')
    .send({ refreshToken: 'whatever-raw-token' });

  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'AUTH_REFRESH_TOKEN_INVALID');
  assert.equal(rotated, false);
});

test('a demoted admin holding a stale admin access token is still rejected (role reloaded from DB)', async (t) => {
  // DB role is now 'user'; the token still claims 'admin'.
  mockContext(t, { caller: userDoc({ id: ADMIN_ID, role: 'user' }) });
  let revoked = false;
  t.mock.method(sessionRepository, 'revokeAllForUser', async () => {
    revoked = true;
    return 0;
  });

  const res = await request(app)
    .get('/api/v1/users')
    .set('Authorization', `Bearer ${tokenFor(adminDoc(), ADMIN_SESSION_ID, 'admin')}`);

  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
  assert.equal(revoked, false, 'role demotion needs no session revocation to take effect');
});

test('GET /api/v1/users/me still returns the current user (regression, includes preferences)', async (t) => {
  mockContext(t, { caller: userDoc({ id: USER_ID, role: 'user' }) });
  const res = await request(app)
    .get('/api/v1/users/me')
    .set('Authorization', `Bearer ${userToken()}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.data.user.id, USER_ID);
  assert.equal('passwordHash' in res.body.data.user, false);
  assert.ok(res.body.data.user.preferences, 'the self view still carries preferences');
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('GET /api/v1/users/me exposes provider + linkedAt and never the Google subject', async (t) => {
  mockContext(t, { caller: userDoc({ id: USER_ID, role: 'user' }) });

  const res = await request(app)
    .get('/api/v1/users/me')
    .set('Authorization', `Bearer ${userToken()}`);

  assert.equal(res.status, 200);
  const { authIdentities } = res.body.data.user;
  assert.equal(Array.isArray(authIdentities), true);
  assert.equal(authIdentities.length, 1);
  // Exactly the two public fields — no third key can ride along.
  assert.deepEqual(Object.keys(authIdentities[0]).sort(), ['linkedAt', 'provider']);
  assert.equal(authIdentities[0].provider, 'google');
  assert.equal(authIdentities[0].linkedAt, '2026-03-02T03:04:05.000Z');
  assert.equal('subject' in authIdentities[0], false);
  // The stub's subject value must not appear anywhere in the serialized body,
  // under any key or nesting.
  assert.equal(JSON.stringify(res.body).includes('private-subject'), false);
});
// ===========================================================================
// PATCH /api/v1/users/me  (self-profile)
// ===========================================================================

function selfPatch(token, body) {
  return request(app)
    .patch('/api/v1/users/me')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

test('PATCH /api/v1/users/me without a token is rejected', async () => {
  const res = await request(app).patch('/api/v1/users/me').send({ name: 'New' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'AUTH_TOKEN_MISSING');
});

test('PATCH /api/v1/users/me succeeds for a normal authenticated user (route not shadowed by /:userId)', async (t) => {
  mockContext(t, { caller: userDoc({ id: USER_ID, role: 'user' }) });
  t.mock.method(userRepository, 'updateById', async (id, update) =>
    userDoc({ id: String(id), name: update.$set.name ?? 'Person' })
  );

  const res = await selfPatch(userToken(), { name: 'Renamed Person' });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.user.name, 'Renamed Person');
  assert.equal(res.body.data.user.id, USER_ID);
});

test('PATCH /api/v1/users/me succeeds for an admin editing their own profile', async (t) => {
  mockContext(t, { caller: adminDoc() });
  t.mock.method(userRepository, 'updateById', async (id, update) =>
    adminDoc({ id: String(id), name: update.$set.name })
  );

  const res = await selfPatch(adminToken(), { name: 'Admin Renamed' });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.user.name, 'Admin Renamed');
});

test('PATCH /api/v1/users/me rejects an admin-managed / unknown field with 400 (never 403)', async (t) => {
  mockContext(t, { caller: userDoc({ id: USER_ID, role: 'user' }) });
  let updated = false;
  t.mock.method(userRepository, 'updateById', async () => {
    updated = true;
    return userDoc();
  });

  for (const body of [
    { role: 'admin' },
    { status: 'active' },
    { email: 'new@example.com' },
    { emailVerified: true },
    { passwordHash: '$2b$10$x' },
    { authIdentities: [{ provider: 'google', subject: 'attacker-controlled' }] },
    { authProviders: ['google'] },
    { _id: USER_ID },
    { userId: USER_ID },
    { createdAt: '2020-01-01' },
    { nickname: 'x' },
  ]) {
    const res = await selfPatch(userToken(), body);
    assert.equal(res.status, 400, `expected ${JSON.stringify(body)} -> 400`);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
  assert.equal(updated, false);
});

test('PATCH /api/v1/users/me rejects an empty body and structural no-ops', async (t) => {
  mockContext(t, { caller: userDoc({ id: USER_ID, role: 'user' }) });
  for (const body of [{}, { preferences: {} }, { preferences: { notifications: {} } }]) {
    const res = await selfPatch(userToken(), body);
    assert.equal(res.status, 400, `expected ${JSON.stringify(body)} -> 400`);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
});

test('PATCH /api/v1/users/me updates only the supplied preference leaf and returns the safe serializer', async (t) => {
  mockContext(t, { caller: userDoc({ id: USER_ID, role: 'user' }) });
  let capturedSet;
  t.mock.method(userRepository, 'updateById', async (id, update) => {
    capturedSet = update.$set;
    return userDoc({ id: String(id) });
  });

  const res = await selfPatch(userToken(), { preferences: { allergies: ['Peanuts', 'Shellfish'] } });

  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(capturedSet), ['preferences.allergies']);
  assert.deepEqual(capturedSet['preferences.allergies'], ['Peanuts', 'Shellfish']);

  const raw = JSON.stringify(res.body);
  assert.equal(raw.includes('passwordHash'), false);
  assert.equal(raw.includes(FORBIDDEN_HASH), false);
  assert.equal(raw.includes('private-subject'), false);
  assert.equal(raw.includes('__v'), false);
  assert.ok(res.body.data.user.preferences, 'response carries preferences');
  // The self-view names the linked providers (B4.3A) but never their subjects.
  assert.deepEqual(res.body.data.user.authIdentities, [
    { provider: 'google', linkedAt: '2026-03-02T03:04:05.000Z' },
  ]);
});

test('PATCH /api/v1/users/me accepts notifications.enabled:false (present value, not "missing")', async (t) => {
  mockContext(t, { caller: userDoc({ id: USER_ID, role: 'user' }) });
  let capturedSet;
  t.mock.method(userRepository, 'updateById', async (id, update) => {
    capturedSet = update.$set;
    return userDoc({ id: String(id) });
  });

  const res = await selfPatch(userToken(), { preferences: { notifications: { enabled: false } } });

  assert.equal(res.status, 200);
  assert.deepEqual(capturedSet, { 'preferences.notifications.enabled': false });
});

test('PATCH /api/v1/users/me accepts an empty allergies array (clear)', async (t) => {
  mockContext(t, { caller: userDoc({ id: USER_ID, role: 'user' }) });
  let capturedSet;
  t.mock.method(userRepository, 'updateById', async (id, update) => {
    capturedSet = update.$set;
    return userDoc({ id: String(id) });
  });

  const res = await selfPatch(userToken(), { preferences: { allergies: [] } });

  assert.equal(res.status, 200);
  assert.deepEqual(capturedSet, { 'preferences.allergies': [] });
});

test('PATCH /api/v1/users/me returns 401 AUTH_SESSION_INVALID when the user vanished before the write', async (t) => {
  mockContext(t, { caller: userDoc({ id: USER_ID, role: 'user' }) });
  t.mock.method(userRepository, 'updateById', async () => null);

  const res = await selfPatch(userToken(), { name: 'Ghost' });

  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'AUTH_SESSION_INVALID');
});

test('PATCH /api/v1/users/me is rejected for a suspended user (blocked by authenticate)', async (t) => {
  mockContext(t, { caller: userDoc({ id: USER_ID, role: 'user', status: 'suspended' }) });
  let updated = false;
  t.mock.method(userRepository, 'updateById', async () => {
    updated = true;
    return userDoc();
  });

  const res = await selfPatch(userToken(), { name: 'Nope' });

  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'AUTH_SESSION_INVALID');
  assert.equal(updated, false);
});

test('PATCH /api/v1/users/me never revokes sessions', async (t) => {
  mockContext(t, { caller: userDoc({ id: USER_ID, role: 'user' }) });
  let revoked = false;
  t.mock.method(sessionRepository, 'revokeAllForUser', async () => {
    revoked = true;
    return 0;
  });
  t.mock.method(userRepository, 'updateById', async (id) => userDoc({ id: String(id) }));

  const res = await selfPatch(userToken(), {
    name: 'Calm',
    preferences: { notifications: { enabled: false } },
  });

  assert.equal(res.status, 200);
  assert.equal(revoked, false);
});

