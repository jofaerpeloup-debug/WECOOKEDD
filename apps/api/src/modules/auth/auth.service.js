const userService = require('../users/user.service');
const sessionService = require('../sessions/session.service');
const { signAccessToken } = require('../../shared/security/access-token');
const { AppError } = require('../../shared/errors/app-error');

async function issueTokensForUser(user) {
  const { session, refreshToken } = await sessionService.createSession(user._id);
  const accessToken = signAccessToken({
    userId: user._id,
    role: user.role,
    sessionId: session._id,
  });
  return { accessToken, refreshToken };
}

async function register({ name, email, password }) {
  const user = await userService.registerUser({ name, email, password });
  const tokens = await issueTokensForUser(user);
  return { user, ...tokens };
}

async function login({ email, password }) {
  const user = await userService.verifyCredentials(email, password);
  if (!user) {
    throw new AppError('Invalid email or password.', {
      statusCode: 401,
      code: 'AUTH_INVALID_CREDENTIALS',
    });
  }

  if (user.status === 'suspended') {
    throw new AppError('This account has been suspended.', {
      statusCode: 403,
      code: 'AUTH_ACCOUNT_SUSPENDED',
    });
  }

  const tokens = await issueTokensForUser(user);
  return { user, ...tokens };
}

function refreshTokenInvalid() {
  return new AppError('Refresh token is invalid or expired.', {
    statusCode: 401,
    code: 'AUTH_REFRESH_TOKEN_INVALID',
  });
}

/**
 * Refreshing has two steps deliberately kept in this order: check the
 * owning user is still active BEFORE rotating, then rotate atomically.
 * Rotating first would burn the caller's only valid refresh token even if
 * the subsequent user lookup then failed (e.g. a transient DB error) — the
 * client would be left with neither a usable old token nor a delivered new
 * one. The pre-check has no side effect, so a failure here never costs the
 * caller their session; the atomic rotate afterwards is still what
 * actually guarantees one-time use, since a concurrent request could rotate
 * the session in between.
 */
async function refresh(rawRefreshToken) {
  const session = await sessionService.findActiveSessionByRefreshToken(rawRefreshToken);
  if (!session) {
    throw refreshTokenInvalid();
  }

  const user = await userService.getUserById(session.userId);
  if (!user || user.status !== 'active') {
    throw refreshTokenInvalid();
  }

  const rotated = await sessionService.rotateSession(rawRefreshToken);
  if (!rotated) {
    // Another request rotated or revoked this token between our pre-check
    // and this atomic rotation attempt.
    throw refreshTokenInvalid();
  }

  const accessToken = signAccessToken({
    userId: user._id,
    role: user.role,
    sessionId: rotated.session._id,
  });

  return { accessToken, refreshToken: rotated.refreshToken };
}

async function logout(sessionId) {
  await sessionService.revokeSession(sessionId);
}

async function logoutAll(userId) {
  const revokedCount = await sessionService.revokeAllSessionsForUser(userId);
  return { revokedCount };
}

module.exports = { register, login, refresh, logout, logoutAll };