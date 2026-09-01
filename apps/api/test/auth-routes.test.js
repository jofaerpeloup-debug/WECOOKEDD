process.env.NODE_ENV = 'test';
process.env.PORT = '4018';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

// Importing app.js must not start a server or touch MongoDB — these tests
// only ever stub the repository layer (the actual Mongoose/DB boundary), so
// the real validation -> controller -> service chain runs unmodified.
const { createApp } = require('../src/app');
const userRepository = require('../src/modules/users/user.repository');
const sessionRepository = require('../src/modules/sessions/session.repository');
const { hashPassword } = require('../src/shared/security/password');
const { signAccessToken } = require('../src/shared/security/access-token');
const { authRateLimiter } = require('../src/modules/auth/auth.routes');

const app = createApp();

// The change-password suite below exercises many authenticated attempts through
// the shared authRateLimiter (limit 20 / 15min / IP). Reset its per-IP counter
// before each of those tests so they never bleed into the shared budget the
// login/register/refresh tests above also draw from. supertest's loopback
// connection normalises to the key '127.0.0.1'.
function resetAuthLimiter() {
  return authRateLimiter.resetKey('127.0.0.1');
}

// Authenticated routes (GET /users/me, /auth/logout, /auth/logout-all) go
// through authenticate.middleware.js, which now validates that the JWT's
// sessionId/sub claims are well-formed Mongo ObjectIds before doing any
// repository lookup — so tokens used against those routes need realistic
// ObjectId-shaped ids, unlike the plain 'u1'-style ids used elsewhere in
// this file for routes that never pass through that check.
const AUTH_USER_ID = '507f1f77bcf86cd799439011';
const AUTH_SESSION_ID = '507f1f77bcf86cd799439012';

function fakeUserDoc({
  id = 'u1',
  email = 'ada@example.com',
  passwordHash = 'irrelevant-hash',
  role = 'user',
  status = 'active',
} = {}) {
  return {
    _id: id,
    name: 'Ada',
    email,
    passwordHash,
    role,
    status,
    authProviders: ['local'],
    preferences: { dietaryPreferences: [], allergies: [], notifications: { enabled: true } },
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

let sessionCounter = 0;
function fakeSessionDoc(userId) {
  sessionCounter += 1;
  return {
    _id: `session-${sessionCounter}`,
    userId,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    lastUsedAt: null,
  };
}

test('POST /api/v1/auth/register creates a user, issues tokens, and never returns passwordHash', async (t) => {
  t.mock.method(userRepository, 'createUser', async (args) =>
    fakeUserDoc({ email: args.email, passwordHash: args.passwordHash })
  );
  t.mock.method(sessionRepository, 'createSession', async ({ userId }) => fakeSessionDoc(userId));

  const response = await request(app).post('/api/v1/auth/register').send({
    name: 'Ada',
    email: 'ada@example.com',
    password: 'a-good-password',
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.user.email, 'ada@example.com');
  assert.equal(response.body.data.user.role, 'user');
  assert.ok(response.body.data.accessToken);
  assert.ok(response.body.data.refreshToken);
  assert.equal('passwordHash' in response.body.data.user, false);
});

test('POST /api/v1/auth/register rejects a duplicate email with 409 USER_EMAIL_ALREADY_EXISTS', async (t) => {
  t.mock.method(userRepository, 'createUser', async () => {
    const err = new Error('E11000 duplicate key error collection: wecooked.users index: email_1');
    err.code = 11000;
    throw err;
  });

  const response = await request(app).post('/api/v1/auth/register').send({
    name: 'Ada',
    email: 'ada@example.com',
    password: 'a-good-password',
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'USER_EMAIL_ALREADY_EXISTS');
});

test('POST /api/v1/auth/register rejects a client-supplied role field before it reaches the service', async () => {
  const response = await request(app).post('/api/v1/auth/register').send({
    name: 'Ada',
    email: 'ada@example.com',
    password: 'a-good-password',
    role: 'admin',
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/auth/login succeeds with valid credentials and creates a session', async (t) => {
  const passwordHash = await hashPassword('correct-password');
  t.mock.method(userRepository, 'findByEmailWithPassword', async () => fakeUserDoc({ passwordHash }));
  let sessionCreated = false;
  t.mock.method(sessionRepository, 'createSession', async ({ userId }) => {
    sessionCreated = true;
    return fakeSessionDoc(userId);
  });

  const response = await request(app).post('/api/v1/auth/login').send({
    email: 'ada@example.com',
    password: 'correct-password',
  });

  assert.equal(response.status, 200);
  assert.equal(sessionCreated, true);
  assert.ok(response.body.data.accessToken);
  assert.ok(response.body.data.refreshToken);
});

test('POST /api/v1/auth/login returns the identical error for a wrong password and an unknown email', async (t) => {
  const passwordHash = await hashPassword('correct-password');
  t.mock.method(userRepository, 'findByEmailWithPassword', async (email) =>
    email === 'ada@example.com' ? fakeUserDoc({ passwordHash }) : null
  );

  const wrongPassword = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'ada@example.com', password: 'wrong-password' });
  const unknownEmail = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'nobody@example.com', password: 'whatever' });

  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownEmail.status, 401);
  assert.deepEqual(wrongPassword.body.error, unknownEmail.body.error);
  assert.equal(wrongPassword.body.error.code, 'AUTH_INVALID_CREDENTIALS');
});

test('POST /api/v1/auth/login rejects a suspended account without creating a session', async (t) => {
  const passwordHash = await hashPassword('correct-password');
  t.mock.method(userRepository, 'findByEmailWithPassword', async () =>
    fakeUserDoc({ passwordHash, status: 'suspended' })
  );
  let sessionCreated = false;
  t.mock.method(sessionRepository, 'createSession', async () => {
    sessionCreated = true;
    return fakeSessionDoc('u1');
  });

  const response = await request(app).post('/api/v1/auth/login').send({
    email: 'ada@example.com',
    password: 'correct-password',
  });

  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'AUTH_ACCOUNT_SUSPENDED');
  assert.equal(sessionCreated, false);
});

