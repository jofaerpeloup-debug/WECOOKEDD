process.env.NODE_ENV = 'test';
process.env.PORT = '4025';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');

const recipeRepository = require('../src/modules/recipes/recipe.repository');
const Recipe = require('../src/modules/recipes/recipe.model');
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

function mockNoDuplicateCandidates(t) {
  t.mock.method(recipeRepository, 'findDuplicateCandidates', async () => ({
    candidates: [], candidateUniverseCount: 0, comparedCount: 0, truncated: false,
  }));
}

function failOnRecipeWrites(t) {
  for (const method of ['createRecipe', 'updateById', 'publishById', 'archiveById', 'restoreById']) {
    t.mock.method(recipeRepository, method, async () => {
      assert.fail(`readiness must not call recipeRepository.${method}`);
    });
  }
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

function completeStoredRecipe(overrides = {}) {
  const recipe = {
    _id: 'recipe1',
    title: 'Chicken Adobo',
    description: 'A complete Filipino recipe.',
    difficulty: 'easy',
    prepTimeMinutes: 15,
    cookTimeMinutes: 40,
    servings: 4,
    instructions: ['Cook until done.'],
    dietaryTags: [],
    imageUrl: null,
    imageAssetId: null,
    isActive: true,
    ...overrides,
  };

  recipe.ingredients = (recipe.ingredients || []).map((entry) => ({
    quantity: 1,
    unit: 'piece',
    optional: false,
    ...entry,
  }));

  return recipe;
}

test('createRecipe validates every ingredient through IngredientService and persists a normalized document', async (t) => {
  mockNoDuplicateCandidates(t);
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

test('createRecipe preserves canonical lb/oz quantities without conversion', async (t) => {
  mockNoDuplicateCandidates(t);
  t.mock.method(ingredientService, 'findIngredientById', async (id) => activeIngredient(id));
  let capturedArgs;
  t.mock.method(recipeRepository, 'createRecipe', async (args) => {
    capturedArgs = args;
    return { _id: 'recipe1', ...args };
  });

  await recipeService.createRecipe(adoboPayload({
    ingredients: [
      { ingredientId: CHICKEN_ID, quantity: 0.75, unit: 'lb' },
      { ingredientId: GARLIC_ID, quantity: 8, unit: 'oz' },
    ],
  }));

  assert.deepEqual(capturedArgs.ingredients.map(({ quantity, unit }) => ({ quantity, unit })), [
    { quantity: 0.75, unit: 'lb' },
    { quantity: 8, unit: 'oz' },
  ]);
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
  mockNoDuplicateCandidates(t);
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
  mockNoDuplicateCandidates(t);
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
  mockNoDuplicateCandidates(t);
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
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => completeStoredRecipe({
    ingredients: [{ ingredientId: activeIngredient(CHICKEN_ID), optional: false }],
  }));

  const recipe = await recipeService.getRecipeById('recipe1', { isAdmin: false });
  assert.equal(recipe._id, 'recipe1');
});

test('getRecipeById returns 404 for an archived recipe when the caller is not an admin', async (t) => {
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => completeStoredRecipe({
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
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => completeStoredRecipe({
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
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => completeStoredRecipe({
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
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => completeStoredRecipe({
    ingredients: [
      { ingredientId: activeIngredient(CHICKEN_ID), optional: false },
      { ingredientId: inactiveIngredient(GARLIC_ID, 'Garlic'), optional: true },
    ],
  }));

  const recipe = await recipeService.getRecipeById('recipe1', { isAdmin: false });
  assert.equal(recipe._id, 'recipe1');
});

test('getRecipeById omits an archived optional ingredient usage from the normal-user response instead of exposing it as usable', async (t) => {
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => completeStoredRecipe({
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
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => completeStoredRecipe({
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
    category: 'dinner',
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
  assert.equal(capturedFilter.category, 'dinner');
  assert.equal(capturedFilter.difficulty, 'easy');
  assert.equal(capturedFilter.dietaryTags, 'dairyFree');
  assert.equal(capturedFilter['ingredients.ingredientId'], CHICKEN_ID);
  assert.deepEqual(capturedFilter.prepTimeMinutes, { $lte: 30 });
  assert.deepEqual(capturedFilter.$and, [
    {
      $or: [
        { publicationStatus: 'published' },
        { publicationStatus: { $exists: false } },
      ],
    },
  ]);
  assert.equal('cuisine' in capturedFilter, false);
});

test('recipe dependency lookup matches active Published and legacy consumer-visible recipes using any ingredient entry', async (t) => {
  let capturedFilter;
  t.mock.method(Recipe, 'exists', async (filter) => {
    capturedFilter = filter;
    return { _id: 'recipe1' };
  });

  const exists = await recipeRepository.hasActiveConsumerRecipeUsingIngredient(CHICKEN_ID);

  assert.equal(exists, true);
  assert.deepEqual(capturedFilter, {
    isActive: true,
    'ingredients.ingredientId': CHICKEN_ID,
    $or: [
      { publicationStatus: 'published' },
      { publicationStatus: { $exists: false } },
    ],
  });
  assert.equal(JSON.stringify(capturedFilter).includes('optional'), false);
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
    region: 'bicol-region',
    category: 'dinner',
    status: 'active',
    page: 1,
    limit: 20,
    sort: 'titleAsc',
    isAdmin: false,
  });

  assert.deepEqual(findFilter, countFilter);
  assert.equal(findFilter.region, 'bicol-region');
  assert.equal(findFilter.category, 'dinner');
  assert.ok(findFilter.$or);
});

test('all five frozen legacy metadata dispositions remain consumer-visible in list and detail before migration', async (t) => {
  const legacyRecipes = [
    completeStoredRecipe({ _id: 'tondo', publicationStatus: 'published', region: 'tondo' }),
    completeStoredRecipe({ _id: 'bicol', publicationStatus: 'published', region: 'bicol' }),
    completeStoredRecipe({ _id: 'mangaldan', publicationStatus: 'published', region: 'mangaldan' }),
    completeStoredRecipe({ _id: 'fine-dining', publicationStatus: 'published', region: 'central-luzon', category: 'fine-dining-restaurant' }),
    completeStoredRecipe({ _id: 'medium', publicationStatus: 'published', region: 'central-luzon', category: 'medium' }),
  ].map((recipe) => ({
    ...recipe,
    ingredients: [{
      ingredientId: activeIngredient(CHICKEN_ID, 'Chicken'),
      quantity: 1,
      unit: 'piece',
      optional: false,
    }],
  }));
  t.mock.method(recipeRepository, 'findMany', async () => legacyRecipes);
  t.mock.method(recipeRepository, 'countByFilter', async () => legacyRecipes.length);
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async (id) => (
    legacyRecipes.find((recipe) => recipe._id === id) || null
  ));

  const listed = await recipeService.listRecipes({
    status: 'active', page: 1, limit: 20, sort: 'titleAsc', isAdmin: false,
  });
  assert.deepEqual(listed.items.map(({ region, category }) => ({ region, category })), [
    { region: 'tondo', category: undefined },
    { region: 'bicol', category: undefined },
    { region: 'mangaldan', category: undefined },
    { region: 'central-luzon', category: 'fine-dining-restaurant' },
    { region: 'central-luzon', category: 'medium' },
  ]);

  for (const recipe of legacyRecipes) {
    const detail = await recipeService.getRecipeById(recipe._id, { isAdmin: false });
    assert.equal(detail._id, recipe._id);
  }
});

test('createRecipe normalizes structured steps into ordered instruction text and never stores cuisine', async (t) => {
  mockNoDuplicateCandidates(t);
  t.mock.method(ingredientService, 'findIngredientById', async (id) => activeIngredient(id));
  let capturedArgs;
  t.mock.method(recipeRepository, 'createRecipe', async (args) => {
    capturedArgs = args;
    return { _id: 'recipe1', ...args };
  });

  const payload = adoboPayload({ region: 'bicol-region', category: 'dinner' });
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
  assert.equal(capturedArgs.region, 'bicol-region');
  assert.equal(capturedArgs.category, 'dinner');
  assert.equal('cuisine' in capturedArgs, false);
});

test('updateRecipe clears region/category via $unset on an explicit null, and does not cross-touch the other', async (t) => {
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    _id: 'recipe1',
    isActive: true,
    region: 'bicol-region',
    category: 'dinner',
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
    region: 'bicol-region',
    category: 'dinner',
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', optional: false }],
  }));
  let capturedUpdate;
  t.mock.method(recipeRepository, 'updateById', async (id, update) => {
    capturedUpdate = update;
    return { _id: id, ...(update.$set || {}) };
  });

  await recipeService.updateRecipe('recipe1', { region: null, category: 'snack' });

  assert.deepEqual(capturedUpdate.$unset, { region: '' });
  assert.deepEqual(capturedUpdate.$set, { category: 'snack' });
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
    completeStoredRecipe({
      _id: 'recipe1',
      ingredients: [{ ingredientId: activeIngredient(CHICKEN_ID), optional: false }],
    }),
    completeStoredRecipe({
      _id: 'recipe2',
      ingredients: [{ ingredientId: inactiveIngredient(OTHER_ID), optional: false }],
    }),
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
    completeStoredRecipe({
      ingredients: [
        { ingredientId: activeIngredient(CHICKEN_ID, 'Chicken'), optional: false },
        { ingredientId: inactiveIngredient(GARLIC_ID, 'Garlic'), optional: true },
      ],
    }),
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

test('updateRecipe preserves canonical lb/oz replacement entries without conversion', async (t) => {
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    _id: 'recipe1', isActive: true,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', optional: false }],
  }));
  t.mock.method(ingredientService, 'findIngredientById', async (id) => activeIngredient(id));
  let capturedUpdate;
  t.mock.method(recipeRepository, 'updateById', async (id, update) => {
    capturedUpdate = update;
    return { _id: id, ...update.$set };
  });

  await recipeService.updateRecipe('recipe1', {
    ingredients: [
      { ingredientId: CHICKEN_ID, quantity: 0.75, unit: 'lb' },
      { ingredientId: GARLIC_ID, quantity: 8, unit: 'oz' },
    ],
  });

  assert.deepEqual(capturedUpdate.$set.ingredients.map(({ quantity, unit }) => ({ quantity, unit })), [
    { quantity: 0.75, unit: 'lb' },
    { quantity: 8, unit: 'oz' },
  ]);
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

test('restoreRecipe re-verifies every stored ingredient (including optional) for a Published recipe', async (t) => {
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    ...adoboPayload(),
    _id: 'recipe1',
    isActive: false,
    publicationStatus: 'published',
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
  t.mock.method(recipeRepository, 'restoreById', async (id) => ({ _id: id, isActive: true }));

  await recipeService.restoreRecipe('recipe1');

  assert.deepEqual(checkedIds.sort(), [CHICKEN_ID, GARLIC_ID].sort());
});

test('restoreRecipe rejects restoration when a Published recipe ingredient (even optional) is inactive', async (t) => {
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    ...adoboPayload(),
    _id: 'recipe1',
    isActive: false,
    publicationStatus: 'published',
    ingredients: [{ ingredientId: GARLIC_ID, quantity: 1, unit: 'clove', optional: true }],
  }));
  t.mock.method(ingredientService, 'findIngredientById', async (id) => inactiveIngredient(id));

  await assert.rejects(
    () => recipeService.restoreRecipe('recipe1'),
    (err) => {
      assert.equal(err.code, 'RECIPE_INGREDIENT_INACTIVE');
      return true;
    }
  );
});

test('publishRecipe rejects a Draft whose Ingredient was archived while the Draft remained non-blocking', async (t) => {
  t.mock.method(recipeRepository, 'findRawById', async () => completeStoredRecipe({
    publicationStatus: 'draft',
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'piece', optional: false }],
  }));
  t.mock.method(ingredientService, 'findIngredientById', async (id) => inactiveIngredient(id));
  t.mock.method(recipeRepository, 'publishById', async () => {
    assert.fail('A Draft with an inactive Ingredient must not be published.');
  });

  await assert.rejects(
    () => recipeService.publishRecipe('recipe1', {}, { actorId: 'moderator1' }),
    (err) => {
      assert.equal(err.code, 'RECIPE_INGREDIENT_INACTIVE');
      return true;
    }
  );
});

test('publish readiness returns the exact ready projection and performs no Recipe write', async (t) => {
  const updatedAt = new Date('2026-09-30T01:02:03.000Z');
  const draft = completeStoredRecipe({
    publicationStatus: 'draft',
    updatedAt,
    prepTimeMinutes: undefined,
    region: undefined,
    category: undefined,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'piece', optional: false }],
  });
  t.mock.method(recipeRepository, 'findRawById', async () => draft);
  t.mock.method(ingredientService, 'findIngredientById', async (id) => activeIngredient(id));
  mockNoDuplicateCandidates(t);
  failOnRecipeWrites(t);

  const result = await recipeService.getRecipePublishReadiness('recipe1', {
    expectedUpdatedAt: updatedAt.toISOString(),
  });

  assert.equal(result.ready, true);
  assert.equal(result.recipeId, 'recipe1');
  assert.equal(result.recipeUpdatedAt, updatedAt.toISOString());
  assert.deepEqual(result.issues, []);
  assert.equal(result.duplicateReview.fingerprintVersion, 'recipe-duplicate-v1');
  assert.equal(result.duplicateReview.candidates.length, 0);
});

