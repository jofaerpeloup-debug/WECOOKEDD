const { Router } = require('express');
const { noStore } = require('../../middleware/no-store.middleware');
const { authenticate } = require('../../middleware/authenticate.middleware');
const { requireCapability } = require('../../middleware/require-capability.middleware');
const { CAPABILITIES } = require('../../shared/security/capabilities');
const { AppError } = require('../../shared/errors/app-error');
const controller = require('./analytics.controller');

const router = Router();

function rejectQuery(req, res, next) {
  // originalUrl also catches duplicate, malformed, or parser-normalized keys.
  if (req.originalUrl.split('?').length > 1) {
    return next(new AppError('Analytics filters are not supported.', {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    }));
  }
  next();
}

router.get(
  '/overview',
  noStore,
  authenticate,
  requireCapability(CAPABILITIES.MONITORING_READ),
  rejectQuery,
  controller.getOverview
);

module.exports = router;
