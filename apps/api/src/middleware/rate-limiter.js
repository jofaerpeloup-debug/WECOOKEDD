const rateLimit = require('express-rate-limit');
const { AppError } = require('../shared/errors/app-error');

/**
 * Wraps express-rate-limit so a limited request is routed through the same
 * AppError -> central error middleware path as every other error, instead
 * of the library's default 429 response.
 */
function createRateLimiter(options) {
  // The default in-memory store is intentional for the single Render instance
  // used by this checkpoint. Scaling beyond one instance requires a shared
  // limiter store so every process observes the same counters.
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    ...options,
    handler: (req, res, next) => {
      next(
        new AppError('Too many requests. Please try again later.', {
          statusCode: 429,
          code: 'RATE_LIMIT_EXCEEDED',
        })
      );
    },
  });
}

function authenticatedUserKey(req) {
  if (!req.auth?.userId) {
    throw new AppError('Session is no longer valid.', {
      statusCode: 401,
      code: 'AUTH_SESSION_INVALID',
    });
  }
  return String(req.auth.userId);
}

const SOCIAL_RATE_LIMITS = Object.freeze({
  challenge: Object.freeze({ windowMs: 15 * 60 * 1000, limit: 30 }),
  googleLogin: Object.freeze({ windowMs: 15 * 60 * 1000, limit: 20 }),
  googleLinkIp: Object.freeze({ windowMs: 15 * 60 * 1000, limit: 20 }),
  googleLinkUser: Object.freeze({ windowMs: 15 * 60 * 1000, limit: 10 }),
  // Its own per-user budget rather than a share of googleLinkUser: one link
  // attempt spends exactly one challenge AND one exchange, so a shared counter
  // would halve the effective link allowance.
  linkChallengeUser: Object.freeze({ windowMs: 15 * 60 * 1000, limit: 10 }),
});

const RECIPE_IMPORT_RATE_LIMITS = Object.freeze({
  ip: Object.freeze({ windowMs: 15 * 60 * 1000, limit: 20 }),
  user: Object.freeze({ windowMs: 15 * 60 * 1000, limit: 10 }),
});

const socialChallengeRateLimiter = createRateLimiter({
  ...SOCIAL_RATE_LIMITS.challenge,
});

const socialGoogleLoginRateLimiter = createRateLimiter({
  ...SOCIAL_RATE_LIMITS.googleLogin,
});

const socialGoogleLinkIpRateLimiter = createRateLimiter({
  ...SOCIAL_RATE_LIMITS.googleLinkIp,
});

const socialGoogleLinkUserRateLimiter = createRateLimiter({
  ...SOCIAL_RATE_LIMITS.googleLinkUser,
  keyGenerator: authenticatedUserKey,
});

const socialLinkChallengeUserRateLimiter = createRateLimiter({
  ...SOCIAL_RATE_LIMITS.linkChallengeUser,
  keyGenerator: authenticatedUserKey,
});

function createRecipeImportRateLimiters() {
  return {
    ip: createRateLimiter({ ...RECIPE_IMPORT_RATE_LIMITS.ip }),
    user: createRateLimiter({
      ...RECIPE_IMPORT_RATE_LIMITS.user,
      keyGenerator: authenticatedUserKey,
    }),
  };
}

const {
  ip: recipeImportIpRateLimiter,
  user: recipeImportUserRateLimiter,
} = createRecipeImportRateLimiters();

module.exports = {
  createRateLimiter,
  authenticatedUserKey,
  SOCIAL_RATE_LIMITS,
  RECIPE_IMPORT_RATE_LIMITS,
  createRecipeImportRateLimiters,
  socialChallengeRateLimiter,
  socialGoogleLoginRateLimiter,
  socialGoogleLinkIpRateLimiter,
  socialGoogleLinkUserRateLimiter,
  socialLinkChallengeUserRateLimiter,
  recipeImportIpRateLimiter,
  recipeImportUserRateLimiter,
};
