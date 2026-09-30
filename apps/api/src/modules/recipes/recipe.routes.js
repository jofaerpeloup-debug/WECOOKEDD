const { Router } = require('express');
const recipeController = require('./recipe.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/authenticate.middleware');
const { requireCapability } = require('../../middleware/require-capability.middleware');
const {
  requireCatalogReadAllForNonActive,
  requireCatalogWriteForDraftList,
} = require('../../middleware/catalog-read.middleware');
const { CAPABILITIES } = require('../../shared/security/capabilities');
const {
  recipeImportIpRateLimiter,
  recipeImportUserRateLimiter,
} = require('../../middleware/rate-limiter');
const {
  recipeParamsSchema,
  listRecipesSchema,
  createRecipeSchema,
  createDraftSchema,
  duplicateCheckSchema,
  updateRecipeSchema,
  publishRecipeSchema,
  publishReadinessSchema,
  lifecycleRecipeSchema,
  importRecipeUrlSchema,
} = require('./recipe.validation');

const router = Router();

router.post(
  '/duplicate-check',
  authenticate,
  requireCapability(CAPABILITIES.CATALOG_WRITE),
  validate(duplicateCheckSchema),
  recipeController.checkRecipeDuplicates
);

router.post(
  '/import-url',
  authenticate,
  requireCapability(CAPABILITIES.CATALOG_WRITE),
  recipeImportIpRateLimiter,
  recipeImportUserRateLimiter,
  validate(importRecipeUrlSchema),
  recipeController.importRecipeUrl
);

router.get(
  '/',
  authenticate,
  validate(listRecipesSchema),
  requireCatalogWriteForDraftList,
  requireCatalogReadAllForNonActive,
  recipeController.listRecipes
);
router.post(
  '/:recipeId/publish-readiness',
  authenticate,
  requireCapability(CAPABILITIES.CATALOG_WRITE),
  validate(publishReadinessSchema),
  recipeController.getRecipePublishReadiness
);
router.get('/:recipeId', authenticate, validate(recipeParamsSchema), recipeController.getRecipe);

router.post(
  '/drafts',
  authenticate,
  requireCapability(CAPABILITIES.CATALOG_WRITE),
  validate(createDraftSchema),
  recipeController.createDraft
);
router.post(
  '/',
  authenticate,
  requireCapability(CAPABILITIES.CATALOG_WRITE),
  validate(createRecipeSchema),
  recipeController.createRecipe
);
router.post(
  '/:recipeId/publish',
  authenticate,
  requireCapability(CAPABILITIES.CATALOG_WRITE),
  validate(publishRecipeSchema),
  recipeController.publishRecipe
);
router.post(
  '/:recipeId/archive',
  authenticate,
  requireCapability(CAPABILITIES.CATALOG_WRITE),
  validate(lifecycleRecipeSchema),
  recipeController.archiveRecipe
);
router.post(
  '/:recipeId/restore',
  authenticate,
  requireCapability(CAPABILITIES.CATALOG_WRITE),
  validate(lifecycleRecipeSchema),
  recipeController.restoreRecipe
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
