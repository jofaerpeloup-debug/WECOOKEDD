process.env.NODE_ENV = 'test';
process.env.PORT = '4015';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
// Pinned explicitly (not left to TEST_EMAIL_DEFAULTS) so these tests' fragment-
// vs-query URL-shape assertions stay deterministic regardless of a developer's
// own local .env — dotenv.config() (inside loadEnv()) never overrides a
// process.env key that is already set, so setting these here BEFORE anything
// requires config/env.js wins over any ambient PASSWORD_RESET_URL /
// EMAIL_VERIFICATION_URL on this machine. Same pattern already used by
// email-service.test.js.
process.env.PASSWORD_RESET_URL = 'http://localhost:5173/reset-password';
process.env.EMAIL_VERIFICATION_URL = 'http://localhost:5173/verify-email';

const test = require('node:test');
const assert = require('node:assert/strict');

const userService = require('../src/modules/users/user.service');
const sessionService = require('../src/modules/sessions/session.service');
const authService = require('../src/modules/auth/auth.service');
const emailService = require('../src/shared/email/email.service');
const googleProvider = require('../src/modules/auth/providers/google.provider');
const socialAuthChallengeService = require('../src/modules/auth/social-auth-challenge.service');
const { verifyAccessToken } = require('../src/shared/security/access-token');
const { AppError } = require('../src/shared/errors/app-error');

function fakeUser(overrides = {}) {
  return {
    _id: 'user-1',
    name: 'Ada',
    email: 'ada@example.com',
    role: 'user',
    status: 'active',
    authIdentities: [],
    ...overrides,
  };
}

function fakeGoogleIdentity(overrides = {}) {
  return {
    provider: 'google',
    subject: 'google-subject-1',
    email: 'ada@example.com',
    emailVerified: true,
    suggestedName: 'Ada Google',
    verifiedNonce: Buffer.alloc(32, 5).toString('base64url'),
    ...overrides,
  };
}

function mockGoogleCredential(t, { identity = fakeGoogleIdentity(), calls } = {}) {
  t.mock.method(googleProvider, 'verifyGoogleIdToken', async () => {
    calls?.push('verify');
    return identity;
  });
  return t.mock.method(socialAuthChallengeService, 'consumeChallenge', async () => {
    calls?.push('consume');
  });
}

function fakeSession(overrides = {}) {
  return { _id: 'session-1', userId: 'user-1', ...overrides };
}

test('register creates the user and issues tokens tied to a new session', async (t) => {
  t.mock.method(userService, 'registerUser', async () => fakeUser());
  t.mock.method(userService, 'startEmailVerification', async () => {});
  t.mock.method(emailService, 'sendVerificationEmail', async () => {});
  t.mock.method(sessionService, 'createSession', async () => ({
    session: fakeSession(),
    refreshToken: 'raw-refresh-token',
  }));

  const result = await authService.register({
    name: 'Ada',
    email: 'ada@example.com',
    password: 'a-good-password',
  });

  assert.equal(result.user.email, 'ada@example.com');
  assert.equal(result.refreshToken, 'raw-refresh-token');
  const payload = verifyAccessToken(result.accessToken);
  assert.equal(payload.sub, 'user-1');
  assert.equal(payload.sessionId, 'session-1');
  assert.equal(payload.role, 'user');
});

test('register issues a verification token for the new user and emails a fragment link', async (t) => {
  t.mock.method(userService, 'registerUser', async () => fakeUser());
  let started;
  t.mock.method(userService, 'startEmailVerification', async (args) => {
    started = args;
  });
  let emailed;
  t.mock.method(emailService, 'sendVerificationEmail', async (args) => {
    emailed = args;
  });
  t.mock.method(sessionService, 'createSession', async () => ({
    session: fakeSession(),
    refreshToken: 'raw-refresh-token',
  }));

  await authService.register({
    name: 'Ada',
    email: 'ada@example.com',
    password: 'a-good-password',
  });

  assert.equal(started.userId, 'user-1');
  assert.match(started.tokenHash, /^[a-f0-9]{64}$/);
  assert.ok(started.expiresAt instanceof Date);
  assert.equal(emailed.to, 'ada@example.com');
  const url = new URL(emailed.verifyUrl);
  assert.equal(url.search, '');
  assert.match(url.hash, /^#token=[A-Za-z0-9_-]{43}$/);
});

test('register succeeds and issues a session even when verification email delivery fails', async (t) => {
  t.mock.method(userService, 'registerUser', async () => fakeUser());
  t.mock.method(userService, 'startEmailVerification', async () => {});
  t.mock.method(emailService, 'sendVerificationEmail', async () => {
    const error = new Error('provider failed');
    error.name = 'EmailDeliveryError';
    error.providerStatus = 503;
    throw error;
  });
  t.mock.method(sessionService, 'createSession', async () => ({
    session: fakeSession(),
    refreshToken: 'raw-refresh-token',
  }));
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args));

  const result = await authService.register({
    name: 'Ada',
    email: 'ada@example.com',
    password: 'a-good-password',
  });

  assert.equal(result.user.email, 'ada@example.com');
  assert.ok(result.accessToken);
  assert.ok(result.refreshToken);
  const serialized = JSON.stringify(logged);
  assert.equal(serialized.includes('ada@example.com'), false);
  assert.ok(serialized.includes('503'));
});

