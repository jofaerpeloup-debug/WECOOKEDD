process.env.NODE_ENV = 'test';
process.env.PORT = '4025';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');

const recipeRepository = require('../src/modules/recipes/recipe.repository');
const ingredientService = require('../src/modules/ingredients/ingredient.service');
const recipeService = require('../src/modules/recipes/recipe.service');
const { AppError } = require('../src/shared/errors/app-error');

const CHICKEN_ID = '507f1f77bcf86cd799439011';
const GARLIC_ID = '507f1f77bcf86cd799439012';
const OTHER_ID = '507f1f77bcf86cd799439013';

function activeIngredient(id, name = 'Ingredient') {
  return { _id: id, name, isActive: true };
}

function inactiveIngredient(id, name = 'Ingredient') {
  return { _id: id, name, isActive: false };
}

function adoboPayload(overrides = {}) {
  return {
    title: 'Chicken Adobo',
    description: 'A classic Filipino chicken dish braised in soy sauce, vinegar, garlic, and spices.',
    difficulty: 'easy',
    prepTimeMinutes: 15,
    cookTimeMinutes: 40,
    servings: 4,
    ingredients: [
      { ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', note: 'cut into serving pieces', optional: false },
      { ingredientId: GARLIC_ID, quantity: 0.5, unit: 'cup', note: null, optional: false },
    ],
    instructions: [
      'Combine chicken, soy sauce, garlic, and bay leaves.',
      'Marinate for at least 30 minutes.',
      'Simmer until the chicken is cooked through.',
      'Add vinegar and reduce the sauce.',
    ],
    ...overrides,
  };
}

test('createRecipe validates every ingredient through IngredientService and persists a normalized document', async (t) => {
  const checkedIds = [];
  t.mock.method(ingredientService, 'findIngredientById', async (id) => {
    checkedIds.push(id);
    return activeIngredient(id);
  });
  let capturedArgs;
  t.mock.method(recipeRepository, 'createRecipe', async (args) => {
    capturedArgs = args;
    return { _id: 'recipe1', ...args };
  });

  await recipeService.createRecipe(adoboPayload());

  assert.deepEqual(checkedIds.sort(), [CHICKEN_ID, GARLIC_ID].sort());
  assert.equal(capturedArgs.title, 'Chicken Adobo');
  assert.equal(capturedArgs.ingredients.length, 2);
  assert.deepEqual(capturedArgs.dietaryTags, []);
});

test('createRecipe rejects when a referenced ingredient does not exist', async (t) => {
  t.mock.method(ingredientService, 'findIngredientById', async (id) => (id === GARLIC_ID ? null : activeIngredient(id)));

  await assert.rejects(
    () => recipeService.createRecipe(adoboPayload()),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'RECIPE_INGREDIENT_NOT_FOUND');
      return true;
    }
  );
});

test('createRecipe rejects when a referenced ingredient is inactive', async (t) => {
  t.mock.method(ingredientService, 'findIngredientById', async (id) =>
    id === CHICKEN_ID ? inactiveIngredient(id) : activeIngredient(id)
  );

  await assert.rejects(
    () => recipeService.createRecipe(adoboPayload()),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, 'RECIPE_INGREDIENT_INACTIVE');
      return true;
    }
  );
});

