const shoppingListRepository = require('./shopping-list.repository');
const ingredientService = require('../ingredients/ingredient.service');
const recipeService = require('../recipes/recipe.service');
const ShoppingList = require('./shopping-list.model');
const { isPositiveFiniteNumber } = require('../../shared/constants/measurement-units');
const { AppError } = require('../../shared/errors/app-error');

function ingredientNotFoundError() {
  return new AppError('Ingredient not found.', { statusCode: 404, code: 'INGREDIENT_NOT_FOUND' });
}

function ingredientInactiveError() {
  return new AppError('Ingredient is not active.', { statusCode: 400, code: 'INGREDIENT_INACTIVE' });
}

function recipeNotFoundError() {
  return new AppError('Recipe not found.', { statusCode: 404, code: 'RECIPE_NOT_FOUND' });
}

function itemNotFoundError() {
  return new AppError('Shopping list item not found.', {
    statusCode: 404,
    code: 'SHOPPING_LIST_ITEM_NOT_FOUND',
  });
}

function itemAlreadyExistsError() {
  return new AppError('An item with this ingredient and unit already exists on the list.', {
    statusCode: 409,
    code: 'SHOPPING_LIST_ITEM_ALREADY_EXISTS',
  });
}

function limitExceededError() {
  return new AppError(`A shopping list cannot contain more than ${ShoppingList.MAX_ITEMS} items.`, {
    statusCode: 400,
    code: 'SHOPPING_LIST_LIMIT_EXCEEDED',
  });
}

function invalidQuantityError(message) {
  return new AppError(message, { statusCode: 400, code: 'VALIDATION_ERROR' });
}

function staleError() {
  return new AppError('Shopping list changed. Reload and try again.', {
    statusCode: 409,
    code: 'SHOPPING_LIST_STALE',
  });
}

function isVersionError(err) {
  return err instanceof ShoppingList.base.Error.VersionError;
}

async function saveOrThrowStale(list) {
  try {
    await shoppingListRepository.save(list);
  } catch (err) {
    if (isVersionError(err)) {
      throw staleError();
    }
    throw err;
  }
}

async function saveAdditiveWithOneRetry(userId, list, applyPayload) {
  try {
    await shoppingListRepository.save(list);
    return list;
  } catch (err) {
    if (!isVersionError(err)) throw err;
  }

  const latest = await shoppingListRepository.findOrCreateByUserId(userId);
  applyPayload(latest);
  assertWithinLimit(latest.items);
  await saveOrThrowStale(latest);
  return latest;
}

// Verified via IngredientService only — ShoppingListService never imports
// the Ingredient model/repository directly (cross-module boundary rule).
async function assertActiveIngredient(ingredientId) {
  const ingredient = await ingredientService.findIngredientById(ingredientId);
  if (!ingredient) {
    throw ingredientNotFoundError();
  }
  if (!ingredient.isActive) {
    throw ingredientInactiveError();
  }
  return ingredient;
}

function isValidQuantityForUnit(quantity, unit) {
  const hasQuantity = quantity !== undefined && quantity !== null;
  return unit === 'toTaste' ? !hasQuantity : hasQuantity && isPositiveFiniteNumber(quantity);
}

function findItemIndex(items, ingredientId, unit) {
  return items.findIndex((item) => String(item.ingredientId) === String(ingredientId) && item.unit === unit);
}

// Adds one ingredient usage into `items` (a live Mongoose DocumentArray),
// merging into an existing same-ingredient+same-unit entry — summing
// quantity and resetting isChecked to false, since merging in more of an
// ingredient is new shopping work — rather than creating a duplicate.
// toTaste has no quantity to sum: a second toTaste add for the same
// ingredient is a no-op merge beyond the isChecked reset. Mutates `items`
// in place; callers are responsible for enforcing the item-count limit and
// persisting afterward.
function mergeItemInto(items, { ingredientId, quantity, unit }) {
  const index = findItemIndex(items, ingredientId, unit);
  if (index === -1) {
    items.push({ ingredientId, quantity: unit === 'toTaste' ? undefined : quantity, unit, isChecked: false });
    return;
  }
  const existing = items[index];
  if (unit !== 'toTaste') {
    existing.quantity = (existing.quantity ?? 0) + quantity;
  }
  existing.isChecked = false;
}

function assertWithinLimit(items) {
  if (items.length > ShoppingList.MAX_ITEMS) {
    throw limitExceededError();
  }
}

// Resolves every distinct ingredientId referenced by `list.items` through
// IngredientService (never the Ingredient model/repository directly),
// returning a Map keyed by string id. A missing entry (Ingredient deleted
// outright) resolves to undefined/null in the map, same as an archived one
// resolves to a document with isActive: false — the serializer treats both
// as "not available" while still reporting the historical ingredientId.
async function resolveIngredientsById(list) {
  const uniqueIds = [...new Set(list.items.map((item) => String(item.ingredientId)))];
  const found = await Promise.all(uniqueIds.map((id) => ingredientService.findIngredientById(id)));
  const map = new Map();
  uniqueIds.forEach((id, index) => map.set(id, found[index] ?? null));
  return map;
}

async function toResult(list) {
  const ingredientsById = await resolveIngredientsById(list);
  return { shoppingList: list, ingredientsById };
}

