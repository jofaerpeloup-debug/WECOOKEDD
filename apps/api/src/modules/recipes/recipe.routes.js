const { Router } = require('express');
const recipeController = require('./recipe.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/authenticate.middleware');
const { requireCapability } = require('../../middleware/require-capability.middleware');
const { requireCatalogReadAllForNonActive } = require('../../middleware/catalog-read.middleware');
const { CAPABILITIES } = require('../../shared/security/capabilities');
const {
  recipeParamsSchema,
  listRecipesSchema,
  createRecipeSchema,
  updateRecipeSchema,
} = require('./recipe.validation');

const router = Router();

router.get(
  '/',
  authenticate,
  validate(listRecipesSchema),
  requireCatalogReadAllForNonActive,
  recipeController.listRecipes
);
router.get('/:recipeId', authenticate, validate(recipeParamsSchema), recipeController.getRecipe);

router.post(
  '/',
  authenticate,
  requireCapability(CAPABILITIES.CATALOG_WRITE),
  validate(createRecipeSchema),
  recipeController.createRecipe
);
router.patch(
  '/:recipeId',
  authenticate,
  requireCapability(CAPABILITIES.CATALOG_WRITE),
  validate(updateRecipeSchema),
  recipeController.updateRecipe
);
router.delete(
  '/:recipeId',
  authenticate,
  requireCapability(CAPABILITIES.CATALOG_WRITE),
  validate(recipeParamsSchema),
  recipeController.archiveRecipe
);

module.exports = router;
