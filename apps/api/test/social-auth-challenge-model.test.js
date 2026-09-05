process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

const SocialAuthChallenge = require('../src/modules/auth/social-auth-challenge.model');

const LINK_USER_ID = '507f1f77bcf86cd799439011';

const validChallenge = () => ({
  provider: 'google',
  intent: 'login',
  nonceHash: 'a'.repeat(64),
  expiresAt: new Date(Date.now() + 60_000),
});

test('SocialAuthChallenge accepts only a Google challenge with a lowercase SHA-256 digest', async () => {
  await new SocialAuthChallenge(validChallenge()).validate();

  for (const invalid of [
    { provider: 'apple' },
    { nonceHash: 'A'.repeat(64) },
    { nonceHash: 'a'.repeat(63) },
    { expiresAt: undefined },
  ]) {
    await assert.rejects(() => new SocialAuthChallenge({ ...validChallenge(), ...invalid }).validate());
  }
});

test('SocialAuthChallenge requires a known intent', async () => {
  await assert.rejects(() =>
    new SocialAuthChallenge({ ...validChallenge(), intent: undefined }).validate()
  );
  await assert.rejects(() =>
    new SocialAuthChallenge({ ...validChallenge(), intent: 'anything-else' }).validate()
  );
  assert.deepEqual(SocialAuthChallenge.CHALLENGE_INTENTS, ['login', 'link']);
});

test('a link challenge must be bound to a user and a login challenge must not be', async () => {
  await new SocialAuthChallenge({
    ...validChallenge(),
    intent: 'link',
    userId: LINK_USER_ID,
  }).validate();

  // link without a binding
  await assert.rejects(
    () => new SocialAuthChallenge({ ...validChallenge(), intent: 'link' }).validate(),
    /must be bound to the authenticated user/
  );
  // login carrying a binding
  await assert.rejects(
    () => new SocialAuthChallenge({ ...validChallenge(), userId: LINK_USER_ID }).validate(),
    /Only a link challenge may be bound to a user/
  );
});

test('a login challenge materializes with NO userId property at all', () => {
  // The login consume predicate is `userId: { $exists: false }`. That only
  // separates login from link challenges while a login document genuinely omits
  // the field — a stored `null` (e.g. from adding `default: null`) would match
  // `$exists: true` and silently break the separation. Locked here.
  const login = new SocialAuthChallenge(validChallenge());
  const asObject = login.toObject();

  assert.equal('userId' in asObject, false);
  assert.equal(login.userId, undefined);
  assert.deepEqual(Object.keys(asObject).sort(), [
    '_id',
    'expiresAt',
    'intent',
    'nonceHash',
    'provider',
  ]);
  assert.equal(SocialAuthChallenge.schema.path('userId').options.default, undefined);

  // The link counterpart does carry it, so `$exists` genuinely discriminates.
  const link = new SocialAuthChallenge({
    ...validChallenge(),
    intent: 'link',
    userId: LINK_USER_ID,
  });
  assert.equal('userId' in link.toObject(), true);
});

test('SocialAuthChallenge stores no raw nonce or profile fields and hides nonceHash by default', () => {
  for (const path of ['nonce', 'email', 'account', 'consumedAt']) {
    assert.equal(SocialAuthChallenge.schema.path(path), undefined);
  }
  // userId is the authoritative bound user id, never a caller-supplied value.
  assert.equal(SocialAuthChallenge.schema.path('userId').instance, 'ObjectId');
  assert.equal(SocialAuthChallenge.schema.path('nonceHash').options.select, false);
});

test('SocialAuthChallenge declares the exact expiresAt TTL index', () => {
  const ttl = SocialAuthChallenge.schema
    .indexes()
    .find(([keys]) => JSON.stringify(keys) === JSON.stringify({ expiresAt: 1 }));
  assert.ok(ttl);
  assert.equal(ttl[1].expireAfterSeconds, 0);
});