test('POST /api/v1/auth/login rejects a password whose UTF-8 byte length exceeds 72 bytes', async () => {
  const response = await request(app).post('/api/v1/auth/login').send({
    email: 'ada@example.com',
    password: 'a'.repeat(73),
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/auth/refresh rotates the token and returns new tokens', async (t) => {
  t.mock.method(sessionRepository, 'findActiveByHash', async () => ({ _id: 'session-99', userId: 'u42' }));
  t.mock.method(sessionRepository, 'rotateByHash', async ({ newHash }) => ({
    _id: 'session-99',
    userId: 'u42',
    refreshTokenHash: newHash,
  }));
  t.mock.method(userRepository, 'findById', async () => fakeUserDoc({ id: 'u42' }));

  const response = await request(app)
    .post('/api/v1/auth/refresh')
    .send({ refreshToken: 'some-raw-refresh-token' });

  assert.equal(response.status, 200);
  assert.ok(response.body.data.accessToken);
  assert.ok(response.body.data.refreshToken);
  assert.notEqual(response.body.data.refreshToken, 'some-raw-refresh-token');
});

test('POST /api/v1/auth/refresh rejects a token with no matching active session', async (t) => {
  t.mock.method(sessionRepository, 'findActiveByHash', async () => null);

  const response = await request(app)
    .post('/api/v1/auth/refresh')
    .send({ refreshToken: 'stale-token' });

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_REFRESH_TOKEN_INVALID');
});

test('POST /api/v1/auth/refresh does not rotate the token when the session\'s user is suspended', async (t) => {
  t.mock.method(sessionRepository, 'findActiveByHash', async () => ({ _id: 'session-1', userId: 'u1' }));
  t.mock.method(userRepository, 'findById', async () => fakeUserDoc({ id: 'u1', status: 'suspended' }));
  let rotateCalled = false;
  t.mock.method(sessionRepository, 'rotateByHash', async () => {
    rotateCalled = true;
    return null;
  });

  const response = await request(app)
    .post('/api/v1/auth/refresh')
    .send({ refreshToken: 'some-token' });

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_REFRESH_TOKEN_INVALID');
  assert.equal(rotateCalled, false, 'expected rotation to never be attempted for an inactive user');
});

test('POST /api/v1/auth/refresh does not rotate the token when the user lookup fails, and the failure surfaces as a 500', async (t) => {
  t.mock.method(sessionRepository, 'findActiveByHash', async () => ({ _id: 'session-1', userId: 'u1' }));
  t.mock.method(userRepository, 'findById', async () => {
    throw new Error('MongoDB connection timed out');
  });
  let rotateCalled = false;
  t.mock.method(sessionRepository, 'rotateByHash', async () => {
    rotateCalled = true;
    return null;
  });

  const response = await request(app)
    .post('/api/v1/auth/refresh')
    .send({ refreshToken: 'some-token' });

  assert.equal(response.status, 500);
  assert.equal(response.body.error.code, 'INTERNAL_SERVER_ERROR');
  assert.equal(rotateCalled, false, 'expected a user-lookup failure to never trigger rotation');
});

test('POST /api/v1/auth/refresh rejects when a concurrent request already consumed the token after the pre-check passed', async (t) => {
  t.mock.method(sessionRepository, 'findActiveByHash', async () => ({ _id: 'session-1', userId: 'u1' }));
  t.mock.method(userRepository, 'findById', async () => fakeUserDoc({ id: 'u1' }));
  // Simulates another request winning the atomic rotation race in between
  // our pre-check and our own rotate attempt.
  t.mock.method(sessionRepository, 'rotateByHash', async () => null);

  const response = await request(app)
    .post('/api/v1/auth/refresh')
    .send({ refreshToken: 'some-token' });

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_REFRESH_TOKEN_INVALID');
});

test('GET /api/v1/users/me returns the current user derived from the token, never passwordHash', async (t) => {
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: AUTH_SESSION_ID,
    userId: AUTH_USER_ID,
    revokedAt: null,
  }));
  t.mock.method(userRepository, 'findById', async () => fakeUserDoc({ id: AUTH_USER_ID }));

  const token = signAccessToken({ userId: AUTH_USER_ID, role: 'user', sessionId: AUTH_SESSION_ID });
  const response = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.user.id, AUTH_USER_ID);
  assert.equal('passwordHash' in response.body.data.user, false);
  assert.equal(JSON.stringify(response.body).includes('irrelevant-hash'), false);
});

