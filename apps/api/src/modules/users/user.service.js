const mongoose = require('mongoose');
const userRepository = require('./user.repository');
const sessionService = require('../sessions/session.service');
const auditService = require('../audit/audit.service');
const { hashPassword, comparePassword } = require('../../shared/security/password');
const { hashPasswordResetToken } = require('../../shared/security/password-reset-token');
const { hashEmailVerificationToken } = require('../../shared/security/email-verification-token');
const { AppError } = require('../../shared/errors/app-error');

const DUPLICATE_KEY_ERROR_CODE = 11000;
const MAX_STATUS_CAS_ATTEMPTS = 2;

// Fixed list-sort map. Every entry carries `_id` as a final tiebreaker so
// pagination is deterministic even when the primary key (createdAt / name) is
// equal across documents — otherwise a row could repeat on one page and be
// skipped on the next.
const SORT_MAP = {
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  nameAsc: { name: 1, _id: 1 },
  nameDesc: { name: -1, _id: 1 },
};

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

// Escapes regex metacharacters so a free-text admin search is always a literal
// substring match, never attacker-controlled regex syntax. Same helper shape
// as ingredient.service.js / recipe.service.js (kept per-module by the
// project's "no premature shared util" convention).
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function userNotFoundError() {
  return new AppError('User not found.', { statusCode: 404, code: 'USER_NOT_FOUND' });
}

// A single stable code for every prohibited self-administration attempt (an
// admin suspending their own account). 403 — it is an authorization-policy
// denial, same family as authorize()'s FORBIDDEN.
function selfAdministrationError(message) {
  return new AppError(message, { statusCode: 403, code: 'ADMIN_CANNOT_MODIFY_SELF' });
}

function statusUpdateConflictError() {
  return new AppError('User status changed concurrently. Please retry.', {
    statusCode: 409,
    code: 'USER_STATUS_UPDATE_CONFLICT',
  });
}

// A precomputed hash compared against when no user is found, so a lookup
// for an unknown email takes roughly the same time as a wrong-password
// lookup for a known one — this keeps login from leaking which emails
// are registered via response timing.
let dummyHashPromise;
function getDummyHash() {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword('wecooked-timing-safety-dummy-password');
  }
  return dummyHashPromise;
}

/**
 * Creates a new local-auth user. Only ever accepts name/email/password —
 * role and status are never caller-controlled here, so public registration
 * can never create anything but an active, role:"user" account.
 */
async function registerUser({ name, email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const passwordHash = await hashPassword(password);

  try {
    return await userRepository.createUser({ name, email: normalizedEmail, passwordHash });
  } catch (err) {
    if (err && err.code === DUPLICATE_KEY_ERROR_CODE) {
      throw new AppError('An account with this email already exists.', {
        statusCode: 409,
        code: 'USER_EMAIL_ALREADY_EXISTS',
      });
    }
    throw err;
  }
}

/**
 * Verifies local-auth credentials. Returns the matching User document on
 * success, or null on any failure (unknown email, wrong password, or an
 * account with no local password at all — e.g. a Google-only user) —
 * callers must treat every case identically to avoid leaking which emails
 * are registered or that an account is provider-only.
 *
 * A provider-only user is truthy but carries no `passwordHash` (the field is
 * never set for social signups), so presence of a *usable* hash is checked
 * explicitly rather than just presence of a user — comparePassword must never
 * be called with anything but a real bcrypt hash or the dummy one.
 */
async function verifyCredentials(email, password) {
  const normalizedEmail = normalizeEmail(email);
  const user = await userRepository.findByEmailWithPassword(normalizedEmail);
  const hasPasswordHash =
    !!user && typeof user.passwordHash === 'string' && user.passwordHash.trim().length > 0;
  const hashToCompare = hasPasswordHash ? user.passwordHash : await getDummyHash();
  const isValid = await comparePassword(password, hashToCompare);

  if (!hasPasswordHash || !isValid) {
    return null;
  }
  return user;
}

function getUserById(id) {
  return userRepository.findById(id);
}

async function getPublicUsersByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const users = await userRepository.findPublicByIds([...new Set(ids.map(String))]);
  return users.map((user) => ({ id: String(user._id), name: user.name }));
}

