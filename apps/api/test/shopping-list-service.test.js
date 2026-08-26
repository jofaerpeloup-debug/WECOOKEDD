process.env.NODE_ENV = 'test';
process.env.PORT = '4031';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');

const shoppingListRepository = require('../src/modules/shopping-lists/shopping-list.repository');
const ingredientService = require('../src/modules/ingredients/ingredient.service');
const recipeService = require('../src/modules/recipes/recipe.service');
const shoppingListService = require('../src/modules/shopping-lists/shopping-list.service');
const ShoppingList = require('../src/modules/shopping-lists/shopping-list.model');
const { AppError } = require('../src/shared/errors/app-error');

const USER_ID = '507f1f77bcf86cd799439001';
const CHICKEN_ID = '507f1f77bcf86cd799439011';
const GARLIC_ID = '507f1f77bcf86cd799439012';
const SALT_ID = '507f1f77bcf86cd799439013';
const RECIPE_ID = '507f1f77bcf86cd799439099';

function buildList(items = []) {
  return new ShoppingList({ userId: USER_ID, items });
}

function activeIngredient(id, name = 'Ingredient') {
  return { _id: id, name, isActive: true };
}

// Every service function ends by resolving each item's Ingredient through
// IngredientService (shopping-list.service.js#resolveIngredientsById) to
// build the safe response — mock it as "everything is active" by default
// unless a test cares about a specific/stale ingredient.
function mockAllIngredientsActive(t) {
  t.mock.method(ingredientService, 'findIngredientById', async (id) => activeIngredient(id));
}

function mockNoSave(t) {
  t.mock.method(shoppingListRepository, 'save', async (list) => list);
}

test('getShoppingList lazily gets/creates exactly one list for the given user', async (t) => {
  let capturedUserId;
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async (userId) => {
    capturedUserId = userId;
    return buildList();
  });
  mockAllIngredientsActive(t);

  const result = await shoppingListService.getShoppingList(USER_ID);

  assert.equal(capturedUserId, USER_ID);
  assert.deepEqual(result.shoppingList.items.toObject(), []);
});

test('addItem rejects when the ingredient does not exist', async (t) => {
  t.mock.method(ingredientService, 'findIngredientById', async () => null);

  await assert.rejects(
    () => shoppingListService.addItem(USER_ID, { ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg' }),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'INGREDIENT_NOT_FOUND');
      return true;
    }
  );
});

test('addItem rejects an inactive ingredient', async (t) => {
  t.mock.method(ingredientService, 'findIngredientById', async (id) => ({ _id: id, name: 'X', isActive: false }));

  await assert.rejects(
    () => shoppingListService.addItem(USER_ID, { ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg' }),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'INGREDIENT_INACTIVE');
      return true;
    }
  );
});

test('addItem adds a new item to an empty list', async (t) => {
  mockAllIngredientsActive(t);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => buildList());
  mockNoSave(t);

  const result = await shoppingListService.addItem(USER_ID, {
    ingredientId: CHICKEN_ID,
    quantity: 1,
    unit: 'kg',
  });

  assert.equal(result.shoppingList.items.length, 1);
  assert.equal(result.shoppingList.items[0].quantity, 1);
  assert.equal(result.shoppingList.items[0].unit, 'kg');
});

test('addItem merges into an existing same-ingredient+same-unit item, summing quantity', async (t) => {
  mockAllIngredientsActive(t);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () =>
    buildList([{ ingredientId: GARLIC_ID, quantity: 3, unit: 'clove', isChecked: true }])
  );
  mockNoSave(t);

  const result = await shoppingListService.addItem(USER_ID, {
    ingredientId: GARLIC_ID,
    quantity: 2,
    unit: 'clove',
  });

  assert.equal(result.shoppingList.items.length, 1);
  assert.equal(result.shoppingList.items[0].quantity, 5);
});

test('addItem resets isChecked to false when merging in additional quantity', async (t) => {
  mockAllIngredientsActive(t);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () =>
    buildList([{ ingredientId: GARLIC_ID, quantity: 3, unit: 'clove', isChecked: true }])
  );
  mockNoSave(t);

  const result = await shoppingListService.addItem(USER_ID, {
    ingredientId: GARLIC_ID,
    quantity: 2,
    unit: 'clove',
  });

  assert.equal(result.shoppingList.items[0].isChecked, false);
});

