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
const emailService = require('../src/shared/email/email.service');
const googleProvider = require('../src/modules/auth/providers/google.provider');
const challengeRepository = require('../src/modules/auth/social-auth-challenge.repository');
const { AppError } = require('../src/shared/errors/app-error');
const { authenticate } = require('../src/middleware/authenticate.middleware');
const authRoutes = require('../src/modules/auth/auth.routes');
const {
  authRateLimiter,
  forgotPasswordRateLimiter,
  socialChallengeRateLimiter,
  socialGoogleLoginRateLimiter,
  socialGoogleLinkIpRateLimiter,
  socialGoogleLinkUserRateLimiter,
  socialLinkChallengeUserRateLimiter,
} = authRoutes;

const app = createApp();

// The change-password suite below exercises many authenticated attempts through
// the shared authRateLimiter (limit 20 / 15min / IP). Reset its per-IP counter
// before each of those tests so they never bleed into the shared budget the
// login/register/refresh tests above also draw from. supertest's loopback
// connection normalises to the key '127.0.0.1'.
function resetAuthLimiter() {
  return authRateLimiter.resetKey('127.0.0.1');
}

function resetForgotPasswordLimiter() {
  return forgotPasswordRateLimiter.resetKey('127.0.0.1');
}

const SOCIAL_LIMITER_USER_IDS = ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439077'];

async function resetSocialLimiters(userId = AUTH_USER_ID) {
  await Promise.all([
    socialChallengeRateLimiter.resetKey('127.0.0.1'),
    socialGoogleLoginRateLimiter.resetKey('127.0.0.1'),
    socialGoogleLinkIpRateLimiter.resetKey('127.0.0.1'),
    socialGoogleLinkUserRateLimiter.resetKey(userId),
    ...SOCIAL_LIMITER_USER_IDS.map((id) => socialLinkChallengeUserRateLimiter.resetKey(id)),
  ]);
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
  authIdentities = [],
} = {}) {
  return {
    _id: id,
    name: 'Ada',
    email,
    passwordHash,
    role,
    status,
    authIdentities,
    preferences: { dietaryPreferences: [], allergies: [], notifications: { enabled: true } },
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function fakeGoogleIdentity(overrides = {}) {
  return {
    provider: 'google',
    subject: 'google-subject-1',
    email: 'ada@example.com',
    emailVerified: true,
    suggestedName: 'Ada Google',
    verifiedNonce: Buffer.alloc(32, 4).toString('base64url'),
    ...overrides,
  };
}

test('social routes install the locked limiter and authentication order', () => {
  const handles = (path) =>
    authRoutes.stack.find((layer) => layer.route?.path === path).route.stack.map((layer) => layer.handle);

  assert.equal(handles('/social/challenge')[0], socialChallengeRateLimiter);
  assert.equal(handles('/social/google')[0], socialGoogleLoginRateLimiter);
  const link = handles('/social/google/link');
  assert.equal(link[0], socialGoogleLinkIpRateLimiter);
  assert.equal(link[1], authenticate);
  assert.equal(link[2], socialGoogleLinkUserRateLimiter);
  assert.equal(link.length, 5);
});

// Mounts a valid authenticated session for AUTH_USER_ID.
function mockAuthenticatedUser(t, { userId = AUTH_USER_ID, user } = {}) {
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: AUTH_SESSION_ID,
    userId,
    revokedAt: null,
  }));
  t.mock.method(userRepository, 'findById', async () => user || fakeUserDoc({ id: userId }));
  return signAccessToken({ userId, role: 'user', sessionId: AUTH_SESSION_ID });
}

test('POST /api/v1/auth/social/challenge returns only the safe one-time login challenge contract', async (t) => {
  await resetSocialLimiters();
  let persisted;
  t.mock.method(challengeRepository, 'createChallenge', async (args) => {
    persisted = args;
    return { _id: '507f1f77bcf86cd799439099' };
  });

  const response = await request(app)
    .post('/api/v1/auth/social/challenge')
    .send({ provider: 'google' });

  assert.equal(response.status, 201);
  assert.deepEqual(Object.keys(response.body.data).sort(), ['challengeId', 'expiresAt', 'nonce']);
  assert.equal(response.body.data.challengeId, '507f1f77bcf86cd799439099');
  assert.match(response.body.data.nonce, /^[A-Za-z0-9_-]{43}$/);
  assert.match(persisted.nonceHash, /^[a-f0-9]{64}$/);
  assert.equal('nonce' in persisted, false);
  // Login intent, unbound: this endpoint must stay usable with no account.
  assert.equal(persisted.intent, 'login');
  assert.equal(persisted.userId, null);
});