test('createRecipe rejects an inactive ingredient even when the entry is marked optional', async (t) => {
  t.mock.method(ingredientService, 'findIngredientById', async (id) =>
    id === GARLIC_ID ? inactiveIngredient(id) : activeIngredient(id)
  );

  await assert.rejects(
    () =>
      recipeService.createRecipe(
        adoboPayload({
          ingredients: [
            { ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg' },
            { ingredientId: GARLIC_ID, quantity: 1, unit: 'clove', optional: true },
          ],
        })
      ),
    (err) => {
      assert.equal(err.code, 'RECIPE_INGREDIENT_INACTIVE');
      return true;
    }
  );
});

test('createRecipe collapses internal/surrounding whitespace in the title', async (t) => {
  t.mock.method(ingredientService, 'findIngredientById', async (id) => activeIngredient(id));
  let capturedArgs;
  t.mock.method(recipeRepository, 'createRecipe', async (args) => {
    capturedArgs = args;
    return { _id: 'recipe1', ...args };
  });

  await recipeService.createRecipe(adoboPayload({ title: '  Chicken   Adobo  ' }));

  assert.equal(capturedArgs.title, 'Chicken Adobo');
});

test('createRecipe normalizes a toTaste ingredient entry to have no stored quantity', async (t) => {
  t.mock.method(ingredientService, 'findIngredientById', async (id) => activeIngredient(id));
  let capturedArgs;
  t.mock.method(recipeRepository, 'createRecipe', async (args) => {
    capturedArgs = args;
    return { _id: 'recipe1', ...args };
  });

  await recipeService.createRecipe(
    adoboPayload({
      ingredients: [{ ingredientId: CHICKEN_ID, unit: 'toTaste', note: 'salt to taste' }],
    })
  );

  assert.equal(capturedArgs.ingredients[0].quantity, undefined);
});

test('createRecipe deduplicates dietary tags', async (t) => {
  t.mock.method(ingredientService, 'findIngredientById', async (id) => activeIngredient(id));
  let capturedArgs;
  t.mock.method(recipeRepository, 'createRecipe', async (args) => {
    capturedArgs = args;
    return { _id: 'recipe1', ...args };
  });

  await recipeService.createRecipe(adoboPayload({ dietaryTags: ['dairyFree', 'dairyFree', 'glutenFree'] }));

  assert.deepEqual(capturedArgs.dietaryTags, ['dairyFree', 'glutenFree']);
});

test('getRecipeById returns a usable recipe for a non-admin caller', async (t) => {
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => ({
    _id: 'recipe1',
    isActive: true,
    ingredients: [{ ingredientId: activeIngredient(CHICKEN_ID), optional: false }],
  }));

  const recipe = await recipeService.getRecipeById('recipe1', { isAdmin: false });
  assert.equal(recipe._id, 'recipe1');
});

test('getRecipeById returns 404 for an archived recipe when the caller is not an admin', async (t) => {
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => ({
    _id: 'recipe1',
    isActive: false,
    ingredients: [{ ingredientId: activeIngredient(CHICKEN_ID), optional: false }],
  }));

  await assert.rejects(
    () => recipeService.getRecipeById('recipe1', { isAdmin: false }),
    (err) => {
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'RECIPE_NOT_FOUND');
      return true;
    }
  );
});

test('getRecipeById returns 404 when a required (non-optional) referenced ingredient is archived', async (t) => {
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => ({
    _id: 'recipe1',
    isActive: true,
    ingredients: [{ ingredientId: inactiveIngredient(CHICKEN_ID), optional: false }],
  }));

  await assert.rejects(
    () => recipeService.getRecipeById('recipe1', { isAdmin: false }),
    (err) => {
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'RECIPE_NOT_FOUND');
      return true;
    }
  );
});

test('getRecipeById returns 404 when a referenced ingredient no longer exists (populate returns null)', async (t) => {
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => ({
    _id: 'recipe1',
    isActive: true,
    ingredients: [{ ingredientId: null, optional: false }],
  }));

  await assert.rejects(
    () => recipeService.getRecipeById('recipe1', { isAdmin: false }),
    (err) => {
      assert.equal(err.code, 'RECIPE_NOT_FOUND');
      return true;
    }
  );
});

test('getRecipeById stays visible when only an optional ingredient (e.g. garnish) is archived', async (t) => {
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => ({
    _id: 'recipe1',
    isActive: true,
    ingredients: [
      { ingredientId: activeIngredient(CHICKEN_ID), optional: false },
      { ingredientId: inactiveIngredient(GARLIC_ID, 'Garlic'), optional: true },
    ],
  }));

  const recipe = await recipeService.getRecipeById('recipe1', { isAdmin: false });
  assert.equal(recipe._id, 'recipe1');
});

test('getRecipeById omits an archived optional ingredient usage from the normal-user response instead of exposing it as usable', async (t) => {
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => ({
    _id: 'recipe1',
    isActive: true,
    ingredients: [
      { ingredientId: activeIngredient(CHICKEN_ID, 'Chicken'), optional: false },
      { ingredientId: inactiveIngredient(GARLIC_ID, 'Garlic'), optional: true },
    ],
  }));

  const recipe = await recipeService.getRecipeById('recipe1', { isAdmin: false });

  assert.equal(recipe.ingredients.length, 1);
  assert.equal(recipe.ingredients[0].ingredientId.name, 'Chicken');
});