test('addItem keeps different units of the same ingredient as separate items (no conversion)', async (t) => {
  mockAllIngredientsActive(t);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () =>
    buildList([{ ingredientId: GARLIC_ID, quantity: 0.5, unit: 'cup' }])
  );
  mockNoSave(t);

  const result = await shoppingListService.addItem(USER_ID, {
    ingredientId: GARLIC_ID,
    quantity: 2,
    unit: 'tbsp',
  });

  assert.equal(result.shoppingList.items.length, 2);
});

test('addItem deduplicates a repeated toTaste add for the same ingredient into one item', async (t) => {
  mockAllIngredientsActive(t);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () =>
    buildList([{ ingredientId: SALT_ID, unit: 'toTaste', isChecked: true }])
  );
  mockNoSave(t);

  const result = await shoppingListService.addItem(USER_ID, { ingredientId: SALT_ID, unit: 'toTaste' });

  assert.equal(result.shoppingList.items.length, 1);
  assert.equal(result.shoppingList.items[0].quantity, undefined);
  assert.equal(result.shoppingList.items[0].isChecked, false);
});

test('addItem enforces the 200-item maximum and does not save when exceeded', async (t) => {
  mockAllIngredientsActive(t);
  const existingItems = Array.from({ length: ShoppingList.MAX_ITEMS }, (_, i) => ({
    ingredientId: `507f1f77bcf86cd7994${String(40000 + i).padStart(5, '0')}`,
    quantity: 1,
    unit: 'piece',
  }));
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => buildList(existingItems));
  let saveCalled = false;
  t.mock.method(shoppingListRepository, 'save', async (list) => {
    saveCalled = true;
    return list;
  });

  await assert.rejects(
    () => shoppingListService.addItem(USER_ID, { ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg' }),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'SHOPPING_LIST_LIMIT_EXCEEDED');
      return true;
    }
  );
  assert.equal(saveCalled, false);
});

