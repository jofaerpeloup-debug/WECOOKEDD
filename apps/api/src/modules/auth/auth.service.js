const userService = require('../users/user.service');
const sessionService = require('../sessions/session.service');
const { signAccessToken } = require('../../shared/security/access-token');
const {
  generatePasswordResetToken,
  hashPasswordResetToken,
} = require('../../shared/security/password-reset-token');
const emailService = require('../../shared/email/email.service');
const { loadEnv } = require('../../config/env');
const { AppError } = require('../../shared/errors/app-error');
const googleProvider = require('./providers/google.provider');
const socialAuthChallengeService = require('./social-auth-challenge.service');

const FORGOT_PASSWORD_MIN_RESPONSE_MS = 750;
const DUPLICATE_KEY_ERROR_CODE = 11000;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function passwordResetUrl(baseUrl, rawToken) {
  const url = new URL(baseUrl);
  url.hash = new URLSearchParams({ token: rawToken }).toString();
  return url.toString();
}

function logForgotPasswordFailure(stage, error) {
  const details = {
    event: 'forgot_password_processing_failed',
    stage,
    errorName: error?.name || 'Error',
  };
  if (Number.isInteger(error?.providerStatus)) {
    details.providerStatus = error.providerStatus;
  }
  if (typeof error?.providerRequestId === 'string') {
    details.providerRequestId = error.providerRequestId;
  }
  console.error('[auth] forgot-password processing failed', details);
}

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

function socialLoginUnavailableError() {
  return new AppError('Google sign-in is not available for this account.', {
    statusCode: 403,
    code: 'AUTH_SOCIAL_LOGIN_UNAVAILABLE',
  });
}

function accountSuspendedError() {
  return new AppError('This account has been suspended.', {
    statusCode: 403,
    code: 'AUTH_ACCOUNT_SUSPENDED',
  });
}

function accountLinkRequiredError() {
  return new AppError(
    'An account already exists for this email. Sign in to your existing account to link Google.',
    { statusCode: 409, code: 'AUTH_ACCOUNT_LINK_REQUIRED' }
  );
}

function socialEmailRequiredError() {
  return new AppError('A verified email is required to create your WeCooked account.', {
    statusCode: 422,
    code: 'AUTH_SOCIAL_EMAIL_REQUIRED',
  });
}

function socialIdentityInUseError() {
  return new AppError('This Google account is already linked to another account.', {
    statusCode: 409,
    code: 'AUTH_SOCIAL_IDENTITY_IN_USE',
  });
}

function socialProviderAlreadyLinkedError() {
  return new AppError('A different Google account is already linked to this account.', {
    statusCode: 409,
    code: 'AUTH_SOCIAL_PROVIDER_ALREADY_LINKED',
  });
}

function sessionInvalidError() {
  return new AppError('Session is no longer valid.', {
    statusCode: 401,
    code: 'AUTH_SESSION_INVALID',
  });
}

function enforceSocialLoginPolicy(user) {
  if (user.role !== 'user') {
    throw socialLoginUnavailableError();
  }
  if (user.status !== 'active') {
    throw accountSuspendedError();
  }
}

function findGoogleIdentity(user) {
  return user.authIdentities?.find((identity) => identity.provider === 'google');
}

async function verifyAndConsumeGoogleCredential({ idToken, challengeId }) {
  const identity = await googleProvider.verifyGoogleIdToken({ idToken });
  await socialAuthChallengeService.consumeChallenge({
    challengeId,
    provider: 'google',
    verifiedNonce: identity.verifiedNonce,
  });
  return identity;
}

async function issueSocialLogin(user) {
  enforceSocialLoginPolicy(user);
  const tokens = await issueTokensForUser(user);
  return { user, ...tokens };
}

async function googleLogin({ idToken, challengeId }) {
  const identity = await verifyAndConsumeGoogleCredential({ idToken, challengeId });
  let user = await userService.getUserByAuthIdentity(identity.provider, identity.subject);
  if (user) {
    return issueSocialLogin(user);
  }

  if (identity.emailVerified !== true || !identity.email) {
    throw socialEmailRequiredError();
  }

  if (await userService.getUserByEmail(identity.email)) {
    throw accountLinkRequiredError();
  }

  try {
    user = await userService.createSocialUser({
      name: identity.suggestedName,
      email: identity.email,
      emailVerified: true,
      authIdentity: {
        provider: identity.provider,
        subject: identity.subject,
        linkedAt: new Date(),
      },
    });
  } catch (error) {
    if (error?.code !== DUPLICATE_KEY_ERROR_CODE) {
      throw error;
    }

    const identityWinner = await userService.getUserByAuthIdentity(
      identity.provider,
      identity.subject
    );
    if (identityWinner) {
      return issueSocialLogin(identityWinner);
    }
    if (await userService.getUserByEmail(identity.email)) {
      throw accountLinkRequiredError();
    }
    throw error;
  }

  return issueSocialLogin(user);
}

