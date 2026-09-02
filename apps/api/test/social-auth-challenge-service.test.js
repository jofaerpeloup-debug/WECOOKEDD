process.env.NODE_ENV = 'test';

const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSocialAuthChallengeService,
} = require('../src/modules/auth/social-auth-challenge.service');
const { AppError } = require('../src/shared/errors/app-error');

test('issueChallenge returns a 43-character nonce but persists only its digest for five minutes', async () => {
  const issuedAt = new Date('2026-09-02T00:00:00.000Z');
  const bytes = Buffer.alloc(32, 7);
  let randomSize;
  let persisted;
  const service = createSocialAuthChallengeService({
    now: () => issuedAt,
    randomBytes: (size) => {
      randomSize = size;
      return bytes;
    },
    repository: {
      createChallenge: async (value) => {
        persisted = value;
        return { _id: '507f1f77bcf86cd799439011' };
      },
    },
  });

  const result = await service.issueChallenge('google');

  assert.equal(randomSize, 32);
  assert.equal(result.nonce.length, 43);
  assert.match(result.nonce, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(result, {
    challengeId: '507f1f77bcf86cd799439011',
    nonce: bytes.toString('base64url'),
    expiresAt: new Date('2026-09-02T00:05:00.000Z'),
  });
  assert.deepEqual(persisted, {
    provider: 'google',
    nonceHash: crypto.createHash('sha256').update(result.nonce).digest('hex'),
    expiresAt: result.expiresAt,
  });
  assert.equal('nonce' in persisted, false);
});

test('consumeChallenge hashes the verified nonce and binds challenge id, provider, and current time', async () => {
  const now = new Date('2026-09-02T00:01:00.000Z');
  let captured;
  const service = createSocialAuthChallengeService({
    now: () => now,
    repository: {
      consumeChallenge: async (value) => {
        captured = value;
        return { _id: value.challengeId };
      },
    },
  });
  const nonce = Buffer.alloc(32, 8).toString('base64url');

  await service.consumeChallenge({ challengeId: 'challenge-7', provider: 'google', verifiedNonce: nonce });

  assert.deepEqual(captured, {
    challengeId: 'challenge-7',
    provider: 'google',
    nonceHash: crypto.createHash('sha256').update(nonce).digest('hex'),
    now,
  });
});

test('a failed atomic consume returns one sanitized challenge error', async () => {
  const nonce = Buffer.alloc(32, 9).toString('base64url');
  const service = createSocialAuthChallengeService({
    repository: { consumeChallenge: async () => null },
  });

  await assert.rejects(
    () => service.consumeChallenge({ challengeId: 'missing', provider: 'google', verifiedNonce: nonce }),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, 'AUTH_SOCIAL_CHALLENGE_INVALID');
      assert.equal(error.message, 'Social authentication challenge is invalid or expired.');
      assert.equal(error.message.includes(nonce), false);
      return true;
    }
  );
});
