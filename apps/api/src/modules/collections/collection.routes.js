const { Router } = require('express');
const collectionController = require('./collection.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/authenticate.middleware');
const {
  collectionParamsSchema,
  collectionRecipeParamsSchema,
  createCollectionSchema,
  patchCollectionSchema,
  listCollectionRecipesSchema,
  addCollectionRecipeSchema,
} = require('./collection.validation');

const router = Router();

router.get('/', authenticate, collectionController.listCollections);
router.post('/', authenticate, validate(createCollectionSchema), collectionController.createCollection);

router.get(
  '/:collectionId',
  authenticate,
  validate(collectionParamsSchema),
  collectionController.getCollection
);
router.patch(
  '/:collectionId',
  authenticate,
  validate(patchCollectionSchema),
  collectionController.updateCollection
);
router.delete(
  '/:collectionId',
  authenticate,
  validate(collectionParamsSchema),
  collectionController.deleteCollection
);

router.get(
  '/:collectionId/recipes',
  authenticate,
  validate(listCollectionRecipesSchema),
  collectionController.listCollectionRecipes
);
router.post(
  '/:collectionId/recipes',
  authenticate,
  validate(addCollectionRecipeSchema),
  collectionController.addCollectionRecipe
);
router.delete(
  '/:collectionId/recipes/:recipeId',
  authenticate,
  validate(collectionRecipeParamsSchema),
  collectionController.removeCollectionRecipe
);

module.exports = router;