test('link challenge route applies the locked limiter/authentication order', () => {
  const handles = (path) =>
    authRoutes.stack.find((layer) => layer.route?.path === path).route.stack.map((layer) => layer.handle);

  const linkChallenge = handles('/social/challenge/link');
  assert.equal(linkChallenge[0], socialChallengeRateLimiter);
  assert.equal(linkChallenge[1], authenticate);
  assert.equal(linkChallenge[2], socialLinkChallengeUserRateLimiter);
  assert.equal(linkChallenge.length, 5);
});

test('an unauthenticated client cannot obtain a link-bound challenge', async (t) => {
  await resetSocialLimiters();
  const create = t.mock.method(challengeRepository, 'createChallenge', async () => ({ _id: 'x' }));

  const missing = await request(app)
    .post('/api/v1/auth/social/challenge/link')
    .send({ provider: 'google' });
  const bogus = await request(app)
    .post('/api/v1/auth/social/challenge/link')
    .set('Authorization', 'Bearer not-a-real-token')
    .send({ provider: 'google' });

  assert.equal(missing.status, 401);
  assert.equal(missing.body.error.code, 'AUTH_TOKEN_MISSING');
  assert.equal(bogus.status, 401);
  assert.equal(bogus.body.error.code, 'AUTH_TOKEN_INVALID');
  assert.equal(create.mock.callCount(), 0);
});

test('a link challenge is bound to the authenticated user and the client cannot choose that id', async (t) => {
  await resetSocialLimiters();
  const token = mockAuthenticatedUser(t);
  let persisted;
  t.mock.method(challengeRepository, 'createChallenge', async (args) => {
    persisted = args;
    return { _id: '507f1f77bcf86cd799439098' };
  });

  const response = await request(app)
    .post('/api/v1/auth/social/challenge/link')
    .set('Authorization', `Bearer ${token}`)
    .send({ provider: 'google' });

  assert.equal(response.status, 201);
  // Response shape is identical to the login challenge — intent and the bound
  // user are server state and are never echoed.
  assert.deepEqual(Object.keys(response.body.data).sort(), ['challengeId', 'expiresAt', 'nonce']);
  assert.equal(persisted.intent, 'link');
  assert.equal(persisted.userId, AUTH_USER_ID);

  // A caller-supplied userId is rejected outright by the strict schema, so it
  // can never become the binding.
  await resetSocialLimiters();
  const spoofed = await request(app)
    .post('/api/v1/auth/social/challenge/link')
    .set('Authorization', `Bearer ${token}`)
    .send({ provider: 'google', userId: '507f1f77bcf86cd799439055' });
  assert.equal(spoofed.status, 400);
  assert.equal(spoofed.body.error.code, 'VALIDATION_ERROR');
});

