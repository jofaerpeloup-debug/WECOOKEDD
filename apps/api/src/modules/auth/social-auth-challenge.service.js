const crypto = require('node:crypto');
const challengeRepository = require('./social-auth-challenge.repository');
const { AppError } = require('../../shared/errors/app-error');

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const NONCE_BYTES = 32;

const CHALLENGE_INTENT = Object.freeze({ LOGIN: 'login', LINK: 'link' });

function hashNonce(nonce) {
  return crypto.createHash('sha256').update(nonce, 'utf8').digest('hex');
}

function invalidChallengeError() {
  return new AppError('Social authentication challenge is invalid or expired.', {
    statusCode: 400,
    code: 'AUTH_SOCIAL_CHALLENGE_INVALID',
  });
}

/**
 * Resolves the user binding for an intent, and is the single place the two
 * intents' binding rules are enforced:
 *
 *   login — never bound to a user; a WeCooked account need not exist yet.
 *   link  — always bound to the caller's AUTHENTICATED database user id.
 *
 * The callers supply that id from `req.auth.userId` (DB-verified by
 * authenticate), never from a request body, so a violation here is a
 * programming error rather than a client-reachable condition — hence TypeError
 * rather than an AppError with an HTTP status.
 */
function resolveIntentBinding(intent, userId) {
  if (intent === CHALLENGE_INTENT.LINK) {
    if (!userId) {
      throw new TypeError('A link challenge requires the authenticated user id.');
    }
    return String(userId);
  }
  if (intent !== CHALLENGE_INTENT.LOGIN) {
    throw new TypeError(`Unsupported social auth challenge intent "${intent}".`);
  }
  if (userId != null) {
    throw new TypeError('A login challenge must not be bound to a user.');
  }
  return null;
}

function createSocialAuthChallengeService({
  repository = challengeRepository,
  now = () => new Date(),
  randomBytes = crypto.randomBytes,
} = {}) {
  async function issueChallenge({ provider, intent, userId = null }) {
    const boundUserId = resolveIntentBinding(intent, userId);
    const nonce = randomBytes(NONCE_BYTES).toString('base64url');
    const issuedAt = now();
    const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
    const challenge = await repository.createChallenge({
      provider,
      intent,
      userId: boundUserId,
      nonceHash: hashNonce(nonce),
      expiresAt,
    });

    // The intent and the bound user are server state; neither is echoed back.
    return { challengeId: String(challenge._id), nonce, expiresAt };
  }

  async function consumeChallenge({ challengeId, provider, intent, userId = null, verifiedNonce }) {
    const boundUserId = resolveIntentBinding(intent, userId);
    const consumed = await repository.consumeChallenge({
      challengeId,
      provider,
      intent,
      userId: boundUserId,
      nonceHash: hashNonce(verifiedNonce),
      now: now(),
    });
    if (!consumed) {
      // One sanitized error for every failure mode — expired, replayed, wrong
      // nonce, wrong intent, or bound to a different user — so nothing about
      // another account's challenge state leaks.
      throw invalidChallengeError();
    }
    return consumed;
  }

  return { issueChallenge, consumeChallenge };
}

const socialAuthChallengeService = createSocialAuthChallengeService();

module.exports = socialAuthChallengeService;
module.exports.createSocialAuthChallengeService = createSocialAuthChallengeService;
module.exports.CHALLENGE_INTENT = CHALLENGE_INTENT;
