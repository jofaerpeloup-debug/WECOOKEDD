const shoppingListRepository = require('./shopping-list.repository');
const ingredientService = require('../ingredients/ingredient.service');
const recipeService = require('../recipes/recipe.service');
const ShoppingList = require('./shopping-list.model');
const { isPositiveFiniteNumber } = require('../../shared/constants/measurement-units');
const { AppError } = require('../../shared/errors/app-error');
const { normalizeCustomLabel } = require('./shopping-list.custom-label');

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

async function saveAdditiveWithOneRetry(userId, list, applyPayload, v2 = false) {
  try {
    list.markModified('items');
    await shoppingListRepository.save(list);
    return list;
  } catch (err) {
    if (!isVersionError(err)) throw err;
  }

  const latest = await shoppingListRepository.findOrCreateByUserId(userId);
  assertListIntegrity(latest);
  if (!v2) assertV1Compatible(latest);
  applyPayload(latest);
  assertWithinLimit(latest.items);
  assertProvenanceBounds(latest.items);
  latest.markModified('items');
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
  return items.findIndex((item) => item.type !== 'custom'
    && String(item.ingredientId) === String(ingredientId) && item.unit === unit);
}

// Adds one ingredient usage into `items` (a live Mongoose DocumentArray),
// merging into an existing same-ingredient+same-unit entry — summing
// quantity and resetting isChecked to false, since merging in more of an
// ingredient is new shopping work — rather than creating a duplicate.
// toTaste has no quantity to sum: a second toTaste add for the same
// ingredient is a no-op merge beyond the isChecked reset. Mutates `items`
// in place; callers are responsible for enforcing the item-count limit and
// persisting afterward.
function mergeItemInto(items, { ingredientId, quantity, unit, recipeId }) {
  const index = findItemIndex(items, ingredientId, unit);
  if (index === -1) {
    items.push({ type: 'ingredient', ingredientId,
      quantity: unit === 'toTaste' ? undefined : quantity, unit, isChecked: false,
      originKind: recipeId ? 'recipe' : 'manual',
      ...(recipeId ? { sourceRecipeIds: [recipeId], quantityEdited: false } : {}),
    });
    return;
  }
  const existing = items[index];
  if (recipeId) {
    const sources = existing.sourceRecipeIds || [];
    if (!sources.some((id) => String(id) === String(recipeId))) sources.push(recipeId);
    existing.sourceRecipeIds = sources;
    existing.quantityEdited = existing.originKind !== 'recipe' || existing.quantityEdited === true;
    existing.originKind = 'recipe';
  } else if (existing.sourceRecipeIds?.length) {
    existing.quantityEdited = true;
  }
  if (unit !== 'toTaste') {
    existing.quantity = (existing.quantity ?? 0) + quantity;
  }
  existing.isChecked = false;
}

function assertV1Compatible(list) {
  if (list.items.some((item) => item.type === 'custom')) {
    throw new AppError('Update WeCooked to use this shopping list.', {
      statusCode: 426, code: 'SHOPPING_LIST_UPGRADE_REQUIRED',
    });
  }
}

function assertProvenanceBounds(items) {
  const all = new Set();
  for (const item of items) {
    if (item.type === 'custom') continue;
    const ids = item.sourceRecipeIds || [];
    if (ids.length > 8 || new Set(ids.map(String)).size !== ids.length) {
      throw new AppError('Shopping list Recipe source limit exceeded.', {
        statusCode: 400, code: 'SHOPPING_LIST_SOURCE_LIMIT_EXCEEDED',
      });
    }
    ids.forEach((id) => all.add(String(id)));
  }
  if (all.size > 200) {
    throw new AppError('Shopping list Recipe source limit exceeded.', {
      statusCode: 400, code: 'SHOPPING_LIST_SOURCE_LIMIT_EXCEEDED',
    });
  }
  return [...all];
}

function assertListIntegrity(list) {
  if (list.$locals?.shoppingStoredItemsArray === false
    || !Array.isArray(list.items) || list.items.length > ShoppingList.MAX_ITEMS) {
    throw new AppError('Shopping list requires repair.', { statusCode: 500, code: 'SHOPPING_LIST_INVALID' });
  }
  for (const item of list.items) {
    if (item.$locals?.shoppingStoredShapeValid === false
      || !ShoppingList.isValidShoppingRow(item.toObject({ depopulate: true }))) {
      throw new AppError('Shopping list requires repair.', { statusCode: 500, code: 'SHOPPING_LIST_INVALID' });
    }
  }
  try { assertProvenanceBounds(list.items); } catch (_err) {
    throw new AppError('Shopping list requires repair.', { statusCode: 500, code: 'SHOPPING_LIST_INVALID' });
  }
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
  const uniqueIds = [...new Set(list.items.filter((item) => item.type !== 'custom')
    .map((item) => String(item.ingredientId)))];
  const found = await Promise.all(uniqueIds.map((id) => ingredientService.findIngredientById(id)));
  const map = new Map();
  uniqueIds.forEach((id, index) => map.set(id, found[index] ?? null));
  return map;
}

async function toResult(list, v2 = false) {
  const ingredientsById = await resolveIngredientsById(list);
  const sourcesById = v2
    ? await recipeService.findConsumerVisibleShoppingSources(assertProvenanceBounds(list.items))
    : null;
  return { shoppingList: list, ingredientsById, sourcesById };
}

