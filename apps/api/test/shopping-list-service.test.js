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
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => buildList());
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
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => buildList());
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

test('addItem preserves canonical lb/oz values without conversion', async (t) => {
  mockAllIngredientsActive(t);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => buildList());
  mockNoSave(t);

  for (const [unit, quantity] of [['lb', 0.75], ['oz', 8]]) {
    const result = await shoppingListService.addItem(USER_ID, { ingredientId: CHICKEN_ID, quantity, unit });
    assert.equal(result.shoppingList.items[0].unit, unit);
    assert.equal(result.shoppingList.items[0].quantity, quantity);
  }
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
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => buildList());
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
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => buildList());
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

test('addRecipeIngredients preserves canonical lb/oz values without conversion', async (t) => {
  mockAllIngredientsActive(t);
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe([
    usage(CHICKEN_ID, 'Chicken', { quantity: 0.75, unit: 'lb', optional: false }),
    usage(GARLIC_ID, 'Garlic', { quantity: 8, unit: 'oz', optional: false }),
  ]));
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => buildList());
  mockNoSave(t);

  const result = await shoppingListService.addRecipeIngredients(USER_ID, RECIPE_ID);
  assert.deepEqual(result.shoppingList.items.map(({ quantity, unit }) => ({ quantity, unit })), [
    { quantity: 0.75, unit: 'lb' }, { quantity: 8, unit: 'oz' },
  ]);
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
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => buildList());
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

function versionError(list) {
  return new ShoppingList.base.Error.VersionError(list, list.__v ?? 0, ['items']);
}