test('register never exposes a raw verification token in its result', async (t) => {
  t.mock.method(userService, 'registerUser', async () => fakeUser());
  let capturedToken;
  t.mock.method(emailService, 'sendVerificationEmail', async (args) => {
    capturedToken = new URL(args.verifyUrl).hash;
  });
  t.mock.method(userService, 'startEmailVerification', async () => {});
  t.mock.method(sessionService, 'createSession', async () => ({
    session: fakeSession(),
    refreshToken: 'raw-refresh-token',
  }));

  const result = await authService.register({
    name: 'Ada',
    email: 'ada@example.com',
    password: 'a-good-password',
  });

  const serialized = JSON.stringify(result);
  assert.ok(capturedToken);
  assert.equal(serialized.includes(capturedToken.replace('#token=', '')), false);
});

test('login rejects with AUTH_INVALID_CREDENTIALS when credentials do not match', async (t) => {
  t.mock.method(userService, 'verifyCredentials', async () => null);

  await assert.rejects(
    () => authService.login({ email: 'ada@example.com', password: 'wrong' }),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 401);
      assert.equal(err.code, 'AUTH_INVALID_CREDENTIALS');
      return true;
    }
  );
});

test('login rejects a suspended account with AUTH_ACCOUNT_SUSPENDED without creating a session', async (t) => {
  t.mock.method(userService, 'verifyCredentials', async () => fakeUser({ status: 'suspended' }));
  let sessionCreated = false;
  t.mock.method(sessionService, 'createSession', async () => {
    sessionCreated = true;
    return { session: fakeSession(), refreshToken: 'x' };
  });

  await assert.rejects(
    () => authService.login({ email: 'ada@example.com', password: 'whatever' }),
    (err) => {
      assert.equal(err.code, 'AUTH_ACCOUNT_SUSPENDED');
      assert.equal(err.statusCode, 403);
      return true;
    }
  );
  assert.equal(sessionCreated, false);
});

test('login succeeds for valid credentials on an active account and creates a session', async (t) => {
  t.mock.method(userService, 'verifyCredentials', async () => fakeUser());
  let sessionCreated = false;
  t.mock.method(sessionService, 'createSession', async () => {
    sessionCreated = true;
    return { session: fakeSession(), refreshToken: 'raw-refresh-token' };
  });

  const result = await authService.login({ email: 'ada@example.com', password: 'correct' });

  assert.equal(sessionCreated, true);
  assert.equal(result.refreshToken, 'raw-refresh-token');
  assert.ok(result.accessToken);
});

test('googleLogin verifies the credential before consuming the exact challenge nonce', async (t) => {
  const calls = [];
  const consume = mockGoogleCredential(t, { calls });
  t.mock.method(userService, 'getUserByAuthIdentity', async () => {
    calls.push('identity');
    return fakeUser();
  });
  t.mock.method(sessionService, 'createSession', async () => ({
    session: fakeSession(),
    refreshToken: 'refresh',
  }));

  await authService.googleLogin({ idToken: 'google-token', challengeId: 'challenge-1' });

  assert.deepEqual(calls.slice(0, 3), ['verify', 'consume', 'identity']);
  assert.deepEqual(consume.mock.calls[0].arguments[0], {
    challengeId: 'challenge-1',
    provider: 'google',
    intent: 'login',
    userId: null,
    verifiedNonce: fakeGoogleIdentity().verifiedNonce,
  });
});

test('googleLogin can only consume a login challenge, and googleLink only a user-bound link challenge', async (t) => {
  const consume = mockGoogleCredential(t);
  // The same identity already belongs to this user, so the link leg is the
  // idempotent path — this test is about which challenge each flow consumes.
  const owner = fakeUser({ _id: 'authenticated-user' });
  t.mock.method(userService, 'getUserByAuthIdentity', async () => owner);
  t.mock.method(sessionService, 'createSession', async () => ({
    session: fakeSession(),
    refreshToken: 'refresh',
  }));
  t.mock.method(userService, 'getUserById', async () => owner);

  await authService.googleLogin({ idToken: 'token', challengeId: 'c1' });
  await authService.googleLink({
    userId: 'authenticated-user',
    idToken: 'token',
    challengeId: 'c2',
  });

  const [login, link] = consume.mock.calls.map((call) => call.arguments[0]);
  assert.equal(login.intent, 'login');
  assert.equal(login.userId, null);
  assert.equal(link.intent, 'link');
  // The binding is the authenticated principal passed by the controller from
  // req.auth.userId — never a body field.
  assert.equal(link.userId, 'authenticated-user');
});

test('a challenge the atomic consume refuses stops the link before any account work', async (t) => {
  t.mock.method(googleProvider, 'verifyGoogleIdToken', async () => fakeGoogleIdentity());
  t.mock.method(socialAuthChallengeService, 'consumeChallenge', async () => {
    // What a login-intent challenge, an expired/replayed one, or one bound to a
    // DIFFERENT user all produce: a single no-match.
    throw new AppError('Social authentication challenge is invalid or expired.', {
      statusCode: 400,
      code: 'AUTH_SOCIAL_CHALLENGE_INVALID',
    });
  });
  const lookup = t.mock.method(userService, 'getUserById', async () => fakeUser());
  const link = t.mock.method(userService, 'linkAuthIdentity', async () => fakeUser());

  await assert.rejects(
    () => authService.googleLink({ userId: 'user-b', idToken: 'token', challengeId: 'a-challenge' }),
    { code: 'AUTH_SOCIAL_CHALLENGE_INVALID', statusCode: 400 }
  );
  assert.equal(lookup.mock.callCount(), 0);
  assert.equal(link.mock.callCount(), 0);
});