test('getRecipeById omits an optional ingredient usage whose Ingredient was deleted outright (populate returns null)', async (t) => {
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => ({
    _id: 'recipe1',
    isActive: true,
    ingredients: [
      { ingredientId: activeIngredient(CHICKEN_ID, 'Chicken'), optional: false },
      { ingredientId: null, optional: true },
    ],
  }));

  const recipe = await recipeService.getRecipeById('recipe1', { isAdmin: false });

  assert.equal(recipe.ingredients.length, 1);
});

test('getRecipeById allows an admin to inspect an archived or unusable recipe, including the full ingredient relationship', async (t) => {
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => ({
    _id: 'recipe1',
    isActive: false,
    ingredients: [
      { ingredientId: inactiveIngredient(CHICKEN_ID, 'Chicken'), optional: false },
      { ingredientId: inactiveIngredient(GARLIC_ID, 'Garlic'), optional: true },
    ],
  }));

  const recipe = await recipeService.getRecipeById('recipe1', { isAdmin: true });
  assert.equal(recipe.isActive, false);
  // Admins see the complete, unfiltered relationship — nothing is masked.
  assert.equal(recipe.ingredients.length, 2);
});

test('getRecipeById throws RECIPE_NOT_FOUND for an admin when the id does not exist at all', async (t) => {
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => null);

  await assert.rejects(
    () => recipeService.getRecipeById('missing', { isAdmin: true }),
    (err) => {
      assert.equal(err.code, 'RECIPE_NOT_FOUND');
      return true;
    }
  );
});

test('listRecipes rejects status=inactive and status=all for a non-admin caller', async () => {
  await assert.rejects(
    () =>
      recipeService.listRecipes({ status: 'inactive', page: 1, limit: 20, sort: 'titleAsc', isAdmin: false }),
    (err) => {
      assert.equal(err.statusCode, 403);
      assert.equal(err.code, 'FORBIDDEN');
      return true;
    }
  );
  await assert.rejects(() =>
    recipeService.listRecipes({ status: 'all', page: 1, limit: 20, sort: 'titleAsc', isAdmin: false })
  );
});

test('listRecipes builds a filter from region, category, difficulty, dietaryTag, ingredientId, and maxPrepTimeMinutes', async (t) => {
  let capturedFilter;
  t.mock.method(recipeRepository, 'findMany', async ({ filter }) => {
    capturedFilter = filter;
    return [];
  });
  t.mock.method(recipeRepository, 'countByFilter', async () => 0);

  await recipeService.listRecipes({
    region: 'central-luzon',
    category: 'main-dish',
    difficulty: 'easy',
    dietaryTag: 'dairyFree',
    ingredientId: CHICKEN_ID,
    maxPrepTimeMinutes: 30,
    status: 'active',
    page: 1,
    limit: 20,
    sort: 'titleAsc',
    isAdmin: false,
  });

  assert.equal(capturedFilter.isActive, true);
  assert.equal(capturedFilter.region, 'central-luzon');
  assert.equal(capturedFilter.category, 'main-dish');
  assert.equal(capturedFilter.difficulty, 'easy');
  assert.equal(capturedFilter.dietaryTags, 'dairyFree');
  assert.equal(capturedFilter['ingredients.ingredientId'], CHICKEN_ID);
  assert.deepEqual(capturedFilter.prepTimeMinutes, { $lte: 30 });
  assert.equal('cuisine' in capturedFilter, false);
});

test('listRecipes composes a region/category filter with search and count over the same universe', async (t) => {
  let findFilter;
  let countFilter;
  t.mock.method(recipeRepository, 'findMany', async ({ filter }) => {
    findFilter = filter;
    return [];
  });
  t.mock.method(recipeRepository, 'countByFilter', async (filter) => {
    countFilter = filter;
    return 0;
  });

  await recipeService.listRecipes({
    search: 'adobo',
    region: 'bicol',
    category: 'main-dish',
    status: 'active',
    page: 1,
    limit: 20,
    sort: 'titleAsc',
    isAdmin: false,
  });

  assert.deepEqual(findFilter, countFilter);
  assert.equal(findFilter.region, 'bicol');
  assert.equal(findFilter.category, 'main-dish');
  assert.ok(findFilter.$or);
});

