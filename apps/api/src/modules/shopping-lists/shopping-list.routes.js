const { Router } = require('express');
const shoppingListController = require('./shopping-list.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/authenticate.middleware');
const {
  itemParamsSchema,
  recipeParamsSchema,
  createItemSchema,
  patchItemSchema,
} = require('./shopping-list.validation');

const router = Router();

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