test('User B cannot consume User A’s link challenge, and intents are not interchangeable', async (t) => {
  await resetSocialLimiters();
  const USER_B = '507f1f77bcf86cd799439077';
  const token = mockAuthenticatedUser(t, { userId: USER_B });
  t.mock.method(googleProvider, 'verifyGoogleIdToken', async () => fakeGoogleIdentity());
  // The atomic match is the authority: a challenge bound to User A (or issued
  // with intent 'login') simply does not match this predicate.
  let consumeFilter;
  t.mock.method(challengeRepository, 'consumeChallenge', async (filter) => {
    consumeFilter = filter;
    return null;
  });
  const link = t.mock.method(userRepository, 'linkAuthIdentity', async () => fakeUserDoc());

  const response = await request(app)
    .post('/api/v1/auth/social/google/link')
    .set('Authorization', `Bearer ${token}`)
    .send({ idToken: 'google-token', challengeId: '507f1f77bcf86cd799439099' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'AUTH_SOCIAL_CHALLENGE_INVALID');
  assert.equal(consumeFilter.intent, 'link');
  assert.equal(consumeFilter.userId, USER_B);
  assert.equal(link.mock.callCount(), 0);
});

test('the Google login flow only ever consumes an unbound login challenge', async (t) => {
  await resetSocialLimiters();
  t.mock.method(googleProvider, 'verifyGoogleIdToken', async () => fakeGoogleIdentity());
  let consumeFilter;
  t.mock.method(challengeRepository, 'consumeChallenge', async (filter) => {
    consumeFilter = filter;
    return { _id: filter.challengeId };
  });
  t.mock.method(userRepository, 'findByAuthIdentity', async () => fakeUserDoc());
  t.mock.method(sessionRepository, 'createSession', async ({ userId }) => fakeSessionDoc(userId));

  const response = await request(app).post('/api/v1/auth/social/google').send({
    idToken: 'google-token',
    challengeId: '507f1f77bcf86cd799439099',
  });

  assert.equal(response.status, 200);
  assert.equal(consumeFilter.intent, 'login');
  // No binding at all. The repository turns this into `userId: { $exists:
  // false }` (see social-auth-challenge-repository.test.js), which a link
  // challenge — always carrying a real bound user id — can never satisfy.
  assert.equal(consumeFilter.userId, null);
});

test('the link-challenge route applies its own ten-attempt per-user limiter', async (t) => {
  await resetSocialLimiters();
  const token = mockAuthenticatedUser(t);
  t.mock.method(challengeRepository, 'createChallenge', async () => ({
    _id: '507f1f77bcf86cd799439098',
  }));

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const ok = await request(app)
      .post('/api/v1/auth/social/challenge/link')
      .set('Authorization', `Bearer ${token}`)
      .send({ provider: 'google' });
    assert.equal(ok.status, 201);
  }
  const limited = await request(app)
    .post('/api/v1/auth/social/challenge/link')
    .set('Authorization', `Bearer ${token}`)
    .send({ provider: 'google' });

  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'RATE_LIMIT_EXCEEDED');
});

test('social challenge and Google login bodies are strict before provider/account work', async (t) => {
  await resetSocialLimiters();
  const verify = t.mock.method(googleProvider, 'verifyGoogleIdToken', async () => fakeGoogleIdentity());

  const challenge = await request(app)
    .post('/api/v1/auth/social/challenge')
    .send({ provider: 'google', nonce: 'caller-controlled' });
  const login = await request(app).post('/api/v1/auth/social/google').send({
    idToken: 'token',
    challengeId: '507f1f77bcf86cd799439099',
    audience: 'caller-controlled',
  });

  assert.equal(challenge.status, 400);
  assert.equal(challenge.body.error.code, 'VALIDATION_ERROR');
  assert.equal(login.status, 400);
  assert.equal(login.body.error.code, 'VALIDATION_ERROR');
  assert.equal(verify.mock.callCount(), 0);
});

test('POST /api/v1/auth/social/google returns ordinary WeCooked tokens without Google secrets', async (t) => {
  await resetSocialLimiters();
  t.mock.method(googleProvider, 'verifyGoogleIdToken', async () => fakeGoogleIdentity());
  let consumeFilter;
  t.mock.method(challengeRepository, 'consumeChallenge', async (filter) => {
    consumeFilter = filter;
    return { _id: filter.challengeId };
  });
  t.mock.method(userRepository, 'findByAuthIdentity', async () => fakeUserDoc());
  t.mock.method(sessionRepository, 'createSession', async ({ userId }) => fakeSessionDoc(userId));

  const response = await request(app).post('/api/v1/auth/social/google').send({
    idToken: 'google-token-secret',
    challengeId: '507f1f77bcf86cd799439099',
  });

  assert.equal(response.status, 200);
  assert.ok(response.body.data.accessToken);
  assert.ok(response.body.data.refreshToken);
  assert.equal(JSON.stringify(response.body).includes('google-token-secret'), false);
  assert.equal(JSON.stringify(response.body).includes(fakeGoogleIdentity().verifiedNonce), false);
  assert.equal(consumeFilter.challengeId, '507f1f77bcf86cd799439099');
  assert.equal(consumeFilter.provider, 'google');
  assert.match(consumeFilter.nonceHash, /^[a-f0-9]{64}$/);
  assert.ok(consumeFilter.now instanceof Date);
});