test('publish readiness preserves lifecycle fail-fast order and skips deeper evaluation', async (t) => {
  const updatedAt = new Date('2026-09-30T01:02:03.000Z');
  let recipe = completeStoredRecipe({ publicationStatus: 'published', isActive: false, updatedAt });
  t.mock.method(recipeRepository, 'findRawById', async () => recipe);
  t.mock.method(ingredientService, 'findIngredientById', async () => assert.fail('ingredient lookup must be skipped'));
  t.mock.method(recipeRepository, 'findDuplicateCandidates', async () => assert.fail('DUP1 must be skipped'));
  failOnRecipeWrites(t);

  const archived = await recipeService.getRecipePublishReadiness('recipe1', {
    expectedUpdatedAt: updatedAt.toISOString(),
  });
  assert.deepEqual(archived.issues, [{
    code: 'RECIPE_ARCHIVED', path: 'isActive', message: 'An archived recipe cannot be published.',
  }]);
  assert.equal(archived.duplicateReview, null);

  recipe = { ...recipe, isActive: true };
  const published = await recipeService.getRecipePublishReadiness('recipe1', {
    expectedUpdatedAt: updatedAt.toISOString(),
  });
  assert.deepEqual(published.issues, [{
    code: 'RECIPE_NOT_DRAFT', path: 'publicationStatus', message: 'Only an active Draft can be published.',
  }]);
  assert.equal(published.duplicateReview, null);
});

