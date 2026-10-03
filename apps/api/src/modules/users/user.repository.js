const User = require('./user.model');

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
function findByIdWithPasswordHash(id, passwordHash) {
  return User.findOne({ _id: id, passwordHash });
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
    $unset: {
      passwordResetTokenHash: 1,
      passwordResetExpiresAt: 1,
    },
  };
}

function replacePasswordById(id, passwordHash) {
  return User.updateOne({ _id: id }, buildPasswordReplacementUpdate(passwordHash));
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
    { returnDocument: 'after', projection: { _id: 1 } }
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
function updateStatusIfCurrent(id, expectedStatus, desiredStatus) {
  const update = { $set: { status: desiredStatus } };
  if (desiredStatus === 'suspended') {
    update.$unset = {
      passwordResetTokenHash: 1,
      passwordResetExpiresAt: 1,
    };
  }

  return User.findOneAndUpdate(
    { _id: id, status: expectedStatus },
    update,
    { returnDocument: 'after', runValidators: true }
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
  findModeratorApplicantById,
  promoteEligibleUserToModerator,
  demoteModeratorToUser,
  findMany,
  countByFilter,
  updateById,
  replaceAvatarIfRevision,
  updateStatusIfCurrent,
  replacePasswordById,
  setPasswordResetTokenForEligibleUser,
  resetPasswordByTokenHash,
  setEmailVerificationTokenForUser,
  verifyEmailByTokenHash,
};
