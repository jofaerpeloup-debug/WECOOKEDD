const User = require('./user.model');

function effectiveGenerationPredicate(sessionGeneration) {
  if (!Number.isInteger(sessionGeneration) || sessionGeneration < 0) {
    throw new TypeError('sessionGeneration must be a non-negative integer.');
  }
  return sessionGeneration === 0
    ? { $or: [{ sessionGeneration: 0 }, { sessionGeneration: { $exists: false } }] }
    : { sessionGeneration };
}

function createUser({ name, email, passwordHash }) {
  if (typeof passwordHash !== 'string' || passwordHash.trim().length === 0) {
    throw new TypeError('createUser requires a nonempty passwordHash.');
  }
  return User.create({ name, email, passwordHash });
}

function findByAuthIdentity(provider, subject) {
  return User.findOne({
    authIdentities: {
      $elemMatch: { provider, subject },
    },
  });
}

function createSocialUser({ name, email, emailVerified, authIdentity }) {
  return User.create({
    name,
    email,
    emailVerified,
    authIdentities: [authIdentity],
    role: 'user',
    status: 'active',
  });
}

function linkAuthIdentity(userId, authIdentity) {
  return User.findOneAndUpdate(
    {
      _id: userId,
      role: 'user',
      status: 'active',
      'authIdentities.provider': { $ne: authIdentity.provider },
    },
    { $push: { authIdentities: authIdentity } },
    { returnDocument: 'after', runValidators: true }
  );
}

function findById(id) {
  return User.findById(id);
}

// Narrow bulk lookup for cross-module public-author presentation. Projection
// prevents email/role/status/preferences/auth identities from reaching the
// caller even accidentally.
function findPublicByIds(ids) {
  return User.find({ _id: { $in: ids } }).select('_id name avatar.url');
}

function findByEmail(email) {
  return User.findOne({ email });
}

// The only path that ever loads passwordHash, used for login/credential
// verification — kept separate from findByEmail so nothing else can
// accidentally pull the hash into a response.
function findByEmailWithPassword(email) {
  return User.findOne({ email }).select('+passwordHash');
}

// By-id counterpart of findByEmailWithPassword, used by authenticated
// self-service credential operations (change-password). The caller's identity
// is the DB-verified req.auth.userId, so there is no need to route through
// email. Still the only other place that opts back into the select:false hash.
function findByIdWithPassword(id) {
  return User.findById(id).select('+passwordHash');
}

// Post-session login fence. Matching the exact bcrypt digest that was
// successfully compared proves the credential snapshot is still current at
// this point. The digest stays in the query predicate and is not selected into
// the returned user document.
function findByIdWithPasswordHash(id, passwordHash, email, deactivatedAt, sessionGeneration) {
  if (email === undefined) return User.findOne({ _id: id, passwordHash });
  const deactivationPredicate = deactivatedAt
    ? { deactivatedAt }
    : { deactivatedAt: { $exists: false } };
  const filter = {
    _id: id,
    passwordHash,
    email,
    status: 'active',
    ...deactivationPredicate,
    ...effectiveGenerationPredicate(sessionGeneration),
  };
  return User.findOne(filter);
}

function reactivatePasswordLoginIfCurrent({ id, passwordHash, email, deactivatedAt, sessionGeneration }) {
  return User.findOneAndUpdate(
    {
      _id: id,
      passwordHash,
      email,
      status: 'active',
      deactivatedAt,
      ...effectiveGenerationPredicate(sessionGeneration),
    },
    { $unset: { deactivatedAt: 1 }, $inc: { sessionGeneration: 1 } },
    { returnDocument: 'after' }
  );
}

function completeSocialLogin({ id, email, deactivatedAt, sessionGeneration, provider, subject }) {
  const deactivationPredicate = deactivatedAt
    ? { deactivatedAt }
    : { deactivatedAt: { $exists: false } };
  const update = deactivatedAt
    ? { $unset: { deactivatedAt: 1 }, $inc: { sessionGeneration: 1 } }
    : { $set: { email } };
  return User.findOneAndUpdate(
    {
      _id: id,
      email,
      status: 'active',
      authIdentities: { $elemMatch: { provider, subject } },
      ...deactivationPredicate,
      ...effectiveGenerationPredicate(sessionGeneration),
    },
    update,
    { returnDocument: 'after' }
  );
}

// Staff-application eligibility needs to know whether a local credential
// exists, but the hash must never leave the service boundary. Keep this as an
// explicit opt-in path rather than weakening passwordHash's select:false
// default.
function findModeratorApplicantById(id) {
  return User.findById(id).select('+passwordHash');
}

// These are deliberately hard-coded role transitions. There is no generic
// updateRole(userId, role) primitive for an HTTP caller to misuse.
function promoteEligibleUserToModerator(id) {
  return User.findOneAndUpdate(
    {
      _id: id,
      status: 'active',
      role: 'user',
      emailVerified: true,
      passwordHash: { $exists: true, $type: 'string', $ne: '' },
    },
    { $set: { role: 'moderator' } },
    { returnDocument: 'after', runValidators: true }
  );
}