test('publish readiness returns deterministic schema then repeated Ingredient issues with dotted paths', async (t) => {
  const updatedAt = new Date('2026-09-30T01:02:03.000Z');
  const draft = completeStoredRecipe({
    publicationStatus: 'draft',
    updatedAt,
    servings: undefined,
    instructions: [],
    prepTimeMinutes: -1,
    region: 'not/a/slug',
    dietaryTags: ['not-a-tag'],
    ingredients: [
      { ingredientId: CHICKEN_ID, quantity: 1, unit: 'piece', optional: false },
      { ingredientId: GARLIC_ID, quantity: 1, unit: 'piece', optional: true },
      { ingredientId: CHICKEN_ID, quantity: 1, unit: 'piece', optional: true },
    ],
  });
  t.mock.method(recipeRepository, 'findRawById', async () => draft);
  t.mock.method(ingredientService, 'findIngredientById', async (id) => (
    id === CHICKEN_ID ? null : inactiveIngredient(id)
  ));
  t.mock.method(recipeRepository, 'findDuplicateCandidates', async () => assert.fail('DUP1 must be skipped'));

  const result = await recipeService.getRecipePublishReadiness('recipe1', {
    expectedUpdatedAt: updatedAt.toISOString(),
  });

  assert.equal(result.ready, false);
  assert.deepEqual(result.issues.map(({ code, path }) => ({ code, path })), [
    { code: 'RECIPE_INCOMPLETE', path: 'region' },
    { code: 'RECIPE_INCOMPLETE', path: 'prepTimeMinutes' },
    { code: 'RECIPE_INCOMPLETE', path: 'servings' },
    { code: 'RECIPE_INCOMPLETE', path: 'instructions' },
    { code: 'RECIPE_INCOMPLETE', path: 'dietaryTags.0' },
    { code: 'RECIPE_INGREDIENT_NOT_FOUND', path: 'ingredients.0.ingredientId' },
    { code: 'RECIPE_INGREDIENT_INACTIVE', path: 'ingredients.1.ingredientId' },
    { code: 'RECIPE_INGREDIENT_NOT_FOUND', path: 'ingredients.2.ingredientId' },
  ]);
  assert.ok(result.issues.slice(0, 5).every((issue) => issue.message.length > 0));
  assert.equal(result.duplicateReview, null);
});

