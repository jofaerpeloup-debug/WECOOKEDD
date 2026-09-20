const sessionRepository = require('./session.repository');
const { loadEnv } = require('../../config/env');
const { generateRefreshToken, hashRefreshToken } = require('../../shared/security/refresh-token');

function refreshTokenExpiryDate() {
  const { refreshTokenTtlDays } = loadEnv();
  return new Date(Date.now() + refreshTokenTtlDays * 24 * 60 * 60 * 1000);
}

/**
 * Starts a new session for a user: creates the Session document and
 * returns it along with the one-time raw refresh token (only the SHA-256
 * digest is ever persisted).
 */
async function createSession(userId) {
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const expiresAt = refreshTokenExpiryDate();

  const session = await sessionRepository.createSession({ userId, refreshTokenHash, expiresAt });
  return { session, refreshToken };
}

/**
 * Non-mutating lookup of the active session backing a raw refresh token.
 * Used to check the owning user before committing to a rotation — has no
 * side effect, unlike rotateSession.
 */
function findActiveSessionByRefreshToken(rawRefreshToken) {
  const hash = hashRefreshToken(rawRefreshToken);
  return sessionRepository.findActiveByHash(hash);
}

/**
 * Rotates a session's refresh token. Returns null if the presented raw
 * token doesn't match any active, unexpired session — including the case
 * where it was already rotated (one-time use) since this check was made.
 */
async function rotateSession(rawRefreshToken) {
  const currentHash = hashRefreshToken(rawRefreshToken);
  const newRefreshToken = generateRefreshToken();
  const newHash = hashRefreshToken(newRefreshToken);

  const session = await sessionRepository.rotateByHash({
    currentHash,
    newHash,
    now: new Date(),
  });

  if (!session) {
    return null;
  }
  return { session, refreshToken: newRefreshToken };
}

function getActiveSessionById(sessionId) {
  return sessionRepository.findActiveById(sessionId);
}

async function revokeSession(sessionId) {
  await sessionRepository.revokeById(sessionId, new Date());
}

function revokeAllSessionsForUser(userId) {
  return sessionRepository.revokeAllForUser(userId, new Date());
}

function revokeAllSessionsForUserCreatedBy(userId, createdAtCutoff) {
  return sessionRepository.revokeAllForUserCreatedBy(userId, createdAtCutoff, new Date());
}

module.exports = {
  createSession,
  findActiveSessionByRefreshToken,
  rotateSession,
  getActiveSessionById,
  revokeSession,
  revokeAllSessionsForUser,
  revokeAllSessionsForUserCreatedBy,
};
