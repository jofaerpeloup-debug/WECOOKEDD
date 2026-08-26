const { Router } = require('express');
const substitutionController = require('./substitution.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/authenticate.middleware');
const { authorize } = require('../../middleware/authorize.middleware');
const {
  substitutionParamsSchema,
  listSubstitutionsSchema,
  createSubstitutionSchema,
  updateSubstitutionSchema,
} = require('./substitution.validation');

const router = Router();

router.get(
  '/',
  authenticate,
  validate(listSubstitutionsSchema),
  substitutionController.listSubstitutions
);
router.get(
  '/:substitutionId',
  authenticate,
  validate(substitutionParamsSchema),
  substitutionController.getSubstitution
);

router.post(
  '/',
  authenticate,
  authorize('admin'),
  validate(createSubstitutionSchema),
  substitutionController.createSubstitution
);
router.patch(
  '/:substitutionId',
  authenticate,
  authorize('admin'),
  validate(updateSubstitutionSchema),
  substitutionController.updateSubstitution
);
router.delete(
  '/:substitutionId',
  authenticate,
  authorize('admin'),
  validate(substitutionParamsSchema),
  substitutionController.archiveSubstitution
);

module.exports = router;