test('clearCheckedItems removes only checked rows from one authoritative snapshot', async (t) => {
  mockAllIngredientsActive(t);
  const list = buildList([
    { ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', isChecked: true },
    { ingredientId: GARLIC_ID, quantity: 2, unit: 'clove', isChecked: false },
    { ingredientId: SALT_ID, unit: 'toTaste', isChecked: true },
  ]);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  const save = t.mock.method(shoppingListRepository, 'save', async (value) => value);

  const result = await shoppingListService.clearCheckedItems(USER_ID);

  assert.deepEqual(result.shoppingList.items.map((row) => String(row.ingredientId)), [GARLIC_ID]);
  assert.equal(save.mock.callCount(), 1);
});

test('clearCheckedItems removes all checked rows and returns an empty list', async (t) => {
  const list = buildList([
    { ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', isChecked: true },
    { ingredientId: SALT_ID, unit: 'toTaste', isChecked: true },
  ]);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  mockNoSave(t);

  const result = await shoppingListService.clearCheckedItems(USER_ID);

  assert.equal(result.shoppingList.items.length, 0);
});

test('clearCheckedItems zero-checked succeeds through an OCC write without deleting unrelated items', async (t) => {
  mockAllIngredientsActive(t);
  const list = buildList([
    { ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', isChecked: false },
  ]);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  const save = t.mock.method(shoppingListRepository, 'save', async (value) => {
    assert.equal(value.isModified('items'), true);
    return value;
  });

  const result = await shoppingListService.clearCheckedItems(USER_ID);

  assert.equal(result.shoppingList.items.length, 1);
  assert.equal(String(result.shoppingList.items[0].ingredientId), CHICKEN_ID);
  assert.equal(result.shoppingList.items[0].isChecked, false);
  assert.equal(save.mock.callCount(), 1);
});

test('clearCheckedItems zero-checked emits an atomic version predicate and returns its authoritative snapshot', async (t) => {
  mockAllIngredientsActive(t);
  const list = ShoppingList.hydrate({
    _id: '507f1f77bcf86cd799439101',
    userId: USER_ID,
    items: [{
      _id: '507f1f77bcf86cd799439111',
      ingredientId: CHICKEN_ID,
      quantity: 1,
      unit: 'kg',
      isChecked: false,
    }],
    __v: 7,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  const stored = {
    __v: 7,
    items: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', isChecked: false }],
  };
  const updateOne = t.mock.method(ShoppingList.collection, 'updateOne', async (filter, update) => {
    assert.equal(String(filter._id), String(list._id));
    assert.equal(filter.__v, 7);
    assert.equal(update.$inc.__v, 1);
    assert.equal(update.$set.items.length, 1);
    assert.equal(String(update.$set.items[0].ingredientId), CHICKEN_ID);
    assert.equal(update.$set.items[0].isChecked, false);
    // The compare-and-swap matches and is the Clear Checked linearization
    // point. A second writer may then commit legitimately before this request
    // serializes its response; that later write must not invalidate success.
    stored.items = update.$set.items.map((item) => ({ ...item }));
    stored.__v += update.$inc.__v;
    stored.items.push({ ingredientId: GARLIC_ID, quantity: 2, unit: 'clove', isChecked: false });
    stored.__v += 1;
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  });

  const result = await shoppingListService.clearCheckedItems(USER_ID);

  assert.equal(updateOne.mock.callCount(), 1);
  assert.equal(result.shoppingList.__v, 8);
  assert.equal(result.shoppingList.items.length, 1);
  assert.equal(String(result.shoppingList.items[0].ingredientId), CHICKEN_ID);
  assert.equal(stored.__v, 9);
  assert.equal(stored.items.length, 2);
});

for (const concurrentMutation of [
  {
    name: 'check',
    apply(state) { state.items[0].isChecked = true; },
    assertPreserved(state) { assert.equal(state.items[0].isChecked, true); },
  },
  {
    name: 'add',
    apply(state) {
      state.items.push({ ingredientId: GARLIC_ID, quantity: 2, unit: 'clove', isChecked: false });
    },
    assertPreserved(state) { assert.equal(state.items.length, 2); },
  },
  {
    name: 'edit',
    apply(state) { state.items[0].quantity = 3; },
    assertPreserved(state) { assert.equal(state.items[0].quantity, 3); },
  },
]) {
  test(`clearCheckedItems zero-checked detects a concurrent ${concurrentMutation.name} at the atomic version check without retry`, async (t) => {
    const list = ShoppingList.hydrate({
      _id: '507f1f77bcf86cd799439102',
      userId: USER_ID,
      items: [{
        _id: '507f1f77bcf86cd799439112',
        ingredientId: CHICKEN_ID,
        quantity: 1,
        unit: 'kg',
        isChecked: false,
      }],
      __v: 11,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const stored = {
      __v: 11,
      items: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', isChecked: false }],
    };
    const find = t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
    const updateOne = t.mock.method(ShoppingList.collection, 'updateOne', async (filter) => {
      // Commit the competing mutation immediately before the real Mongoose
      // compare-and-swap generated by save(). The stale filter must miss.
      concurrentMutation.apply(stored);
      stored.__v += 1;
      assert.equal(filter.__v, 11);
      return { acknowledged: true, matchedCount: filter.__v === stored.__v ? 1 : 0, modifiedCount: 0 };
    });

    await assert.rejects(
      () => shoppingListService.clearCheckedItems(USER_ID),
      (err) => err instanceof AppError && err.statusCode === 409 && err.code === 'SHOPPING_LIST_STALE'
    );

    assert.equal(find.mock.callCount(), 1);
    assert.equal(updateOne.mock.callCount(), 1);
    assert.equal(stored.__v, 12);
    concurrentMutation.assertPreserved(stored);
  });
}

test('non-commutative VersionError maps to SHOPPING_LIST_STALE without retry', async (t) => {
  const list = buildList([
    { ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', isChecked: true },
  ]);
  const find = t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  const save = t.mock.method(shoppingListRepository, 'save', async () => {
    throw versionError(list);
  });

  await assert.rejects(
    () => shoppingListService.clearCheckedItems(USER_ID),
    (err) => err instanceof AppError && err.statusCode === 409 && err.code === 'SHOPPING_LIST_STALE'
  );
  assert.equal(find.mock.callCount(), 1);
  assert.equal(save.mock.callCount(), 1);
});

test('addItem retries exactly once after VersionError and reapplies the payload once to fresh state', async (t) => {
  mockAllIngredientsActive(t);
  const stale = buildList([]);
  const latest = buildList([
    { ingredientId: CHICKEN_ID, quantity: 10, unit: 'kg', isChecked: true },
  ]);
  const find = t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () =>
    find.mock.callCount() === 0 ? stale : latest
  );
  const save = t.mock.method(shoppingListRepository, 'save', async (value) => {
    if (save.mock.callCount() === 0) throw versionError(value);
    return value;
  });

  const result = await shoppingListService.addItem(USER_ID, {
    ingredientId: CHICKEN_ID, quantity: 2, unit: 'kg',
  });

  assert.equal(find.mock.callCount(), 2);
  assert.equal(save.mock.callCount(), 2);
  assert.equal(result.shoppingList.items[0].quantity, 12);
  assert.equal(result.shoppingList.items[0].isChecked, false);
});

test('addRecipeIngredients retries exactly once after VersionError and applies every usage once', async (t) => {
  const stale = buildList([]);
  const latest = buildList([
    { ingredientId: GARLIC_ID, quantity: 1, unit: 'clove', isChecked: false },
  ]);
  t.mock.method(recipeService, 'findUsableRecipeById', async () => ({
    ingredients: [
      { ingredient: { id: GARLIC_ID }, quantity: 2, unit: 'clove' },
      { ingredient: { id: SALT_ID }, quantity: null, unit: 'toTaste' },
    ],
  }));
  mockAllIngredientsActive(t);
  const find = t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () =>
    find.mock.callCount() === 0 ? stale : latest
  );
  const save = t.mock.method(shoppingListRepository, 'save', async (value) => {
    if (save.mock.callCount() === 0) throw versionError(value);
    return value;
  });

  const result = await shoppingListService.addRecipeIngredients(USER_ID, RECIPE_ID);

  assert.equal(find.mock.callCount(), 2);
  assert.equal(save.mock.callCount(), 2);
  assert.equal(result.shoppingList.items[0].quantity, 3);
  assert.equal(result.shoppingList.items.filter((row) => String(row.ingredientId) === SALT_ID).length, 1);
});

test('additive operations do not retry unknown save outcomes', async (t) => {
  mockAllIngredientsActive(t);
  const list = buildList([]);
  const find = t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  const unknown = new Error('connection reset after write');
  const save = t.mock.method(shoppingListRepository, 'save', async () => { throw unknown; });

  await assert.rejects(
    () => shoppingListService.addItem(USER_ID, {
      ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg',
    }),
    (err) => err === unknown
  );
  assert.equal(find.mock.callCount(), 1);
  assert.equal(save.mock.callCount(), 1);
});
test('SHOP5 v1 guard is checked before Ingredient lookup and blocks a mixed snapshot', async (t) => {
  const list = buildList([{ type: 'custom', label: 'Milk' }]);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  const ingredient = t.mock.method(ingredientService, 'findIngredientById', async () => activeIngredient(CHICKEN_ID));
  await assert.rejects(() => shoppingListService.addItem(USER_ID, {
    ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg',
  }), { statusCode: 426, code: 'SHOPPING_LIST_UPGRADE_REQUIRED' });
  assert.equal(ingredient.mock.callCount(), 0);
});

test('SHOP5 pre-insert v1 GET keeps its exact snapshot while the next read reaches 426', async (t) => {
  const initial = buildList([{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg' }]);
  const mixed = buildList([
    { ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg' },
    { type: 'custom', label: 'Milk' },
  ]);
  let current = initial;
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => current);
  let startLookup;
  const lookupStarted = new Promise((resolve) => { startLookup = resolve; });
  let finishLookup;
  const lookupResult = new Promise((resolve) => { finishLookup = resolve; });
  t.mock.method(ingredientService, 'findIngredientById', () => {
    startLookup();
    return lookupResult;
  });
  const early = shoppingListService.getShoppingList(USER_ID);
  await lookupStarted;
  current = mixed;
  finishLookup({ _id: CHICKEN_ID, name: 'Chicken', isActive: true });
  const { toPublicShoppingList } = require('../src/modules/shopping-lists/shopping-list.serializer');
  const publicEarly = toPublicShoppingList(await early);
  assert.equal(publicEarly.items.length, 1);
  assert.deepEqual(Object.keys(publicEarly.items[0]).sort(), [
    'category', 'id', 'ingredient', 'ingredientId', 'isAvailable', 'isChecked',
    'quantity', 'unit',
  ]);
  await assert.rejects(() => shoppingListService.getShoppingList(USER_ID), {
    statusCode: 426, code: 'SHOPPING_LIST_UPGRADE_REQUIRED',
  });
});

test('SHOP5 legacy missing type and origin project as Ingredient with legacy source', async (t) => {
  const list = buildList([{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg' }]);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  mockAllIngredientsActive(t);
  t.mock.method(recipeService, 'findConsumerVisibleShoppingSources', async () => new Map());
  const { toPublicShoppingListV2 } = require('../src/modules/shopping-lists/shopping-list.serializer');
  const row = toPublicShoppingListV2(await shoppingListService.getShoppingList(USER_ID, true)).items[0];
  assert.equal(row.type, 'ingredient');
  assert.deepEqual(row.source, { kind: 'legacy' });
  assert.equal(row.ingredientId, CHICKEN_ID);
});

test('SHOP5 unknown persisted row type fails closed', async (t) => {
  const list = buildList([{
    type: 'future', ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg',
  }]);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  await assert.rejects(() => shoppingListService.getShoppingList(USER_ID, true), {
    statusCode: 500, code: 'SHOPPING_LIST_INVALID',
  });
});

function hydratedShop5List(rows) {
  return ShoppingList.hydrate({
    _id: '507f1f77bcf86cd799439080', userId: USER_ID, __v: 0,
    items: rows.map((row, index) => ({
      _id: (index + 1000).toString(16).padStart(24, '0'), ...row,
    })),
  });
}

test('SHOP5 rejects malformed raw top-level items on both reads without repair', async (t) => {
  let current;
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => current);
  const save = t.mock.method(shoppingListRepository, 'save', async (list) => list);
  const lookup = t.mock.method(ingredientService, 'findIngredientById', async () => activeIngredient(CHICKEN_ID));
  for (const [name, raw] of [
    ['missing', {}],
    ['null', { items: null }],
    ['object', { items: {} }],
    ['string', { items: 'invalid' }],
    ['number', { items: 7 }],
  ]) {
    current = ShoppingList.hydrate({
      _id: '507f1f77bcf86cd799439080', userId: USER_ID, __v: 0, ...raw,
    });
    assert.equal(current.$locals.shoppingStoredItemsArray, false, name);
    const before = JSON.stringify(current.toObject());
    const modifiedBeforeRead = current.isModified('items');
    for (const v2 of [false, true]) {
      await assert.rejects(() => shoppingListService.getShoppingList(USER_ID, v2), {
        statusCode: 500, code: 'SHOPPING_LIST_INVALID',
      }, `${name}, v2=${v2}`);
    }
    assert.equal(JSON.stringify(current.toObject()), before, name);
    assert.equal(current.isModified('items'), modifiedBeforeRead, name);
  }
  assert.equal(save.mock.callCount(), 0);
  assert.equal(lookup.mock.callCount(), 0);
});

test('SHOP5 accepts persisted and newly constructed empty lists on both reads', async (t) => {
  let current;
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => current);
  for (const list of [
    ShoppingList.hydrate({ userId: USER_ID, __v: 0, items: [] }),
    new ShoppingList({ userId: USER_ID }),
  ]) {
    current = list;
    for (const v2 of [false, true]) {
      const result = await shoppingListService.getShoppingList(USER_ID, v2);
      assert.equal(result.shoppingList.items.length, 0);
    }
  }
});

test('SHOP5 accepts 200 stored rows but rejects 201 without changing the document', async (t) => {
  let current;
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => current);
  const save = t.mock.method(shoppingListRepository, 'save', async (list) => list);
  const rows = Array.from({ length: 200 }, (_, index) => ({
    type: 'custom', label: `Item ${index}`, isChecked: false,
  }));
  current = hydratedShop5List(rows);
  assert.equal(current.__v, 0);
  assert.equal((await shoppingListService.getShoppingList(USER_ID, true)).shoppingList.items.length, 200);
  current = hydratedShop5List([...rows, { type: 'custom', label: 'Last', isChecked: false }]);
  const before = JSON.stringify(current.toObject());
  await assert.rejects(() => shoppingListService.getShoppingList(USER_ID, true), {
    statusCode: 500, code: 'SHOPPING_LIST_INVALID',
  });
  await assert.rejects(() => shoppingListService.getShoppingList(USER_ID), {
    statusCode: 500, code: 'SHOPPING_LIST_INVALID',
  });
  assert.equal(JSON.stringify(current.toObject()), before);
  assert.equal(save.mock.callCount(), 0);
});

test('SHOP5 fails closed on malformed hydrated rows before either wire format is built', async (t) => {
  let current;
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => current);
  const save = t.mock.method(shoppingListRepository, 'save', async (list) => list);
  const lookup = t.mock.method(ingredientService, 'findIngredientById', async () => activeIngredient(CHICKEN_ID));
  const validIngredient = { ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', isChecked: false };
  for (const malformed of [
    { type: 'custom', label: 'Milk' },
    { type: 'custom', label: 'Milk', isChecked: null },
    { type: 'custom', label: 'Milk', isChecked: 'invalid' },
    { type: 'custom', label: 'Milk', isChecked: 1 },
    { _id: null, type: 'custom', label: 'Milk', isChecked: false },
    { type: 'custom', label: 'Milk', isChecked: false, ingredientId: null },
    { type: 'custom', label: 'Milk', isChecked: false, sourceRecipeIds: null },
    { ingredientId: null, quantity: 1, unit: 'kg', isChecked: false },
    { ingredientId: CHICKEN_ID, quantity: 1, isChecked: false },
    { ingredientId: CHICKEN_ID, quantity: -1, unit: 'kg', isChecked: false },
    { ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', isChecked: false,
      originKind: 'recipe' },
    { ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', isChecked: false,
      sourceRecipeIds: [] },
    { ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', isChecked: false,
      originKind: 'recipe', sourceRecipeIds: ['not-an-id'], quantityEdited: false },
  ]) {
    current = hydratedShop5List([validIngredient, malformed]);
    const before = JSON.stringify(current.toObject());
    for (const v2 of [false, true]) {
      await assert.rejects(() => shoppingListService.getShoppingList(USER_ID, v2), {
        statusCode: 500, code: 'SHOPPING_LIST_INVALID',
      });
    }
    assert.equal(JSON.stringify(current.toObject()), before);
  }
  assert.equal(lookup.mock.callCount(), 0);
  assert.equal(save.mock.callCount(), 0);
});

test('SHOP5 accepts a hydrated legacy Ingredient and a valid sourced Recipe row', async (t) => {
  const list = hydratedShop5List([
    { ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', isChecked: false },
    { type: 'ingredient', ingredientId: GARLIC_ID, quantity: 2, unit: 'piece',
      isChecked: true, originKind: 'recipe', sourceRecipeIds: [RECIPE_ID], quantityEdited: false },
  ]);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  mockAllIngredientsActive(t);
  t.mock.method(recipeService, 'findConsumerVisibleShoppingSources', async () => new Map([
    [RECIPE_ID, { id: RECIPE_ID, title: 'Recipe A' }],
  ]));
  const result = await shoppingListService.getShoppingList(USER_ID, true);
  assert.equal((await shoppingListService.getShoppingList(USER_ID)).shoppingList.items.length, 2);
  assert.equal(result.shoppingList.__v, 0);
  const { toPublicShoppingListV2 } = require('../src/modules/shopping-lists/shopping-list.serializer');
  assert.deepEqual(toPublicShoppingListV2(result).items.map((item) => item.source), [
    { kind: 'legacy' }, { kind: 'single', title: 'Recipe A', quantityEdited: false },
  ]);
});

test('SHOP5 v1 additive retry rechecks the winning custom row', async (t) => {
  const old = buildList();
  old.__v = 0;
  const winning = buildList([{ type: 'custom', label: 'Milk' }]);
  winning.__v = 1;
  let reads = 0;
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => ++reads === 1 ? old : winning);
  mockAllIngredientsActive(t);
  const save = t.mock.method(shoppingListRepository, 'save', async () => { throw versionError(old); });
  await assert.rejects(() => shoppingListService.addItem(USER_ID, {
    ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg',
  }), { statusCode: 426, code: 'SHOPPING_LIST_UPGRADE_REQUIRED' });
  assert.equal(save.mock.callCount(), 1);
  assert.equal(winning.items.length, 1);
  assert.equal(winning.items[0].label, 'Milk');
});

test('SHOP5 v1 Recipe import retry rechecks the winning custom row', async (t) => {
  const old = buildList();
  old.__v = 0;
  const winning = buildList([{ type: 'custom', label: 'Milk' }]);
  let reads = 0;
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => ++reads === 1 ? old : winning);
  t.mock.method(recipeService, 'findUsableRecipeById', async () => ({
    ingredients: [{ ingredient: { id: CHICKEN_ID }, quantity: 1, unit: 'kg' }],
  }));
  const save = t.mock.method(shoppingListRepository, 'save', async () => { throw versionError(old); });
  await assert.rejects(() => shoppingListService.addRecipeIngredients(USER_ID, RECIPE_ID), {
    statusCode: 426, code: 'SHOPPING_LIST_UPGRADE_REQUIRED',
  });
  assert.equal(save.mock.callCount(), 1);
  assert.equal(winning.items.length, 1);
});

test('SHOP5 no-op toTaste add still enters OCC and rechecks a winning custom row', async (t) => {
  const old = ShoppingList.hydrate(buildList([
    { ingredientId: CHICKEN_ID, unit: 'toTaste', isChecked: false },
  ]).toObject());
  old.__v = 0;
  assert.equal(old.isModified('items'), false);
  const winning = buildList([{ type: 'custom', label: 'Milk' }]);
  let reads = 0;
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => ++reads === 1 ? old : winning);
  mockAllIngredientsActive(t);
  const save = t.mock.method(shoppingListRepository, 'save', async (list) => {
    assert.equal(list.isModified('items'), true);
    throw versionError(list);
  });
  await assert.rejects(() => shoppingListService.addItem(USER_ID, {
    ingredientId: CHICKEN_ID, unit: 'toTaste',
  }), { statusCode: 426, code: 'SHOPPING_LIST_UPGRADE_REQUIRED' });
  assert.equal(save.mock.callCount(), 1);
});

test('SHOP5 repeated checkbox value still enters versioned persistence', async (t) => {
  const list = ShoppingList.hydrate(buildList([
    { ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', isChecked: false },
  ]).toObject());
  list.__v = 0;
  assert.equal(list.isModified('items'), false);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  const save = t.mock.method(shoppingListRepository, 'save', async (doc) => {
    assert.equal(doc.isModified('items'), true);
    throw versionError(doc);
  });
  await assert.rejects(() => shoppingListService.patchItem(
    USER_ID, String(list.items[0]._id), { isChecked: false }
  ), { statusCode: 409, code: 'SHOPPING_LIST_STALE' });
  assert.equal(save.mock.callCount(), 1);
});

test('SHOP5 empty Clear All still performs an OCC write at version zero', async (t) => {
  const list = ShoppingList.hydrate(buildList().toObject());
  list.__v = 0;
  assert.equal(list.isModified('items'), false);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  const save = t.mock.method(shoppingListRepository, 'save', async (doc) => {
    assert.equal(doc.isModified('items'), true);
    throw versionError(doc);
  });
  await assert.rejects(() => shoppingListService.clearItems(USER_ID), {
    statusCode: 409, code: 'SHOPPING_LIST_STALE',
  });
  assert.equal(save.mock.callCount(), 1);
});

test('SHOP5 Recipe import records mixed history and projects current visible title', async (t) => {
  const list = buildList([{ type: 'ingredient', ingredientId: CHICKEN_ID,
    quantity: 9, unit: 'kg', originKind: 'manual' }]);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  t.mock.method(recipeService, 'findUsableRecipeById', async () => ({
    _id: RECIPE_ID, ingredients: [{ ingredient: { id: CHICKEN_ID }, quantity: 1, unit: 'kg' }],
  }));
  const visible = t.mock.method(recipeService, 'findConsumerVisibleShoppingSources', async () =>
    new Map([[RECIPE_ID, { id: RECIPE_ID, title: 'Recipe A' }]]));
  mockAllIngredientsActive(t);
  mockNoSave(t);
  const result = await shoppingListService.addRecipeIngredients(USER_ID, RECIPE_ID, true);
  const { toPublicShoppingListV2 } = require('../src/modules/shopping-lists/shopping-list.serializer');
  const row = toPublicShoppingListV2(result).items[0];
  assert.equal(row.quantity, 10);
  assert.deepEqual(row.source, { kind: 'single', title: 'Recipe A', quantityEdited: true });
  assert.equal(visible.mock.callCount(), 1);
  assert.deepEqual(visible.mock.calls[0].arguments[0], [RECIPE_ID]);
});

test('SHOP5 two distinct Recipe imports retain multiple:false until a manual edit', async (t) => {
  const secondId = '507f1f77bcf86cd799439098';
  const list = buildList();
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  mockNoSave(t);
  mockAllIngredientsActive(t);
  t.mock.method(recipeService, 'findUsableRecipeById', async () => ({
    ingredients: [{ ingredient: { id: CHICKEN_ID }, quantity: 1, unit: 'kg' }],
  }));
  t.mock.method(recipeService, 'findConsumerVisibleShoppingSources', async () => new Map([
    [RECIPE_ID, { id: RECIPE_ID, title: 'Recipe A' }],
    [secondId, { id: secondId, title: 'Recipe B' }],
  ]));
  await shoppingListService.addRecipeIngredients(USER_ID, RECIPE_ID, true);
  const result = await shoppingListService.addRecipeIngredients(USER_ID, secondId, true);
  const { toPublicShoppingListV2 } = require('../src/modules/shopping-lists/shopping-list.serializer');
  assert.deepEqual(toPublicShoppingListV2(result).items[0].source,
    { kind: 'multiple', quantityEdited: false });
  assert.equal(result.shoppingList.items[0].quantity, 2);
  assert.deepEqual(result.shoppingList.items[0].sourceRecipeIds.map(String), [RECIPE_ID, secondId]);
});

test('SHOP5 source projection hides all titles if any historical Recipe is unavailable', async (t) => {
  const secondId = '507f1f77bcf86cd799439098';
  const hiddenId = '507f1f77bcf86cd799439097';
  const anotherHiddenId = '507f1f77bcf86cd799439096';
  const row = (ingredientId, sourceRecipeIds) => ({
    type: 'ingredient', ingredientId, quantity: 1, unit: 'kg',
    originKind: 'recipe', sourceRecipeIds, quantityEdited: false,
  });
  const list = buildList([
    row(CHICKEN_ID, [RECIPE_ID]),
    row(GARLIC_ID, [RECIPE_ID, secondId]),
    row(SALT_ID, [RECIPE_ID, hiddenId]),
    row('507f1f77bcf86cd799439014', [hiddenId, anotherHiddenId]),
  ]);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  mockAllIngredientsActive(t);
  t.mock.method(recipeService, 'findConsumerVisibleShoppingSources', async () => new Map([
    [RECIPE_ID, { id: RECIPE_ID, title: 'Recipe A' }],
    [secondId, { id: secondId, title: 'Recipe B' }],
  ]));
  const { toPublicShoppingListV2 } = require('../src/modules/shopping-lists/shopping-list.serializer');
  const publicRows = toPublicShoppingListV2(await shoppingListService.getShoppingList(USER_ID, true)).items;
  assert.deepEqual(publicRows.map((entry) => entry.source), [
    { kind: 'single', title: 'Recipe A', quantityEdited: false },
    { kind: 'multiple', quantityEdited: false },
    { kind: 'unavailable', quantityEdited: false },
    { kind: 'unavailable', quantityEdited: false },
  ]);
  assert.equal(JSON.stringify(publicRows).includes(hiddenId), false);
  assert.equal(JSON.stringify(publicRows).includes('Recipe B'), false);
});

test('SHOP5 source bounds reject the whole Recipe import before save', async (t) => {
  const ids = Array.from({ length: 200 }, (_, index) => index.toString(16).padStart(24, '0'));
  const rows = Array.from({ length: 25 }, (_, index) => ({
    type: 'ingredient', ingredientId: (1000 + index).toString(16).padStart(24, '0'),
    quantity: 1, unit: 'kg', originKind: 'recipe',
    sourceRecipeIds: ids.slice(index * 8, index * 8 + 8), quantityEdited: false,
  }));
  const list = buildList(rows);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  const save = t.mock.method(shoppingListRepository, 'save', async (value) => value);
  t.mock.method(recipeService, 'findUsableRecipeById', async () => ({
    ingredients: [{ ingredient: { id: CHICKEN_ID }, quantity: 1, unit: 'kg' }],
  }));
  await assert.rejects(() => shoppingListService.addRecipeIngredients(USER_ID, RECIPE_ID), {
    statusCode: 400, code: 'SHOPPING_LIST_SOURCE_LIMIT_EXCEEDED',
  });
  assert.equal(save.mock.callCount(), 0);
});

test('SHOP5 per-row source bound rejects a ninth distinct Recipe before save', async (t) => {
  const eight = Array.from({ length: 8 }, (_, index) => index.toString(16).padStart(24, '0'));
  const list = buildList([{
    type: 'ingredient', ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg',
    originKind: 'recipe', sourceRecipeIds: eight, quantityEdited: false,
  }]);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  const save = t.mock.method(shoppingListRepository, 'save', async (value) => value);
  t.mock.method(recipeService, 'findUsableRecipeById', async () => ({
    ingredients: [{ ingredient: { id: CHICKEN_ID }, quantity: 1, unit: 'kg' }],
  }));
  await assert.rejects(() => shoppingListService.addRecipeIngredients(USER_ID, RECIPE_ID), {
    statusCode: 400, code: 'SHOPPING_LIST_SOURCE_LIMIT_EXCEEDED',
  });
  assert.equal(save.mock.callCount(), 0);
});

for (const [name, execute] of [
  ['PATCH', (id) => shoppingListService.patchItem(USER_ID, id, { isChecked: true })],
  ['single delete', (id) => shoppingListService.removeItem(USER_ID, id)],
  ['zero-checked Clear Checked', () => shoppingListService.clearCheckedItems(USER_ID)],
  ['Clear All', () => shoppingListService.clearItems(USER_ID)],
]) {
  test(`SHOP5 v1 ${name} loses a version-zero race to custom insertion without replay`, async (t) => {
    const list = buildList([{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg' }]);
    list.__v = 0;
    const winner = buildList([{ type: 'custom', label: 'Milk' }]);
    let reads = 0;
    t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => {
      reads += 1;
      return list;
    });
    const save = t.mock.method(shoppingListRepository, 'save', async () => {
      throw versionError(list);
    });
    await assert.rejects(() => execute(String(list.items[0]._id)), {
      statusCode: 409, code: 'SHOPPING_LIST_STALE',
    });
    assert.equal(reads, 1);
    assert.equal(save.mock.callCount(), 1);
    assert.equal(winner.items[0].label, 'Milk');
  });
}
