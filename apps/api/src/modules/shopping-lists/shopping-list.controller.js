const shoppingListService = require('./shopping-list.service');
const { toPublicShoppingList, toPublicShoppingListV2 } = require('./shopping-list.serializer');
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

function sendV2(res, result) {
  sendSuccess(res, { shoppingListFormat: 2, shoppingList: toPublicShoppingListV2(result) });
}

const getShoppingListV2 = asyncHandler(async (req, res) => {
  sendV2(res, await shoppingListService.getShoppingList(req.auth.userId, true));
});
const addItemV2 = asyncHandler(async (req, res) => {
  const result = req.body.type === 'custom'
    ? await shoppingListService.addCustomItem(req.auth.userId, req.body)
    : await shoppingListService.addItem(req.auth.userId, req.body, true);
  sendV2(res, result);
});
const patchItemV2 = asyncHandler(async (req, res) => {
  sendV2(res, await shoppingListService.patchItem(req.auth.userId, req.params.itemId, req.body, true));
});
const removeItemV2 = asyncHandler(async (req, res) => {
  sendV2(res, await shoppingListService.removeItem(req.auth.userId, req.params.itemId, true));
});
const clearCheckedItemsV2 = asyncHandler(async (req, res) => {
  sendV2(res, await shoppingListService.clearCheckedItems(req.auth.userId, true));
});
const clearItemsV2 = asyncHandler(async (req, res) => {
  sendV2(res, await shoppingListService.clearItems(req.auth.userId, true));
});
const addRecipeIngredientsV2 = asyncHandler(async (req, res) => {
  sendV2(res, await shoppingListService.addRecipeIngredients(req.auth.userId, req.params.recipeId, true, req.body));
});

module.exports = {
  getShoppingList,
  addItem,
  patchItem,
  removeItem,
  clearCheckedItems,
  clearItems,
  addRecipeIngredients,
  getShoppingListV2,
  addItemV2,
  patchItemV2,
  removeItemV2,
  clearCheckedItemsV2,
  clearItemsV2,
  addRecipeIngredientsV2,
};
