const { Router } = require('express');
const authController = require('./auth.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/authenticate.middleware');
const { createRateLimiter } = require('../../middleware/rate-limiter');
const {
  registerSchema,
  loginSchema,
  refreshSchema,
  changePasswordSchema,
} = require('./auth.validation');

const router = Router();

// Stricter than the app-wide baseline limiter — these are the endpoints
// most attractive for credential stuffing / account enumeration.
const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
});

router.post('/register', authRateLimiter, validate(registerSchema), authController.register);
router.post('/login', authRateLimiter, validate(loginSchema), authController.login);
router.post('/refresh', authRateLimiter, validate(refreshSchema), authController.refresh);
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
