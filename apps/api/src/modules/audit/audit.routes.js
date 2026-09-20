const { Router } = require('express');
const { noStore } = require('../../middleware/no-store.middleware');
const { authenticate } = require('../../middleware/authenticate.middleware');
const { requireCapability } = require('../../middleware/require-capability.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { CAPABILITIES } = require('../../shared/security/capabilities');
const auditController = require('./audit.controller');
const { listAuditLogsSchema } = require('./audit.validation');

const router = Router();
const monitoringReader = requireCapability(CAPABILITIES.MONITORING_READ);

router.get(
  '/',
  noStore,
  authenticate,
  monitoringReader,
  validate(listAuditLogsSchema),
  auditController.listAuditLogs
);

module.exports = router;
