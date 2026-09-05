process.env.NODE_ENV = 'test';

const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSocialAuthChallengeService,
  CHALLENGE_INTENT,
} = require('../src/modules/auth/social-auth-challenge.service');
const { AppError } = require('../src/shared/errors/app-error');

const LINK_USER_ID = '507f1f77bcf86cd799439011';

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

  const result = await service.issueChallenge({ provider: 'google', intent: 'login' });

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
    intent: 'login',
    userId: null,
    nonceHash: crypto.createHash('sha256').update(result.nonce).digest('hex'),
    expiresAt: result.expiresAt,
  });
  assert.equal('nonce' in persisted, false);
});

test('a link challenge is persisted bound to the authenticated user and never echoes that binding', async () => {
  let persisted;
  const service = createSocialAuthChallengeService({
    repository: {
      createChallenge: async (value) => {
        persisted = value;
        return { _id: '507f1f77bcf86cd799439022' };
      },
    },
  });

  const result = await service.issueChallenge({
    provider: 'google',
    intent: 'link',
    userId: LINK_USER_ID,
  });

  assert.equal(persisted.intent, 'link');
  assert.equal(persisted.userId, LINK_USER_ID);
  // The response carries the one-time secret only — no intent, no user id.
  assert.deepEqual(Object.keys(result).sort(), ['challengeId', 'expiresAt', 'nonce']);
});

test('the service refuses intent/binding combinations that would weaken the separation', async () => {
  const repository = {
    createChallenge: async () => {
      throw new Error('must not reach the repository');
    },
    consumeChallenge: async () => {
      throw new Error('must not reach the repository');
    },
  };
  const service = createSocialAuthChallengeService({ repository });
  const nonce = Buffer.alloc(32, 1).toString('base64url');

  // link with no authenticated user
  await assert.rejects(
    () => service.issueChallenge({ provider: 'google', intent: 'link' }),
    /requires the authenticated user id/
  );
  // login pretending to be bound to someone
  await assert.rejects(
    () => service.issueChallenge({ provider: 'google', intent: 'login', userId: LINK_USER_ID }),
    /must not be bound to a user/
  );
  // an unknown intent is never silently treated as login
  await assert.rejects(
    () => service.issueChallenge({ provider: 'google', intent: 'any' }),
    /Unsupported social auth challenge intent/
  );
  await assert.rejects(
    () =>
      service.consumeChallenge({
        challengeId: 'c',
        provider: 'google',
        intent: 'link',
        verifiedNonce: nonce,
      }),
    /requires the authenticated user id/
  );
});

test('consumeChallenge hashes the verified nonce and binds id, provider, intent, and current time', async () => {
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

  await service.consumeChallenge({
    challengeId: 'challenge-7',
    provider: 'google',
    intent: 'login',
    verifiedNonce: nonce,
  });

  assert.deepEqual(captured, {
    challengeId: 'challenge-7',
    provider: 'google',
    intent: 'login',
    userId: null,
    nonceHash: crypto.createHash('sha256').update(nonce).digest('hex'),
    now,
  });
});

test('consuming a link challenge passes the authenticated user id into the atomic match', async () => {
  let captured;
  const service = createSocialAuthChallengeService({
    repository: {
      consumeChallenge: async (value) => {
        captured = value;
        return { _id: value.challengeId };
      },
    },
  });
  const nonce = Buffer.alloc(32, 3).toString('base64url');

  await service.consumeChallenge({
    challengeId: 'challenge-9',
    provider: 'google',
    intent: 'link',
    userId: LINK_USER_ID,
    verifiedNonce: nonce,
  });

  assert.equal(captured.intent, 'link');
  assert.equal(captured.userId, LINK_USER_ID);
});

test('a failed atomic consume returns one sanitized challenge error', async () => {
  const nonce = Buffer.alloc(32, 9).toString('base64url');
  const service = createSocialAuthChallengeService({
    repository: { consumeChallenge: async () => null },
  });

  await assert.rejects(
    () =>
      service.consumeChallenge({
        challengeId: 'missing',
        provider: 'google',
        intent: 'login',
        verifiedNonce: nonce,
      }),
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

test('a wrong-intent, replayed, expired, or foreign-user challenge all fail identically', async () => {
  const nonce = Buffer.alloc(32, 2).toString('base64url');
  // The repository match is the sole authority; every one of these cases is a
  // no-match, and the service must not distinguish them to the caller.
  const service = createSocialAuthChallengeService({
    repository: { consumeChallenge: async () => null },
  });

  const attempts = [
    { intent: 'login', userId: null },
    { intent: 'link', userId: LINK_USER_ID },
    { intent: 'link', userId: '507f1f77bcf86cd799439099' },
  ];
  for (const attempt of attempts) {
    await assert.rejects(
      () =>
        service.consumeChallenge({
          challengeId: '507f1f77bcf86cd799439012',
          provider: 'google',
          verifiedNonce: nonce,
          ...attempt,
        }),
      { code: 'AUTH_SOCIAL_CHALLENGE_INVALID', statusCode: 400 }
    );
  }
});

test('the exported intent constants are the two server-enforced values', () => {
  assert.deepEqual(CHALLENGE_INTENT, { LOGIN: 'login', LINK: 'link' });
});
