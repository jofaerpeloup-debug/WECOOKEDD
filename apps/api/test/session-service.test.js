process.env.NODE_ENV = 'test';
process.env.PORT = '4014';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.REFRESH_TOKEN_TTL_DAYS = '30';

const test = require('node:test');
const assert = require('node:assert/strict');

const sessionRepository = require('../src/modules/sessions/session.repository');
const sessionService = require('../src/modules/sessions/session.service');
const { hashRefreshToken } = require('../src/shared/security/refresh-token');

test('createSession stores only the SHA-256 digest and returns the raw token once', async (t) => {
  let captured;
  t.mock.method(sessionRepository, 'createSession', async (args) => {
    captured = args;
    return { _id: 'session-1', ...args };
  });

  const { session, refreshToken } = await sessionService.createSession('user-1');

  assert.equal(captured.userId, 'user-1');
  assert.equal(captured.refreshTokenHash, hashRefreshToken(refreshToken));
  assert.notEqual(captured.refreshTokenHash, refreshToken);
  assert.ok(captured.expiresAt instanceof Date);
  assert.equal(session._id, 'session-1');
});

test('findActiveSessionByRefreshToken hashes the raw token and delegates to the repository, with no side effect', async (t) => {
  let capturedHash;
  t.mock.method(sessionRepository, 'findActiveByHash', async (hash) => {
    capturedHash = hash;
    return { _id: 'session-1', userId: 'user-1' };
  });

  const session = await sessionService.findActiveSessionByRefreshToken('a-raw-token');

  assert.equal(capturedHash, hashRefreshToken('a-raw-token'));
  assert.equal(session._id, 'session-1');
});

test('findActiveSessionByRefreshToken returns null when nothing matches', async (t) => {
  t.mock.method(sessionRepository, 'findActiveByHash', async () => null);

  const session = await sessionService.findActiveSessionByRefreshToken('unknown-token');
  assert.equal(session, null);
});

test('rotateSession returns null when no active session matches the presented token', async (t) => {
  t.mock.method(sessionRepository, 'rotateByHash', async () => null);

  const result = await sessionService.rotateSession('some-stale-or-forged-token');
  assert.equal(result, null);
});

test('rotateSession returns a new session and a new raw token on success', async (t) => {
  t.mock.method(sessionRepository, 'rotateByHash', async ({ newHash }) => ({
    _id: 'session-1',
    userId: 'user-1',
    refreshTokenHash: newHash,
  }));

  const { session, refreshToken } = await sessionService.rotateSession('the-current-raw-token');

  assert.equal(session.refreshTokenHash, hashRefreshToken(refreshToken));
});

test('rotateSession issues a different raw token on every call', async (t) => {
  t.mock.method(sessionRepository, 'rotateByHash', async ({ newHash }) => ({
    _id: 'session-1',
    refreshTokenHash: newHash,
  }));

  const first = await sessionService.rotateSession('token-a');
  const second = await sessionService.rotateSession('token-a');

  assert.notEqual(first.refreshToken, second.refreshToken);
});

test('getActiveSessionById delegates to the repository', async (t) => {
  t.mock.method(sessionRepository, 'findActiveById', async (id) => ({ _id: id }));
  const session = await sessionService.getActiveSessionById('session-1');
  assert.equal(session._id, 'session-1');
});

test('revokeSession delegates to the repository with the session id', async (t) => {
  let capturedId;
  t.mock.method(sessionRepository, 'revokeById', async (id) => {
    capturedId = id;
    return { _id: id, revokedAt: new Date() };
  });

  await sessionService.revokeSession('session-1');
  assert.equal(capturedId, 'session-1');
});

test('revokeAllSessionsForUser returns the number of sessions revoked', async (t) => {
  t.mock.method(sessionRepository, 'revokeAllForUser', async () => 3);

  const count = await sessionService.revokeAllSessionsForUser('user-1');
  assert.equal(count, 3);
});

test('revokeAllSessionsForUserCreatedBy preserves and forwards the stable cutoff', async (t) => {
  let captured;
  t.mock.method(
    sessionRepository,
    'revokeAllForUserCreatedBy',
    async (userId, createdAtCutoff, now) => {
      captured = { userId, createdAtCutoff, now };
      return 2;
    }
  );
  const cutoff = new Date('2026-09-21T01:00:00.000Z');

  const count = await sessionService.revokeAllSessionsForUserCreatedBy('user-1', cutoff);

  assert.equal(count, 2);
  assert.equal(captured.userId, 'user-1');
  assert.equal(captured.createdAtCutoff, cutoff);
  assert.ok(captured.now instanceof Date);
});