test('googleLogin does not consume a challenge when Google rejects the credential', async (t) => {
  t.mock.method(googleProvider, 'verifyGoogleIdToken', async () => {
    throw new AppError('Google credential is invalid or expired.', {
      statusCode: 401,
      code: 'AUTH_SOCIAL_CREDENTIAL_INVALID',
    });
  });
  const consume = t.mock.method(socialAuthChallengeService, 'consumeChallenge', async () => {});

  await assert.rejects(
    () => authService.googleLogin({ idToken: 'bad-token', challengeId: 'challenge-1' }),
    { code: 'AUTH_SOCIAL_CREDENTIAL_INVALID' }
  );
  assert.equal(consume.mock.callCount(), 0);
});

test('googleLogin reuses a linked active user without overwriting Google-changed profile data', async (t) => {
  mockGoogleCredential(t, {
    identity: fakeGoogleIdentity({ email: 'changed@example.com', suggestedName: 'Changed Name' }),
  });
  const existing = fakeUser({ name: 'Stored Name', email: 'stored@example.com' });
  t.mock.method(userService, 'getUserByAuthIdentity', async () => existing);
  const create = t.mock.method(userService, 'createSocialUser', async () => null);
  t.mock.method(sessionService, 'createSession', async () => ({
    session: fakeSession(),
    refreshToken: 'refresh',
  }));

  const result = await authService.googleLogin({ idToken: 'token', challengeId: 'challenge' });
  assert.equal(result.user.name, 'Stored Name');
  assert.equal(result.user.email, 'stored@example.com');
  assert.equal(create.mock.callCount(), 0);
  assert.ok(result.accessToken);
});

test('googleLogin blocks suspended and Admin identity owners before issuing a session', async (t) => {
  for (const owner of [fakeUser({ status: 'suspended' }), fakeUser({ role: 'admin' })]) {
    mockGoogleCredential(t);
    t.mock.method(userService, 'getUserByAuthIdentity', async () => owner);
    const createSession = t.mock.method(sessionService, 'createSession', async () => ({}));
    await assert.rejects(
      () => authService.googleLogin({ idToken: 'token', challengeId: 'challenge' }),
      { code: owner.role === 'admin' ? 'AUTH_SOCIAL_LOGIN_UNAVAILABLE' : 'AUTH_ACCOUNT_SUSPENDED' }
    );
    assert.equal(createSession.mock.callCount(), 0);
    t.mock.restoreAll();
  }
});

test('googleLogin provisions an explicit normal social user and reuses ordinary session issuance', async (t) => {
  mockGoogleCredential(t);
  t.mock.method(userService, 'getUserByAuthIdentity', async () => null);
  t.mock.method(userService, 'getUserByEmail', async () => null);
  let createdWith;
  t.mock.method(userService, 'createSocialUser', async (args) => {
    createdWith = args;
    return fakeUser({ authIdentities: [args.authIdentity], emailVerified: true });
  });
  t.mock.method(sessionService, 'createSession', async () => ({
    session: fakeSession(),
    refreshToken: 'ordinary-refresh',
  }));

  const result = await authService.googleLogin({ idToken: 'token-secret', challengeId: 'challenge' });

  assert.equal(createdWith.name, 'Ada Google');
  assert.equal(createdWith.email, 'ada@example.com');
  assert.equal(createdWith.emailVerified, true);
  assert.deepEqual(
    { provider: createdWith.authIdentity.provider, subject: createdWith.authIdentity.subject },
    { provider: 'google', subject: 'google-subject-1' }
  );
  assert.ok(createdWith.authIdentity.linkedAt instanceof Date);
  assert.equal('password' in createdWith, false);
  assert.equal('idToken' in createdWith, false);
  assert.equal(result.refreshToken, 'ordinary-refresh');
  assert.ok(result.accessToken);
});

test('googleLogin requires a literal verified usable email only for first provisioning', async (t) => {
  for (const identity of [
    fakeGoogleIdentity({ email: null, emailVerified: false }),
    fakeGoogleIdentity({ emailVerified: 'true' }),
  ]) {
    mockGoogleCredential(t, { identity });
    t.mock.method(userService, 'getUserByAuthIdentity', async () => null);
    await assert.rejects(
      () => authService.googleLogin({ idToken: 'token', challengeId: 'challenge' }),
      { code: 'AUTH_SOCIAL_EMAIL_REQUIRED', statusCode: 422 }
    );
    t.mock.restoreAll();
  }
});

test('googleLogin never auto-links an email collision, including an Admin email', async (t) => {
  mockGoogleCredential(t);
  t.mock.method(userService, 'getUserByAuthIdentity', async () => null);
  t.mock.method(userService, 'getUserByEmail', async () => fakeUser({ role: 'admin' }));
  const create = t.mock.method(userService, 'createSocialUser', async () => null);

  await assert.rejects(
    () => authService.googleLogin({ idToken: 'token', challengeId: 'challenge' }),
    { code: 'AUTH_ACCOUNT_LINK_REQUIRED', statusCode: 409 }
  );
  assert.equal(create.mock.callCount(), 0);
});