function demoteModeratorToUser(id) {
  return User.findOneAndUpdate(
    { _id: id, role: 'moderator' },
    { $set: { role: 'user' } },
    { returnDocument: 'after', runValidators: true }
  );
}

// Every password replacement invalidates every outstanding password-reset
// credential in the SAME document write. Keeping this shape private and shared
// prevents authenticated change-password and token reset from drifting.
function buildPasswordReplacementUpdate(passwordHash) {
  return {
    $set: { passwordHash },
    $inc: { sessionGeneration: 1 },
    $unset: {
      passwordResetTokenHash: 1,
      passwordResetExpiresAt: 1,
    },
  };
}

function replacePasswordById(id, currentPasswordHash, sessionGeneration, passwordHash) {
  return User.findOneAndUpdate(
    {
      _id: id,
      status: 'active',
      deactivatedAt: { $exists: false },
      passwordHash: currentPasswordHash,
      ...effectiveGenerationPredicate(sessionGeneration),
    },
    buildPasswordReplacementUpdate(passwordHash),
    { returnDocument: 'after', projection: { _id: 1, sessionGeneration: 1 } }
  );
}

function setPasswordResetTokenForEligibleUser(id, tokenHash, expiresAt) {
  return User.updateOne(
    {
      _id: id,
      status: 'active',
      passwordHash: { $exists: true, $type: 'string', $ne: '' },
    },
    {
      $set: {
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: expiresAt,
      },
    }
  );
}

// Atomically verifies and consumes a reset credential while replacing the
// password. Only one concurrent request presenting a digest can match.
function resetPasswordByTokenHash({ tokenHash, passwordHash, now }) {
  return User.findOneAndUpdate(
    {
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: { $gt: now },
      status: 'active',
      passwordHash: { $exists: true, $type: 'string', $ne: '' },
    },
    buildPasswordReplacementUpdate(passwordHash),
    { returnDocument: 'after', projection: { _id: 1, sessionGeneration: 1 } }
  );
}

// Shared by post-registration issuance and resend: overwrites any prior
// verification credential with a fresh one. Scoped to active, password-bearing,
// not-yet-verified accounts so a stale/racing call can never re-arm a token for
// a suspended, provider-only, or already-verified user.
function setEmailVerificationTokenForUser(id, tokenHash, expiresAt) {
  return User.updateOne(
    {
      _id: id,
      status: 'active',
      passwordHash: { $exists: true, $type: 'string', $ne: '' },
      emailVerified: { $ne: true },
    },
    {
      $set: {
        emailVerificationTokenHash: tokenHash,
        emailVerificationExpiresAt: expiresAt,
      },
    }
  );
}

// Atomically verifies and consumes an email-verification credential in one
// write. Only one concurrent request presenting a digest can match; a replay
// finds no document (the fields are already unset) and fails identically to a
// wrong/expired token.
function verifyEmailByTokenHash({ tokenHash, now }) {
  return User.findOneAndUpdate(
    {
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpiresAt: { $gt: now },
      status: 'active',
    },
    {
      $set: { emailVerified: true },
      $unset: {
        emailVerificationTokenHash: 1,
        emailVerificationExpiresAt: 1,
      },
    },
    { returnDocument: 'after', projection: { _id: 1 } }
  );
}

function setPendingEmailChange({ userId, passwordHash, currentEmail, pendingEmail, tokenHash, expiresAt }) {
  return User.findOneAndUpdate(
    {
      _id: userId,
      status: 'active',
      deactivatedAt: { $exists: false },
      email: currentEmail,
      passwordHash,
    },
    {
      $set: {
        pendingEmail,
        pendingEmailChangeTokenHash: tokenHash,
        pendingEmailChangeExpiresAt: expiresAt,
      },
    },
    { returnDocument: 'after' }
  );
}

function clearPendingEmailChange(userId) {
  return User.findOneAndUpdate(
    { _id: userId, status: 'active', deactivatedAt: { $exists: false } },
    {
      $unset: {
        pendingEmail: 1,
        pendingEmailChangeTokenHash: 1,
        pendingEmailChangeExpiresAt: 1,
      },
    },
    { returnDocument: 'after' }
  );
}

function findPendingEmailChangeByTokenHash(tokenHash) {
  return User.findOne({ pendingEmailChangeTokenHash: tokenHash })
    .select('+pendingEmailChangeTokenHash');
}

