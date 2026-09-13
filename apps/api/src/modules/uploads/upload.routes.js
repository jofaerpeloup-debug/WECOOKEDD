const { Router } = require('express');
const { authenticate } = require('../../middleware/authenticate.middleware');
const { authorize } = require('../../middleware/authorize.middleware');
const { parseRecipeImage } = require('./upload.middleware');
const uploadController = require('./upload.controller');

const router = Router();

router.post(
  '/recipe-image',
  authenticate,
  authorize('admin'),
  parseRecipeImage,
  uploadController.uploadRecipeImage
);

module.exports = router;
