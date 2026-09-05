const mongoose = require('mongoose');

// Server-enforced purpose of a challenge. A challenge issued for one intent can
// never be consumed by the other flow: `login` belongs to Google login /
// first-time Google account creation and may be requested without a WeCooked
// account, while `link` is account-management state that only an already
// authenticated user can request.
const CHALLENGE_INTENTS = ['login', 'link'];

const socialAuthChallengeSchema = new mongoose.Schema({
  provider: {
    type: String,
    enum: ['google'],
    required: true,
  },
  intent: {
    type: String,
    enum: CHALLENGE_INTENTS,
    required: true,
  },
  // The authoritative database id of the authenticated user a LINK challenge
  // was issued to. Never client-supplied (the link-challenge route reads
  // req.auth.userId) and never set on a login challenge, so a login challenge
  // can never satisfy the link flow's user-bound consume predicate.
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [
      function () {
        return this.intent === 'link';
      },
      'A link challenge must be bound to the authenticated user.',
    ],
    validate: {
      validator(value) {
        return this.intent === 'link' ? value != null : value == null;
      },
      message: 'Only a link challenge may be bound to a user.',
    },
  },
  nonceHash: {
    type: String,
    required: true,
    match: /^[a-f0-9]{64}$/,
    select: false,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
});

socialAuthChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const SocialAuthChallenge = mongoose.model('SocialAuthChallenge', socialAuthChallengeSchema);

module.exports = SocialAuthChallenge;
module.exports.CHALLENGE_INTENTS = CHALLENGE_INTENTS;