test('publish readiness reports empty ingredients as authoritative incompleteness only', async (t) => {
  const updatedAt = new Date('2026-09-30T01:02:03.000Z');
  t.mock.method(recipeRepository, 'findRawById', async () => completeStoredRecipe({
    publicationStatus: 'draft', updatedAt, ingredients: [],
  }));
  t.mock.method(recipeRepository, 'findDuplicateCandidates', async () => assert.fail('DUP1 must be skipped'));

  const result = await recipeService.getRecipePublishReadiness('recipe1', {
    expectedUpdatedAt: updatedAt.toISOString(),
  });
  assert.ok(result.issues.some((issue) => issue.code === 'RECIPE_INCOMPLETE' && issue.path === 'ingredients'));
  assert.equal(result.issues.some((issue) => issue.code.startsWith('RECIPE_INGREDIENT_')), false);
});

test('publish readiness derives every required-content issue from the strict Published schema', async (t) => {
  const updatedAt = new Date('2026-09-30T01:02:03.000Z');
  const draft = completeStoredRecipe({
    publicationStatus: 'draft', updatedAt,
    title: undefined,
    description: undefined,
    difficulty: undefined,
    cookTimeMinutes: undefined,
    servings: undefined,
    instructions: [],
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'piece', optional: false }],
  });
  t.mock.method(recipeRepository, 'findRawById', async () => draft);
  t.mock.method(ingredientService, 'findIngredientById', async (id) => activeIngredient(id));
  t.mock.method(recipeRepository, 'findDuplicateCandidates', async () => assert.fail('DUP1 must be skipped'));

  const result = await recipeService.getRecipePublishReadiness('recipe1', {
    expectedUpdatedAt: updatedAt.toISOString(),
  });
  assert.deepEqual(result.issues.map((issue) => issue.path), [
    'title', 'description', 'difficulty', 'cookTimeMinutes', 'servings', 'instructions',
  ]);
  assert.ok(result.issues.every((issue) => issue.code === 'RECIPE_INCOMPLETE'));
});

