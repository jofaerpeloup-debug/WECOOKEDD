const { Router } = require('express');
const recipeController = require('./recipe.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/authenticate.middleware');
const { authorize } = require('../../middleware/authorize.middleware');
const {
  recipeParamsSchema,
  listRecipesSchema,
  createRecipeSchema,
  updateRecipeSchema,
} = require('./recipe.validation');

const router = Router();

router.get('/', authenticate, validate(listRecipesSchema), recipeController.listRecipes);
router.get('/:recipeId', authenticate, validate(recipeParamsSchema), recipeController.getRecipe);

router.post(
  '/',
  authenticate,
  authorize('admin'),
  validate(createRecipeSchema),
  recipeController.createRecipe
);
router.patch(
  '/:recipeId',
  authenticate,
  authorize('admin'),
  validate(updateRecipeSchema),
  recipeController.updateRecipe
);
router.delete(
  '/:recipeId',
  authenticate,
  authorize('admin'),
  validate(recipeParamsSchema),
  recipeController.archiveRecipe
);

module.exports = router;