test('createRecipe normalizes structured steps into ordered instruction text and never stores cuisine', async (t) => {
  t.mock.method(ingredientService, 'findIngredientById', async (id) => activeIngredient(id));
  let capturedArgs;
  t.mock.method(recipeRepository, 'createRecipe', async (args) => {
    capturedArgs = args;
    return { _id: 'recipe1', ...args };
  });

  const payload = adoboPayload({ region: 'bicol', category: 'main-dish' });
  delete payload.instructions;
  payload.steps = [
    { order: 3, text: 'Serve hot.' },
    { order: 1, text: 'Marinate the chicken.' },
    { order: 2, text: 'Simmer until tender.' },
  ];

  await recipeService.createRecipe(payload);

  assert.deepEqual(capturedArgs.instructions, [
    'Marinate the chicken.',
    'Simmer until tender.',
    'Serve hot.',
  ]);
  assert.equal(capturedArgs.region, 'bicol');
  assert.equal(capturedArgs.category, 'main-dish');
  assert.equal('cuisine' in capturedArgs, false);
});

test('updateRecipe clears region/category via $unset on an explicit null, and does not cross-touch the other', async (t) => {
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    _id: 'recipe1',
    isActive: true,
    region: 'bicol',
    category: 'main-dish',
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', optional: false }],
  }));
  let capturedUpdate;
  t.mock.method(recipeRepository, 'updateById', async (id, update) => {
    capturedUpdate = update;
    return { _id: id };
  });

  await recipeService.updateRecipe('recipe1', { region: null });

  assert.deepEqual(capturedUpdate.$unset, { region: '' });
  assert.equal('category' in (capturedUpdate.$unset || {}), false);
  assert.equal(capturedUpdate.$set, undefined);
});

test('updateRecipe replaces one classifier while clearing the other in a single patch', async (t) => {
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    _id: 'recipe1',
    isActive: true,
    region: 'bicol',
    category: 'main-dish',
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', optional: false }],
  }));
  let capturedUpdate;
  t.mock.method(recipeRepository, 'updateById', async (id, update) => {
    capturedUpdate = update;
    return { _id: id, ...(update.$set || {}) };
  });

  await recipeService.updateRecipe('recipe1', { region: null, category: 'dessert' });

  assert.deepEqual(capturedUpdate.$unset, { region: '' });
  assert.deepEqual(capturedUpdate.$set, { category: 'dessert' });
});

test('updateRecipe accepts structured steps as an instructions replacement', async (t) => {
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    _id: 'recipe1',
    isActive: true,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', optional: false }],
  }));
  let capturedUpdate;
  t.mock.method(recipeRepository, 'updateById', async (id, update) => {
    capturedUpdate = update;
    return { _id: id, ...update.$set };
  });

  await recipeService.updateRecipe('recipe1', {
    steps: [
      { order: 2, text: 'Second.' },
      { order: 1, text: 'First.' },
    ],
  });

  assert.deepEqual(capturedUpdate.$set.instructions, ['First.', 'Second.']);
});

test('listRecipes search matches title/description via an escaped, case-insensitive regex', async (t) => {
  let capturedFilter;
  t.mock.method(recipeRepository, 'findMany', async ({ filter }) => {
    capturedFilter = filter;
    return [];
  });
  t.mock.method(recipeRepository, 'countByFilter', async () => 0);

  await recipeService.listRecipes({
    search: 'adobo (chicken)',
    status: 'active',
    page: 1,
    limit: 20,
    sort: 'titleAsc',
    isAdmin: false,
  });

  assert.ok(capturedFilter.$or);
  assert.ok(capturedFilter.$or[0].title.test('Chicken Adobo (Chicken)'));
  assert.equal(capturedFilter.$or[0].title.source.includes('\\('), true);
});