test('googleLogin recovers only recognized E11000 identity and email races', async (t) => {
  mockGoogleCredential(t);
  let identityLookups = 0;
  t.mock.method(userService, 'getUserByAuthIdentity', async () => {
    identityLookups += 1;
    return identityLookups === 1 ? null : fakeUser();
  });
  t.mock.method(userService, 'getUserByEmail', async () => null);
  t.mock.method(userService, 'createSocialUser', async () => {
    throw Object.assign(new Error('duplicate'), { code: 11000 });
  });
  t.mock.method(sessionService, 'createSession', async () => ({
    session: fakeSession(),
    refreshToken: 'refresh',
  }));
  const winner = await authService.googleLogin({ idToken: 'token', challengeId: 'challenge' });
  assert.equal(winner.user._id, 'user-1');
});

test('googleLogin maps an E11000 email race and propagates an unexplained duplicate', async (t) => {
  mockGoogleCredential(t);
  t.mock.method(userService, 'getUserByAuthIdentity', async () => null);
  let emailLookups = 0;
  t.mock.method(userService, 'getUserByEmail', async () => {
    emailLookups += 1;
    return emailLookups === 1 ? null : fakeUser();
  });
  const duplicate = Object.assign(new Error('duplicate'), { code: 11000 });
  t.mock.method(userService, 'createSocialUser', async () => {
    throw duplicate;
  });
  await assert.rejects(
    () => authService.googleLogin({ idToken: 'token', challengeId: 'challenge' }),
    { code: 'AUTH_ACCOUNT_LINK_REQUIRED' }
  );

  t.mock.restoreAll();
  mockGoogleCredential(t);
  t.mock.method(userService, 'getUserByAuthIdentity', async () => null);
  t.mock.method(userService, 'getUserByEmail', async () => null);
  t.mock.method(userService, 'createSocialUser', async () => {
    throw duplicate;
  });
  await assert.rejects(
    () => authService.googleLogin({ idToken: 'token', challengeId: 'challenge' }),
    (error) => error === duplicate
  );
});

test('googleLink links only the authenticated active normal user and issues no session', async (t) => {
  mockGoogleCredential(t, { identity: fakeGoogleIdentity({ email: 'unrelated@example.com' }) });
  const target = fakeUser({ _id: 'authenticated-user', email: 'stored@example.com' });
  t.mock.method(userService, 'getUserById', async (id) => {
    assert.equal(id, 'authenticated-user');
    return target;
  });
  t.mock.method(userService, 'getUserByAuthIdentity', async () => null);
  let linkedWith;
  t.mock.method(userService, 'linkAuthIdentity', async (id, identity) => {
    linkedWith = { id, identity };
    return fakeUser({ _id: id, email: 'stored@example.com', authIdentities: [identity] });
  });
  const createSession = t.mock.method(sessionService, 'createSession', async () => ({}));

  const result = await authService.googleLink({
    userId: 'authenticated-user',
    idToken: 'token',
    challengeId: 'challenge',
  });
  assert.equal(linkedWith.id, 'authenticated-user');
  assert.equal(linkedWith.identity.subject, 'google-subject-1');
  assert.equal(result.email, 'stored@example.com');
  assert.equal(createSession.mock.callCount(), 0);
});

test('googleLink never sets or touches emailVerified on the existing password account', async (t) => {
  // A different email on the Google side than the WeCooked account's own —
  // deliberately, since googleLink's contract is that email equality is never
  // consulted. If linking silently trusted "the identity is Google-verified"
  // to also mean "this WeCooked email is now verified", an attacker who
  // controls a Google account (any Google account, any email) could flip
  // emailVerified on someone else's unverified WeCooked account merely by
  // linking it — this test locks in that no such write ever happens.
  mockGoogleCredential(t, { identity: fakeGoogleIdentity({ email: 'unrelated@example.com' }) });
  const target = fakeUser({
    _id: 'authenticated-user',
    email: 'stored@example.com',
    emailVerified: false,
  });
  t.mock.method(userService, 'getUserById', async () => target);
  t.mock.method(userService, 'getUserByAuthIdentity', async () => null);
  let linkedWith;
  t.mock.method(userService, 'linkAuthIdentity', async (id, identity) => {
    linkedWith = { id, identity };
    // The repository layer only ever receives {provider, subject, linkedAt} —
    // asserted here structurally rather than by reading past it.
    return fakeUser({
      _id: id,
      email: target.email,
      emailVerified: target.emailVerified,
      authIdentities: [identity],
    });
  });

  const result = await authService.googleLink({
    userId: 'authenticated-user',
    idToken: 'token',
    challengeId: 'challenge',
  });

  assert.deepEqual(Object.keys(linkedWith.identity).sort(), ['linkedAt', 'provider', 'subject']);
  assert.equal(result.emailVerified, false);
});

test('googleLink is idempotent for the same owner and rejects another owner', async (t) => {
  mockGoogleCredential(t);
  t.mock.method(userService, 'getUserById', async () => fakeUser({ _id: 'target' }));
  t.mock.method(userService, 'getUserByAuthIdentity', async () => fakeUser({ _id: 'target' }));
  const link = t.mock.method(userService, 'linkAuthIdentity', async () => null);
  const result = await authService.googleLink({ userId: 'target', idToken: 'token', challengeId: 'c' });
  assert.equal(result._id, 'target');
  assert.equal(link.mock.callCount(), 0);

  t.mock.restoreAll();
  mockGoogleCredential(t);
  t.mock.method(userService, 'getUserById', async () => fakeUser({ _id: 'target' }));
  t.mock.method(userService, 'getUserByAuthIdentity', async () => fakeUser({ _id: 'other' }));
  await assert.rejects(
    () => authService.googleLink({ userId: 'target', idToken: 'token', challengeId: 'c' }),
    { code: 'AUTH_SOCIAL_IDENTITY_IN_USE' }
  );
});

