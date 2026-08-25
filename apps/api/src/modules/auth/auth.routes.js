const { Router } = require('express');
const authController = require('./auth.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/authenticate.middleware');
const { createRateLimiter } = require('../../middleware/rate-limiter');
const { registerSchema, loginSchema, refreshSchema } = require('./auth.validation');

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

module.exports = router;
