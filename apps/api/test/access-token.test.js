process.env.NODE_ENV = 'test';
process.env.PORT = '4011';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.JWT_ACCESS_TTL = '1s';

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const { signAccessToken, verifyAccessToken } = require('../src/shared/security/access-token');

test('signAccessToken produces a token verifyAccessToken accepts', () => {
  const token = signAccessToken({
    userId: '507f1f77bcf86cd799439011',
    role: 'user',
    sessionId: '507f1f77bcf86cd799439012',
  });
  const payload = verifyAccessToken(token);

  assert.equal(payload.sub, '507f1f77bcf86cd799439011');
  assert.equal(payload.role, 'user');
  assert.equal(payload.sessionId, '507f1f77bcf86cd799439012');
});

test('the payload carries only minimal identity claims', () => {
  const token = signAccessToken({ userId: 'user-1', role: 'admin', sessionId: 'session-1' });
  const payload = verifyAccessToken(token);
  const allowedKeys = new Set(['sub', 'role', 'sessionId', 'iat', 'exp', 'iss', 'aud']);

  for (const key of Object.keys(payload)) {
    assert.ok(allowedKeys.has(key), `unexpected claim in access token payload: ${key}`);
  }
});

test('verifyAccessToken rejects a malformed token', () => {
  assert.throws(() => verifyAccessToken('not-a-real-token'));
});

test('verifyAccessToken rejects a token signed with a different secret', () => {
  const foreignToken = jwt.sign(
    { sub: 'x', role: 'user', sessionId: 'y' },
    'a-different-secret-that-is-long-enough-too',
    { algorithm: 'HS256', expiresIn: '15m', issuer: 'wecooked-api', audience: 'wecooked-client' }
  );
  assert.throws(() => verifyAccessToken(foreignToken));
});

test('verifyAccessToken rejects an expired token', async () => {
  const token = signAccessToken({ userId: 'user-1', role: 'user', sessionId: 'session-1' });
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.throws(() => verifyAccessToken(token));
});
