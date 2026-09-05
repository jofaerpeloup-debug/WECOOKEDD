const SocialAuthChallenge = require('./social-auth-challenge.model');

function createChallenge({ provider, intent, userId, nonceHash, expiresAt }) {
  const challenge = { provider, intent, nonceHash, expiresAt };
  // A login challenge stores no user field at all, so the link flow's
  // `userId: <authenticated id>` predicate can never match one.
  if (userId != null) {
    challenge.userId = userId;
  }
  return SocialAuthChallenge.create(challenge);
}

// One atomic, one-time consumption. Every security-relevant condition is part
// of the same match: the challenge id, provider, intent, the user it was bound
// to (or the absence of any binding, for login), the nonce digest, and that it
// has not expired.
//
// `intent` is asserted before the predicate is built: Mongoose strips an
// `undefined` value out of a filter, so a caller that forgot it would silently
// widen the match to BOTH intents and let a login challenge satisfy the link
// flow. Every real caller supplies it, so this is a programmer error, not a
// client-reachable condition — a bare TypeError, carrying no id, token, nonce,
// or user value.
function consumeChallenge({ challengeId, provider, intent, userId, nonceHash, now }) {
  if (!SocialAuthChallenge.CHALLENGE_INTENTS.includes(intent)) {
    throw new TypeError('consumeChallenge requires an explicit challenge intent.');
  }
  return SocialAuthChallenge.findOneAndDelete({
    _id: challengeId,
    provider,
    intent,
    userId: userId != null ? userId : { $exists: false },
    nonceHash,
    expiresAt: { $gt: now },
  });
}

module.exports = { createChallenge, consumeChallenge };