function getUserByAuthIdentity(provider, subject) {
  return userRepository.findByAuthIdentity(provider, subject);
}

function getUserByEmail(email) {
  return userRepository.findByEmail(normalizeEmail(email));
}

function createSocialUser({ name, email, emailVerified, authIdentity }) {
  return userRepository.createSocialUser({
    name,
    email: normalizeEmail(email),
    emailVerified,
    authIdentity,
  });
}

function linkAuthIdentity(userId, authIdentity) {
  return userRepository.linkAuthIdentity(userId, authIdentity);
}

/**
 * Admin user-management list. All filtering/sorting/pagination is
 * server-owned. `search` is a case-insensitive substring over name + email
 * only, regex-escaped. `role` / `status` are already validated against the
 * User enums by the route schema. The filter is assembled field-by-field —
 * nothing from the request is ever spread into it — so a Mongo operator
 * cannot be injected.
 */
async function listUsers({ search, role, status, sort, page, limit }) {
  const filter = {};
  if (role) {
    filter.role = role;
  }
  if (status) {
    filter.status = status;
  }
  if (search) {
    const pattern = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ name: pattern }, { email: pattern }];
  }

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    userRepository.findMany({ filter, sort: SORT_MAP[sort], skip, limit }),
    userRepository.countByFilter(filter),
  ]);

  return { items, total, page, limit };
}

/**
 * Admin mutation of another user's account status. This is the only place
 * status policy lives — the controller does no rule evaluation.
 *
 * `role` is NOT mutable here (or anywhere in the runtime application): there is
 * no generic promote/demote capability, so a second admin is never created
 * through the API. `updateUserSchema` rejects a `role` key at the HTTP boundary;
 * this function additionally builds a status-only `$set` (below) so a direct
 * in-process caller cannot forward `role` (or any other field) either.
 *
 * `actingUserId` is the authenticated admin (from req.auth, DB-verified by
 * authenticate). `targetUserId` is the validated :userId path param — target
 * identity only, never a source of authority.
 *
 * Session/status ordering (see docs/architecture/admin-users-backend-api.md):
 *
 *   suspended -> active : revoke every session BEFORE status flips back to
 *     'active', so a session left unrevoked by an earlier failed suspension
 *     (or a login race) cannot spring back to life. This runs while the user
 *     is still 'suspended', so no login/refresh can mint a session in
 *     parallel. If revocation throws, the error propagates and the user is
 *     NOT reactivated.
 *
 *   active -> suspended : revoke every session AFTER 'suspended' is
 *     persisted. Once committed, login throws AUTH_ACCOUNT_SUSPENDED and
 *     refresh refuses to rotate, so the sweep is race-free. If revocation
 *     throws, the error propagates but the user stays suspended (User.status
 *     is authoritative for authenticate/refresh regardless) — no rollback.
 *
 *   active -> active : no session action.
 *
 * Cross-module revocation goes through SessionService only; this module
 * never imports the Session model or repository.
 */