test('publish readiness returns not-found/conflict errors and performs no writes', async (t) => {
  const updatedAt = new Date('2026-09-30T01:02:03.000Z');
  let recipe = null;
  t.mock.method(recipeRepository, 'findRawById', async () => recipe);
  failOnRecipeWrites(t);
  await assert.rejects(
    () => recipeService.getRecipePublishReadiness('missing', { expectedUpdatedAt: updatedAt.toISOString() }),
    { code: 'RECIPE_NOT_FOUND', statusCode: 404 }
  );

  recipe = completeStoredRecipe({ publicationStatus: 'draft', updatedAt });
  await assert.rejects(
    () => recipeService.getRecipePublishReadiness('recipe1', {
      expectedUpdatedAt: '2026-09-30T00:00:00.000Z',
    }),
    { code: 'RECIPE_EDIT_CONFLICT', statusCode: 409 }
  );
});

test('publish readiness reuses DUP1 required, matching, stale, truncated, and changed-result semantics', async (t) => {
  const updatedAt = new Date('2026-09-30T01:02:03.000Z');
  const draft = completeStoredRecipe({
    publicationStatus: 'draft', updatedAt,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'piece', optional: false }],
  });
  let candidates = [completeStoredRecipe({
    _id: 'candidate1', publicationStatus: 'published', updatedAt,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'piece', optional: false }],
  })];
  let truncated = false;
  t.mock.method(recipeRepository, 'findRawById', async () => draft);
  t.mock.method(ingredientService, 'findIngredientById', async (id) => activeIngredient(id));
  t.mock.method(recipeRepository, 'findDuplicateCandidates', async () => ({
    candidates,
    candidateUniverseCount: truncated ? 501 : candidates.length,
    comparedCount: truncated ? 500 : candidates.length,
    truncated,
  }));
  failOnRecipeWrites(t);

  const required = await recipeService.getRecipePublishReadiness('recipe1', {
    expectedUpdatedAt: updatedAt.toISOString(), duplicateReview: { confirmDistinctRecipe: true },
  });
  assert.equal(required.issues.at(-1).code, 'RECIPE_DUPLICATE_REVIEW_REQUIRED');
  assert.equal(required.duplicateReview.candidates[0].recipe.id, 'candidate1');

  const ready = await recipeService.getRecipePublishReadiness('recipe1', {
    expectedUpdatedAt: updatedAt.toISOString(),
    duplicateReview: { resultDigest: required.duplicateReview.resultDigest, confirmDistinctRecipe: true },
  });
  assert.equal(ready.ready, true);

  candidates = [];
  const stale = await recipeService.getRecipePublishReadiness('recipe1', {
    expectedUpdatedAt: updatedAt.toISOString(),
    duplicateReview: { resultDigest: required.duplicateReview.resultDigest, confirmDistinctRecipe: true },
  });
  assert.equal(stale.issues[0].code, 'RECIPE_DUPLICATE_REVIEW_STALE');
  assert.notEqual(stale.duplicateReview.resultDigest, required.duplicateReview.resultDigest);

  truncated = true;
  const bounded = await recipeService.getRecipePublishReadiness('recipe1', {
    expectedUpdatedAt: updatedAt.toISOString(),
  });
  assert.equal(bounded.duplicateReview.truncated, true);
  assert.equal(bounded.issues[0].code, 'RECIPE_DUPLICATE_REVIEW_REQUIRED');
});

test('readiness and Publish have decision parity, and Publish reruns DUP1 before its atomic transition', async (t) => {
  const updatedAt = new Date('2026-09-30T01:02:03.000Z');
  const draft = completeStoredRecipe({
    publicationStatus: 'draft', updatedAt,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'piece', optional: false }],
  });
  let comparisons = 0;
  let transition;
  t.mock.method(recipeRepository, 'findRawById', async () => draft);
  t.mock.method(ingredientService, 'findIngredientById', async (id) => activeIngredient(id));
  t.mock.method(recipeRepository, 'findDuplicateCandidates', async () => {
    comparisons += 1;
    return { candidates: [], candidateUniverseCount: 0, comparedCount: 0, truncated: false };
  });
  t.mock.method(recipeRepository, 'publishById', async (id, args) => {
    transition = { id, ...args };
    return { ...draft, publicationStatus: 'published' };
  });

  const readiness = await recipeService.getRecipePublishReadiness('recipe1', {
    expectedUpdatedAt: updatedAt.toISOString(),
  });
  assert.equal(readiness.ready, true);
  await recipeService.publishRecipe('recipe1', { expectedUpdatedAt: updatedAt.toISOString() }, {
    actorId: 'moderator1', now: new Date('2026-09-30T02:00:00.000Z'),
  });
  assert.equal(comparisons, 2);
  assert.deepEqual(transition, {
    id: 'recipe1',
    actorId: 'moderator1',
    publishedAt: new Date('2026-09-30T02:00:00.000Z'),
    expectedUpdatedAt: updatedAt.toISOString(),
  });
});

