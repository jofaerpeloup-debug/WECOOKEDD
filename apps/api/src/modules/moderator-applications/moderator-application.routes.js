const { Router } = require('express');
const { authenticate } = require('../../middleware/authenticate.middleware');
const { requireCapability } = require('../../middleware/require-capability.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { noStore } = require('../../middleware/no-store.middleware');
const { CAPABILITIES } = require('../../shared/security/capabilities');
const controller = require('./moderator-application.controller');
const {
  applySchema,
  listSchema,
  decisionParamsSchema,
  rejectionSchema,
  demotionSchema,
} = require('./moderator-application.validation');

const router = Router();
const staffManager = requireCapability(CAPABILITIES.STAFF_MANAGE);

router.get('/me', authenticate, noStore, controller.me);
router.post('/moderator-applications', authenticate, validate(applySchema), controller.apply);
router.get(
  '/moderator-applications',
  authenticate,
  staffManager,
  validate(listSchema),
  controller.list
);
router.post(
  '/moderator-applications/:applicationId/approve',
  authenticate,
  staffManager,
  validate(decisionParamsSchema),
  controller.approve
);
router.post(
  '/moderator-applications/:applicationId/reject',
  authenticate,
  staffManager,
  validate(rejectionSchema),
  controller.reject
);
router.post(
  '/moderators/:userId/demote',
  authenticate,
  staffManager,
  validate(demotionSchema),
  controller.demote
);

module.exports = router;