test('Google login exposes sanitized provider and challenge errors through the normal envelope', async (t) => {
  await resetSocialLimiters();
  t.mock.method(googleProvider, 'verifyGoogleIdToken', async () => {
    throw new AppError('Google credential is invalid or expired.', {
      statusCode: 401,
      code: 'AUTH_SOCIAL_CREDENTIAL_INVALID',
    });
  });
  const consume = t.mock.method(challengeRepository, 'consumeChallenge', async () => ({}));

  const invalid = await request(app).post('/api/v1/auth/social/google').send({
    idToken: 'bad-token',
    challengeId: '507f1f77bcf86cd799439099',
  });
  assert.equal(invalid.status, 401);
  assert.equal(invalid.body.error.code, 'AUTH_SOCIAL_CREDENTIAL_INVALID');
  assert.equal(consume.mock.callCount(), 0);

  t.mock.restoreAll();
  t.mock.method(googleProvider, 'verifyGoogleIdToken', async () => fakeGoogleIdentity());
  t.mock.method(challengeRepository, 'consumeChallenge', async () => null);
  const replay = await request(app).post('/api/v1/auth/social/google').send({
    idToken: 'valid-token',
    challengeId: '507f1f77bcf86cd799439099',
  });
  assert.equal(replay.status, 400);
  assert.equal(replay.body.error.code, 'AUTH_SOCIAL_CHALLENGE_INVALID');
});

test('POST /api/v1/auth/social/google/link requires authentication before validation', async () => {
  await resetSocialLimiters();
  const response = await request(app).post('/api/v1/auth/social/google/link').send({});
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_TOKEN_MISSING');
});

test('POST /api/v1/auth/social/google/link links the authenticated user and returns no tokens', async (t) => {
  await resetSocialLimiters();
  const target = fakeUserDoc({ id: AUTH_USER_ID, email: 'stored@example.com' });
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: AUTH_SESSION_ID,
    userId: AUTH_USER_ID,
    revokedAt: null,
  }));
  t.mock.method(userRepository, 'findById', async () => target);
  t.mock.method(googleProvider, 'verifyGoogleIdToken', async () =>
    fakeGoogleIdentity({ email: 'unrelated@example.com' })
  );
  t.mock.method(challengeRepository, 'consumeChallenge', async (filter) => ({
    _id: filter.challengeId,
  }));
  t.mock.method(userRepository, 'findByAuthIdentity', async () => null);
  let linked;
  t.mock.method(userRepository, 'linkAuthIdentity', async (userId, identity) => {
    linked = { userId, identity };
    return fakeUserDoc({ id: userId, email: 'stored@example.com', authIdentities: [identity] });
  });
  const createSession = t.mock.method(sessionRepository, 'createSession', async () => null);
  const token = signAccessToken({
    userId: AUTH_USER_ID,
    role: 'user',
    sessionId: AUTH_SESSION_ID,
  });

  const response = await request(app)
    .post('/api/v1/auth/social/google/link')
    .set('Authorization', `Bearer ${token}`)
    .send({ idToken: 'google-token', challengeId: '507f1f77bcf86cd799439099' });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.user.id, AUTH_USER_ID);
  assert.equal(response.body.data.user.email, 'stored@example.com');
  assert.equal('accessToken' in response.body.data, false);
  assert.equal('refreshToken' in response.body.data, false);
  assert.equal(linked.userId, AUTH_USER_ID);
  assert.equal(createSession.mock.callCount(), 0);
  // The response tells the client WHICH provider is now linked and when, and
  // nothing else about the identity.
  assert.deepEqual(response.body.data.user.authIdentities, [
    { provider: 'google', linkedAt: linked.identity.linkedAt.toISOString() },
  ]);
  assert.equal(JSON.stringify(response.body).includes('google-subject-1'), false);
});

test('authenticated Google link applies its ten-attempt per-user limiter after authenticate', async (t) => {
  await resetSocialLimiters();
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: AUTH_SESSION_ID,
    userId: AUTH_USER_ID,
    revokedAt: null,
  }));
  t.mock.method(userRepository, 'findById', async () => fakeUserDoc({ id: AUTH_USER_ID }));
  const token = signAccessToken({
    userId: AUTH_USER_ID,
    role: 'user',
    sessionId: AUTH_SESSION_ID,
  });

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const response = await request(app)
      .post('/api/v1/auth/social/google/link')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  }
  const limited = await request(app)
    .post('/api/v1/auth/social/google/link')
    .set('Authorization', `Bearer ${token}`)
    .send({});
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'RATE_LIMIT_EXCEEDED');
});

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

