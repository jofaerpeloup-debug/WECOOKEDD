const shoppingListService = require('./shopping-list.service');
const { toPublicShoppingList } = require('./shopping-list.serializer');
const { sendSuccess } = require('../../shared/http/response');
const { asyncHandler } = require('../../shared/http/async-handler');

const getShoppingList = asyncHandler(async (req, res) => {
  const result = await shoppingListService.getShoppingList(req.auth.userId);
  sendSuccess(res, { shoppingList: toPublicShoppingList(result) });
});

const addItem = asyncHandler(async (req, res) => {
  const result = await shoppingListService.addItem(req.auth.userId, req.body);
  sendSuccess(res, { shoppingList: toPublicShoppingList(result) });
});

const patchItem = asyncHandler(async (req, res) => {
  const { itemId } = req.params;
  const result = await shoppingListService.patchItem(req.auth.userId, itemId, req.body);
  sendSuccess(res, { shoppingList: toPublicShoppingList(result) });
});

const removeItem = asyncHandler(async (req, res) => {
  const { itemId } = req.params;
  const result = await shoppingListService.removeItem(req.auth.userId, itemId);
  sendSuccess(res, { shoppingList: toPublicShoppingList(result) });
});

const clearCheckedItems = asyncHandler(async (req, res) => {
  const result = await shoppingListService.clearCheckedItems(req.auth.userId);
  sendSuccess(res, { shoppingList: toPublicShoppingList(result) });
});

const clearItems = asyncHandler(async (req, res) => {
  const result = await shoppingListService.clearItems(req.auth.userId);
  sendSuccess(res, { shoppingList: toPublicShoppingList(result) });
});

const addRecipeIngredients = asyncHandler(async (req, res) => {
  const { recipeId } = req.params;
  const result = await shoppingListService.addRecipeIngredients(req.auth.userId, recipeId);
  sendSuccess(res, { shoppingList: toPublicShoppingList(result) });
});

module.exports = {
  getShoppingList,
  addItem,
  patchItem,
  removeItem,
  clearCheckedItems,
  clearItems,
  addRecipeIngredients,
};
