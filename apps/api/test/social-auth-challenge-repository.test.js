process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

const SocialAuthChallenge = require('../src/modules/auth/social-auth-challenge.model');
const repository = require('../src/modules/auth/social-auth-challenge.repository');

test('createChallenge persists exactly provider, nonceHash, and expiresAt', async (t) => {
  const input = { provider: 'google', nonceHash: 'a'.repeat(64), expiresAt: new Date() };
  let captured;
  t.mock.method(SocialAuthChallenge, 'create', async (value) => {
    captured = value;
    return { _id: 'challenge-1', ...value };
  });

  await repository.createChallenge(input);
  assert.deepEqual(captured, input);
  assert.deepEqual(Object.keys(captured).sort(), ['expiresAt', 'nonceHash', 'provider']);
});

test('consumeChallenge atomically binds id, provider, digest, and unexpired time', async (t) => {
  const now = new Date('2026-09-02T00:00:00.000Z');
  let filter;
  t.mock.method(SocialAuthChallenge, 'findOneAndDelete', async (value) => {
    filter = value;
    return { _id: value._id };
  });

  await repository.consumeChallenge({
    challengeId: '507f1f77bcf86cd799439011',
    provider: 'google',
    nonceHash: 'b'.repeat(64),
    now,
  });

  assert.deepEqual(filter, {
    _id: '507f1f77bcf86cd799439011',
    provider: 'google',
    nonceHash: 'b'.repeat(64),
    expiresAt: { $gt: now },
  });
});

test('consumeChallenge preserves null and repository errors', async (t) => {
  const mocked = t.mock.method(SocialAuthChallenge, 'findOneAndDelete', async () => null);
  const args = { challengeId: 'id', provider: 'google', nonceHash: 'c'.repeat(64), now: new Date() };
  assert.equal(await repository.consumeChallenge(args), null);

  mocked.mock.mockImplementationOnce(async () => {
    throw new Error('database unavailable');
  });
  await assert.rejects(() => repository.consumeChallenge(args), /database unavailable/);
});