test('Publish retains the atomic updatedAt precondition after a ready evaluation', async (t) => {
  const updatedAt = new Date('2026-09-30T01:02:03.000Z');
  const draft = completeStoredRecipe({
    publicationStatus: 'draft', updatedAt,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'piece', optional: false }],
  });
  let atomicArgs;
  t.mock.method(recipeRepository, 'findRawById', async () => draft);
  t.mock.method(ingredientService, 'findIngredientById', async (id) => activeIngredient(id));
  mockNoDuplicateCandidates(t);
  t.mock.method(recipeRepository, 'publishById', async (id, args) => {
    atomicArgs = args;
    return null;
  });

  await assert.rejects(
    () => recipeService.publishRecipe('recipe1', { expectedUpdatedAt: updatedAt.toISOString() }, {
      actorId: 'moderator1',
    }),
    { code: 'RECIPE_EDIT_CONFLICT', statusCode: 409 }
  );
  assert.equal(atomicArgs.expectedUpdatedAt, updatedAt.toISOString());
});

test('Publish translates the shared multi-issue evaluation to its existing fail-fast error contract', async (t) => {
  const updatedAt = new Date('2026-09-30T01:02:03.000Z');
  const draft = completeStoredRecipe({
    publicationStatus: 'draft', updatedAt, servings: undefined,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'piece', optional: false }],
  });
  t.mock.method(recipeRepository, 'findRawById', async () => draft);
  t.mock.method(ingredientService, 'findIngredientById', async () => null);
  t.mock.method(recipeRepository, 'publishById', async () => assert.fail('blocked Publish must not write'));

  const readiness = await recipeService.getRecipePublishReadiness('recipe1', {
    expectedUpdatedAt: updatedAt.toISOString(),
  });
  assert.deepEqual(readiness.issues.map((issue) => issue.code), [
    'RECIPE_INCOMPLETE', 'RECIPE_INGREDIENT_NOT_FOUND',
  ]);
  await assert.rejects(
    () => recipeService.publishRecipe('recipe1', { expectedUpdatedAt: updatedAt.toISOString() }),
    (error) => error.code === 'RECIPE_INCOMPLETE' && error.details.some((issue) => issue.path[0] === 'servings')
  );
});

test('publish readiness propagates repository, Ingredient, and DUP1 failures', async (t) => {
  const updatedAt = new Date('2026-09-30T01:02:03.000Z');
  const draft = completeStoredRecipe({
    publicationStatus: 'draft', updatedAt,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'piece', optional: false }],
  });
  t.mock.method(recipeRepository, 'findRawById', async () => { throw new Error('repository failed'); });
  await assert.rejects(
    () => recipeService.getRecipePublishReadiness('recipe1', { expectedUpdatedAt: updatedAt.toISOString() }),
    /repository failed/
  );

  recipeRepository.findRawById.mock.mockImplementation(async () => draft);
  t.mock.method(ingredientService, 'findIngredientById', async () => { throw new Error('ingredient failed'); });
  await assert.rejects(
    () => recipeService.getRecipePublishReadiness('recipe1', { expectedUpdatedAt: updatedAt.toISOString() }),
    /ingredient failed/
  );

  ingredientService.findIngredientById.mock.mockImplementation(async (id) => activeIngredient(id));
  t.mock.method(recipeRepository, 'findDuplicateCandidates', async () => { throw new Error('comparator failed'); });
  await assert.rejects(
    () => recipeService.getRecipePublishReadiness('recipe1', { expectedUpdatedAt: updatedAt.toISOString() }),
    /comparator failed/
  );
});