async function googleLink({ userId, idToken, challengeId }) {
  const identity = await verifyAndConsumeGoogleCredential({ idToken, challengeId });
  let target = await userService.getUserById(userId);
  if (!target || target.status !== 'active') {
    throw sessionInvalidError();
  }
  if (target.role !== 'user') {
    throw socialLoginUnavailableError();
  }

  const owner = await userService.getUserByAuthIdentity(identity.provider, identity.subject);
  if (owner) {
    if (String(owner._id) === String(target._id)) {
      return target;
    }
    throw socialIdentityInUseError();
  }

  const existingIdentity = findGoogleIdentity(target);
  if (existingIdentity) {
    if (existingIdentity.subject === identity.subject) {
      return target;
    }
    throw socialProviderAlreadyLinkedError();
  }

  try {
    const linked = await userService.linkAuthIdentity(userId, {
      provider: identity.provider,
      subject: identity.subject,
      linkedAt: new Date(),
    });
    if (linked) {
      return linked;
    }
  } catch (error) {
    if (error?.code !== DUPLICATE_KEY_ERROR_CODE) {
      throw error;
    }
    const concurrentOwner = await userService.getUserByAuthIdentity(
      identity.provider,
      identity.subject
    );
    if (concurrentOwner) {
      if (String(concurrentOwner._id) === String(userId)) {
        if (concurrentOwner.status !== 'active') {
          throw sessionInvalidError();
        }
        if (concurrentOwner.role !== 'user') {
          throw socialLoginUnavailableError();
        }
        return concurrentOwner;
      }
      throw socialIdentityInUseError();
    }
  }

  target = await userService.getUserById(userId);
  if (!target || target.status !== 'active') {
    throw sessionInvalidError();
  }
  if (target.role !== 'user') {
    throw socialLoginUnavailableError();
  }
  const concurrentIdentity = findGoogleIdentity(target);
  if (concurrentIdentity?.subject === identity.subject) {
    return target;
  }
  if (concurrentIdentity) {
    throw socialProviderAlreadyLinkedError();
  }

  throw new Error('Google identity link did not reach a recognized database state.');
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

/**
 * Authenticated self-service password change. Orchestration only — credential
 * policy lives in UserService.changePassword, session handling in
 * SessionService, matching the module-boundary rule (AuthService never touches
 * a repository directly).
 *
 * Order is LOCKED: atomically persist the new hash and invalidate outstanding
 * password-reset credentials FIRST (via userService.changePassword), THEN
 * revoke every session for the user, the current one included. Persisting first
 * kills the old password before the sweep, so a concurrent login racing with
 * the old credentials cannot mint a session that outlives the change. If the
 * revoke throws afterwards, the new password and reset-token invalidation still
 * stand (no rollback) and the failure surfaces as a 500.
 *
 * No replacement session is created and no tokens are issued: the caller must
 * sign in again.
 */
async function changePassword({ userId, currentPassword, newPassword }) {
  await userService.changePassword({ userId, currentPassword, newPassword });
  await sessionService.revokeAllSessionsForUser(userId);
  return { passwordChanged: true };
}

async function forgotPassword(email) {
  const startedAt = Date.now();
  let stage = 'prepare';

  try {
    const { passwordResetTtlMinutes, passwordResetUrl: resetUrlBase } = loadEnv();
    const rawToken = generatePasswordResetToken();
    const tokenHash = hashPasswordResetToken(rawToken);
    const expiresAt = new Date(Date.now() + passwordResetTtlMinutes * 60 * 1000);
    const eligible = await userService.preparePasswordReset({ email, tokenHash, expiresAt });

    if (eligible) {
      stage = 'email';
      await emailService.sendPasswordResetEmail({
        to: eligible.email,
        resetUrl: passwordResetUrl(resetUrlBase, rawToken),
        expiresInMinutes: passwordResetTtlMinutes,
      });
    }
  } catch (error) {
    // Forgot-password never exposes account eligibility or provider/storage
    // failures. The reset credential is intentionally retained after an
    // ambiguous delivery failure: a timeout may still have delivered it.
    logForgotPasswordFailure(stage, error);
  }

  const remainingDelay = FORGOT_PASSWORD_MIN_RESPONSE_MS - (Date.now() - startedAt);
  if (remainingDelay > 0) {
    await delay(remainingDelay);
  }

  return { passwordResetRequested: true };
}

async function resetPassword({ rawToken, newPassword }) {
  const { userId } = await userService.resetPasswordWithToken({ rawToken, newPassword });
  await sessionService.revokeAllSessionsForUser(userId);
  return { passwordReset: true };
}

async function logout(sessionId) {
  await sessionService.revokeSession(sessionId);
}

async function logoutAll(userId) {
  const revokedCount = await sessionService.revokeAllSessionsForUser(userId);
  return { revokedCount };
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  changePassword,
  forgotPassword,
  resetPassword,
  googleLogin,
  googleLink,
};
