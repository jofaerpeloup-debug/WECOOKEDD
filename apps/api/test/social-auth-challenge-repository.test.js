process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

const SocialAuthChallenge = require('../src/modules/auth/social-auth-challenge.model');
const repository = require('../src/modules/auth/social-auth-challenge.repository');

const LINK_USER_ID = '507f1f77bcf86cd799439011';

test('createChallenge persists exactly provider, intent, nonceHash, and expiresAt for a login challenge', async (t) => {
  const input = {
    provider: 'google',
    intent: 'login',
    nonceHash: 'a'.repeat(64),
    expiresAt: new Date(),
  };
  let captured;
  t.mock.method(SocialAuthChallenge, 'create', async (value) => {
    captured = value;
    return { _id: 'challenge-1', ...value };
  });

  await repository.createChallenge({ ...input, userId: null });
  assert.deepEqual(captured, input);
  // No user field at all — not even null — so the link flow's bound predicate
  // can never match a login challenge.
  assert.deepEqual(Object.keys(captured).sort(), ['expiresAt', 'intent', 'nonceHash', 'provider']);
});

test('createChallenge persists the bound user id for a link challenge', async (t) => {
  let captured;
  t.mock.method(SocialAuthChallenge, 'create', async (value) => {
    captured = value;
    return { _id: 'challenge-2', ...value };
  });

  await repository.createChallenge({
    provider: 'google',
    intent: 'link',
    userId: LINK_USER_ID,
    nonceHash: 'b'.repeat(64),
    expiresAt: new Date(),
  });

  assert.equal(captured.intent, 'link');
  assert.equal(captured.userId, LINK_USER_ID);
});

test('consumeChallenge atomically binds id, provider, intent, digest, and unexpired time', async (t) => {
  const now = new Date('2026-09-02T00:00:00.000Z');
  let filter;
  t.mock.method(SocialAuthChallenge, 'findOneAndDelete', async (value) => {
    filter = value;
    return { _id: value._id };
  });

  await repository.consumeChallenge({
    challengeId: '507f1f77bcf86cd799439011',
    provider: 'google',
    intent: 'login',
    userId: null,
    nonceHash: 'b'.repeat(64),
    now,
  });

  assert.deepEqual(filter, {
    _id: '507f1f77bcf86cd799439011',
    provider: 'google',
    intent: 'login',
    userId: { $exists: false },
    nonceHash: 'b'.repeat(64),
    expiresAt: { $gt: now },
  });
});

test('consuming a link challenge additionally binds the authenticated user id', async (t) => {
  const now = new Date('2026-09-02T00:00:00.000Z');
  let filter;
  t.mock.method(SocialAuthChallenge, 'findOneAndDelete', async (value) => {
    filter = value;
    return { _id: value._id };
  });

  await repository.consumeChallenge({
    challengeId: '507f1f77bcf86cd799439012',
    provider: 'google',
    intent: 'link',
    userId: LINK_USER_ID,
    nonceHash: 'c'.repeat(64),
    now,
  });

  assert.equal(filter.intent, 'link');
  assert.equal(filter.userId, LINK_USER_ID);
  assert.deepEqual(filter.expiresAt, { $gt: now });
});

test('consumeChallenge refuses to build a predicate without an explicit intent', async (t) => {
  // Mongoose strips `intent: undefined` out of a filter, which would widen the
  // atomic match to BOTH intents and let a login challenge satisfy the link
  // flow. The guard must fire before any query is issued.
  const findOneAndDelete = t.mock.method(SocialAuthChallenge, 'findOneAndDelete', async () => ({}));
  const args = {
    challengeId: '507f1f77bcf86cd799439011',
    provider: 'google',
    userId: null,
    nonceHash: 'd'.repeat(64),
    now: new Date(),
  };

  for (const intent of [undefined, null, '', 'LOGIN', 'anything-else']) {
    assert.throws(
      () => repository.consumeChallenge({ ...args, intent }),
      (error) => {
        assert.ok(error instanceof TypeError);
        assert.equal(error.message, 'consumeChallenge requires an explicit challenge intent.');
        // No id, nonce digest, or user value in a programmer-error message.
        assert.equal(error.message.includes(args.challengeId), false);
        assert.equal(error.message.includes(args.nonceHash), false);
        return true;
      }
    );
  }
  // Omitting the key entirely is the same failure.
  assert.throws(() => repository.consumeChallenge(args), TypeError);
  assert.equal(findOneAndDelete.mock.callCount(), 0);

  // The normal intents still reach the query untouched.
  await repository.consumeChallenge({ ...args, intent: 'login' });
  await repository.consumeChallenge({ ...args, intent: 'link', userId: LINK_USER_ID });
  assert.equal(findOneAndDelete.mock.callCount(), 2);
});

test('consumeChallenge preserves null and repository errors', async (t) => {
  const mocked = t.mock.method(SocialAuthChallenge, 'findOneAndDelete', async () => null);
  const args = {
    challengeId: 'id',
    provider: 'google',
    intent: 'login',
    userId: null,
    nonceHash: 'c'.repeat(64),
    now: new Date(),
  };
  assert.equal(await repository.consumeChallenge(args), null);

  mocked.mock.mockImplementationOnce(async () => {
    throw new Error('database unavailable');
  });
  await assert.rejects(() => repository.consumeChallenge(args), /database unavailable/);
});