test('googleLink rejects a different Google identity, Admin, and inactive target', async (t) => {
  const cases = [
    {
      target: fakeUser({ authIdentities: [{ provider: 'google', subject: 'other-subject' }] }),
      code: 'AUTH_SOCIAL_PROVIDER_ALREADY_LINKED',
    },
    { target: fakeUser({ role: 'admin' }), code: 'AUTH_SOCIAL_LOGIN_UNAVAILABLE' },
    { target: fakeUser({ status: 'suspended' }), code: 'AUTH_SESSION_INVALID' },
  ];
  for (const { target, code } of cases) {
    mockGoogleCredential(t);
    t.mock.method(userService, 'getUserById', async () => target);
    t.mock.method(userService, 'getUserByAuthIdentity', async () => null);
    await assert.rejects(
      () => authService.googleLink({ userId: 'user-1', idToken: 'token', challengeId: 'c' }),
      { code }
    );
    t.mock.restoreAll();
  }
});

test('googleLink classifies link races by reloading ownership and target state', async (t) => {
  mockGoogleCredential(t);
  let ownerLookups = 0;
  t.mock.method(userService, 'getUserById', async () => fakeUser({ _id: 'target' }));
  t.mock.method(userService, 'getUserByAuthIdentity', async () => {
    ownerLookups += 1;
    return ownerLookups === 1 ? null : fakeUser({ _id: 'other' });
  });
  t.mock.method(userService, 'linkAuthIdentity', async () => {
    throw Object.assign(new Error('duplicate'), { code: 11000 });
  });
  await assert.rejects(
    () => authService.googleLink({ userId: 'target', idToken: 'token', challengeId: 'c' }),
    { code: 'AUTH_SOCIAL_IDENTITY_IN_USE' }
  );
});

test('googleLink treats a concurrent same-user/same-subject winner as idempotent', async (t) => {
  mockGoogleCredential(t);
  let ownerLookups = 0;
  const target = fakeUser({ _id: 'target' });
  t.mock.method(userService, 'getUserById', async () => target);
  t.mock.method(userService, 'getUserByAuthIdentity', async () => {
    ownerLookups += 1;
    return ownerLookups === 1 ? null : fakeUser({ _id: 'target' });
  });
  t.mock.method(userService, 'linkAuthIdentity', async () => {
    throw Object.assign(new Error('duplicate'), { code: 11000 });
  });

  const result = await authService.googleLink({
    userId: 'target',
    idToken: 'token',
    challengeId: 'challenge',
  });
  assert.equal(result._id, 'target');
});

test('googleLink maps a provider-guard no-match to the concurrently linked different subject', async (t) => {
  mockGoogleCredential(t);
  let targetLookups = 0;
  t.mock.method(userService, 'getUserById', async () => {
    targetLookups += 1;
    return targetLookups === 1
      ? fakeUser({ _id: 'target' })
      : fakeUser({
          _id: 'target',
          authIdentities: [{ provider: 'google', subject: 'concurrent-other-subject' }],
        });
  });
  t.mock.method(userService, 'getUserByAuthIdentity', async () => null);
  t.mock.method(userService, 'linkAuthIdentity', async () => null);

  await assert.rejects(
    () => authService.googleLink({ userId: 'target', idToken: 'token', challengeId: 'challenge' }),
    { code: 'AUTH_SOCIAL_PROVIDER_ALREADY_LINKED' }
  );
});

test('googleLink never creates a user, never merges, and never consults email equality', async (t) => {
  // The Google token's email is IDENTICAL to a different existing account's —
  // the one case an email-based auto-link would collapse. Nothing here may act
  // on that.
  mockGoogleCredential(t, { identity: fakeGoogleIdentity({ email: 'maria@gmail.com' }) });
  const target = fakeUser({ _id: 'target', email: 'maria@gmail.com', role: 'user', status: 'active' });
  t.mock.method(userService, 'getUserById', async () => target);
  t.mock.method(userService, 'getUserByAuthIdentity', async () => null);
  const byEmail = t.mock.method(userService, 'getUserByEmail', async () => fakeUser({ _id: 'someone-else' }));
  const create = t.mock.method(userService, 'createSocialUser', async () => null);
  let linkedWith;
  t.mock.method(userService, 'linkAuthIdentity', async (id, identity) => {
    linkedWith = { id, identity };
    return fakeUser({ _id: id, email: target.email, authIdentities: [identity] });
  });
  const createSession = t.mock.method(sessionService, 'createSession', async () => ({}));

  const result = await authService.googleLink({
    userId: 'target',
    idToken: 'token',
    challengeId: 'challenge',
  });

  assert.equal(create.mock.callCount(), 0, 'link must never create a user');
  assert.equal(byEmail.mock.callCount(), 0, 'link must never resolve an account by email');
  assert.equal(createSession.mock.callCount(), 0, 'link must never issue a session');
  // The write is the identity push only — no role/status/email/passwordHash.
  assert.equal(linkedWith.id, 'target');
  assert.deepEqual(Object.keys(linkedWith.identity).sort(), ['linkedAt', 'provider', 'subject']);
  assert.equal(result._id, 'target');
  assert.equal(result.email, 'maria@gmail.com');
  assert.equal(result.role, 'user');
  assert.equal(result.status, 'active');
  assert.equal('passwordHash' in linkedWith.identity, false);
});