test('legacy direct create requires current duplicate acknowledgement and never mutates before either 409', async (t) => {
  t.mock.method(ingredientService, 'findIngredientById', async (id) => activeIngredient(id));
  let candidate = completeStoredRecipe({
    _id: 'candidate1',
    title: 'Chicken Adobo',
    ingredients: adoboPayload().ingredients,
    instructions: adoboPayload().instructions,
    publicationStatus: 'published',
    updatedAt: new Date('2026-09-29T00:00:00.000Z'),
  });
  t.mock.method(recipeRepository, 'findDuplicateCandidates', async () => ({
    candidates: [candidate], candidateUniverseCount: 1, comparedCount: 1, truncated: false,
  }));
  let creates = 0;
  let persisted;
  t.mock.method(recipeRepository, 'createRecipe', async (doc) => { creates += 1; persisted = doc; return { _id: 'new', ...doc }; });

  let required;
  await assert.rejects(() => recipeService.createRecipe(adoboPayload()), (error) => {
    required = error.details[0].duplicateReview;
    assert.equal(error.code, 'RECIPE_DUPLICATE_REVIEW_REQUIRED');
    assert.equal(required.candidates[0].recipe.id, 'candidate1');
    assert.equal('fingerprint' in required.candidates[0].recipe, false);
    return true;
  });
  assert.equal(creates, 0);

  for (const duplicateReview of [
    {},
    { confirmDistinctRecipe: true },
    { resultDigest: required.resultDigest },
    { resultDigest: required.resultDigest, confirmDistinctRecipe: false },
  ]) {
    await assert.rejects(() => recipeService.createRecipe(adoboPayload({ duplicateReview })), (error) => {
      assert.equal(error.code, 'RECIPE_DUPLICATE_REVIEW_REQUIRED');
      assert.equal(error.details[0].duplicateReview.resultDigest, required.resultDigest);
      assert.equal(error.details[0].duplicateReview.candidates[0].recipe.id, 'candidate1');
      return true;
    });
    assert.equal(creates, 0);
  }

  candidate = { ...candidate, isActive: false };
  let fresh;
  await assert.rejects(() => recipeService.createRecipe(adoboPayload({
    duplicateReview: { resultDigest: required.resultDigest, confirmDistinctRecipe: true },
  })), (error) => {
    assert.equal(error.code, 'RECIPE_DUPLICATE_REVIEW_STALE');
    fresh = error.details[0].duplicateReview;
    assert.notEqual(fresh.resultDigest, required.resultDigest);
    return true;
  });
  assert.equal(creates, 0);

  await recipeService.createRecipe(adoboPayload({
    duplicateReview: { resultDigest: fresh.resultDigest, confirmDistinctRecipe: true },
  }));
  assert.equal(creates, 1);
  assert.equal('duplicateReview' in persisted, false);
  assert.equal('confirmFilipinoCuisine' in persisted, false);
});

test('publish reruns duplicate comparison immediately before mutation and accepts only the current acknowledged digest', async (t) => {
  const updatedAt = new Date('2026-09-29T01:00:00.000Z');
  const draft = completeStoredRecipe({
    publicationStatus: 'draft', updatedAt,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'piece', optional: false }],
  });
  let candidate = completeStoredRecipe({
    _id: 'candidate1', publicationStatus: undefined, updatedAt: new Date('2026-09-29T00:00:00.000Z'),
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'piece', optional: false }],
  });
  t.mock.method(recipeRepository, 'findRawById', async () => draft);
  t.mock.method(ingredientService, 'findIngredientById', async (id) => activeIngredient(id));
  t.mock.method(recipeRepository, 'findDuplicateCandidates', async () => ({
    candidates: [candidate], candidateUniverseCount: 1, comparedCount: 1, truncated: false,
  }));
  let publishes = 0;
  t.mock.method(recipeRepository, 'publishById', async () => { publishes += 1; return { ...draft, publicationStatus: 'published' }; });

  const checked = await recipeService.checkRecipeDuplicates({ recipeId: 'recipe1', expectedUpdatedAt: updatedAt.toISOString() });
  assert.equal(checked.candidates[0].recipe.publicationStatusSource, 'legacy');
  candidate = { ...candidate, instructions: ['Candidate changed.'], updatedAt: new Date('2026-09-29T02:00:00.000Z') };
  await assert.rejects(() => recipeService.publishRecipe('recipe1', {
    expectedUpdatedAt: updatedAt.toISOString(),
    duplicateReview: { resultDigest: checked.resultDigest, confirmDistinctRecipe: true },
  }, { actorId: 'moderator1' }), { code: 'RECIPE_DUPLICATE_REVIEW_STALE' });
  assert.equal(publishes, 0);

  const fresh = await recipeService.checkRecipeDuplicates({ recipeId: 'recipe1', expectedUpdatedAt: updatedAt.toISOString() });
  await recipeService.publishRecipe('recipe1', {
    expectedUpdatedAt: updatedAt.toISOString(),
    duplicateReview: { resultDigest: fresh.resultDigest, confirmDistinctRecipe: true },
  }, { actorId: 'moderator1' });
  assert.equal(publishes, 1);
});

