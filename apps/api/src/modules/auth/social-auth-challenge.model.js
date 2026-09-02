const mongoose = require('mongoose');

const socialAuthChallengeSchema = new mongoose.Schema({
  provider: {
    type: String,
    enum: ['google'],
    required: true,
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