test('GET /api/v1/users/me without a token is rejected', async () => {
  const response = await request(app).get('/api/v1/users/me');
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_TOKEN_MISSING');
});

test('POST /api/v1/auth/logout revokes the current session', async (t) => {
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: AUTH_SESSION_ID,
    userId: AUTH_USER_ID,
    revokedAt: null,
  }));
  t.mock.method(userRepository, 'findById', async () => fakeUserDoc({ id: AUTH_USER_ID }));
  let revokedId;
  t.mock.method(sessionRepository, 'revokeById', async (id) => {
    revokedId = id;
    return { _id: id, revokedAt: new Date() };
  });

  const token = signAccessToken({ userId: AUTH_USER_ID, role: 'user', sessionId: AUTH_SESSION_ID });
  const response = await request(app)
    .post('/api/v1/auth/logout')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.loggedOut, true);
  assert.equal(revokedId, AUTH_SESSION_ID);
});

test("POST /api/v1/auth/logout-all revokes all of the user's sessions", async (t) => {
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: AUTH_SESSION_ID,
    userId: AUTH_USER_ID,
    revokedAt: null,
  }));
  t.mock.method(userRepository, 'findById', async () => fakeUserDoc({ id: AUTH_USER_ID }));
  let capturedUserId;
  t.mock.method(sessionRepository, 'revokeAllForUser', async (userId) => {
    capturedUserId = userId;
    return 3;
  });

  const token = signAccessToken({ userId: AUTH_USER_ID, role: 'user', sessionId: AUTH_SESSION_ID });
  const response = await request(app)
    .post('/api/v1/auth/logout-all')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.revokedCount, 3);
  assert.equal(capturedUserId, AUTH_USER_ID);
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/change-password
// ---------------------------------------------------------------------------

const CP_CURRENT = 'current-admin-secret';