async function getShoppingList(userId, v2 = false) {
  const list = await shoppingListRepository.findOrCreateByUserId(userId);
  assertListIntegrity(list);
  if (!v2) assertV1Compatible(list);
  return toResult(list, v2);
}

// New items may only reference active Ingredients; merging follows the
// same ingredientId+unit key used everywhere else in this module.
async function addItem(userId, { ingredientId, quantity, unit }, v2 = false) {
  const list = await shoppingListRepository.findOrCreateByUserId(userId);
  assertListIntegrity(list);
  if (!v2) assertV1Compatible(list);
  await assertActiveIngredient(ingredientId);
  const applyPayload = (target) => {
    mergeItemInto(target.items, { ingredientId, quantity, unit });
    assertWithinLimit(target.items);
  };
  applyPayload(list);

  const saved = await saveAdditiveWithOneRetry(userId, list, applyPayload, v2);
  return toResult(saved, v2);
}

async function addCustomItem(userId, { label }) {
  const normalized = normalizeCustomLabel(label);
  if (normalized === null) throw invalidQuantityError('Invalid custom item label.');
  const list = await shoppingListRepository.findOrCreateByUserId(userId);
  assertListIntegrity(list);
  const applyPayload = (target) => {
    target.items.push({ type: 'custom', label: normalized, isChecked: false });
    assertWithinLimit(target.items);
  };
  applyPayload(list);
  const saved = await saveAdditiveWithOneRetry(userId, list, applyPayload, true);
  return toResult(saved, true);
}

// Strict/partial: validates the resulting prospective item (not merely each
// incoming field in isolation) so a PATCH can never leave an invalid
// quantity/unit combination. Switching to "toTaste" requires the resulting
// quantity to be null/omitted; switching away from it requires a positive
// quantity to be supplied in the same request — a stale stored value from
// the other shape is never silently carried over or cleared.
async function patchItem(userId, itemId, patch, v2 = false) {
  const list = await shoppingListRepository.findOrCreateByUserId(userId);
  assertListIntegrity(list);
  if (!v2) assertV1Compatible(list);
  const item = list.items.id(itemId);
  if (!item) {
    throw itemNotFoundError();
  }

  if (v2 && patch.type !== (item.type || 'ingredient')) {
    throw invalidQuantityError('Shopping list item type does not match.');
  }
  if (item.type === 'custom') {
    item.isChecked = patch.isChecked;
    list.markModified('items');
    await saveOrThrowStale(list);
    return toResult(list, true);
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
  if ((patch.quantity !== undefined || patch.unit !== undefined) && item.sourceRecipeIds?.length) {
    item.quantityEdited = true;
  }
  if (patch.isChecked !== undefined) {
    item.isChecked = patch.isChecked;
  }

  list.markModified('items');
  await saveOrThrowStale(list);
  return toResult(list, v2);
}

// The user must still be able to remove a stale item even if its
// Ingredient has since become archived/missing — this never calls
// IngredientService.
async function removeItem(userId, itemId, v2 = false) {
  const list = await shoppingListRepository.findOrCreateByUserId(userId);
  assertListIntegrity(list);
  if (!v2) assertV1Compatible(list);
  const item = list.items.id(itemId);
  if (!item) {
    throw itemNotFoundError();
  }

  item.deleteOne();
  await saveOrThrowStale(list);
  return toResult(list, v2);
}

async function clearCheckedItems(userId, v2 = false) {
  const list = await shoppingListRepository.findOrCreateByUserId(userId);
  assertListIntegrity(list);
  if (!v2) assertV1Compatible(list);
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
    return toResult(list, v2);
  }

  const checkedIdSet = new Set(checkedIds);
  list.items = list.items.filter((item) => !checkedIdSet.has(String(item._id)));
  await saveOrThrowStale(list);
  return toResult(list, v2);
}

async function clearItems(userId, v2 = false) {
  const list = await shoppingListRepository.findOrCreateByUserId(userId);
  assertListIntegrity(list);
  if (!v2) assertV1Compatible(list);
  list.items = [];
  list.markModified('items');
  await saveOrThrowStale(list);
  return toResult(list, v2);
}

// Convenience import: merges every currently-usable ingredient usage from
// a Recipe into the current user's list. The Recipe must itself be usable
// (resolved through RecipeService only); archived/unusable recipes are
// rejected outright, and an archived optional ingredient usage that
// RecipeService already omits from its own non-admin view never reappears
// here. Applies every usage to the single ShoppingList document and saves
// it once — no transaction needed since it's one document.
async function addRecipeIngredients(userId, recipeId, v2 = false) {
  const list = await shoppingListRepository.findOrCreateByUserId(userId);
  assertListIntegrity(list);
  if (!v2) assertV1Compatible(list);
  const recipe = await recipeService.findUsableRecipeById(recipeId);
  if (!recipe) {
    throw recipeNotFoundError();
  }

  const applyPayload = (target) => {
    for (const usage of recipe.ingredients) {
      mergeItemInto(target.items, {
        ingredientId: usage.ingredient.id,
        quantity: usage.quantity,
        unit: usage.unit,
        recipeId,
      });
    }
    assertWithinLimit(target.items);
    assertProvenanceBounds(target.items);
  };
  applyPayload(list);

  const saved = await saveAdditiveWithOneRetry(userId, list, applyPayload, v2);
  return toResult(saved, v2);
}

module.exports = {
  getShoppingList,
  addItem,
  addCustomItem,
  patchItem,
  removeItem,
  clearCheckedItems,
  clearItems,
  addRecipeIngredients,
};
