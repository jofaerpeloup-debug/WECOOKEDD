const { Router } = require('express');
const substitutionController = require('./substitution.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/authenticate.middleware');
const { requireCapability } = require('../../middleware/require-capability.middleware');
const { requireCatalogReadAllForNonActive } = require('../../middleware/catalog-read.middleware');
const { CAPABILITIES } = require('../../shared/security/capabilities');
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
  requireCatalogReadAllForNonActive,
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
  requireCapability(CAPABILITIES.CATALOG_WRITE),
  validate(createSubstitutionSchema),
  substitutionController.createSubstitution
);
router.patch(
  '/:substitutionId',
  authenticate,
  requireCapability(CAPABILITIES.CATALOG_WRITE),
  validate(updateSubstitutionSchema),
  substitutionController.updateSubstitution
);
router.delete(
  '/:substitutionId',
  authenticate,
  requireCapability(CAPABILITIES.CATALOG_WRITE),
  validate(substitutionParamsSchema),
  substitutionController.archiveSubstitution
);

module.exports = router;
