const mongoose = require('mongoose');

const AUTH_PROVIDERS = ['local', 'google'];
const ROLES = ['user', 'admin'];
const STATUSES = ['active', 'suspended'];

const preferencesSchema = new mongoose.Schema(
  {
    dietaryPreferences: { type: [String], default: [] },
    allergies: { type: [String], default: [] },
    notifications: {
      enabled: { type: Boolean, default: true },
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    // select: false keeps the hash out of normal queries; auth code must
    // opt in with .select('+passwordHash') via an explicit repository path.
    // Only required for local-auth users — a future Google-only account
    // (authProviders without "local") has no password to hash. Google
    // login itself is not implemented yet; this only keeps the schema from
    // blocking that account shape later.
    passwordHash: {
      type: String,
      required: [
        function () {
          return this.authProviders.includes('local');
        },
        'passwordHash is required for local-auth users.',
      ],
      select: false,
    },
    // Password-reset credentials are opaque, one-time secrets. Only the
    // SHA-256 digest is persisted, and neither reset field is selected by
    // ordinary user queries. Never add a TTL index here: MongoDB would delete
    // the entire User document when the timestamp expires.
    passwordResetTokenHash: {
      type: String,
      select: false,
    },
    passwordResetExpiresAt: {
      type: Date,
      select: false,
    },
    authProviders: {
      type: [String],
      enum: AUTH_PROVIDERS,
      default: ['local'],
    },
    role: {
      type: String,
      enum: ROLES,
      default: 'user',
    },
    status: {
      type: String,
      enum: STATUSES,
      default: 'active',
    },
    preferences: {
      type: preferencesSchema,
      default: () => ({}),
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

userSchema.index({ passwordResetTokenHash: 1 }, { unique: true, sparse: true });

const User = mongoose.model('User', userSchema);

module.exports = User;
module.exports.AUTH_PROVIDERS = AUTH_PROVIDERS;
module.exports.ROLES = ROLES;
module.exports.STATUSES = STATUSES;
