const { z } = require('zod');
const { loadEnv } = require('../../../config/env');
const { AppError } = require('../../../shared/errors/app-error');

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const CLOCK_TOLERANCE_SECONDS = 60;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const emailSchema = z.string().trim().toLowerCase().email().max(320);

function invalidCredentialError() {
  return new AppError('Google credential is invalid or expired.', {
    statusCode: 401,
    code: 'AUTH_SOCIAL_CREDENTIAL_INVALID',
  });
}

function providerUnavailableError() {
  return new AppError('Google authentication is temporarily unavailable.', {
    statusCode: 503,
    code: 'AUTH_PROVIDER_UNAVAILABLE',
  });
}

function normalizeEmail(payload) {
  if (payload.email_verified !== true || typeof payload.email !== 'string') {
    return { email: null, emailVerified: false };
  }
  const parsed = emailSchema.safeParse(payload.email);
  return parsed.success
    ? { email: parsed.data, emailVerified: true }
    : { email: null, emailVerified: false };
}

function normalizeName(value) {
  if (typeof value !== 'string') {
    return 'WeCooked User';
  }
  const normalized = value.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized.slice(0, 100) || 'WeCooked User';
}

function validateClaims(payload, nowMilliseconds) {
  const subjectValid =
    typeof payload.sub === 'string' &&
    payload.sub.length > 0 &&
    payload.sub.length <= 255 &&
    payload.sub === payload.sub.trim();
  const issuedAtValid =
    Number.isFinite(payload.iat) &&
    Number.isInteger(payload.iat) &&
    payload.iat <= Math.floor(nowMilliseconds / 1000) + CLOCK_TOLERANCE_SECONDS;
  const nonceValid = typeof payload.nonce === 'string' && NONCE_PATTERN.test(payload.nonce);

  if (!subjectValid || !issuedAtValid || !nonceValid) {
    throw invalidCredentialError();
  }
}

function isInfrastructureFailure(error) {
  return (
    error?.code === 'ERR_JWKS_TIMEOUT' ||
    error?.code === 'ERR_JWKS_INVALID' ||
    error?.code === 'ECONNRESET' ||
    error?.code === 'ECONNREFUSED' ||
    error?.code === 'ENOTFOUND' ||
    error?.name === 'TypeError'
  );
}

function createGoogleProvider({
  importJose = () => import('jose'),
  getConfig = loadEnv,
  now = () => Date.now(),
} = {}) {
  let verificationContextPromise;

  async function getVerificationContext() {
    if (!verificationContextPromise) {
      verificationContextPromise = importJose().then((jose) => ({
        jose,
        jwks: jose.createRemoteJWKSet(new URL(GOOGLE_JWKS_URL), {
          timeoutDuration: 3000,
          cooldownDuration: 30000,
          cacheMaxAge: 600000,
        }),
      }));
    }
    return verificationContextPromise;
  }

  async function verifyGoogleIdToken({ idToken }) {
    try {
      const { jose, jwks } = await getVerificationContext();
      const { googleOAuthClientIds } = getConfig();
      const { payload } = await jose.jwtVerify(idToken, jwks, {
        algorithms: ['RS256'],
        issuer: GOOGLE_ISSUERS,
        audience: googleOAuthClientIds,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        requiredClaims: ['sub', 'exp', 'iat', 'nonce'],
      });

      validateClaims(payload, now());
      const { email, emailVerified } = normalizeEmail(payload);
      return {
        provider: 'google',
        subject: payload.sub,
        email,
        emailVerified,
        suggestedName: normalizeName(payload.name),
        verifiedNonce: payload.nonce,
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      if (isInfrastructureFailure(error)) {
        throw providerUnavailableError();
      }
      throw invalidCredentialError();
    }
  }

  return { verifyGoogleIdToken };
}

const googleProvider = createGoogleProvider();

module.exports = googleProvider;
module.exports.createGoogleProvider = createGoogleProvider;
