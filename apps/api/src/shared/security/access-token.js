const jwt = require('jsonwebtoken');
const { loadEnv } = require('../../config/env');

const ALGORITHM = 'HS256';
const ISSUER = 'wecooked-api';
const AUDIENCE = 'wecooked-client';

/**
 * Signs a short-lived access JWT. Payload is intentionally minimal — just
 * enough to identify the user, their role, and the session backing the
 * token, so authorization checks never need to trust stale claims for
 * anything else.
 */
function signAccessToken({ userId, role, sessionId }) {
  const { jwtAccessSecret, jwtAccessTtl } = loadEnv();
  return jwt.sign({ sub: String(userId), role, sessionId: String(sessionId) }, jwtAccessSecret, {
    algorithm: ALGORITHM,
    expiresIn: jwtAccessTtl,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

/**
 * Verifies and decodes an access JWT. Throws (JsonWebTokenError,
 * TokenExpiredError, etc.) on any invalid/expired/malformed token — callers
 * are responsible for translating that into a safe AppError.
 */
function verifyAccessToken(token) {
  const { jwtAccessSecret } = loadEnv();
  return jwt.verify(token, jwtAccessSecret, {
    algorithms: [ALGORITHM],
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

module.exports = { signAccessToken, verifyAccessToken };
