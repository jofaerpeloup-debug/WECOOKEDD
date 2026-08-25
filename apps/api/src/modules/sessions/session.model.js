const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // select: false keeps the digest out of normal query results; nothing
    // in the API ever needs to return it to a client.
    refreshTokenHash: {
      type: String,
      required: true,
      unique: true,
      select: false,
    },
    // Absolute refresh-session expiration for Phase 2 — rotating a token
    // does not extend this. expireAfterSeconds: 0 makes MongoDB delete the
    // document once this timestamp passes.
    expiresAt: {
      type: Date,
      required: true,
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const Session = mongoose.model('Session', sessionSchema);

module.exports = Session;
