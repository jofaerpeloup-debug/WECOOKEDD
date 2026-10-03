const mongoose = require('mongoose');
const { EMAIL_MAX_CHARS } = require('@wecooked/contracts');

const SOCIAL_AUTH_PROVIDERS = ['google', 'apple', 'facebook'];
const ROLES = Object.freeze(['user', 'moderator', 'admin']);
const STATUSES = ['active', 'suspended'];
const COOKING_LEVELS = ['beginner', 'intermediate', 'advanced'];

const avatarSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
      validate: {
        validator(value) {
          try {
            return new URL(value).protocol === 'https:';
          } catch {
            return false;
          }
        },
        message: 'Avatar URL must use HTTPS.',
      },
    },
    assetId: { type: String, required: true, trim: true, minlength: 1 },
  },
  { _id: false }
);

const authIdentitySchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: SOCIAL_AUTH_PROVIDERS,
      required: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255,
    },
    linkedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  { _id: false }
);

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
      maxlength: EMAIL_MAX_CHARS,
      unique: true,
    },
    // select: false keeps the hash out of normal queries; auth code must
    // opt in with .select('+passwordHash') via an explicit repository path.
    // A new account must have at least one usable authentication method. This
    // check is new-document-only because hydrated local users normally omit
    // this select:false field and must remain valid on unrelated writes.
    passwordHash: {
      type: String,
      required: [
        function () {
          const hasAuthIdentities =
            Array.isArray(this.authIdentities) && this.authIdentities.length > 0;
          return this.isNew && !hasAuthIdentities;
        },
        'A new user requires a passwordHash or an authIdentity.',
      ],
      validate: {
        validator(value) {
          return value == null || (typeof value === 'string' && value.trim().length > 0);
        },
        message: 'passwordHash must be a nonempty string when provided.',
      },
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
    authIdentities: {
      type: [authIdentitySchema],
      default: [],
      validate: {
        validator(identities) {
          if (!Array.isArray(identities)) {
            return false;
          }
          const providers = identities.map((identity) => identity.provider);
          return new Set(providers).size === providers.length;
        },
        message: 'A user may have at most one identity for each social provider.',
      },
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
    bio: { type: String, trim: true, maxlength: 500, default: '' },
    cookingLevel: { type: String, enum: COOKING_LEVELS, default: 'beginner' },
    avatar: { type: avatarSchema, default: null },
    avatarRevision: {
      type: Number,
      min: 0,
      default: 0,
      validate: { validator: Number.isInteger, message: 'Avatar revision must be an integer.' },
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    // Email-verification credentials follow the exact same shape as the
    // password-reset pair above: opaque, one-time, select:false, digest-only,
    // no TTL index (that would delete the whole User document on expiry).
    emailVerificationTokenHash: {
      type: String,
      select: false,
    },
    emailVerificationExpiresAt: {
      type: Date,
      select: false,
    },
  },
  { timestamps: true }
);

userSchema.index({ passwordResetTokenHash: 1 }, { unique: true, sparse: true });
userSchema.index({ emailVerificationTokenHash: 1 }, { unique: true, sparse: true });

const User = mongoose.model('User', userSchema);

module.exports = User;
module.exports.SOCIAL_AUTH_PROVIDERS = SOCIAL_AUTH_PROVIDERS;
module.exports.ROLES = ROLES;
module.exports.STATUSES = STATUSES;
module.exports.COOKING_LEVELS = COOKING_LEVELS;