// Wires the authenticate middleware (session + user lookup) and the
// service-layer repository calls for a happy change-password. Returns handles
// to assert on. `onRevokeAll` lets a caller flip stateful mocks.
async function mockChangePassword(t, { userStatus = 'active', onRevokeAll } = {}) {
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: AUTH_SESSION_ID,
    userId: AUTH_USER_ID,
    revokedAt: null,
  }));
  t.mock.method(userRepository, 'findById', async () =>
    fakeUserDoc({ id: AUTH_USER_ID, status: userStatus })
  );

  const currentHash = await hashPassword(CP_CURRENT);
  t.mock.method(userRepository, 'findByIdWithPassword', async () =>
    fakeUserDoc({ id: AUTH_USER_ID, passwordHash: currentHash })
  );

  const persisted = [];
  t.mock.method(userRepository, 'updatePasswordHashById', async (id, passwordHash) => {
    persisted.push({ id, passwordHash });
    return { matchedCount: 1, modifiedCount: 1 };
  });

  const revokedFor = [];
  t.mock.method(sessionRepository, 'revokeAllForUser', async (userId) => {
    revokedFor.push(userId);
    if (onRevokeAll) onRevokeAll();
    return 2;
  });

  const token = signAccessToken({ userId: AUTH_USER_ID, role: 'admin', sessionId: AUTH_SESSION_ID });
  return { token, persisted, revokedFor };
}

test('POST /api/v1/auth/change-password without a token is rejected 401 AUTH_TOKEN_MISSING', async () => {
  const response = await request(app)
    .post('/api/v1/auth/change-password')
    .send({ currentPassword: 'x', newPassword: 'a-new-password' });

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_TOKEN_MISSING');
});

test('POST /api/v1/auth/change-password succeeds and returns exactly { passwordChanged: true }', async (t) => {
  await resetAuthLimiter();
  const { token, persisted, revokedFor } = await mockChangePassword(t);

  const response = await request(app)
    .post('/api/v1/auth/change-password')
    .set('Authorization', `Bearer ${token}`)
    .send({ currentPassword: CP_CURRENT, newPassword: 'a-brand-new-secret' });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { success: true, data: { passwordChanged: true } });
  // no user object, no token fields, no hash anywhere in the response
  assert.equal('user' in response.body.data, false);
  assert.equal('accessToken' in response.body.data, false);
  assert.equal('refreshToken' in response.body.data, false);
  assert.equal(JSON.stringify(response.body).includes('passwordHash'), false);
  assert.equal(JSON.stringify(response.body).includes('$2'), false);
  // persisted a bcrypt hash, not the plaintext
  assert.equal(persisted.length, 1);
  assert.match(persisted[0].passwordHash, /^\$2[aby]\$/);
  assert.notEqual(persisted[0].passwordHash, 'a-brand-new-secret');
  // every session revoked, for the authenticated user
  assert.deepEqual(revokedFor, [AUTH_USER_ID]);
});