test('patchItem updates quantity in place', async (t) => {
  mockAllIngredientsActive(t);
  const list = buildList([{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg' }]);
  const itemId = String(list.items[0]._id);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  mockNoSave(t);

  const result = await shoppingListService.patchItem(USER_ID, itemId, { quantity: 4 });

  assert.equal(result.shoppingList.items[0].quantity, 4);
});

test('patchItem updates isChecked independently of quantity/unit', async (t) => {
  mockAllIngredientsActive(t);
  const list = buildList([{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', isChecked: false }]);
  const itemId = String(list.items[0]._id);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  mockNoSave(t);

  const result = await shoppingListService.patchItem(USER_ID, itemId, { isChecked: true });

  assert.equal(result.shoppingList.items[0].isChecked, true);
  assert.equal(result.shoppingList.items[0].quantity, 1);
});

test('patchItem allows a valid transition to toTaste when quantity is explicitly cleared', async (t) => {
  mockAllIngredientsActive(t);
  const list = buildList([{ ingredientId: CHICKEN_ID, quantity: 2, unit: 'piece' }]);
  const itemId = String(list.items[0]._id);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  mockNoSave(t);

  const result = await shoppingListService.patchItem(USER_ID, itemId, { unit: 'toTaste', quantity: null });

  assert.equal(result.shoppingList.items[0].unit, 'toTaste');
  assert.equal(result.shoppingList.items[0].quantity, undefined);
});

test('patchItem rejects switching to toTaste while leaving a stale quantity in place', async (t) => {
  mockAllIngredientsActive(t);
  const list = buildList([{ ingredientId: CHICKEN_ID, quantity: 2, unit: 'piece' }]);
  const itemId = String(list.items[0]._id);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  mockNoSave(t);

  await assert.rejects(
    () => shoppingListService.patchItem(USER_ID, itemId, { unit: 'toTaste' }),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    }
  );
});

test('patchItem allows a valid transition from toTaste to a measurable unit with a positive quantity', async (t) => {
  mockAllIngredientsActive(t);
  const list = buildList([{ ingredientId: SALT_ID, unit: 'toTaste' }]);
  const itemId = String(list.items[0]._id);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  mockNoSave(t);

  const result = await shoppingListService.patchItem(USER_ID, itemId, { unit: 'piece', quantity: 3 });

  assert.equal(result.shoppingList.items[0].unit, 'piece');
  assert.equal(result.shoppingList.items[0].quantity, 3);
});

test('patchItem rejects switching away from toTaste without supplying a quantity', async (t) => {
  mockAllIngredientsActive(t);
  const list = buildList([{ ingredientId: SALT_ID, unit: 'toTaste' }]);
  const itemId = String(list.items[0]._id);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  mockNoSave(t);

  await assert.rejects(
    () => shoppingListService.patchItem(USER_ID, itemId, { unit: 'piece' }),
    (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    }
  );
});

test('patchItem rejects a unit change that collides with another existing item\'s ingredientId+unit', async (t) => {
  mockAllIngredientsActive(t);
  const list = buildList([
    { ingredientId: GARLIC_ID, quantity: 2, unit: 'piece' },
    { ingredientId: GARLIC_ID, quantity: 3, unit: 'clove' },
  ]);
  const cloveItemId = String(list.items[1]._id);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  mockNoSave(t);

  await assert.rejects(
    () => shoppingListService.patchItem(USER_ID, cloveItemId, { unit: 'piece' }),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, 'SHOPPING_LIST_ITEM_ALREADY_EXISTS');
      return true;
    }
  );
});

test('patchItem throws SHOPPING_LIST_ITEM_NOT_FOUND for a missing item', async (t) => {
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => buildList());

  await assert.rejects(
    () => shoppingListService.patchItem(USER_ID, '507f1f77bcf86cd799439fff', { isChecked: true }),
    (err) => {
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'SHOPPING_LIST_ITEM_NOT_FOUND');
      return true;
    }
  );
});

test('removeItem physically removes the item', async (t) => {
  const list = buildList([{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg' }]);
  const itemId = String(list.items[0]._id);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  mockNoSave(t);

  const result = await shoppingListService.removeItem(USER_ID, itemId);

  assert.equal(result.shoppingList.items.length, 0);
});

test('removeItem throws SHOPPING_LIST_ITEM_NOT_FOUND for a missing item', async (t) => {
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => buildList());

  await assert.rejects(
    () => shoppingListService.removeItem(USER_ID, '507f1f77bcf86cd799439fff'),
    (err) => {
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'SHOPPING_LIST_ITEM_NOT_FOUND');
      return true;
    }
  );
});

test('removeItem succeeds even when the item\'s ingredient is stale/archived (no IngredientService call needed to remove)', async (t) => {
  const list = buildList([{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg' }]);
  const itemId = String(list.items[0]._id);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  mockNoSave(t);

  const result = await shoppingListService.removeItem(USER_ID, itemId);
  assert.equal(result.shoppingList.items.length, 0);
});

test('clearItems empties the list', async (t) => {
  const list = buildList([
    { ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg' },
    { ingredientId: GARLIC_ID, quantity: 2, unit: 'clove' },
  ]);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  mockNoSave(t);

  const result = await shoppingListService.clearItems(USER_ID);

  assert.equal(result.shoppingList.items.length, 0);
});

test('a stale item whose Ingredient no longer exists still resolves safely (ingredient: null, historical ingredientId kept)', async (t) => {
  const STALE_ID = '507f1f77bcf86cd799439fee';
  const list = buildList([{ ingredientId: STALE_ID, quantity: 1, unit: 'kg' }]);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  t.mock.method(ingredientService, 'findIngredientById', async () => null);

  const result = await shoppingListService.getShoppingList(USER_ID);

  assert.equal(result.ingredientsById.get(STALE_ID), null);
});

test('an archived Ingredient (still exists, isActive: false) is reported as unavailable', async (t) => {
  const list = buildList([{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg' }]);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  t.mock.method(ingredientService, 'findIngredientById', async (id) => ({ _id: id, name: 'X', isActive: false }));

  const result = await shoppingListService.getShoppingList(USER_ID);

  assert.equal(result.ingredientsById.get(String(CHICKEN_ID)).isActive, false);
});

// --- Recipe import ---

// Matches RecipeService.findUsableRecipeById's actual cross-module contract
// shape (recipe.service.js#toUsageSummary): { ingredient: { id, name },
// quantity, unit, optional } — deliberately NOT the internal
// { ingredientId: <populated ref> } shape Recipe uses for its own HTTP
// serialization pipeline. Keeping this helper in sync with the real
// contract is what catches drift between the two, which a test that only
// mocks RecipeService can otherwise hide.
function usage(id, name, extra = {}) {
  return { ingredient: { id, name }, ...extra };
}

function usableRecipe(ingredients) {
  return { _id: RECIPE_ID, ingredients };
}

test('addRecipeIngredients rejects an unusable/archived recipe', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => null);

  await assert.rejects(
    () => shoppingListService.addRecipeIngredients(USER_ID, RECIPE_ID),
    (err) => {
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'RECIPE_NOT_FOUND');
      return true;
    }
  );
});

test('addRecipeIngredients propagates an unexpected RecipeService/database failure as-is, never as RECIPE_NOT_FOUND', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => {
    throw new Error('ECONNRESET: mongo connection lost');
  });

  await assert.rejects(
    () => shoppingListService.addRecipeIngredients(USER_ID, RECIPE_ID),
    (err) => {
      assert.equal(err instanceof AppError, false);
      assert.equal(err.message, 'ECONNRESET: mongo connection lost');
      return true;
    }
  );
});

test('addRecipeIngredients adds the recipe\'s usable ingredient usages to an empty list', async (t) => {
  mockAllIngredientsActive(t);
  t.mock.method(recipeService, 'findUsableRecipeById', async () =>
    usableRecipe([
      usage(CHICKEN_ID, 'Chicken', { quantity: 1, unit: 'kg', optional: false }),
      usage(GARLIC_ID, 'Garlic', { quantity: 3, unit: 'clove', optional: true }),
    ])
  );
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => buildList());
  mockNoSave(t);

  const result = await shoppingListService.addRecipeIngredients(USER_ID, RECIPE_ID);

  assert.equal(result.shoppingList.items.length, 2);
});

test('addRecipeIngredients merges a same-ingredient+same-unit recipe usage into an existing list item', async (t) => {
  mockAllIngredientsActive(t);
  t.mock.method(recipeService, 'findUsableRecipeById', async () =>
    usableRecipe([usage(CHICKEN_ID, 'Chicken', { quantity: 2, unit: 'kg', optional: false })])
  );
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () =>
    buildList([{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg' }])
  );
  mockNoSave(t);

  const result = await shoppingListService.addRecipeIngredients(USER_ID, RECIPE_ID);

  assert.equal(result.shoppingList.items.length, 1);
  assert.equal(result.shoppingList.items[0].quantity, 3);
});

test('addRecipeIngredients keeps a different-unit usage of the same ingredient as a separate item', async (t) => {
  mockAllIngredientsActive(t);
  t.mock.method(recipeService, 'findUsableRecipeById', async () =>
    usableRecipe([usage(CHICKEN_ID, 'Chicken', { quantity: 200, unit: 'g', optional: false })])
  );
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () =>
    buildList([{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg' }])
  );
  mockNoSave(t);

  const result = await shoppingListService.addRecipeIngredients(USER_ID, RECIPE_ID);

  assert.equal(result.shoppingList.items.length, 2);
});

test('addRecipeIngredients handles a toTaste recipe usage by keeping a single item', async (t) => {
  mockAllIngredientsActive(t);
  t.mock.method(recipeService, 'findUsableRecipeById', async () =>
    usableRecipe([usage(SALT_ID, 'Salt', { unit: 'toTaste', optional: false })])
  );
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () =>
    buildList([{ ingredientId: SALT_ID, unit: 'toTaste' }])
  );
  mockNoSave(t);

  const result = await shoppingListService.addRecipeIngredients(USER_ID, RECIPE_ID);

  assert.equal(result.shoppingList.items.length, 1);
});

test('addRecipeIngredients includes an active optional ingredient usage exactly like a required one', async (t) => {
  mockAllIngredientsActive(t);
  t.mock.method(recipeService, 'findUsableRecipeById', async () =>
    usableRecipe([usage(GARLIC_ID, 'Garlic', { quantity: 1, unit: 'clove', optional: true })])
  );
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => buildList());
  mockNoSave(t);

  const result = await shoppingListService.addRecipeIngredients(USER_ID, RECIPE_ID);

  assert.equal(result.shoppingList.items.length, 1);
  assert.equal(result.shoppingList.items[0].unit, 'clove');
});

test('addRecipeIngredients enforces the 200-item maximum on the merged result', async (t) => {
  mockAllIngredientsActive(t);
  const existingItems = Array.from({ length: ShoppingList.MAX_ITEMS }, (_, i) => ({
    ingredientId: `507f1f77bcf86cd7994${String(50000 + i).padStart(5, '0')}`,
    quantity: 1,
    unit: 'piece',
  }));
  t.mock.method(recipeService, 'findUsableRecipeById', async () =>
    usableRecipe([usage(CHICKEN_ID, 'Chicken', { quantity: 1, unit: 'kg', optional: false })])
  );
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => buildList(existingItems));
  let saveCalled = false;
  t.mock.method(shoppingListRepository, 'save', async (list) => {
    saveCalled = true;
    return list;
  });

  await assert.rejects(
    () => shoppingListService.addRecipeIngredients(USER_ID, RECIPE_ID),
    (err) => {
      assert.equal(err.code, 'SHOPPING_LIST_LIMIT_EXCEEDED');
      return true;
    }
  );
  assert.equal(saveCalled, false);
});

test('addRecipeIngredients succeeds at exactly the 200-item boundary when merges keep the final count from exceeding it', async (t) => {
  // 199 existing items. The recipe contributes 6 usages: 5 merge into
  // existing entries (no net growth) and 1 is genuinely new — so the final
  // merged count is exactly 200, not 199 + 6 = 205. The limit must be
  // checked against the final merged result, not existing.length + the
  // number of incoming usages.
  mockAllIngredientsActive(t);
  const mergeableIds = Array.from({ length: 5 }, (_, i) => `507f1f77bcf86cd7994${String(60000 + i).padStart(5, '0')}`);
  const filler = Array.from({ length: 194 }, (_, i) => ({
    ingredientId: `507f1f77bcf86cd7994${String(70000 + i).padStart(5, '0')}`,
    quantity: 1,
    unit: 'piece',
  }));
  const existingItems = [
    ...filler,
    ...mergeableIds.map((id) => ({ ingredientId: id, quantity: 1, unit: 'piece' })),
  ];
  assert.equal(existingItems.length, 199);

  t.mock.method(recipeService, 'findUsableRecipeById', async () =>
    usableRecipe([
      ...mergeableIds.map((id) => usage(id, 'Ingredient', { quantity: 1, unit: 'piece', optional: false })),
      usage(CHICKEN_ID, 'Chicken', { quantity: 1, unit: 'kg', optional: false }),
    ])
  );
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => buildList(existingItems));
  mockNoSave(t);

  const result = await shoppingListService.addRecipeIngredients(USER_ID, RECIPE_ID);

  assert.equal(result.shoppingList.items.length, 200);
  // Each of the 5 mergeable ids summed to quantity 2; the 1 new item exists once more.
  assert.equal(result.shoppingList.items.filter((item) => item.quantity === 2).length, 5);
});

test('addRecipeIngredients saves the ShoppingList document exactly once for a multi-ingredient import', async (t) => {
  mockAllIngredientsActive(t);
  t.mock.method(recipeService, 'findUsableRecipeById', async () =>
    usableRecipe([
      usage(CHICKEN_ID, 'Chicken', { quantity: 1, unit: 'kg', optional: false }),
      usage(GARLIC_ID, 'Garlic', { quantity: 3, unit: 'clove', optional: false }),
      usage(SALT_ID, 'Salt', { unit: 'toTaste', optional: false }),
    ])
  );
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => buildList());
  let saveCount = 0;
  t.mock.method(shoppingListRepository, 'save', async (list) => {
    saveCount += 1;
    return list;
  });

  await shoppingListService.addRecipeIngredients(USER_ID, RECIPE_ID);

  assert.equal(saveCount, 1);
});

// --- Infrastructure-failure propagation (must never be masked as a domain result) ---

test('getShoppingList propagates an unexpected IngredientService/database failure instead of treating it as a stale ingredient', async (t) => {
  const list = buildList([{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg' }]);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  t.mock.method(ingredientService, 'findIngredientById', async () => {
    throw new Error('mongo timeout');
  });

  await assert.rejects(
    () => shoppingListService.getShoppingList(USER_ID),
    (err) => {
      assert.equal(err instanceof AppError, false);
      assert.equal(err.message, 'mongo timeout');
      return true;
    }
  );
});

test('addItem propagates an unexpected IngredientService/database failure instead of INGREDIENT_NOT_FOUND', async (t) => {
  t.mock.method(ingredientService, 'findIngredientById', async () => {
    throw new Error('mongo timeout');
  });

  await assert.rejects(
    () => shoppingListService.addItem(USER_ID, { ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg' }),
    (err) => {
      assert.equal(err instanceof AppError, false);
      assert.equal(err.message, 'mongo timeout');
      return true;
    }
  );
});