test('googleLink returns the same user identity it was given, never a different account', async (t) => {
  mockGoogleCredential(t);
  const target = fakeUser({ _id: 'user-a', email: 'a@example.com' });
  t.mock.method(userService, 'getUserById', async () => target);
  t.mock.method(userService, 'getUserByAuthIdentity', async () => null);
  t.mock.method(userService, 'linkAuthIdentity', async (id, identity) =>
    fakeUser({ _id: id, email: 'a@example.com', authIdentities: [identity] })
  );

  const result = await authService.googleLink({
    userId: 'user-a',
    idToken: 'token',
    challengeId: 'challenge',
  });

  assert.equal(String(result._id), 'user-a');
  assert.equal(result.authIdentities.length, 1);
  assert.equal(result.authIdentities[0].provider, 'google');
});

test('refresh rejects with AUTH_REFRESH_TOKEN_INVALID when no active session matches the token, and never rotates', async (t) => {
  t.mock.method(sessionService, 'findActiveSessionByRefreshToken', async () => null);
  let rotateCalled = false;
  t.mock.method(sessionService, 'rotateSession', async () => {
    rotateCalled = true;
    return null;
  });

  await assert.rejects(
    () => authService.refresh('some-token'),
    (err) => {
      assert.equal(err.code, 'AUTH_REFRESH_TOKEN_INVALID');
      assert.equal(err.statusCode, 401);
      return true;
    }
  );
  assert.equal(rotateCalled, false, 'expected no session match to short-circuit before rotating');
});

test("refresh rejects when the session's user is no longer active, and never rotates", async (t) => {
  t.mock.method(sessionService, 'findActiveSessionByRefreshToken', async () => fakeSession());
  t.mock.method(userService, 'getUserById', async () => fakeUser({ status: 'suspended' }));
  let rotateCalled = false;
  t.mock.method(sessionService, 'rotateSession', async () => {
    rotateCalled = true;
    return null;
  });

  await assert.rejects(
    () => authService.refresh('some-token'),
    (err) => {
      assert.equal(err.code, 'AUTH_REFRESH_TOKEN_INVALID');
      return true;
    }
  );
  assert.equal(rotateCalled, false, 'expected an inactive user to short-circuit before rotating');
});

test('refresh rejects when the session\'s user no longer exists, and never rotates', async (t) => {
  t.mock.method(sessionService, 'findActiveSessionByRefreshToken', async () => fakeSession());
  t.mock.method(userService, 'getUserById', async () => null);
  let rotateCalled = false;
  t.mock.method(sessionService, 'rotateSession', async () => {
    rotateCalled = true;
    return null;
  });

  await assert.rejects(
    () => authService.refresh('some-token'),
    (err) => {
      assert.equal(err.code, 'AUTH_REFRESH_TOKEN_INVALID');
      return true;
    }
  );
  assert.equal(rotateCalled, false);
});

test('refresh does not rotate the token when the user lookup errors, and the error propagates', async (t) => {
  t.mock.method(sessionService, 'findActiveSessionByRefreshToken', async () => fakeSession());
  t.mock.method(userService, 'getUserById', async () => {
    throw new Error('MongoDB connection timed out');
  });
  let rotateCalled = false;
  t.mock.method(sessionService, 'rotateSession', async () => {
    rotateCalled = true;
    return null;
  });

  await assert.rejects(() => authService.refresh('some-token'), /MongoDB connection timed out/);
  assert.equal(rotateCalled, false, 'expected a user-lookup failure to never trigger rotation');
});

test('refresh succeeds: checks the user first, then rotates, and returns a freshly-signed access token plus the rotated refresh token', async (t) => {
  const calls = [];
  t.mock.method(sessionService, 'findActiveSessionByRefreshToken', async () => {
    calls.push('findActiveSessionByRefreshToken');
    return fakeSession();
  });
  t.mock.method(userService, 'getUserById', async () => {
    calls.push('getUserById');
    return fakeUser();
  });
  t.mock.method(sessionService, 'rotateSession', async () => {
    calls.push('rotateSession');
    return { session: fakeSession(), refreshToken: 'new-raw-token' };
  });

  const result = await authService.refresh('old-token');

  assert.deepEqual(calls, ['findActiveSessionByRefreshToken', 'getUserById', 'rotateSession']);
  assert.equal(result.refreshToken, 'new-raw-token');
  const payload = verifyAccessToken(result.accessToken);
  assert.equal(payload.sub, 'user-1');
});

test('refresh rejects with AUTH_REFRESH_TOKEN_INVALID when the atomic rotation loses a concurrency race after the pre-check passed', async (t) => {
  t.mock.method(sessionService, 'findActiveSessionByRefreshToken', async () => fakeSession());
  t.mock.method(userService, 'getUserById', async () => fakeUser());
  // Simulates a second concurrent request having already consumed this
  // token via the atomic rotate, between our pre-check and our own attempt.
  t.mock.method(sessionService, 'rotateSession', async () => null);

  await assert.rejects(
    () => authService.refresh('some-token'),
    (err) => {
      assert.equal(err.code, 'AUTH_REFRESH_TOKEN_INVALID');
      assert.equal(err.statusCode, 401);
      return true;
    }
  );
});

