const { Router } = require('express');
const { authenticate } = require('../../middleware/authenticate.middleware');
const { requireCapability } = require('../../middleware/require-capability.middleware');
const { CAPABILITIES } = require('../../shared/security/capabilities');
const { parseRecipeImage } = require('./upload.middleware');
const uploadController = require('./upload.controller');

const router = Router();

router.post(
  '/recipe-image',
  authenticate,
  requireCapability(CAPABILITIES.RECIPE_IMAGE_UPLOAD),
  parseRecipeImage,
  uploadController.uploadRecipeImage
);

module.exports = router;