async function adminUpdateUser({ actingUserId, actingUserRole, targetUserId, patch }) {
  // Canonicalise the target id before any identity comparison. It arrives as a
  // validated-but-not-normalised hex string — mongoose.Types.ObjectId.isValid()
  // accepts a 24-char hex string in ANY case — while actingUserId is already
  // canonical (authenticate builds it with String(user._id)). Comparing the raw
  // forms would let an admin bypass the self-protection check below by simply
  // re-casing their own id in the request path. The route schema guarantees
  // this is a valid ObjectId, so the constructor cannot throw here.
  const targetId = new mongoose.Types.ObjectId(targetUserId).toString();

  let target = await userRepository.findById(targetId);
  if (!target) {
    throw userNotFoundError();
  }

  // Writable-field allow-list. `status` is the only administrative field this
  // endpoint mutates; the update object is assembled explicitly (never
  // `{ $set: patch }`) so nothing else in `patch` — a `role` key most of all —
  // can ever reach MongoDB, even from an internal caller that skipped the route
  // schema. Enum validation is not repeated here: `updateUserSchema` owns the
  // HTTP boundary and the Mongoose `status` enum (runValidators) owns the write.
  const update = {};
  if (patch.status !== undefined) {
    update.status = patch.status;
  }
  if (Object.keys(update).length === 0) {
    // Unreachable over HTTP (updateUserSchema requires `status`). A direct
    // caller passed nothing this endpoint can act on.
    throw new AppError('At least one supported field must be provided.', {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
  }

  if (String(actingUserId) === targetId && update.status !== 'active') {
    throw selfAdministrationError('You cannot change your own status.');
  }

  for (let attempt = 0; attempt < MAX_STATUS_CAS_ATTEMPTS; attempt += 1) {
    const fromStatus = target.status;
    const statusChanged = update.status !== fromStatus;
    const reactivating = update.status === 'active' && fromStatus === 'suspended';
    // Fires for a winning active->suspended transition and for an initial
    // suspended->suspended mop-up. A request that loses a suspension CAS exits
    // on the authoritative reload below and never reaches this side effect.
    const suspending = update.status === 'suspended';

    if (reactivating) {
      const sessionCutoff = new Date();
      await sessionService.revokeAllSessionsForUserCreatedBy(targetId, sessionCutoff);
    }

    const updated = await userRepository.updateStatusIfCurrent(
      targetId,
      fromStatus,
      update.status
    );

    if (!updated) {
      const current = await userRepository.findById(targetId);
      if (!current) {
        throw userNotFoundError();
      }
      if (current.status === update.status) {
        return current;
      }
      target = current;
      continue;
    }

    if (suspending) {
      try {
        await sessionService.revokeAllSessionsForUser(targetId);
      } catch (error) {
        if (statusChanged) {
          await auditService.record({
            eventType: 'admin.user.status_changed',
            actorUserId: actingUserId,
            actorRole: actingUserRole,
            targetType: 'user',
            targetId,
            outcome: 'partial_failure',
            reasonCode: 'SESSION_REVOCATION_FAILED',
            metadata: { fromStatus, toStatus: update.status },
          });
        }
        throw error;
      }
    }

    if (statusChanged) {
      await auditService.record({
        eventType: 'admin.user.status_changed',
        actorUserId: actingUserId,
        actorRole: actingUserRole,
        targetType: 'user',
        targetId,
        outcome: 'success',
        metadata: { fromStatus, toStatus: update.status },
      });
    }

    return updated;
  }

  throw statusUpdateConflictError();
}

// The authenticated principal was deleted between authenticate (which loaded
// them, active, moments ago) and this write. Same semantic as
// user.controller.getCurrentUser: the session no longer maps to a live user.
function sessionInvalidError() {
  return new AppError('Session is no longer valid.', {
    statusCode: 401,
    code: 'AUTH_SESSION_INVALID',
  });
}

/**
 * Updates the authenticated user's OWN profile. Deliberately separate from
 * adminUpdateUser: no acting/target split (the caller can only ever be the
 * subject), no role/status policy, and no session revocation — name and
 * preferences carry zero authorization authority (they are not JWT claims, and
 * authenticate reloads role/status from MongoDB every request regardless).
 *
 * `patch` is the strict-validated body: { name?, preferences?: {
 * dietaryPreferences?, allergies?, notifications?: { enabled } } }. The Mongo
 * update is assembled here field-by-field with dot-path $set keys — never
 * `{ $set: patch }` or `{ $set: patch.preferences }`, which would replace the
 * whole `preferences` subdocument and wipe the sibling keys the request never
 * mentioned. A supplied array (including []) replaces that array wholesale; an
 * omitted key is simply never added to $set. Duplicates are stored as sent.
 */
async function updateOwnProfile({ userId, patch }) {
  const update = {};

  if (patch.name !== undefined) {
    update.name = patch.name;
  }

  const { preferences } = patch;
  if (preferences) {
    if (preferences.dietaryPreferences !== undefined) {
      update['preferences.dietaryPreferences'] = preferences.dietaryPreferences;
    }
    if (preferences.allergies !== undefined) {
      update['preferences.allergies'] = preferences.allergies;
    }
    if (preferences.notifications && preferences.notifications.enabled !== undefined) {
      update['preferences.notifications.enabled'] = preferences.notifications.enabled;
    }
  }

  const updated = await userRepository.updateById(userId, { $set: update });
  if (!updated) {
    throw sessionInvalidError();
  }
  return updated;
}

/**
 * Changes the authenticated user's OWN password. Identity is the caller's
 * DB-verified id (`req.auth.userId`) — never an email, a token claim, or a body
 * field, so there is no IDOR surface.
 *
 * This function owns credential policy only: load the hash, verify the current
 * password, reject a same-password no-op, hash the new password, and persist it
 * through a credential-replacement write that atomically invalidates every
 * outstanding password-reset token. It does NOT revoke sessions —
 * `AuthService.changePassword` orchestrates that AFTER this resolves, so the
 * new hash is always persisted before the all-sessions sweep (persist first;
 * if the later revoke throws, the password change still stands — documented
 * residual, same "no rollback" stance as `adminUpdateUser` active->suspended).
 */
async function changePassword({ userId, currentPassword, newPassword }) {
  const user = await userRepository.findByIdWithPassword(userId);
  if (!user) {
    // Deleted between `authenticate` (moments ago, active) and this read.
    throw sessionInvalidError();
  }

  // Local password capability is the actual presence of a nonempty stored
  // hash. Social identities never imply that a local password exists.
  if (typeof user.passwordHash !== 'string' || user.passwordHash.trim().length === 0) {
    throw new AppError('Password change is not available for this account.', {
      statusCode: 400,
      code: 'AUTH_PASSWORD_CHANGE_UNAVAILABLE',
    });
  }

  const currentValid = await comparePassword(currentPassword, user.passwordHash);
  if (!currentValid) {
    // 400, deliberately NOT 401: the admin API client transparently
    // refresh-retries any 401, which would replay a wrong-password attempt and
    // rotate a refresh token on every typo. A distinct code (not
    // AUTH_INVALID_CREDENTIALS, which is login's) lets the frontend flag the
    // current-password field.
    throw new AppError('Current password is incorrect.', {
      statusCode: 400,
      code: 'AUTH_CURRENT_PASSWORD_INVALID',
    });
  }

  // The current password is now confirmed to match the stored hash, so a
  // plaintext equality check is an exact same-password test — no second bcrypt
  // compare, and there is no password-history system to consult.
  if (newPassword === currentPassword) {
    throw new AppError('New password must be different from your current password.', {
      statusCode: 400,
      code: 'NEW_PASSWORD_SAME_AS_CURRENT',
    });
  }

  const newPasswordHash = await hashPassword(newPassword);
  const result = await userRepository.replacePasswordById(userId, newPasswordHash);
  if (!result || result.matchedCount === 0) {
    // Deleted between the lookup above and this write.
    throw sessionInvalidError();
  }
}

/**
 * Starts a reset only for an active account that currently supports local
 * password authentication. The repository repeats the eligibility predicates
 * so a concurrent suspension/provider change cannot receive a reset token.
 */
async function preparePasswordReset({ email, tokenHash, expiresAt }) {
  const normalizedEmail = normalizeEmail(email);
  const user = await userRepository.findByEmailWithPassword(normalizedEmail);

  if (
    !user ||
    user.status !== 'active' ||
    typeof user.passwordHash !== 'string' ||
    user.passwordHash.trim().length === 0
  ) {
    return null;
  }

  const result = await userRepository.setPasswordResetTokenForEligibleUser(
    user._id,
    tokenHash,
    expiresAt
  );
  if (!result || result.matchedCount === 0) {
    return null;
  }

  return { userId: String(user._id), email: user.email };
}

async function resetPasswordWithToken({ rawToken, newPassword }) {
  const tokenHash = hashPasswordResetToken(rawToken);
  const passwordHash = await hashPassword(newPassword);
  const user = await userRepository.resetPasswordByTokenHash({
    tokenHash,
    passwordHash,
    now: new Date(),
  });

  if (!user) {
    throw new AppError('Password reset token is invalid or expired.', {
      statusCode: 400,
      code: 'AUTH_PASSWORD_RESET_TOKEN_INVALID',
    });
  }

  return { userId: String(user._id) };
}

/**
 * Issues a fresh email-verification credential for a user this call already
 * knows the identity of (the account it just registered). No eligibility
 * lookup by email is needed — the caller supplies the id of an account it just
 * created, which is by construction active, password-bearing, and unverified —
 * but the repository write still repeats those predicates (see
 * setEmailVerificationTokenForUser) so this can never re-arm a token for an
 * account that has since changed state.
 */
async function startEmailVerification({ userId, tokenHash, expiresAt }) {
  await userRepository.setEmailVerificationTokenForUser(userId, tokenHash, expiresAt);
}

/**
 * Resend path: looks the account up by email and issues a new verification
 * credential ONLY for an active, password-bearing, not-yet-verified user.
 * Returns null for every other case (unknown email, provider-only, already
 * verified, suspended) so the caller (AuthService.resendVerification) can
 * answer with one identical generic response regardless of why the send was
 * skipped.
 */
async function prepareEmailVerification({ email, tokenHash, expiresAt }) {
  const normalizedEmail = normalizeEmail(email);
  const user = await userRepository.findByEmailWithPassword(normalizedEmail);

  if (
    !user ||
    user.status !== 'active' ||
    user.emailVerified === true ||
    typeof user.passwordHash !== 'string' ||
    user.passwordHash.trim().length === 0
  ) {
    return null;
  }

  const result = await userRepository.setEmailVerificationTokenForUser(
    user._id,
    tokenHash,
    expiresAt
  );
  if (!result || result.matchedCount === 0) {
    return null;
  }

  return { userId: String(user._id), email: user.email };
}

/**
 * Consumes a raw verification token: hashes it, atomically matches + flips
 * emailVerified + clears the credential in one write. Any failure (malformed,
 * unknown, expired, already-used) collapses to the same generic error — the
 * caller must never learn which case it was.
 */
async function verifyEmailWithToken({ rawToken }) {
  const tokenHash = hashEmailVerificationToken(rawToken);
  const user = await userRepository.verifyEmailByTokenHash({ tokenHash, now: new Date() });

  if (!user) {
    throw new AppError('Email verification token is invalid or expired.', {
      statusCode: 400,
      code: 'AUTH_EMAIL_VERIFICATION_TOKEN_INVALID',
    });
  }

  return { userId: String(user._id) };
}

module.exports = {
  registerUser,
  verifyCredentials,
  getUserById,
  getPublicUsersByIds,
  getUserByAuthIdentity,
  getUserByEmail,
  createSocialUser,
  linkAuthIdentity,
  listUsers,
  adminUpdateUser,
  updateOwnProfile,
  changePassword,
  preparePasswordReset,
  resetPasswordWithToken,
  startEmailVerification,
  prepareEmailVerification,
  verifyEmailWithToken,
};