test('POST /api/v1/auth/login for a Google-only account (no passwordHash) returns 401, not a 500 bcrypt crash', async (t) => {
  // Regression: verifyCredentials used to call bcrypt.compare(password, undefined)
  // for a truthy user with no local passwordHash, throwing "Illegal arguments:
  // string, undefined" and surfacing as a raw 500 to the client.
  t.mock.method(userRepository, 'findByEmailWithPassword', async () =>
    fakeUserDoc({
      email: 'google-only@example.com',
      passwordHash: undefined,
      authIdentities: [{ provider: 'google', subject: 'sub-1', linkedAt: new Date() }],
    })
  );
  let sessionCreated = false;
  t.mock.method(sessionRepository, 'createSession', async () => {
    sessionCreated = true;
    return fakeSessionDoc('u1');
  });

  const response = await request(app).post('/api/v1/auth/login').send({
    email: 'google-only@example.com',
    password: 'whatever-they-typed',
  });

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_INVALID_CREDENTIALS');
  assert.equal(response.body.error.message, 'Invalid email or password.');
  assert.equal(sessionCreated, false);
  // Never reveal that the account is Google-only, and never leak an internal
  // bcrypt/error message anywhere in the response.
  const raw = JSON.stringify(response.body).toLowerCase();
  assert.equal(raw.includes('google'), false);
  assert.equal(raw.includes('bcrypt'), false);
  assert.equal(raw.includes('illegal arguments'), false);
});

test('POST /api/v1/auth/login: admin credentials return role "admin" in the response, never downgraded', async (t) => {
  const passwordHash = await hashPassword('correct-password');
  t.mock.method(userRepository, 'findByEmailWithPassword', async () =>
    fakeUserDoc({ passwordHash, role: 'admin' })
  );
  t.mock.method(sessionRepository, 'createSession', async ({ userId }) => fakeSessionDoc(userId));

  const response = await request(app).post('/api/v1/auth/login').send({
    email: 'ada@example.com',
    password: 'correct-password',
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.user.role, 'admin');
});

test('GET /api/v1/users/me: an admin session round-trips role "admin", never defaulted to "user"', async (t) => {
  const token = mockAuthenticatedUser(t, {
    user: fakeUserDoc({ id: AUTH_USER_ID, role: 'admin' }),
  });

  const response = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.user.role, 'admin');
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
  t.mock.method(userRepository, 'replacePasswordById', async (id, passwordHash) => {
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
  t.mock.method(userRepository, 'replacePasswordById', async () => ({ matchedCount: 1 }));
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
  t.mock.method(userRepository, 'replacePasswordById', async () => ({ matchedCount: 1 }));
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

test('POST /api/v1/auth/forgot-password returns generic success and emails only an eligible account', async (t) => {
  await resetForgotPasswordLimiter();
  const passwordHash = await hashPassword('current-secret');
  t.mock.method(userRepository, 'findByEmailWithPassword', async () =>
    fakeUserDoc({ id: AUTH_USER_ID, email: 'ada@example.com', passwordHash })
  );
  let stored;
  t.mock.method(
    userRepository,
    'setPasswordResetTokenForEligibleUser',
    async (userId, tokenHash, expiresAt) => {
      stored = { userId, tokenHash, expiresAt };
      return { matchedCount: 1 };
    }
  );
  let email;
  t.mock.method(emailService, 'sendPasswordResetEmail', async (args) => {
    email = args;
  });

  const response = await request(app)
    .post('/api/v1/auth/forgot-password')
    .send({ email: '  ADA@EXAMPLE.COM ' });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    success: true,
    data: { passwordResetRequested: true },
  });
  assert.equal(stored.userId, AUTH_USER_ID);
  assert.match(stored.tokenHash, /^[a-f0-9]{64}$/);
  assert.ok(stored.expiresAt instanceof Date);
  assert.equal(email.to, 'ada@example.com');
  assert.match(new URL(email.resetUrl).hash, /^#token=[A-Za-z0-9_-]{43}$/);
});

test('POST /api/v1/auth/forgot-password gives an unknown email the identical response and sends nothing', async (t) => {
  await resetForgotPasswordLimiter();
  t.mock.method(userRepository, 'findByEmailWithPassword', async () => null);
  const send = t.mock.method(emailService, 'sendPasswordResetEmail', async () => {});

  const response = await request(app)
    .post('/api/v1/auth/forgot-password')
    .send({ email: 'unknown@example.com' });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    success: true,
    data: { passwordResetRequested: true },
  });
  assert.equal(send.mock.callCount(), 0);
});

test('POST /api/v1/auth/forgot-password rejects malformed and extra fields', async () => {
  await resetForgotPasswordLimiter();
  const malformed = await request(app)
    .post('/api/v1/auth/forgot-password')
    .send({ email: 'not-an-email' });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.code, 'VALIDATION_ERROR');

  const extra = await request(app)
    .post('/api/v1/auth/forgot-password')
    .send({ email: 'ada@example.com', client: 'admin' });
  assert.equal(extra.status, 400);
  assert.equal(extra.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/auth/reset-password atomically resets and revokes all sessions without issuing tokens', async (t) => {
  await resetAuthLimiter();
  let resetArgs;
  t.mock.method(userRepository, 'resetPasswordByTokenHash', async (args) => {
    resetArgs = args;
    return { _id: AUTH_USER_ID };
  });
  const revokedFor = [];
  t.mock.method(sessionRepository, 'revokeAllForUser', async (userId) => {
    revokedFor.push(String(userId));
    return 2;
  });

  const response = await request(app)
    .post('/api/v1/auth/reset-password')
    .send({ token: 'A'.repeat(43), newPassword: 'brand-new-secret' });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { success: true, data: { passwordReset: true } });
  assert.match(resetArgs.tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(resetArgs.passwordHash, 'brand-new-secret');
  assert.deepEqual(revokedFor, [AUTH_USER_ID]);
  assert.equal('accessToken' in response.body.data, false);
  assert.equal('refreshToken' in response.body.data, false);
});

test('POST /api/v1/auth/reset-password rejects invalid, expired, or replayed tokens identically', async (t) => {
  await resetAuthLimiter();
  t.mock.method(userRepository, 'resetPasswordByTokenHash', async () => null);
  const revoke = t.mock.method(sessionRepository, 'revokeAllForUser', async () => 0);

  for (const token of ['B'.repeat(43), 'C'.repeat(43)]) {
    const response = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: 'brand-new-secret' });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'AUTH_PASSWORD_RESET_TOKEN_INVALID');
    assert.equal(response.body.error.message, 'Password reset token is invalid or expired.');
  }
  assert.equal(revoke.mock.callCount(), 0);
});

