process.env.NODE_ENV = 'test';
process.env.PORT = '4015';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';

const test = require('node:test');
const assert = require('node:assert/strict');

const userService = require('../src/modules/users/user.service');
const sessionService = require('../src/modules/sessions/session.service');
const authService = require('../src/modules/auth/auth.service');
const { verifyAccessToken } = require('../src/shared/security/access-token');
const { AppError } = require('../src/shared/errors/app-error');

function fakeUser(overrides = {}) {
  return {
    _id: 'user-1',
    name: 'Ada',
    email: 'ada@example.com',
    role: 'user',
    status: 'active',
    ...overrides,
  };
}

function fakeSession(overrides = {}) {
  return { _id: 'session-1', userId: 'user-1', ...overrides };
}

test('register creates the user and issues tokens tied to a new session', async (t) => {
  t.mock.method(userService, 'registerUser', async () => fakeUser());
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
