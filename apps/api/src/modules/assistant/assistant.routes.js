const { Router } = require('express');
const { authenticate } = require('../../middleware/authenticate.middleware');
const { validate } = require('../../middleware/validate.middleware');
const {
  assistantUserRateLimiter,
  assistantIpRateLimiter,
} = require('../../middleware/rate-limiter');
const { assistantChatSchema } = require('./assistant.validation');
const assistantController = require('./assistant.controller');

const router = Router();

router.post(
  '/chat',
  authenticate,
  assistantUserRateLimiter,
  assistantIpRateLimiter,
  validate(assistantChatSchema),
  assistantController.chat
);

module.exports = router;