test('POST /api/v1/auth/change-password with a wrong current password → 400 AUTH_CURRENT_PASSWORD_INVALID (not 401)', async (t) => {
  await resetAuthLimiter();
  const { token, persisted, revokedFor } = await mockChangePassword(t);

  const response = await request(app)
    .post('/api/v1/auth/change-password')
    .set('Authorization', `Bearer ${token}`)
    .send({ currentPassword: 'wrong-current', newPassword: 'a-brand-new-secret' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'AUTH_CURRENT_PASSWORD_INVALID');
  assert.equal(persisted.length, 0);
  assert.equal(revokedFor.length, 0);
});

test('POST /api/v1/auth/change-password with a newPassword shorter than 8 chars → 400 VALIDATION_ERROR', async (t) => {
  await resetAuthLimiter();
  const { token } = await mockChangePassword(t);

  const response = await request(app)
    .post('/api/v1/auth/change-password')
    .set('Authorization', `Bearer ${token}`)
    .send({ currentPassword: CP_CURRENT, newPassword: '1234567' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.ok(Array.isArray(response.body.error.details));
});

test('POST /api/v1/auth/change-password with an extra field → 400 VALIDATION_ERROR', async (t) => {
  await resetAuthLimiter();
  const { token } = await mockChangePassword(t);

  const response = await request(app)
    .post('/api/v1/auth/change-password')
    .set('Authorization', `Bearer ${token}`)
    .send({ currentPassword: CP_CURRENT, newPassword: 'a-brand-new-secret', confirmPassword: 'a-brand-new-secret' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/auth/change-password where newPassword equals currentPassword → 400 NEW_PASSWORD_SAME_AS_CURRENT', async (t) => {
  await resetAuthLimiter();
  const { token, persisted, revokedFor } = await mockChangePassword(t);

  const response = await request(app)
    .post('/api/v1/auth/change-password')
    .set('Authorization', `Bearer ${token}`)
    .send({ currentPassword: CP_CURRENT, newPassword: CP_CURRENT });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'NEW_PASSWORD_SAME_AS_CURRENT');
  assert.equal(persisted.length, 0);
  assert.equal(revokedFor.length, 0);
});

test('POST /api/v1/auth/change-password for a suspended user is rejected by authenticate (401 AUTH_SESSION_INVALID) before the limiter/validation', async (t) => {
  await resetAuthLimiter();
  const { token, persisted } = await mockChangePassword(t, { userStatus: 'suspended' });

  const response = await request(app)
    .post('/api/v1/auth/change-password')
    .set('Authorization', `Bearer ${token}`)
    .send({ currentPassword: CP_CURRENT, newPassword: 'a-brand-new-secret' });

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_SESSION_INVALID');
  assert.equal(persisted.length, 0);
});

test('after a successful change-password, the same access token fails the next authenticated request (401 AUTH_SESSION_INVALID)', async (t) => {
  await resetAuthLimiter();

  let sessionsRevoked = false;
  t.mock.method(sessionRepository, 'findActiveById', async () =>
    sessionsRevoked ? null : { _id: AUTH_SESSION_ID, userId: AUTH_USER_ID, revokedAt: null }
  );
  t.mock.method(userRepository, 'findById', async () => fakeUserDoc({ id: AUTH_USER_ID }));
  const currentHash = await hashPassword(CP_CURRENT);
  t.mock.method(userRepository, 'findByIdWithPassword', async () =>
    fakeUserDoc({ id: AUTH_USER_ID, passwordHash: currentHash })
  );
  t.mock.method(userRepository, 'updatePasswordHashById', async () => ({ matchedCount: 1 }));
  t.mock.method(sessionRepository, 'revokeAllForUser', async () => {
    sessionsRevoked = true;
    return 1;
  });

  const token = signAccessToken({ userId: AUTH_USER_ID, role: 'admin', sessionId: AUTH_SESSION_ID });

  const changed = await request(app)
    .post('/api/v1/auth/change-password')
    .set('Authorization', `Bearer ${token}`)
    .send({ currentPassword: CP_CURRENT, newPassword: 'a-brand-new-secret' });
  assert.equal(changed.status, 200);

  const after = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${token}`);
  assert.equal(after.status, 401);
  assert.equal(after.body.error.code, 'AUTH_SESSION_INVALID');
});

test('after a successful change-password, the pre-change refresh token can no longer refresh (401 AUTH_REFRESH_TOKEN_INVALID)', async (t) => {
  await resetAuthLimiter();

  let sessionsRevoked = false;
  t.mock.method(sessionRepository, 'findActiveById', async () =>
    sessionsRevoked ? null : { _id: AUTH_SESSION_ID, userId: AUTH_USER_ID, revokedAt: null }
  );
  t.mock.method(userRepository, 'findById', async () => fakeUserDoc({ id: AUTH_USER_ID }));
  const currentHash = await hashPassword(CP_CURRENT);
  t.mock.method(userRepository, 'findByIdWithPassword', async () =>
    fakeUserDoc({ id: AUTH_USER_ID, passwordHash: currentHash })
  );
  t.mock.method(userRepository, 'updatePasswordHashById', async () => ({ matchedCount: 1 }));
  // A revoked session no longer matches the active-by-hash filter.
  t.mock.method(sessionRepository, 'findActiveByHash', async () => (sessionsRevoked ? null : { _id: AUTH_SESSION_ID, userId: AUTH_USER_ID }));
  t.mock.method(sessionRepository, 'revokeAllForUser', async () => {
    sessionsRevoked = true;
    return 1;
  });

  const token = signAccessToken({ userId: AUTH_USER_ID, role: 'admin', sessionId: AUTH_SESSION_ID });

  const changed = await request(app)
    .post('/api/v1/auth/change-password')
    .set('Authorization', `Bearer ${token}`)
    .send({ currentPassword: CP_CURRENT, newPassword: 'a-brand-new-secret' });
  assert.equal(changed.status, 200);

  const refreshed = await request(app)
    .post('/api/v1/auth/refresh')
    .send({ refreshToken: 'the-pre-change-refresh-token' });
  assert.equal(refreshed.status, 401);
  assert.equal(refreshed.body.error.code, 'AUTH_REFRESH_TOKEN_INVALID');
});