test('logout revokes the given session', async (t) => {
  let capturedId;
  t.mock.method(sessionService, 'revokeSession', async (id) => {
    capturedId = id;
  });

  await authService.logout('session-1');
  assert.equal(capturedId, 'session-1');
});

test("logoutAll revokes all of the user's sessions and reports the count", async (t) => {
  t.mock.method(sessionService, 'revokeAllSessionsForUser', async () => 4);

  const result = await authService.logoutAll('user-1');
  assert.equal(result.revokedCount, 4);
});

// ---------------------------------------------------------------------------
// changePassword — orchestration (persist first, THEN revoke every session)
// ---------------------------------------------------------------------------

test('changePassword persists the new password FIRST, then revokes every session (order matters)', async (t) => {
  const calls = [];
  t.mock.method(userService, 'changePassword', async () => {
    calls.push('userService.changePassword');
  });
  t.mock.method(sessionService, 'revokeAllSessionsForUser', async () => {
    calls.push('sessionService.revokeAllSessionsForUser');
    return 3;
  });

  const result = await authService.changePassword({
    userId: 'user-1',
    currentPassword: 'old',
    newPassword: 'a-new-password',
  });

  assert.deepEqual(calls, ['userService.changePassword', 'sessionService.revokeAllSessionsForUser']);
  assert.deepEqual(result, { passwordChanged: true });
});

test('changePassword revokes sessions for the authenticated user id', async (t) => {
  t.mock.method(userService, 'changePassword', async () => {});
  let revokedFor;
  t.mock.method(sessionService, 'revokeAllSessionsForUser', async (userId) => {
    revokedFor = userId;
    return 1;
  });

  await authService.changePassword({
    userId: 'user-42',
    currentPassword: 'old',
    newPassword: 'a-new-password',
  });

  assert.equal(revokedFor, 'user-42');
});

test('changePassword does NOT revoke sessions when the credential change fails', async (t) => {
  t.mock.method(userService, 'changePassword', async () => {
    throw new AppError('Current password is incorrect.', {
      statusCode: 400,
      code: 'AUTH_CURRENT_PASSWORD_INVALID',
    });
  });
  let revokeCalled = false;
  t.mock.method(sessionService, 'revokeAllSessionsForUser', async () => {
    revokeCalled = true;
    return 0;
  });

  await assert.rejects(
    () =>
      authService.changePassword({
        userId: 'user-1',
        currentPassword: 'wrong',
        newPassword: 'a-new-password',
      }),
    (err) => {
      assert.equal(err.code, 'AUTH_CURRENT_PASSWORD_INVALID');
      return true;
    }
  );
  assert.equal(revokeCalled, false);
});

test('changePassword propagates a session-revocation failure unchanged (password already persisted — no rollback)', async (t) => {
  t.mock.method(userService, 'changePassword', async () => {});
  t.mock.method(sessionService, 'revokeAllSessionsForUser', async () => {
    throw new Error('session store unavailable');
  });

  await assert.rejects(
    () =>
      authService.changePassword({
        userId: 'user-1',
        currentPassword: 'old',
        newPassword: 'a-new-password',
      }),
    /session store unavailable/
  );
});

test('changePassword returns exactly { passwordChanged: true } and issues no tokens', async (t) => {
  t.mock.method(userService, 'changePassword', async () => {});
  t.mock.method(sessionService, 'revokeAllSessionsForUser', async () => 2);

  const result = await authService.changePassword({
    userId: 'user-1',
    currentPassword: 'old',
    newPassword: 'a-new-password',
  });

  assert.deepEqual(Object.keys(result), ['passwordChanged']);
  assert.equal(result.passwordChanged, true);
});

test('forgotPassword stores a reset credential, emails a fragment link, and enforces the response floor', async (t) => {
  let prepared;
  let emailed;
  t.mock.method(userService, 'preparePasswordReset', async (args) => {
    prepared = args;
    return { userId: 'user-1', email: 'ada@example.com' };
  });
  t.mock.method(emailService, 'sendPasswordResetEmail', async (args) => {
    emailed = args;
  });
  const startedAt = Date.now();

  const result = await authService.forgotPassword('ada@example.com');

  assert.deepEqual(result, { passwordResetRequested: true });
  assert.match(prepared.tokenHash, /^[a-f0-9]{64}$/);
  assert.ok(prepared.expiresAt instanceof Date);
  const url = new URL(emailed.resetUrl);
  assert.equal(url.search, '');
  assert.match(url.hash, /^#token=[A-Za-z0-9_-]{43}$/);
  assert.equal(emailed.to, 'ada@example.com');
  assert.ok(Date.now() - startedAt >= 700);
});

test('forgotPassword returns the identical generic result for an unknown account and sends nothing', async (t) => {
  t.mock.method(userService, 'preparePasswordReset', async () => null);
  const send = t.mock.method(emailService, 'sendPasswordResetEmail', async () => {});

  const result = await authService.forgotPassword('unknown@example.com');

  assert.deepEqual(result, { passwordResetRequested: true });
  assert.equal(send.mock.callCount(), 0);
});

test('forgotPassword hides email delivery failure and logs no recipient, token, or reset URL', async (t) => {
  t.mock.method(userService, 'preparePasswordReset', async () => ({
    userId: 'user-1',
    email: 'ada@example.com',
  }));
  t.mock.method(emailService, 'sendPasswordResetEmail', async () => {
    const error = new Error('provider failed');
    error.name = 'EmailDeliveryError';
    error.providerStatus = 503;
    throw error;
  });
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args));

  const result = await authService.forgotPassword('ada@example.com');

  assert.deepEqual(result, { passwordResetRequested: true });
  const serialized = JSON.stringify(logged);
  assert.equal(serialized.includes('ada@example.com'), false);
  assert.equal(serialized.includes('#token='), false);
  assert.equal(serialized.includes('provider failed'), false);
  assert.ok(serialized.includes('503'));
});

