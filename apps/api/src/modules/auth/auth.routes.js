const { Router } = require('express');
const authController = require('./auth.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/authenticate.middleware');
const {
  createRateLimiter,
  socialChallengeRateLimiter,
  socialGoogleLoginRateLimiter,
  socialGoogleLinkIpRateLimiter,
  socialGoogleLinkUserRateLimiter,
  socialLinkChallengeUserRateLimiter,
} = require('../../middleware/rate-limiter');
const {
  registerSchema,
  loginSchema,
  refreshSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  socialChallengeSchema,
  googleSocialSchema,
} = require('./auth.validation');

const router = Router();

// Stricter than the app-wide baseline limiter — these are the endpoints
// most attractive for credential stuffing / account enumeration.
const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
});

const forgotPasswordRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
});

router.post('/register', authRateLimiter, validate(registerSchema), authController.register);
router.post('/login', authRateLimiter, validate(loginSchema), authController.login);
router.post(
  '/social/challenge',
  socialChallengeRateLimiter,
  validate(socialChallengeSchema),
  authController.socialChallenge
);
// A LINK challenge is account-management state, so it gets its own
// authenticated route rather than an optionally-authenticated
// /social/challenge: the binding is req.auth.userId and there is no request
// shape in which an anonymous caller can obtain one. Middleware order mirrors
// /social/google/link — IP limiter, authenticate, per-user limiter, strict
// validation, controller. The IP stage deliberately REUSES
// socialChallengeRateLimiter, so both challenge routes draw on one shared
// 30/15min per-IP budget; only the per-user stage below is dedicated.
router.post(
  '/social/challenge/link',
  socialChallengeRateLimiter,
  authenticate,
  socialLinkChallengeUserRateLimiter,
  validate(socialChallengeSchema),
  authController.socialLinkChallenge
);
router.post(
  '/social/google',
  socialGoogleLoginRateLimiter,
  validate(googleSocialSchema),
  authController.googleLogin
);
router.post(
  '/social/google/link',
  socialGoogleLinkIpRateLimiter,
  authenticate,
  socialGoogleLinkUserRateLimiter,
  validate(googleSocialSchema),
  authController.googleLink
);
router.post('/refresh', authRateLimiter, validate(refreshSchema), authController.refresh);
router.post(
  '/forgot-password',
  forgotPasswordRateLimiter,
  validate(forgotPasswordSchema),
  authController.forgotPassword
);
router.post(
  '/reset-password',
  authRateLimiter,
  validate(resetPasswordSchema),
  authController.resetPassword
);
router.post('/logout', authenticate, authController.logout);
router.post('/logout-all', authenticate, authController.logoutAll);

// authenticate BEFORE authRateLimiter: an invalid/expired session fails auth
// first and never consumes the limiter budget; only genuine authenticated
// attempts are rate-limited (brute-forcing currentPassword through a stolen
// access token). Reuses the same limiter instance as login/register/refresh.
router.post(
  '/change-password',
  authenticate,
  authRateLimiter,
  validate(changePasswordSchema),
  authController.changePassword
);

module.exports = router;
// Exposed for tests so a suite that exercises many authenticated attempts can
// reset the shared limiter's per-IP counter between cases. Not used by app code
// (v1.routes.js consumes the default router export).
module.exports.authRateLimiter = authRateLimiter;
module.exports.forgotPasswordRateLimiter = forgotPasswordRateLimiter;
module.exports.socialChallengeRateLimiter = socialChallengeRateLimiter;
module.exports.socialGoogleLoginRateLimiter = socialGoogleLoginRateLimiter;
module.exports.socialGoogleLinkIpRateLimiter = socialGoogleLinkIpRateLimiter;
module.exports.socialGoogleLinkUserRateLimiter = socialGoogleLinkUserRateLimiter;
module.exports.socialLinkChallengeUserRateLimiter = socialLinkChallengeUserRateLimiter;