test('listRecipes drops a recipe whose non-optional ingredient is archived when status=active', async (t) => {
  t.mock.method(recipeRepository, 'findMany', async () => [
    {
      _id: 'recipe1',
      isActive: true,
      ingredients: [{ ingredientId: activeIngredient(CHICKEN_ID), optional: false }],
    },
    {
      _id: 'recipe2',
      isActive: true,
      ingredients: [{ ingredientId: inactiveIngredient(OTHER_ID), optional: false }],
    },
  ]);
  t.mock.method(recipeRepository, 'countByFilter', async () => 2);

  const result = await recipeService.listRecipes({
    status: 'active',
    page: 1,
    limit: 20,
    sort: 'titleAsc',
    isAdmin: false,
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]._id, 'recipe1');
  // Known V1 trade-off: total reflects the pre-filter database count.
  assert.equal(result.total, 2);
});

test('listRecipes does not apply the usability trim when an admin requests status=all', async (t) => {
  t.mock.method(recipeRepository, 'findMany', async () => [
    {
      _id: 'recipe2',
      isActive: false,
      ingredients: [{ ingredientId: inactiveIngredient(OTHER_ID), optional: false }],
    },
  ]);
  t.mock.method(recipeRepository, 'countByFilter', async () => 1);

  const result = await recipeService.listRecipes({
    status: 'all',
    page: 1,
    limit: 20,
    sort: 'titleAsc',
    isAdmin: true,
  });

  assert.equal(result.items.length, 1);
});

test('listRecipes omits an archived optional ingredient usage from a normal user\'s results, consistent with getRecipeById', async (t) => {
  t.mock.method(recipeRepository, 'findMany', async () => [
    {
      _id: 'recipe1',
      isActive: true,
      ingredients: [
        { ingredientId: activeIngredient(CHICKEN_ID, 'Chicken'), optional: false },
        { ingredientId: inactiveIngredient(GARLIC_ID, 'Garlic'), optional: true },
      ],
    },
  ]);
  t.mock.method(recipeRepository, 'countByFilter', async () => 1);

  const result = await recipeService.listRecipes({
    status: 'active',
    page: 1,
    limit: 20,
    sort: 'titleAsc',
    isAdmin: false,
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].ingredients.length, 1);
  assert.equal(result.items[0].ingredients[0].ingredientId.name, 'Chicken');
});

test('listRecipes does not mask ingredient usages for an admin, even in the default active view', async (t) => {
  t.mock.method(recipeRepository, 'findMany', async () => [
    {
      _id: 'recipe1',
      isActive: true,
      ingredients: [
        { ingredientId: activeIngredient(CHICKEN_ID, 'Chicken'), optional: false },
        { ingredientId: inactiveIngredient(GARLIC_ID, 'Garlic'), optional: true },
      ],
    },
  ]);
  t.mock.method(recipeRepository, 'countByFilter', async () => 1);

  const result = await recipeService.listRecipes({
    status: 'active',
    page: 1,
    limit: 20,
    sort: 'titleAsc',
    isAdmin: true,
  });

  assert.equal(result.items[0].ingredients.length, 2);
});

test('updateRecipe preserves the existing ingredients array when none is provided', async (t) => {
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    _id: 'recipe1',
    isActive: true,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', optional: false }],
  }));
  let capturedUpdate;
  t.mock.method(recipeRepository, 'updateById', async (id, update) => {
    capturedUpdate = update;
    return { _id: id, ...update.$set };
  });

  await recipeService.updateRecipe('recipe1', { description: 'Updated description.' });

  assert.equal('ingredients' in capturedUpdate.$set, false);
  assert.equal(capturedUpdate.$set.description, 'Updated description.');
});

test('updateRecipe preserves the existing instructions array when none is provided', async (t) => {
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    _id: 'recipe1',
    isActive: true,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', optional: false }],
  }));
  let capturedUpdate;
  t.mock.method(recipeRepository, 'updateById', async (id, update) => {
    capturedUpdate = update;
    return { _id: id, ...update.$set };
  });

  await recipeService.updateRecipe('recipe1', { title: 'New Title' });

  assert.equal('instructions' in capturedUpdate.$set, false);
});