test('resetPassword replaces credentials FIRST, then revokes every session, and issues no tokens', async (t) => {
  const calls = [];
  t.mock.method(userService, 'resetPasswordWithToken', async () => {
    calls.push('resetPasswordWithToken');
    return { userId: 'user-1' };
  });
  t.mock.method(sessionService, 'revokeAllSessionsForUser', async () => {
    calls.push('revokeAllSessionsForUser');
    return 2;
  });

  const result = await authService.resetPassword({
    rawToken: 'A'.repeat(43),
    newPassword: 'brand-new-secret',
  });

  assert.deepEqual(calls, ['resetPasswordWithToken', 'revokeAllSessionsForUser']);
  assert.deepEqual(result, { passwordReset: true });
  assert.equal('accessToken' in result, false);
  assert.equal('refreshToken' in result, false);
});

test('resetPassword does not revoke sessions when token consumption fails', async (t) => {
  t.mock.method(userService, 'resetPasswordWithToken', async () => {
    throw new AppError('Password reset token is invalid or expired.', {
      statusCode: 400,
      code: 'AUTH_PASSWORD_RESET_TOKEN_INVALID',
    });
  });
  const revoke = t.mock.method(sessionService, 'revokeAllSessionsForUser', async () => 0);

  await assert.rejects(
    () =>
      authService.resetPassword({
        rawToken: 'A'.repeat(43),
        newPassword: 'brand-new-secret',
      }),
    { code: 'AUTH_PASSWORD_RESET_TOKEN_INVALID' }
  );
  assert.equal(revoke.mock.callCount(), 0);
});

test('verifyEmail consumes the token and never revokes sessions', async (t) => {
  t.mock.method(userService, 'verifyEmailWithToken', async () => ({ userId: 'user-1' }));
  const revoke = t.mock.method(sessionService, 'revokeAllSessionsForUser', async () => 1);

  const result = await authService.verifyEmail('A'.repeat(43));

  assert.deepEqual(result, { emailVerified: true });
  assert.equal(revoke.mock.callCount(), 0);
});

test('verifyEmail propagates the generic invalid/expired/replayed error unchanged', async (t) => {
  t.mock.method(userService, 'verifyEmailWithToken', async () => {
    throw new AppError('Email verification token is invalid or expired.', {
      statusCode: 400,
      code: 'AUTH_EMAIL_VERIFICATION_TOKEN_INVALID',
    });
  });

  await assert.rejects(
    () => authService.verifyEmail('B'.repeat(43)),
    { code: 'AUTH_EMAIL_VERIFICATION_TOKEN_INVALID' }
  );
});

test('resendVerification stores a fresh credential, emails a fragment link, and enforces the response floor', async (t) => {
  let prepared;
  let emailed;
  t.mock.method(userService, 'prepareEmailVerification', async (args) => {
    prepared = args;
    return { userId: 'user-1', email: 'ada@example.com' };
  });
  t.mock.method(emailService, 'sendVerificationEmail', async (args) => {
    emailed = args;
  });
  const startedAt = Date.now();

  const result = await authService.resendVerification('ada@example.com');

  assert.deepEqual(result, { verificationEmailRequested: true });
  assert.match(prepared.tokenHash, /^[a-f0-9]{64}$/);
  assert.ok(prepared.expiresAt instanceof Date);
  const url = new URL(emailed.verifyUrl);
  assert.equal(url.search, '');
  assert.match(url.hash, /^#token=[A-Za-z0-9_-]{43}$/);
  assert.equal(emailed.to, 'ada@example.com');
  assert.ok(Date.now() - startedAt >= 700);
});

test('resendVerification returns the identical generic result for an unknown/ineligible account and sends nothing', async (t) => {
  t.mock.method(userService, 'prepareEmailVerification', async () => null);
  const send = t.mock.method(emailService, 'sendVerificationEmail', async () => {});

  const result = await authService.resendVerification('unknown@example.com');

  assert.deepEqual(result, { verificationEmailRequested: true });
  assert.equal(send.mock.callCount(), 0);
});

test('resendVerification hides email delivery failure and logs no recipient, token, or verification URL', async (t) => {
  t.mock.method(userService, 'prepareEmailVerification', async () => ({
    userId: 'user-1',
    email: 'ada@example.com',
  }));
  t.mock.method(emailService, 'sendVerificationEmail', async () => {
    const error = new Error('provider failed');
    error.name = 'EmailDeliveryError';
    error.providerStatus = 503;
    throw error;
  });
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args));

  const result = await authService.resendVerification('ada@example.com');

  assert.deepEqual(result, { verificationEmailRequested: true });
  const serialized = JSON.stringify(logged);
  assert.equal(serialized.includes('ada@example.com'), false);
  assert.equal(serialized.includes('#token='), false);
  assert.equal(serialized.includes('provider failed'), false);
  assert.ok(serialized.includes('503'));
});
