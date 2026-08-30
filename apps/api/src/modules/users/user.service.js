const mongoose = require('mongoose');
const userRepository = require('./user.repository');
const sessionService = require('../sessions/session.service');
const { hashPassword, comparePassword } = require('../../shared/security/password');
const { AppError } = require('../../shared/errors/app-error');

const DUPLICATE_KEY_ERROR_CODE = 11000;

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
// admin demoting or suspending their own account). 403 — it is an
// authorization-policy denial, same family as authorize()'s FORBIDDEN.
function selfAdministrationError(message) {
  return new AppError(message, { statusCode: 403, code: 'ADMIN_CANNOT_MODIFY_SELF' });
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
 * success, or null on any failure (unknown email or wrong password) —
 * callers must treat both cases identically to avoid leaking which emails
 * are registered.
 */
async function verifyCredentials(email, password) {
  const normalizedEmail = normalizeEmail(email);
  const user = await userRepository.findByEmailWithPassword(normalizedEmail);
  const hashToCompare = user ? user.passwordHash : await getDummyHash();
  const isValid = await comparePassword(password, hashToCompare);

  if (!user || !isValid) {
    return null;
  }
  return user;
}

function getUserById(id) {
  return userRepository.findById(id);
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
 * Admin mutation of another user's role and/or status. This is the only
 * place role/status policy lives — the controller does no rule evaluation.
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
 *   active -> active / role-only : no session action. A role change is
 *     effective on the target's next request anyway, because authenticate
 *     reloads role from MongoDB every call — the stale JWT claim is never
 *     trusted.
 *
 * Cross-module revocation goes through SessionService only; this module
 * never imports the Session model or repository.
 */
async function adminUpdateUser({ actingUserId, targetUserId, patch }) {
  // Canonicalise the target id before any identity comparison. It arrives as a
  // validated-but-not-normalised hex string — mongoose.Types.ObjectId.isValid()
  // accepts a 24-char hex string in ANY case — while actingUserId is already
  // canonical (authenticate builds it with String(user._id)). Comparing the raw
  // forms would let an admin bypass the self-protection check below by simply
  // re-casing their own id in the request path. The route schema guarantees
  // this is a valid ObjectId, so the constructor cannot throw here.
  const targetId = new mongoose.Types.ObjectId(targetUserId).toString();

  const target = await userRepository.findById(targetId);
  if (!target) {
    throw userNotFoundError();
  }

  if (String(actingUserId) === targetId) {
    if (patch.role !== undefined && patch.role !== 'admin') {
      throw selfAdministrationError('You cannot change your own role.');
    }
    if (patch.status !== undefined && patch.status !== 'active') {
      throw selfAdministrationError('You cannot change your own status.');
    }
  }

  const reactivating = patch.status === 'active' && target.status === 'suspended';
  // Fires on active->suspended and on a suspended->suspended retry (a cheap,
  // idempotent mop-up if an earlier suspension's revoke call had failed).
  const suspending = patch.status === 'suspended';

  if (reactivating) {
    await sessionService.revokeAllSessionsForUser(targetId);
  }

  const updated = await userRepository.updateById(targetId, { $set: patch });
  if (!updated) {
    // Deleted between the read above and this write.
    throw userNotFoundError();
  }

  if (suspending) {
    await sessionService.revokeAllSessionsForUser(targetId);
  }

  return updated;
}

module.exports = {
  registerUser,
  verifyCredentials,
  getUserById,
  listUsers,
  adminUpdateUser,
};