test('updateRecipe validates a replacement ingredients array through IngredientService', async (t) => {
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    _id: 'recipe1',
    isActive: true,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', optional: false }],
  }));
  const checkedIds = [];
  t.mock.method(ingredientService, 'findIngredientById', async (id) => {
    checkedIds.push(id);
    return activeIngredient(id);
  });
  t.mock.method(recipeRepository, 'updateById', async (id, update) => ({ _id: id, ...update.$set }));

  await recipeService.updateRecipe('recipe1', {
    ingredients: [{ ingredientId: GARLIC_ID, quantity: 2, unit: 'clove' }],
  });

  assert.deepEqual(checkedIds, [GARLIC_ID]);
});

test('updateRecipe rejects a replacement ingredients array referencing an inactive ingredient', async (t) => {
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    _id: 'recipe1',
    isActive: true,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', optional: false }],
  }));
  t.mock.method(ingredientService, 'findIngredientById', async (id) => inactiveIngredient(id));

  await assert.rejects(
    () =>
      recipeService.updateRecipe('recipe1', {
        ingredients: [{ ingredientId: GARLIC_ID, quantity: 2, unit: 'clove' }],
      }),
    (err) => {
      assert.equal(err.code, 'RECIPE_INGREDIENT_INACTIVE');
      return true;
    }
  );
});

test('updateRecipe throws RECIPE_NOT_FOUND when the id does not exist', async (t) => {
  t.mock.method(recipeRepository, 'findRawById', async () => null);

  await assert.rejects(
    () => recipeService.updateRecipe('missing', { title: 'x' }),
    (err) => {
      assert.equal(err.code, 'RECIPE_NOT_FOUND');
      assert.equal(err.statusCode, 404);
      return true;
    }
  );
});

test('updateRecipe reactivation re-verifies every stored ingredient (including optional) is still active', async (t) => {
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    _id: 'recipe1',
    isActive: false,
    ingredients: [
      { ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', optional: false },
      { ingredientId: GARLIC_ID, quantity: 1, unit: 'clove', optional: true },
    ],
  }));
  const checkedIds = [];
  t.mock.method(ingredientService, 'findIngredientById', async (id) => {
    checkedIds.push(id);
    return activeIngredient(id);
  });
  t.mock.method(recipeRepository, 'updateById', async (id, update) => ({ _id: id, ...update.$set }));

  await recipeService.updateRecipe('recipe1', { isActive: true });

  assert.deepEqual(checkedIds.sort(), [CHICKEN_ID, GARLIC_ID].sort());
});

test('updateRecipe rejects reactivation when a stored ingredient (even an optional one) is no longer active', async (t) => {
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    _id: 'recipe1',
    isActive: false,
    ingredients: [{ ingredientId: GARLIC_ID, quantity: 1, unit: 'clove', optional: true }],
  }));
  t.mock.method(ingredientService, 'findIngredientById', async (id) => inactiveIngredient(id));

  await assert.rejects(
    () => recipeService.updateRecipe('recipe1', { isActive: true }),
    (err) => {
      assert.equal(err.code, 'RECIPE_INGREDIENT_INACTIVE');
      return true;
    }
  );
});

test('updateRecipe does not re-verify ingredients for an unrelated field update while already active', async (t) => {
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    _id: 'recipe1',
    isActive: true,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', optional: false }],
  }));
  let called = false;
  t.mock.method(ingredientService, 'findIngredientById', async (id) => {
    called = true;
    return activeIngredient(id);
  });
  t.mock.method(recipeRepository, 'updateById', async (id, update) => ({ _id: id, ...update.$set }));

  await recipeService.updateRecipe('recipe1', { servings: 6 });

  assert.equal(called, false);
});

test('updateRecipe with only { title } does not wipe ingredients, instructions, dietaryTags, imageUrl, or isActive', async (t) => {
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    _id: 'recipe1',
    isActive: true,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', optional: false }],
    instructions: ['Simmer until tender.'],
    dietaryTags: ['dairyFree'],
    imageUrl: 'https://example.com/adobo.jpg',
  }));
  let capturedUpdate;
  t.mock.method(recipeRepository, 'updateById', async (id, update) => {
    capturedUpdate = update;
    return { _id: id, ...update.$set };
  });

  await recipeService.updateRecipe('recipe1', { title: 'Updated Adobo' });

  assert.deepEqual(Object.keys(capturedUpdate.$set), ['title']);
  for (const untouchedField of ['ingredients', 'instructions', 'dietaryTags', 'imageUrl', 'isActive']) {
    assert.equal(untouchedField in capturedUpdate.$set, false, `expected ${untouchedField} to be absent from $set`);
  }
});

