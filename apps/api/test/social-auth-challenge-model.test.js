process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

const SocialAuthChallenge = require('../src/modules/auth/social-auth-challenge.model');

const validChallenge = () => ({
  provider: 'google',
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

test('SocialAuthChallenge schema stores no raw nonce or account fields and hides nonceHash by default', () => {
  for (const path of ['nonce', 'userId', 'email', 'account', 'consumedAt']) {
    assert.equal(SocialAuthChallenge.schema.path(path), undefined);
  }
  assert.equal(SocialAuthChallenge.schema.path('nonceHash').options.select, false);
});

test('SocialAuthChallenge declares the exact expiresAt TTL index', () => {
  const ttl = SocialAuthChallenge.schema
    .indexes()
    .find(([keys]) => JSON.stringify(keys) === JSON.stringify({ expiresAt: 1 }));
  assert.ok(ttl);
  assert.equal(ttl[1].expireAfterSeconds, 0);
});