test('an outstanding reset token cannot overwrite a password changed through authenticated B2', async (t) => {
  await resetAuthLimiter();
  let resetCredentialActive = true;
  let replacementHash;
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: AUTH_SESSION_ID,
    userId: AUTH_USER_ID,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
  }));
  t.mock.method(userRepository, 'findById', async () => fakeUserDoc({ id: AUTH_USER_ID }));
  const currentHash = await hashPassword(CP_CURRENT);
  t.mock.method(userRepository, 'findByIdWithPassword', async () =>
    fakeUserDoc({ id: AUTH_USER_ID, passwordHash: currentHash })
  );
  t.mock.method(userRepository, 'replacePasswordById', async (id, passwordHash) => {
    assert.equal(id, AUTH_USER_ID);
    replacementHash = passwordHash;
    resetCredentialActive = false;
    return { matchedCount: 1 };
  });
  t.mock.method(userRepository, 'resetPasswordByTokenHash', async () =>
    resetCredentialActive ? { _id: AUTH_USER_ID } : null
  );
  t.mock.method(sessionRepository, 'revokeAllForUser', async () => 1);
  const accessToken = signAccessToken({
    userId: AUTH_USER_ID,
    role: 'admin',
    sessionId: AUTH_SESSION_ID,
  });

  const changed = await request(app)
    .post('/api/v1/auth/change-password')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ currentPassword: CP_CURRENT, newPassword: 'legitimate-new-secret' });
  assert.equal(changed.status, 200);
  assert.equal(await require('../src/shared/security/password').comparePassword('legitimate-new-secret', replacementHash), true);

  const reset = await request(app)
    .post('/api/v1/auth/reset-password')
    .send({ token: 'D'.repeat(43), newPassword: 'attacker-password' });
  assert.equal(reset.status, 400);
  assert.equal(reset.body.error.code, 'AUTH_PASSWORD_RESET_TOKEN_INVALID');
});

test('forgot-password uses its dedicated five-request limiter', async () => {
  await resetForgotPasswordLimiter();
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'not-an-email' });
    assert.equal(response.status, 400);
  }
  const limited = await request(app)
    .post('/api/v1/auth/forgot-password')
    .send({ email: 'not-an-email' });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'RATE_LIMIT_EXCEEDED');
});
