const crypto = require('node:crypto');
const challengeRepository = require('./social-auth-challenge.repository');
const { AppError } = require('../../shared/errors/app-error');

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const NONCE_BYTES = 32;

function hashNonce(nonce) {
  return crypto.createHash('sha256').update(nonce, 'utf8').digest('hex');
}

function invalidChallengeError() {
  return new AppError('Social authentication challenge is invalid or expired.', {
    statusCode: 400,
    code: 'AUTH_SOCIAL_CHALLENGE_INVALID',
  });
}

function createSocialAuthChallengeService({
  repository = challengeRepository,
  now = () => new Date(),
  randomBytes = crypto.randomBytes,
} = {}) {
  async function issueChallenge(provider) {
    const nonce = randomBytes(NONCE_BYTES).toString('base64url');
    const issuedAt = now();
    const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
    const challenge = await repository.createChallenge({
      provider,
      nonceHash: hashNonce(nonce),
      expiresAt,
    });

    return { challengeId: String(challenge._id), nonce, expiresAt };
  }

  async function consumeChallenge({ challengeId, provider, verifiedNonce }) {
    const consumed = await repository.consumeChallenge({
      challengeId,
      provider,
      nonceHash: hashNonce(verifiedNonce),
      now: now(),
    });
    if (!consumed) {
      throw invalidChallengeError();
    }
    return consumed;
  }

  return { issueChallenge, consumeChallenge };
}

const socialAuthChallengeService = createSocialAuthChallengeService();

module.exports = socialAuthChallengeService;
module.exports.createSocialAuthChallengeService = createSocialAuthChallengeService;
