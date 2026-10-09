const { Router } = require('express');
const controller = require('./push-installation.controller');
const { authenticate } = require('../../middleware/authenticate.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { createRateLimiter, authenticatedUserKey } = require('../../middleware/rate-limiter');
const { putPushInstallationSchema, deletePushInstallationSchema } = require('./push-installation.validation');

const router = Router({ mergeParams: true });
const limiter = createRateLimiter({ windowMs: 15 * 60 * 1000, limit: 60, keyGenerator: authenticatedUserKey });
router.put('/:installationId', authenticate, limiter, validate(putPushInstallationSchema), controller.put);
router.delete('/:installationId', authenticate, limiter, validate(deletePushInstallationSchema), controller.remove);

module.exports = router;