function verifyPendingEmailChange({ userId, tokenHash, pendingEmail, now }) {
  return User.findOneAndUpdate(
    {
      _id: userId,
      status: 'active',
      deactivatedAt: { $exists: false },
      pendingEmail,
      pendingEmailChangeTokenHash: tokenHash,
      pendingEmailChangeExpiresAt: { $gt: now },
    },
    {
      $set: { email: pendingEmail, emailVerified: true },
      $inc: { sessionGeneration: 1 },
      $unset: {
        pendingEmail: 1,
        pendingEmailChangeTokenHash: 1,
        pendingEmailChangeExpiresAt: 1,
        emailVerificationTokenHash: 1,
        emailVerificationExpiresAt: 1,
      },
    },
    { returnDocument: 'after' }
  );
}

function invalidatePendingEmailChange({ userId, tokenHash }) {
  return User.updateOne(
    { _id: userId, pendingEmailChangeTokenHash: tokenHash },
    { $unset: { pendingEmail: 1, pendingEmailChangeTokenHash: 1, pendingEmailChangeExpiresAt: 1 } }
  );
}

function deactivateIfActive({ userId }) {
  return User.findOneAndUpdate(
    { _id: userId, status: 'active', deactivatedAt: { $exists: false } },
    {
      $currentDate: { deactivatedAt: true },
      $inc: { sessionGeneration: 1 },
      $unset: {
        pendingEmail: 1,
        pendingEmailChangeTokenHash: 1,
        pendingEmailChangeExpiresAt: 1,
        passwordResetTokenHash: 1,
        passwordResetExpiresAt: 1,
        emailVerificationTokenHash: 1,
        emailVerificationExpiresAt: 1,
      },
    },
    { returnDocument: 'after' }
  );
}

// Admin user-management list. Pure query mechanics — the caller (service)
// owns the filter/sort/skip/limit values and every policy decision. The
// model's `select: false` on passwordHash means the digest is never in the
// result set here.
function findMany({ filter, sort, skip, limit }) {
  return User.find(filter).sort(sort).skip(skip).limit(limit);
}

function countByFilter(filter) {
  return User.countDocuments(filter);
}

// runValidators re-checks the role/status enums on write; returnDocument: 'after'
// returns the post-update document for the response. Returns null when no
// document matches the id (e.g. deleted between read and write).
function updateById(id, update) {
  return User.findByIdAndUpdate(id, update, { returnDocument: 'after', runValidators: true });
}

function replaceAvatarIfRevision(id, observedRevision, avatar) {
  const revisionPredicate = observedRevision === 0
    ? { $or: [{ avatarRevision: 0 }, { avatarRevision: { $exists: false } }] }
    : { avatarRevision: observedRevision };
  return User.findOneAndUpdate(
    { _id: id, ...revisionPredicate },
    { $set: { avatar }, $inc: { avatarRevision: 1 } },
    { returnDocument: 'after', runValidators: true }
  );
}

// Atomic compare-and-set for the Admin status mutation. Matching both the id
// and the status observed by the service means a returned document proves this
// caller owned the write. A null result is a lost race, never evidence of a
// transition. Reset credentials are cleared in the same winning suspension
// write, preserving the existing suspension security invariant.
function updateStatusIfCurrent(id, expectedStatus, expectedGeneration, desiredStatus) {
  const update = { $set: { status: desiredStatus } };
  if (desiredStatus !== expectedStatus) {
    update.$inc = { sessionGeneration: 1 };
  }
  if (desiredStatus === 'suspended') {
    update.$unset = {
      passwordResetTokenHash: 1,
      passwordResetExpiresAt: 1,
    };
  }

  return User.findOneAndUpdate(
    { _id: id, status: expectedStatus, ...effectiveGenerationPredicate(expectedGeneration) },
    update,
    { returnDocument: 'after', runValidators: true }
  );
}

function advanceSessionGenerationForActiveUser(id) {
  return User.findOneAndUpdate(
    { _id: id, status: 'active', deactivatedAt: { $exists: false } },
    { $inc: { sessionGeneration: 1 } },
    { returnDocument: 'after', projection: { _id: 1, sessionGeneration: 1 } }
  );
}

module.exports = {
  createUser,
  findByAuthIdentity,
  createSocialUser,
  linkAuthIdentity,
  findById,
  findPublicByIds,
  findByEmail,
  findByEmailWithPassword,
  findByIdWithPassword,
  findByIdWithPasswordHash,
  reactivatePasswordLoginIfCurrent,
  completeSocialLogin,
  findModeratorApplicantById,
  promoteEligibleUserToModerator,
  demoteModeratorToUser,
  findMany,
  countByFilter,
  updateById,
  replaceAvatarIfRevision,
  updateStatusIfCurrent,
  advanceSessionGenerationForActiveUser,
  replacePasswordById,
  setPasswordResetTokenForEligibleUser,
  resetPasswordByTokenHash,
  setEmailVerificationTokenForUser,
  verifyEmailByTokenHash,
  setPendingEmailChange,
  clearPendingEmailChange,
  findPendingEmailChangeByTokenHash,
  verifyPendingEmailChange,
  invalidatePendingEmailChange,
  deactivateIfActive,
};
