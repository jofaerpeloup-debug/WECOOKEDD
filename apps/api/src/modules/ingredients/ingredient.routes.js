const { Router } = require('express');
const ingredientController = require('./ingredient.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/authenticate.middleware');
const { requireCapability } = require('../../middleware/require-capability.middleware');
const { requireCatalogReadAllForNonActive } = require('../../middleware/catalog-read.middleware');
const { CAPABILITIES } = require('../../shared/security/capabilities');
const {
  ingredientParamsSchema,
  listIngredientsSchema,
  createIngredientSchema,
  updateIngredientSchema,
} = require('./ingredient.validation');

const router = Router();

router.get(
  '/',
  authenticate,
  validate(listIngredientsSchema),
  requireCatalogReadAllForNonActive,
  ingredientController.listIngredients
);
router.get(
  '/:ingredientId',
  authenticate,
  validate(ingredientParamsSchema),
  ingredientController.getIngredient
);

router.post(
  '/',
  authenticate,
  requireCapability(CAPABILITIES.CATALOG_WRITE),
  validate(createIngredientSchema),
  ingredientController.createIngredient
);
router.patch(
  '/:ingredientId',
  authenticate,
  requireCapability(CAPABILITIES.CATALOG_WRITE),
  validate(updateIngredientSchema),
  ingredientController.updateIngredient
);
router.delete(
  '/:ingredientId',
  authenticate,
  requireCapability(CAPABILITIES.CATALOG_WRITE),
  validate(ingredientParamsSchema),
  ingredientController.archiveIngredient
);

module.exports = router;