async function getShoppingList(userId) {
  const list = await shoppingListRepository.findOrCreateByUserId(userId);
  return toResult(list);
}

// New items may only reference active Ingredients; merging follows the
// same ingredientId+unit key used everywhere else in this module.
async function addItem(userId, { ingredientId, quantity, unit }) {
  await assertActiveIngredient(ingredientId);

  const list = await shoppingListRepository.findOrCreateByUserId(userId);
  const applyPayload = (target) => {
    mergeItemInto(target.items, { ingredientId, quantity, unit });
    assertWithinLimit(target.items);
  };
  applyPayload(list);

  const saved = await saveAdditiveWithOneRetry(userId, list, applyPayload);
  return toResult(saved);
}

// Strict/partial: validates the resulting prospective item (not merely each
// incoming field in isolation) so a PATCH can never leave an invalid
// quantity/unit combination. Switching to "toTaste" requires the resulting
// quantity to be null/omitted; switching away from it requires a positive
// quantity to be supplied in the same request — a stale stored value from
// the other shape is never silently carried over or cleared.
async function patchItem(userId, itemId, patch) {
  const list = await shoppingListRepository.findOrCreateByUserId(userId);
  const item = list.items.id(itemId);
  if (!item) {
    throw itemNotFoundError();
  }

  const nextUnit = patch.unit ?? item.unit;
  const nextQuantity = patch.quantity !== undefined ? patch.quantity : item.quantity;

  if (!isValidQuantityForUnit(nextQuantity, nextUnit)) {
    throw invalidQuantityError(
      nextUnit === 'toTaste'
        ? 'quantity must be omitted when unit is "toTaste".'
        : 'quantity is required and must be a finite number greater than zero unless unit is "toTaste".'
    );
  }

  // Only a unit change can move this item onto another item's
  // ingredientId+unit key. Reject with a predictable conflict rather than
  // silently merging the two during PATCH.
  if (patch.unit !== undefined && patch.unit !== item.unit) {
    const collisionIndex = findItemIndex(list.items, item.ingredientId, nextUnit);
    if (collisionIndex !== -1 && String(list.items[collisionIndex]._id) !== String(item._id)) {
      throw itemAlreadyExistsError();
    }
  }

  item.unit = nextUnit;
  item.quantity = nextUnit === 'toTaste' ? undefined : nextQuantity;
  if (patch.isChecked !== undefined) {
    item.isChecked = patch.isChecked;
  }

  await saveOrThrowStale(list);
  return toResult(list);
}

// The user must still be able to remove a stale item even if its
// Ingredient has since become archived/missing — this never calls
// IngredientService.
async function removeItem(userId, itemId) {
  const list = await shoppingListRepository.findOrCreateByUserId(userId);
  const item = list.items.id(itemId);
  if (!item) {
    throw itemNotFoundError();
  }

  item.deleteOne();
  await saveOrThrowStale(list);
  return toResult(list);
}

async function clearCheckedItems(userId) {
  const list = await shoppingListRepository.findOrCreateByUserId(userId);
  const checkedIds = list.items
    .filter((item) => item.isChecked === true)
    .map((item) => String(item._id));

  if (checkedIds.length === 0) {
    // An unchanged document would make Mongoose save() a database no-op and
    // leave no OCC linearization point. Force an identity write of the items
    // snapshot so optimisticConcurrency emits one atomic {_id, __v} update;
    // a mutation committed before that update becomes SHOPPING_LIST_STALE.
    list.markModified('items');
    await saveOrThrowStale(list);
    return toResult(list);
  }

  const checkedIdSet = new Set(checkedIds);
  list.items = list.items.filter((item) => !checkedIdSet.has(String(item._id)));
  await saveOrThrowStale(list);
  return toResult(list);
}

async function clearItems(userId) {
  const list = await shoppingListRepository.findOrCreateByUserId(userId);
  list.items = [];
  await saveOrThrowStale(list);
  return toResult(list);
}

// Convenience import: merges every currently-usable ingredient usage from
// a Recipe into the current user's list. The Recipe must itself be usable
// (resolved through RecipeService only); archived/unusable recipes are
// rejected outright, and an archived optional ingredient usage that
// RecipeService already omits from its own non-admin view never reappears
// here. Applies every usage to the single ShoppingList document and saves
// it once — no transaction needed since it's one document.
async function addRecipeIngredients(userId, recipeId) {
  const recipe = await recipeService.findUsableRecipeById(recipeId);
  if (!recipe) {
    throw recipeNotFoundError();
  }

  const list = await shoppingListRepository.findOrCreateByUserId(userId);
  const applyPayload = (target) => {
    for (const usage of recipe.ingredients) {
      mergeItemInto(target.items, {
        ingredientId: usage.ingredient.id,
        quantity: usage.quantity,
        unit: usage.unit,
      });
    }
    assertWithinLimit(target.items);
  };
  applyPayload(list);

  const saved = await saveAdditiveWithOneRetry(userId, list, applyPayload);
  return toResult(saved);
}

module.exports = {
  getShoppingList,
  addItem,
  patchItem,
  removeItem,
  clearCheckedItems,
  clearItems,
  addRecipeIngredients,
};