test('publish sends every semantically incomplete acknowledgement to fresh required-review enforcement', async (t) => {
  const updatedAt = new Date('2026-09-29T01:00:00.000Z');
  const draft = completeStoredRecipe({
    publicationStatus: 'draft', updatedAt,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'piece', optional: false }],
  });
  t.mock.method(recipeRepository, 'findRawById', async () => draft);
  t.mock.method(ingredientService, 'findIngredientById', async (id) => activeIngredient(id));
  t.mock.method(recipeRepository, 'findDuplicateCandidates', async () => ({
    candidates: [], candidateUniverseCount: 501, comparedCount: 500, truncated: true,
  }));
  let publishes = 0;
  t.mock.method(recipeRepository, 'publishById', async () => { publishes += 1; return draft; });
  let freshDigest;
  for (const duplicateReview of [
    undefined,
    {},
    { confirmDistinctRecipe: true },
    { resultDigest: 'a'.repeat(64) },
    { resultDigest: 'a'.repeat(64), confirmDistinctRecipe: false },
  ]) {
    await assert.rejects(() => recipeService.publishRecipe('recipe1', {
      expectedUpdatedAt: updatedAt.toISOString(),
      ...(duplicateReview === undefined ? {} : { duplicateReview }),
    }, { actorId: 'moderator1' }), (error) => {
      assert.equal(error.code, 'RECIPE_DUPLICATE_REVIEW_REQUIRED');
      assert.equal(error.details[0].duplicateReview.truncated, true);
      freshDigest ||= error.details[0].duplicateReview.resultDigest;
      assert.equal(error.details[0].duplicateReview.resultDigest, freshDigest);
      return true;
    });
    assert.equal(publishes, 0);
  }
});

test('duplicate repository uses five bounded lifecycle branches, self exclusion, and deterministic 500-window metadata', async (t) => {
  const calls = [];
  const newest = Array.from({ length: 501 }, (_, index) => ({
    _id: String(index).padStart(24, '0'),
    updatedAt: new Date(Date.UTC(2026, 8, 29, 0, 0, 0, 501 - index)),
  }));
  t.mock.method(Recipe, 'find', (filter, projection) => {
    const call = { filter, projection, sort: null, limit: null };
    calls.push(call);
    return {
      sort(value) { call.sort = value; return this; },
      limit(value) { call.limit = value; return this; },
      async lean() { return filter.publicationStatus === 'published' && filter.isActive === true ? newest : []; },
    };
  });
  t.mock.method(Recipe, 'countDocuments', async (filter) => (
    filter.publicationStatus === 'published' && filter.isActive === true ? 501 : 0
  ));

  const result = await recipeRepository.findDuplicateCandidates({ excludeId: 'self-id', limit: 500 });
  assert.equal(calls.length, 5);
  assert.ok(calls.every((call) => call.limit === 501));
  assert.ok(calls.every((call) => call.filter._id.$ne === 'self-id'));
  assert.ok(calls.every((call) => call.sort.updatedAt === -1 && call.sort._id === 1));
  assert.deepEqual(calls.map((call) => [call.filter.publicationStatus, call.filter.isActive]), [
    ['published', true], ['published', false], [null, true], [null, false], ['draft', true],
  ]);
  assert.equal(result.candidateUniverseCount, 501);
  assert.equal(result.comparedCount, 500);
  assert.equal(result.truncated, true);
  assert.equal(result.candidates.length, 500);
});

test('duplicate repository resolves merged-window timestamp ties by ascending Recipe id', async (t) => {
  const tiedAt = new Date('2026-09-29T00:00:00.000Z');
  const branchIds = ['000000000000000000000005', '000000000000000000000001', '000000000000000000000003'];
  let branch = 0;
  t.mock.method(Recipe, 'find', () => {
    const id = branchIds[branch++];
    return {
      sort() { return this; },
      limit() { return this; },
      async lean() { return id ? [{ _id: id, updatedAt: tiedAt }] : []; },
    };
  });
  t.mock.method(Recipe, 'countDocuments', async () => 1);

  const result = await recipeRepository.findDuplicateCandidates({ limit: 2 });
  assert.deepEqual(result.candidates.map(({ _id }) => String(_id)), [
    '000000000000000000000001',
    '000000000000000000000003',
  ]);
  assert.equal(result.candidateUniverseCount, 5);
  assert.equal(result.comparedCount, 2);
  assert.equal(result.truncated, true);
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
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => completeStoredRecipe({
    isActive: false,
    ingredients: [{ ingredientId: activeIngredient(CHICKEN_ID), optional: false }],
  }));

  const result = await recipeService.findUsableRecipeById('recipe1');
  assert.equal(result, null);
});

test('findUsableRecipeById resolves null when a required (non-optional) ingredient is inactive', async (t) => {
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => completeStoredRecipe({
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
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => completeStoredRecipe({
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
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => completeStoredRecipe({
    ingredients: [
      { ingredientId: activeIngredient(CHICKEN_ID, 'Chicken'), quantity: 1, unit: 'kg', optional: false },
      { ingredientId: inactiveIngredient(GARLIC_ID, 'Garlic'), quantity: 1, unit: 'clove', optional: true },
    ],
  }));

  const result = await recipeService.findUsableRecipeById('recipe1');

  assert.equal(result.ingredients.length, 1);
  assert.equal(result.ingredients[0].ingredient.name, 'Chicken');
});