test('archiveRecipe sets isActive: false via the repository', async (t) => {
  let archivedId;
  t.mock.method(recipeRepository, 'archiveById', async (id) => {
    archivedId = id;
    return { _id: id, isActive: false };
  });

  const recipe = await recipeService.archiveRecipe('recipe1');
  assert.equal(archivedId, 'recipe1');
  assert.equal(recipe.isActive, false);
});

test('archiveRecipe throws RECIPE_NOT_FOUND when no document matches', async (t) => {
  t.mock.method(recipeRepository, 'archiveById', async () => null);

  await assert.rejects(
    () => recipeService.archiveRecipe('missing'),
    (err) => {
      assert.equal(err.code, 'RECIPE_NOT_FOUND');
      return true;
    }
  );
});

// findUsableRecipeById is the cross-module lookup Favorites/ShoppingList
// depend on. Every consumer-side test mocks it away entirely, so its real
// implementation needs its own direct coverage here — otherwise a change
// to its behavior/shape could go unnoticed by the whole suite.
test('findUsableRecipeById resolves null (never throws) when the recipe does not exist', async (t) => {
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => null);

  const result = await recipeService.findUsableRecipeById('missing');
  assert.equal(result, null);
});

test('findUsableRecipeById resolves null for an archived recipe', async (t) => {
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => ({
    _id: 'recipe1',
    isActive: false,
    ingredients: [{ ingredientId: activeIngredient(CHICKEN_ID), optional: false }],
  }));

  const result = await recipeService.findUsableRecipeById('recipe1');
  assert.equal(result, null);
});

test('findUsableRecipeById resolves null when a required (non-optional) ingredient is inactive', async (t) => {
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => ({
    _id: 'recipe1',
    isActive: true,
    ingredients: [{ ingredientId: inactiveIngredient(CHICKEN_ID), optional: false }],
  }));

  const result = await recipeService.findUsableRecipeById('recipe1');
  assert.equal(result, null);
});

test('findUsableRecipeById propagates an unexpected repository/database failure instead of resolving null', async (t) => {
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => {
    throw new Error('MongoServerSelectionError: connection timed out');
  });

  await assert.rejects(
    () => recipeService.findUsableRecipeById('recipe1'),
    (err) => {
      assert.equal(err instanceof AppError, false);
      assert.equal(err.message, 'MongoServerSelectionError: connection timed out');
      return true;
    }
  );
});

test('findUsableRecipeById returns a decoupled { ingredient: { id, name } } usage shape, not the raw populated ingredientId field', async (t) => {
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => ({
    _id: 'recipe1',
    isActive: true,
    ingredients: [
      { ingredientId: activeIngredient(CHICKEN_ID, 'Chicken'), quantity: 1, unit: 'kg', optional: false, note: 'secret internal note' },
    ],
  }));

  const result = await recipeService.findUsableRecipeById('recipe1');

  assert.equal(result.ingredients.length, 1);
  const [usage] = result.ingredients;
  assert.deepEqual(usage.ingredient, { id: CHICKEN_ID, name: 'Chicken' });
  assert.equal(usage.quantity, 1);
  assert.equal(usage.unit, 'kg');
  assert.equal(usage.optional, false);
  assert.equal('ingredientId' in usage, false);
  assert.equal('note' in usage, false);
});

test('findUsableRecipeById omits an archived optional ingredient usage from the returned usages, same as getRecipeById', async (t) => {
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => ({
    _id: 'recipe1',
    isActive: true,
    ingredients: [
      { ingredientId: activeIngredient(CHICKEN_ID, 'Chicken'), quantity: 1, unit: 'kg', optional: false },
      { ingredientId: inactiveIngredient(GARLIC_ID, 'Garlic'), quantity: 1, unit: 'clove', optional: true },
    ],
  }));

  const result = await recipeService.findUsableRecipeById('recipe1');

  assert.equal(result.ingredients.length, 1);
  assert.equal(result.ingredients[0].ingredient.name, 'Chicken');
});