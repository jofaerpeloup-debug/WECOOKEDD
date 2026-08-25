const userRepository = require('./user.repository');
const { hashPassword, comparePassword } = require('../../shared/security/password');
const { AppError } = require('../../shared/errors/app-error');

const DUPLICATE_KEY_ERROR_CODE = 11000;

function normalizeEmail(email) {
  return email.trim().toLowerCase();
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

module.exports = {
  registerUser,
  verifyCredentials,
  getUserById,
};
