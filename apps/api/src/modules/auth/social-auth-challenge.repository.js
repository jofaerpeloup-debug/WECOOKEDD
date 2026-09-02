const SocialAuthChallenge = require('./social-auth-challenge.model');

function createChallenge({ provider, nonceHash, expiresAt }) {
  return SocialAuthChallenge.create({ provider, nonceHash, expiresAt });
}

function consumeChallenge({ challengeId, provider, nonceHash, now }) {
  return SocialAuthChallenge.findOneAndDelete({
    _id: challengeId,
    provider,
    nonceHash,
    expiresAt: { $gt: now },
  });
}

module.exports = { createChallenge, consumeChallenge };
