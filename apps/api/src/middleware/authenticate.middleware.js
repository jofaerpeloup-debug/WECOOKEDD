const mongoose = require('mongoose');
const { verifyAccessToken } = require('../shared/security/access-token');
const sessionService = require('../modules/sessions/session.service');
const userService = require('../modules/users/user.service');
const { AppError } = require('../shared/errors/app-error');

const BEARER_PREFIX = 'Bearer ';

function sessionInvalid() {
  return new AppError('Session is no longer valid.', {
    statusCode: 401,
    code: 'AUTH_SESSION_INVALID',
  });
}

function effectiveGeneration(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * Verifies the Authorization: Bearer <access-token> header, then confirms
 * the session it names is still active, belongs to the same user the token
 * claims, and that user is still active — using current MongoDB state
 * rather than trusting the JWT's (potentially stale) claims, so revoked
 * sessions and suspended users lose access immediately rather than at token
 * expiry.
 *
 * Only specific, expected failure conditions (missing token, bad signature,
 * malformed id, missing/foreign/expired session, missing/inactive user) are
 * translated into a 401 here. A genuine repository/database failure is an
 * unexpected Error, not an AppError, so it is left to propagate to the
 * central error handler as a 500 rather than being reported as an auth
 * failure.
 */
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith(BEARER_PREFIX)) {
      throw new AppError('Authentication required.', {
        statusCode: 401,
        code: 'AUTH_TOKEN_MISSING',
      });
    }

    const token = header.slice(BEARER_PREFIX.length).trim();
    if (!token) {
      throw new AppError('Authentication required.', {
        statusCode: 401,
        code: 'AUTH_TOKEN_MISSING',
      });
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw new AppError('Invalid or expired access token.', {
        statusCode: 401,
        code: 'AUTH_TOKEN_INVALID',
      });
    }

    // A validly-signed token can still carry a malformed id, e.g. from an
    // older token format or a forged/tampered claim that slipped past
    // signature checks in some other way. Reject that shape explicitly
    // instead of letting an invalid ObjectId hit the repository as a
    // CastError, which would otherwise look like a database failure.
    if (
      !mongoose.Types.ObjectId.isValid(payload.sessionId) ||
      !mongoose.Types.ObjectId.isValid(payload.sub)
    ) {
      throw sessionInvalid();
    }

    const session = await sessionService.getActiveSessionById(payload.sessionId);
    if (!session || String(session.userId) !== String(payload.sub)) {
      throw sessionInvalid();
    }

    // Load the user via the session's own (trusted, DB-verified) userId
    // rather than the token's claim — the ownership check above already
    // confirmed they agree, but this keeps the lookup anchored to data we
    // just read from MongoDB rather than the caller-supplied token.
    const user = await userService.getUserById(session.userId);
    if (
      !user
      || user.status !== 'active'
      || user.deactivatedAt
      || effectiveGeneration(session.securityGeneration)
        !== effectiveGeneration(user.sessionGeneration)
    ) {
      throw sessionInvalid();
    }

    req.auth = {
      userId: String(user._id),
      role: user.role,
      sessionId: String(session._id),
    };

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { authenticate };
