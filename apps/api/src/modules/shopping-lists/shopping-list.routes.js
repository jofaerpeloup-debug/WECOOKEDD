const { Router } = require('express');
const shoppingListController = require('./shopping-list.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/authenticate.middleware');
const {
  itemParamsSchema,
  recipeParamsSchema,
  createItemSchema,
  patchItemSchema,
  v2GetSchema,
  v2ItemParamsSchema,
  v2RecipeParamsSchema,
  v2CreateItemSchema,
  v2PatchItemSchema,
} = require('./shopping-list.validation');

const router = Router();

router.get('/v2', authenticate, validate(v2GetSchema), shoppingListController.getShoppingListV2);
router.post('/v2/items', authenticate, validate(v2CreateItemSchema), shoppingListController.addItemV2);
router.patch('/v2/items/:itemId', authenticate, validate(v2PatchItemSchema), shoppingListController.patchItemV2);
router.delete('/v2/items/checked', authenticate, validate(v2GetSchema), shoppingListController.clearCheckedItemsV2);
router.delete('/v2/items/:itemId', authenticate, validate(v2ItemParamsSchema), shoppingListController.removeItemV2);
router.delete('/v2/items', authenticate, validate(v2GetSchema), shoppingListController.clearItemsV2);
router.post('/v2/recipes/:recipeId', authenticate, validate(v2RecipeParamsSchema), shoppingListController.addRecipeIngredientsV2);

router.get('/', authenticate, shoppingListController.getShoppingList);
router.post('/items', authenticate, validate(createItemSchema), shoppingListController.addItem);
router.patch('/items/:itemId', authenticate, validate(patchItemSchema), shoppingListController.patchItem);
router.delete('/items/checked', authenticate, shoppingListController.clearCheckedItems);
router.delete('/items/:itemId', authenticate, validate(itemParamsSchema), shoppingListController.removeItem);
router.delete('/items', authenticate, shoppingListController.clearItems);
router.post(
  '/recipes/:recipeId',
  authenticate,
  validate(recipeParamsSchema),
  shoppingListController.addRecipeIngredients
);

module.exports = router;
