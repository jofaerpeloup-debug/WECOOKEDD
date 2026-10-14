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
const Review = require('../src/modules/reviews/review.model');
const Ingredient = require('../src/modules/ingredients/ingredient.model');
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
    imageUrlIsPublicHttps: false,
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

function cookingProfile(overrides = {}) {
  return {
    schemaVersion: 1,
    defaultSpiceLevel: 'mild',
    spiceAlternatives: [{
      spiceLevel: 'hot',
      ingredients: [{ ingredientId: GARLIC_ID, quantity: 2, unit: 'clove', optional: false }],
    }],
    stepTimers: [{ stepOrder: 1, servings: 4, spiceLevel: 'hot', durationSeconds: 90 }],
    ...overrides,
  };
}

function shoppingProfiledRecipe(overrides = {}) {
  return completeStoredRecipe({
    publicationStatus: 'published', updatedAt: new Date('2026-10-14T00:00:00.000Z'),
    ingredients: [{ ingredientId: activeIngredient(CHICKEN_ID), quantity: 1, unit: 'kg' }],
    cooking: {
      schemaVersion: 1, defaultSpiceLevel: 'none',
      spiceAlternatives: ['mild', 'medium', 'hot', 'extra_hot'].map((spiceLevel, index) => ({
        spiceLevel,
        ingredients: [{ ingredientId: activeIngredient(GARLIC_ID),
          quantity: index + 2, unit: 'clove', note: 'authored', optional: false }],
      })),
      stepTimers: [],
    },
    ...overrides,
  });
}

function smartRecipe(id, title, overrides = {}) {
  const recipe = completeStoredRecipe({
    _id: id,
    title,
    publicationStatus: 'published',
    ingredients: [{ ingredientId: activeIngredient(CHICKEN_ID, 'Chicken') }],
    ...overrides,
  });
  if (recipe.nutrition != null && recipe.nutritionProvenance === undefined) {
    recipe.nutritionProvenance = { sourceKind: 'manual', sourceLabel: 'Reviewed panel' };
  }
  return recipe;
}

function balancedNutrition(overrides = {}) {
  return {
    schemaVersion: 1,
    basis: 'perServing',
    caloriesKcal: 650,
    proteinGrams: 15,
    carbohydrateGrams: 50,
    fatGrams: 20,
    sugarGrams: 20,
    fiberGrams: 5,
    ...overrides,
  };
}

test('smart repository streams a projected public candidate universe in title and _id order with a bounded batch', (t) => {
  const calls = {};
  const cursor = { kind: 'cursor' };
  const query = {
    sort(value) { calls.sort = value; return this; },
    lean() { calls.lean = true; return this; },
    populate(path, fields) { calls.populate = { path, fields }; return this; },
    cursor(options) { calls.cursor = options; return cursor; },
  };
  t.mock.method(Recipe, 'find', (filter, projection) => {
    calls.find = { filter, projection };
    return query;
  });

  assert.equal(recipeRepository.streamSmartCollectionCandidates(), cursor);
  assert.deepEqual(calls.find.filter, {
    isActive: true,
    $or: [{ publicationStatus: 'published' }, { publicationStatus: { $exists: false } }],
  });
  assert.match(calls.find.projection, /nutritionProvenance/);
  assert.match(calls.find.projection, /imageAssetId/);
  assert.deepEqual(calls.sort, { title: 1, _id: 1 });
  assert.deepEqual(calls.populate, { path: 'ingredients.ingredientId', fields: 'name isActive' });
  assert.equal(calls.lean, true);
  assert.deepEqual(calls.cursor, { batchSize: 100 });
});

test('duration smart groups preserve inclusive 30/60 boundaries and missing prep as zero', async (t) => {
  const universe = [
    smartRecipe('q1', 'Quick boundary', { prepTimeMinutes: undefined, cookTimeMinutes: 30 }),
    smartRecipe('q2', 'Too slow', { prepTimeMinutes: 1, cookTimeMinutes: 30 }),
    smartRecipe('w1', 'Weekend boundary', { prepTimeMinutes: undefined, cookTimeMinutes: 60 }),
    smartRecipe('w2', 'Too quick', { prepTimeMinutes: 1, cookTimeMinutes: 58 }),
  ];
  t.mock.method(recipeRepository, 'streamSmartCollectionCandidates', () => universe);

  const quick = await recipeService.getSmartCollection({ groupKey: 'quick-meals', page: 1, limit: 20 });
  const weekend = await recipeService.getSmartCollection({ groupKey: 'weekend-cooking', page: 1, limit: 20 });
  assert.deepEqual(quick.items.map(({ _id }) => _id), ['q1']);
  assert.deepEqual(weekend.items.map(({ _id }) => _id), ['w1']);
});

test('smart reads reuse canonical public completeness for URLs, provenance, quantities, and lifecycle', async (t) => {
  const valid = smartRecipe('valid', 'A valid dinner', {
    category: 'dinner', imageUrl: 'https://images.example.com/valid.jpg',
  });
  const invalid = [
    smartRecipe('http', 'B HTTP image', { category: 'dinner', imageUrl: 'http://images.example.com/a.jpg' }),
    smartRecipe('localhost', 'C localhost image', { category: 'dinner', imageUrl: 'https://localhost/a.jpg' }),
    smartRecipe('private', 'D private image', { category: 'dinner', imageUrl: 'https://192.168.1.4/a.jpg' }),
    smartRecipe('credentials', 'E credential image', { category: 'dinner', imageUrl: 'https://user:pass@example.com/a.jpg' }),
    smartRecipe('missing-provenance', 'F missing provenance', {
      category: 'dinner', nutrition: balancedNutrition(), nutritionProvenance: null,
    }),
    smartRecipe('invalid-provenance', 'G invalid provenance', {
      category: 'dinner', nutrition: balancedNutrition(),
      nutritionProvenance: { sourceKind: 'manual', sourceLabel: 'Panel', sourceUrl: 'https://127.0.0.1/panel' },
    }),
    smartRecipe('infinite', 'H infinite quantity', {
      category: 'dinner', ingredients: [{ ingredientId: activeIngredient(CHICKEN_ID), quantity: Infinity, unit: 'piece' }],
    }),
    smartRecipe('draft', 'I draft', { category: 'dinner', publicationStatus: 'draft' }),
    smartRecipe('incomplete', 'J incomplete', { category: 'dinner', instructions: [] }),
    smartRecipe('inactive-recipe', 'K inactive recipe', { category: 'dinner', isActive: false }),
    smartRecipe('inactive-ingredient', 'L inactive ingredient', {
      category: 'dinner', ingredients: [{ ingredientId: inactiveIngredient(CHICKEN_ID), quantity: 1, unit: 'piece' }],
    }),
  ];
  t.mock.method(recipeRepository, 'streamSmartCollectionCandidates', () => [valid, ...invalid]);

  const [summaryDinner] = (await recipeService.listSmartCollections()).filter(({ key }) => key === 'dinner-ideas');
  const detailDinner = await recipeService.getSmartCollection({ groupKey: 'dinner-ideas', page: 1, limit: 20 });
  assert.equal(summaryDinner.recipeCount, 1);
  assert.deepEqual(summaryDinner.coverImageUrls, ['https://images.example.com/valid.jpg']);
  assert.equal(detailDinner.total, 1);
  assert.deepEqual(detailDinner.items.map(({ _id }) => _id), ['valid']);
});

test('Balanced Meals excludes missing, malformed, wrong-version, wrong-basis, non-finite, and threshold failures', async (t) => {
  const cases = [
    smartRecipe('balanced', 'A balanced', { nutrition: balancedNutrition() }),
    smartRecipe('missing', 'B missing'),
    smartRecipe('partial', 'C partial', { nutrition: { schemaVersion: 1, basis: 'perServing', caloriesKcal: 500 } }),
    smartRecipe('version', 'D version', { nutrition: balancedNutrition({ schemaVersion: 2 }) }),
    smartRecipe('basis', 'E basis', { nutrition: balancedNutrition({ basis: 'perRecipe' }) }),
    smartRecipe('nan', 'F NaN', { nutrition: balancedNutrition({ proteinGrams: Number.NaN }) }),
    smartRecipe('infinite', 'G infinity', { nutrition: balancedNutrition({ caloriesKcal: Number.POSITIVE_INFINITY }) }),
    smartRecipe('calories', 'H calories', { nutrition: balancedNutrition({ caloriesKcal: 651 }) }),
    smartRecipe('protein', 'I protein', { nutrition: balancedNutrition({ proteinGrams: 14.9 }) }),
    smartRecipe('fiber', 'J fiber', { nutrition: balancedNutrition({ fiberGrams: 4.9 }) }),
    smartRecipe('sugar', 'K sugar', { nutrition: balancedNutrition({ sugarGrams: 20.1 }) }),
  ];
  t.mock.method(recipeRepository, 'streamSmartCollectionCandidates', () => cases);

  const balanced = await recipeService.getSmartCollection({ groupKey: 'balanced-meals', page: 1, limit: 20 });
  assert.equal(balanced.total, 1);
  assert.deepEqual(balanced.items.map(({ _id }) => _id), ['balanced']);
});

test('summary and detail traverse the same canonical universe once per request and retain only the requested ordered page', async (t) => {
  const universe = [
    smartRecipe('0001', 'Alpha', { prepTimeMinutes: undefined, cookTimeMinutes: 20, imageUrl: 'https://example.com/1.jpg' }),
    smartRecipe('0002', 'Same', { prepTimeMinutes: undefined, cookTimeMinutes: 20, imageUrl: null }),
    smartRecipe('0003', 'Same', { prepTimeMinutes: undefined, cookTimeMinutes: 20, imageUrl: 'https://example.com/3.jpg' }),
    smartRecipe('0004', 'Same', { prepTimeMinutes: undefined, cookTimeMinutes: 20, imageUrl: 'https://example.com/4.jpg' }),
    smartRecipe('0005', 'Zulu', { prepTimeMinutes: undefined, cookTimeMinutes: 20, imageUrl: 'https://example.com/5.jpg' }),
    smartRecipe('0006', 'Zulu invalid', { prepTimeMinutes: undefined, cookTimeMinutes: 20, imageUrl: 'https://localhost/not-public.jpg' }),
  ];
  let traversals = 0;
  t.mock.method(recipeRepository, 'streamSmartCollectionCandidates', () => {
    traversals += 1;
    return universe;
  });

  const [summary] = await recipeService.listSmartCollections();
  assert.equal(traversals, 1);
  const second = await recipeService.getSmartCollection({ groupKey: 'quick-meals', page: 2, limit: 2 });
  assert.equal(traversals, 2);
  assert.equal(summary.recipeCount, 5);
  assert.deepEqual(summary.coverImageUrls, [
    'https://example.com/1.jpg', 'https://example.com/3.jpg', 'https://example.com/4.jpg',
  ]);
  assert.equal(second.total, summary.recipeCount);
  assert.deepEqual(second.items.map(({ _id }) => _id), ['0003', '0004']);
});

function evaluateMongoExpression(expression, document, variables = {}) {
  if (typeof expression === 'string' && expression.startsWith('$')) {
    const source = expression.startsWith('$$') ? variables : document;
    const path = expression.replace(/^\$\$?/u, '').split('.');
    return path.reduce((value, key) => value?.[key], source);
  }
  if (Array.isArray(expression)) {
    return expression.map((entry) => evaluateMongoExpression(entry, document, variables));
  }
  if (!expression || typeof expression !== 'object') return expression;
  if ('$type' in expression) {
    const value = evaluateMongoExpression(expression.$type, document, variables);
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }
  if ('$objectToArray' in expression) {
    const value = evaluateMongoExpression(expression.$objectToArray, document, variables);
    return Object.entries(value).map(([k, v]) => ({ k, v }));
  }
  if ('$map' in expression) {
    const input = evaluateMongoExpression(expression.$map.input, document, variables);
    return input.map((value) => evaluateMongoExpression(
      expression.$map.in,
      document,
      { ...variables, [expression.$map.as]: value },
    ));
  }
  if ('$setEquals' in expression) {
    const [left, right] = evaluateMongoExpression(expression.$setEquals, document, variables);
    return left.length === right.length && left.every((value) => right.includes(value));
  }
  if ('$ifNull' in expression) {
    const [value, fallback] = evaluateMongoExpression(expression.$ifNull, document, variables);
    return value === null || value === undefined ? fallback : value;
  }
  if ('$add' in expression) {
    const operands = evaluateMongoExpression(expression.$add, document, variables);
    if (!operands.every((value) => typeof value === 'number' && Number.isFinite(value))) {
      throw new TypeError('$add only supports numeric operands in this test evaluator');
    }
    return operands.reduce((sum, value) => sum + value, 0);
  }
  if ('$isNumber' in expression) {
    const value = evaluateMongoExpression(expression.$isNumber, document, variables);
    return typeof value === 'number' && Number.isFinite(value);
  }
  if ('$and' in expression) {
    const results = expression.$and.map((entry) => evaluateMongoExpression(entry, document, variables));
    return results.every(Boolean);
  }
  if ('$or' in expression) {
    return expression.$or.some((entry) => evaluateMongoExpression(entry, document, variables));
  }
  if ('$cond' in expression) {
    const [condition, whenTrue, whenFalse] = expression.$cond;
    return evaluateMongoExpression(condition, document, variables)
      ? evaluateMongoExpression(whenTrue, document, variables)
      : evaluateMongoExpression(whenFalse, document, variables);
  }
  for (const [operator, compare] of [
    ['$eq', (left, right) => Object.is(left, right) || left === right],
    ['$ne', (left, right) => left !== right],
    ['$lt', (left, right) => left < right],
    ['$lte', (left, right) => left <= right],
    ['$gte', (left, right) => left >= right],
    ['$gt', (left, right) => left > right],
  ]) {
    if (operator in expression) {
      const [left, right] = evaluateMongoExpression(expression[operator], document, variables);
      return compare(left, right);
    }
  }
  throw new Error(`Unsupported expression ${JSON.stringify(expression)}`);
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
  assert.equal(capturedArgs.imageUrlIsPublicHttps, false);
});

test('complete create and Draft create derive public-HTTPS image state server-side', async (t) => {
  mockNoDuplicateCandidates(t);
  t.mock.method(ingredientService, 'findIngredientById', async (id) => activeIngredient(id));
  const writes = [];
  t.mock.method(recipeRepository, 'createRecipe', async (document) => {
    writes.push(document);
    return { _id: `recipe${writes.length}`, ...document };
  });

  await recipeService.createRecipe(adoboPayload({ imageUrl: 'https://example.com/adobo.jpg' }));
  await recipeService.createDraft({ title: 'Draft Adobo', imageUrl: 'https://example.com/draft.jpg' });

  assert.equal(writes[0].imageUrlIsPublicHttps, true);
  assert.equal(writes[1].imageUrlIsPublicHttps, true);
});

test('createDraft preserves explicit nutrition null as clean unavailability', async (t) => {
  let capturedArgs;
  t.mock.method(recipeRepository, 'createRecipe', async (args) => {
    capturedArgs = args;
    return { _id: 'recipe1', ...args };
  });

  await recipeService.createDraft({ title: 'Nutrition unavailable', nutrition: null }, { actorId: CHICKEN_ID });

  assert.equal(capturedArgs.nutrition, null);
  assert.equal(capturedArgs.nutritionProvenance, undefined);
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
  t.mock.method(recipeRepository, 'findConsumerPage', async ({ filter }) => {
    capturedFilter = filter;
    return { items: [], total: 0 };
  });

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
  assert.deepEqual(capturedFilter.dietaryTags, { $all: ['dairyFree'] });
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

test('listRecipes guards malformed stored time values and preserves every total-time boundary', async (t) => {
  const filters = [];
  t.mock.method(recipeRepository, 'findConsumerPage', async ({ filter }) => {
    filters.push(filter);
    return { items: [], total: 0 };
  });

  for (const totalTimeBucket of ['under-15', '15-to-30', '31-to-60', 'over-60']) {
    await recipeService.listRecipes({
      totalTimeBucket, status: 'active', page: 1, limit: 20, sort: 'titleAsc', isAdmin: false,
    });
  }

  const fixtures = [
    { name: '14', prepTimeMinutes: 4, cookTimeMinutes: 10 },
    { name: '15', prepTimeMinutes: 5, cookTimeMinutes: 10 },
    { name: '30', prepTimeMinutes: 20, cookTimeMinutes: 10 },
    { name: '31', prepTimeMinutes: 21, cookTimeMinutes: 10 },
    { name: '60', prepTimeMinutes: 50, cookTimeMinutes: 10 },
    { name: '61', prepTimeMinutes: 51, cookTimeMinutes: 10 },
    { name: 'missing prep', cookTimeMinutes: 14 },
    { name: 'null prep', prepTimeMinutes: null, cookTimeMinutes: 14 },
    { name: 'string prep', prepTimeMinutes: '4', cookTimeMinutes: 10 },
    { name: 'array prep', prepTimeMinutes: [4], cookTimeMinutes: 10 },
    { name: 'object prep', prepTimeMinutes: { value: 4 }, cookTimeMinutes: 10 },
    { name: 'missing cook', prepTimeMinutes: 1 },
    { name: 'null cook', prepTimeMinutes: 1, cookTimeMinutes: null },
    { name: 'string cook', prepTimeMinutes: 1, cookTimeMinutes: '10' },
    { name: 'array cook', prepTimeMinutes: 1, cookTimeMinutes: [10] },
    { name: 'object cook', prepTimeMinutes: 1, cookTimeMinutes: { value: 10 } },
  ];
  const matches = filters.map((filter) => fixtures
    .filter((fixture) => evaluateMongoExpression(filter.$expr, fixture))
    .map((fixture) => fixture.name));
  assert.deepEqual(matches, [
    ['14', 'missing prep', 'null prep'],
    ['15', '30'],
    ['31', '60'],
    ['61'],
  ]);
});

test('listRecipes deduplicates multi-dietary AND in the single eligible page query', async (t) => {
  let findFilter;
  t.mock.method(recipeRepository, 'findConsumerPage', async ({ filter }) => {
    findFilter = filter;
    return { items: [], total: 0 };
  });

  await recipeService.listRecipes({
    search: 'adobo.*',
    region: 'bicol-region',
    category: 'dinner',
    difficulty: 'hard',
    dietaryTags: ['vegan', 'glutenFree', 'vegan'],
    ingredientId: CHICKEN_ID,
    maxPrepTimeMinutes: 30,
    totalTimeBucket: '31-to-60',
    status: 'active',
    page: 1,
    limit: 20,
    sort: 'titleAsc',
    isAdmin: false,
  });

  assert.deepEqual(findFilter.dietaryTags, { $all: ['vegan', 'glutenFree'] });
  assert.equal(findFilter.region, 'bicol-region');
  assert.equal(findFilter.category, 'dinner');
  assert.equal(findFilter.difficulty, 'hard');
  assert.equal(findFilter['ingredients.ingredientId'], CHICKEN_ID);
  assert.deepEqual(findFilter.prepTimeMinutes, { $lte: 30 });
  assert.equal(findFilter.$or[0].title.source, 'adobo\\.\\*');
  assert.ok(findFilter.$expr);
  assert.deepEqual(findFilter.$and, [{
    $or: [
      { publicationStatus: 'published' },
      { publicationStatus: { $exists: false } },
    ],
  }]);
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
    $and: [
      { $or: [
        { publicationStatus: 'published' },
        { publicationStatus: { $exists: false } },
      ] },
      { $or: [
        { 'ingredients.ingredientId': CHICKEN_ID },
        { 'cooking.spiceAlternatives.ingredients.ingredientId': CHICKEN_ID },
      ] },
    ],
  });
  assert.equal(JSON.stringify(capturedFilter).includes('optional'), false);
});

test('listRecipes composes region/category with non-relevance regex search over the eligible universe', async (t) => {
  let findFilter;
  t.mock.method(recipeRepository, 'findConsumerPage', async ({ filter }) => {
    findFilter = filter;
    return { items: [], total: 0 };
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

  assert.equal(findFilter.region, 'bicol-region');
  assert.equal(findFilter.category, 'dinner');
  assert.ok(findFilter.$or);
});

test('listRecipes applies the indexed active-Draft filter and updatedDesc sort to the same paginated universe', async (t) => {
  let findArgs;
  let countFilter;
  t.mock.method(recipeRepository, 'findMany', async (args) => {
    findArgs = args;
    return [];
  });
  t.mock.method(recipeRepository, 'countByFilter', async (filter) => {
    countFilter = filter;
    return 41;
  });

  const result = await recipeService.listRecipes({
    search: 'adobo.*',
    publicationStatus: 'draft',
    status: 'active',
    page: 3,
    limit: 20,
    sort: 'updatedDesc',
    isAdmin: true,
  });

  assert.deepEqual(findArgs.filter, countFilter);
  assert.equal(findArgs.filter.publicationStatus, 'draft');
  assert.equal(findArgs.filter.isActive, true);
  assert.equal(findArgs.filter.$or[0].title.source, 'adobo\\.\\*');
  assert.deepEqual(findArgs.sort, { updatedAt: -1, _id: 1 });
  assert.equal(findArgs.skip, 40);
  assert.equal(findArgs.limit, 20);
  assert.equal(result.total, 41);
  assert.equal('$and' in findArgs.filter, false, 'staff Draft list must not add consumer publication logic');
});

test('listRecipes leaves publication filtering unchanged when publicationStatus is omitted', async (t) => {
  let capturedFilter;
  t.mock.method(recipeRepository, 'findMany', async ({ filter }) => { capturedFilter = filter; return []; });
  t.mock.method(recipeRepository, 'countByFilter', async () => 0);
  await recipeService.listRecipes({
    status: 'active', page: 1, limit: 20, sort: 'titleAsc', isAdmin: true,
  });
  assert.equal('publicationStatus' in capturedFilter, false);
  assert.deepEqual(capturedFilter, { isActive: true });
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
  t.mock.method(recipeRepository, 'findConsumerPage', async () => ({
    items: legacyRecipes,
    total: legacyRecipes.length,
  }));
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
  assert.deepEqual(capturedUpdate.$set, {
    imageUrlIsPublicHttps: false, nutritionSourceUrlIsPublicHttps: false,
  });
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
  assert.deepEqual(capturedUpdate.$set, {
    category: 'snack', imageUrlIsPublicHttps: false, nutritionSourceUrlIsPublicHttps: false,
  });
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
  t.mock.method(recipeRepository, 'findConsumerPage', async ({ filter }) => {
    capturedFilter = filter;
    return { items: [], total: 0 };
  });

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

test('relevance composes every current filter and exclusion into the server text query', async (t) => {
  let args;
  t.mock.method(recipeRepository, 'findRanked', async (value) => {
    args = value;
    return { items: [], total: 0 };
  });
  await recipeService.listRecipes({
    search: 'adobo', region: 'central-luzon', category: 'dinner', difficulty: 'easy',
    dietaryTag: 'dairyFree', ingredientId: CHICKEN_ID, maxPrepTimeMinutes: 30,
    excludeRecipeId: '507f1f77bcf86cd799439099', status: 'active', page: 1, limit: 20,
    sort: 'relevance', isAdmin: false,
  });
  assert.equal(args.sort, 'relevance');
  assert.deepEqual(args.filter.$text, { $search: 'adobo' });
  assert.equal('$or' in args.filter, false, 'relevance must not use substring regex search');
  assert.equal(args.filter.region, 'central-luzon');
  assert.equal(args.filter.category, 'dinner');
  assert.equal(args.filter.difficulty, 'easy');
  assert.deepEqual(args.filter.dietaryTags, { $all: ['dairyFree'] });
  assert.equal(args.filter['ingredients.ingredientId'], CHICKEN_ID);
  assert.deepEqual(args.filter.prepTimeMinutes, { $lte: 30 });
  assert.deepEqual(args.filter._id, { $ne: '507f1f77bcf86cd799439099' });
});

test('every non-relevance sort preserves regex search and has an ascending _id tie-breaker', async (t) => {
  const calls = [];
  t.mock.method(recipeRepository, 'findConsumerPage', async (args) => {
    calls.push(args);
    return { items: [], total: 0 };
  });
  const sorts = ['titleAsc', 'titleDesc', 'newest', 'oldest', 'prepTimeAsc', 'prepTimeDesc', 'updatedDesc'];
  for (const sort of sorts) {
    await recipeService.listRecipes({
      search: 'adobo.*', status: 'active', page: 1, limit: 20, sort, isAdmin: false,
    });
  }
  assert.equal(calls.length, sorts.length);
  calls.forEach((call) => {
    assert.equal(call.filter.$or[0].title.source, 'adobo\\.\\*');
    assert.equal(call.sort._id, 1);
  });
});

test('consumer ranked totals and page boundaries come from the database-owned page', async (t) => {
  const ranked = completeStoredRecipe({
    _id: 'rated-b',
    ingredients: [{ ingredientId: activeIngredient(CHICKEN_ID), optional: false }],
    _ratingSummary: { averageRating: 4.8, ratingCount: 9 },
  });
  let args;
  t.mock.method(recipeRepository, 'findRanked', async (value) => {
    args = value;
    return { items: [ranked], total: 2 };
  });
  const result = await recipeService.listRecipes({
    status: 'active', page: 2, limit: 1, sort: 'topRated', isAdmin: false,
  });
  assert.equal(result.total, 2);
  assert.deepEqual(result.items.map((recipe) => recipe._id), ['rated-b']);
  assert.deepEqual(result.items[0]._ratingSummary, { averageRating: 4.8, ratingCount: 9 });
  assert.equal(args.skip, 1);
  assert.equal(args.limit, 1);
  assert.equal(args.consumerOnly, true);
});

test('topRated aggregation orders on raw average/count/id before display rounding', async (t) => {
  let pipeline;
  t.mock.method(Recipe, 'aggregate', async (value) => { pipeline = value; return []; });
  t.mock.method(Recipe, 'populate', async (rows) => rows);
  await recipeRepository.findRanked({ filter: { isActive: true }, sort: 'topRated', skip: 20, limit: 10 });
  const facet = pipeline.at(-1).$facet;
  const sortStage = facet.items.find((stage) => stage.$sort);
  const summaryStage = facet.items.find((stage) => stage.$set?._ratingSummary);
  assert.deepEqual(sortStage.$sort, {
    '_rankingReviews.averageRating': -1,
    '_rankingReviews.ratingCount': -1,
    _id: 1,
  });
  assert.deepEqual(summaryStage.$set._ratingSummary.averageRating, {
    $round: ['$_rankingReviews.averageRating', 1],
  });
  assert.deepEqual(facet.items.slice(1, 3), [{ $skip: 20 }, { $limit: 10 }]);
  assert.ok(
    facet.items.indexOf(summaryStage) > facet.items.findIndex((stage) => stage.$limit),
    'display rounding must occur only after raw-average ordering and page selection'
  );
  assert.deepEqual(pipeline.find((stage) => stage.$match?.['_rankingReviews.ratingCount']), {
    $match: { '_rankingReviews.ratingCount': { $gt: 0 } },
  });
  const reviewLookup = pipeline.find((stage) => stage.$lookup?.as === '_rankingReviews').$lookup;
  assert.equal(reviewLookup.from, Review.collection.name);
  assert.deepEqual(reviewLookup.pipeline[1].$group, {
    _id: null,
    averageRating: { $avg: '$rating' },
    ratingCount: { $sum: 1 },
  });
  assert.deepEqual(facet.total, [{ $count: 'value' }]);
});

test('relevance aggregation sorts by full text score then _id in MongoDB', async (t) => {
  let pipeline;
  t.mock.method(Recipe, 'aggregate', async (value) => { pipeline = value; return []; });
  t.mock.method(Recipe, 'populate', async (rows) => rows);
  await recipeRepository.findRanked({
    filter: { $text: { $search: 'adobo' } }, sort: 'relevance', skip: 0, limit: 20,
  });
  assert.deepEqual(pipeline[0], { $match: { $text: { $search: 'adobo' } } });
  assert.deepEqual(pipeline[1].$set, {
    _rankingScore: { $meta: 'textScore' },
  });
  assert.deepEqual(pipeline.at(-1).$facet.items[0], {
    $sort: { _rankingScore: -1, _id: 1 },
  });
  assert.deepEqual(pipeline.at(-1).$facet.items.slice(1, 3), [{ $skip: 0 }, { $limit: 20 }]);
  assert.equal(JSON.stringify(pipeline).includes('"$toLower"'), false);
  assert.equal(JSON.stringify(pipeline).includes('titleSortKey'), false);
  assert.deepEqual(pipeline.at(-1).$facet.total, [{ $count: 'value' }]);
});

test('relevance equal-score pages use _id regardless of ASCII, accented, and non-Latin titles', async (t) => {
  const rows = [
    { _id: '0003', title: 'Zebra', _rankingScore: 1.25 },
    { _id: '0005', title: 'Árbol', _rankingScore: 3.125 },
    { _id: '0001', title: '東京', _rankingScore: 1.25 },
    { _id: '0006', title: 'Ωμέγα', _rankingScore: 0.5 },
    { _id: '0004', title: 'apple', _rankingScore: 3.125 },
    { _id: '0002', title: 'éclair', _rankingScore: 1.25 },
  ].map((row) => ({ ...row, _rankingTitle: row.title.toLowerCase() }));
  const pipelines = [];
  t.mock.method(Recipe, 'aggregate', async (pipeline) => {
    pipelines.push(pipeline);
    const facet = pipeline.at(-1).$facet;
    let items = [...rows];
    for (const stage of facet.items) {
      if (stage.$sort) {
        items.sort((a, b) => {
          for (const [field, direction] of Object.entries(stage.$sort)) {
            if (a[field] < b[field]) return -direction;
            if (a[field] > b[field]) return direction;
          }
          return 0;
        });
      }
      if (stage.$skip !== undefined) items = items.slice(stage.$skip);
      if (stage.$limit !== undefined) items = items.slice(0, stage.$limit);
    }
    return [{ items, total: [{ value: rows.length }] }];
  });
  t.mock.method(Recipe, 'populate', async (items) => items);

  for (let repeat = 0; repeat < 2; repeat += 1) {
    const ids = [];
    for (const skip of [0, 2, 4]) {
      const page = await recipeRepository.findRanked({
        filter: { $text: { $search: 'feast' }, isActive: true },
        sort: 'relevance', consumerOnly: true, skip, limit: 2,
      });
      assert.equal(page.total, rows.length);
      ids.push(...page.items.map(({ _id }) => _id));
    }
    assert.deepEqual(ids, ['0004', '0005', '0001', '0002', '0003', '0006']);
    assert.equal(new Set(ids).size, rows.length, 'repeated pages have no duplicates or gaps');
  }
  for (const pipeline of pipelines) {
    const facetIndex = pipeline.findIndex((stage) => stage.$facet);
    assert.ok(pipeline.findIndex((stage) => stage.$match?.$expr) < facetIndex);
    assert.ok(pipeline.findIndex((stage) => stage.$lookup?.as === '_activeRequiredIngredients') < facetIndex);
    assert.deepEqual(pipeline[facetIndex].$facet.items[0], { $sort: { _rankingScore: -1, _id: 1 } });
    assert.deepEqual(pipeline[facetIndex].$facet.total, [{ $count: 'value' }]);
  }
});

test('consumer pagination filters completeness and active required Ingredients before one database facet', async (t) => {
  let pipeline;
  let populatedRows;
  const pageItem = completeStoredRecipe({ _id: 'page-item' });
  t.mock.method(Recipe, 'aggregate', async (value) => {
    pipeline = value;
    return [{ items: [pageItem], total: [{ value: 21 }] }];
  });
  t.mock.method(Recipe, 'populate', async (rows) => {
    populatedRows = rows;
    return rows;
  });

  const result = await recipeRepository.findConsumerPage({
    filter: { isActive: true },
    sort: { title: 1, _id: 1 },
    skip: 20,
    limit: 10,
  });

  assert.ok(pipeline.find((stage) => stage.$match?.$expr), 'completeness must be database-filtered');
  const ingredientLookup = pipeline.find((stage) => stage.$lookup?.as === '_activeRequiredIngredients').$lookup;
  assert.equal(ingredientLookup.from, Ingredient.collection.name);
  assert.equal(JSON.stringify(ingredientLookup.pipeline).includes('isActive'), true);
  const facet = pipeline.at(-1).$facet;
  assert.deepEqual(facet.items.slice(0, 3), [
    { $sort: { title: 1, _id: 1 } },
    { $skip: 20 },
    { $limit: 10 },
  ]);
  assert.deepEqual(facet.total, [{ $count: 'value' }]);
  assert.deepEqual(populatedRows, [pageItem], 'only the requested page is populated');
  assert.deepEqual(result, { items: [pageItem], total: 21 });
});

test('consumer eligibility uses UTF-16 length before paging and requires nutrition attribution', async (t) => {
  let pipeline;
  t.mock.method(Recipe, 'aggregate', async (value) => { pipeline = value; return []; });
  t.mock.method(Recipe, 'populate', async (rows) => rows);
  await recipeRepository.findConsumerPage({
    filter: { isActive: true }, sort: { title: 1, _id: 1 }, skip: 0, limit: 20,
  });
  const completenessIndex = pipeline.findIndex((stage) => stage.$match?.$expr?.$and);
  const expression = pipeline[completenessIndex].$match.$expr;
  const titleTerm = expression.$and.find((term) => JSON.stringify(term).includes('"$title"'));
  const titleLength = titleTerm.$and[1].$gte[0];
  const normalizedTitle = { $trim: {
    input: { $cond: [{ $eq: [{ $type: '$title' }, 'string'] }, '$title', ''] },
    chars: '\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff',
  } };
  const expectedLength = { $add: [
    { $strLenCP: normalizedTitle },
    { $size: { $regexFindAll: {
      input: normalizedTitle,
      regex: '[\\x{10000}-\\x{10FFFF}]',
    } } },
  ] };
  // The exact type guard and empty-string fallback keep missing, null, and
  // malformed legacy title values out of string-only aggregation operators.
  assert.deepEqual(titleTerm.$and[0], { $eq: [{ $type: '$title' }, 'string'] });
  assert.deepEqual(titleLength, expectedLength, 'the complete Mongo expression must use documented regex options');
  assert.equal(titleLength.$add[1].$size.$regexFindAll.regex,
    String.raw`[\x{10000}-\x{10FFFF}]`, 'the emitted string must retain PCRE2 backslashes');
  for (const unsupportedOption of ['u', 'g']) {
    const invalidLength = structuredClone(expectedLength);
    invalidLength.$add[1].$size.$regexFindAll.options = unsupportedOption;
    assert.throws(() => assert.deepEqual(invalidLength, expectedLength), { name: 'AssertionError' });
  }
  assert.deepEqual(titleTerm.$and[2].$lte, [titleLength, 150]);
  const lengths = [
    ['A'.repeat(150), true], ['A'.repeat(151), false],
    ['😀'.repeat(75), true], ['😀'.repeat(76), false],
    ['A'.repeat(148) + '😀', true], ['A'.repeat(149) + '😀', false],
    ['\u00a0' + 'A'.repeat(150) + '\ufeff', true],
    ['\u2028' + '😀'.repeat(76) + '\u2029', false],
  ];
  for (const [value, eligible] of lengths) {
    const normalized = value.trim();
    const codePoints = [...normalized];
    const expressionLength = codePoints.length + codePoints.filter((point) => point.codePointAt(0) > 0xffff).length;
    assert.equal(expressionLength, normalized.length);
    assert.equal(expressionLength <= 150, eligible);
  }
  const serialized = JSON.stringify(expression);
  for (const field of [
    '$nutritionProvenance.sourceKind', '$nutritionProvenance.sourceLabel',
    '$nutritionProvenance.acceptedBy', '$nutritionProvenance.acceptedAt',
    '$nutritionSourceUrlIsPublicHttps', '$imageUrlIsPublicHttps',
  ]) assert.ok(serialized.includes(field), `missing ${field}`);
  assert.ok(completenessIndex < pipeline.findIndex((stage) => stage.$facet));
});

test('database completeness requires the strict server-derived image fact and contains no URL regex', async (t) => {
  let pipeline;
  t.mock.method(Recipe, 'aggregate', async (value) => { pipeline = value; return []; });
  t.mock.method(Recipe, 'populate', async (rows) => rows);

  await recipeRepository.findConsumerPage({
    filter: { isActive: true },
    sort: { title: 1, _id: 1 },
    skip: 0,
    limit: 20,
  });

  const completeness = pipeline.find((stage) => stage.$match?.$expr).$match.$expr;
  const imageCondition = completeness.$and.find((condition) => (
    condition.$or?.some((branch) => branch.$and?.some((part) => (
      part.$eq?.[0] === '$imageUrlIsPublicHttps'
    )))
  ));
  const derivedCheck = imageCondition.$or
    .flatMap((branch) => branch.$and || [])
    .find((part) => part.$eq?.[0] === '$imageUrlIsPublicHttps');

  assert.deepEqual(derivedCheck, { $eq: ['$imageUrlIsPublicHttps', true] });
  assert.equal(JSON.stringify(completeness).includes('$regexMatch'), false);
  assert.ok(
    pipeline.indexOf(pipeline.find((stage) => stage.$match?.$expr)) < pipeline.indexOf(pipeline.at(-1)),
    'derived eligibility must remain before the count/page facet'
  );
});

test('publish and restore repository mutations persist the server-derived image fact atomically', async (t) => {
  const calls = [];
  t.mock.method(Recipe, 'findOneAndUpdate', (filter, update, options) => {
    calls.push({ filter, update, options });
    return { populate: () => ({ _id: 'recipe1' }) };
  });

  await recipeRepository.publishById('recipe1', {
    actorId: 'moderator1',
    publishedAt: new Date('2026-10-05T00:00:00.000Z'),
    expectedUpdatedAt: '2026-10-04T00:00:00.000Z',
    imageUrlIsPublicHttps: true,
    nextUpdatedAt: new Date('2026-10-05T00:00:00.001Z'),
  });
  await recipeRepository.restoreById('recipe1', {
    actorId: 'moderator1',
    expectedUpdatedAt: '2026-10-04T00:00:00.000Z',
    imageUrlIsPublicHttps: false,
    nextUpdatedAt: new Date('2026-10-05T00:00:00.001Z'),
  });

  assert.equal(calls[0].update.$set.imageUrlIsPublicHttps, true);
  assert.equal(calls[0].update.$set.publicationStatus, 'published');
  assert.equal(calls[1].update.$set.imageUrlIsPublicHttps, false);
  assert.equal(calls[1].update.$set.isActive, true);
  assert.equal(calls[0].options.runValidators, true);
});

test('repository CAS distinguishes absent, zero, and positive revisions on every mutation', async (t) => {
  const calls = [];
  t.mock.method(Recipe, 'findOneAndUpdate', (filter, update) => {
    calls.push({ filter, update });
    return { populate: async () => ({ _id: filter._id }) };
  });
  const operations = [
    (revision) => recipeRepository.updateById('recipe1', { $set: { title: 'New' } }, {
      expectedRevision: revision, nextUpdatedAt: new Date('2026-10-11T00:00:00.001Z'),
    }),
    (revision) => recipeRepository.publishById('recipe1', {
      actorId: CHICKEN_ID, publishedAt: new Date(0), expectedRevision: revision,
      imageUrlIsPublicHttps: false, nutritionSourceUrlIsPublicHttps: false,
      nextUpdatedAt: new Date('2026-10-11T00:00:00.001Z'),
    }),
    (revision) => recipeRepository.restoreById('recipe1', {
      actorId: CHICKEN_ID, expectedRevision: revision,
      imageUrlIsPublicHttps: false, nutritionSourceUrlIsPublicHttps: false,
      nextUpdatedAt: new Date('2026-10-11T00:00:00.001Z'),
    }),
    (revision) => recipeRepository.archiveById('recipe1', {
      actorId: CHICKEN_ID, expectedRevision: revision,
      nextUpdatedAt: new Date('2026-10-11T00:00:00.001Z'),
    }),
  ];
  for (const revision of [undefined, 0, 5]) {
    for (const operation of operations) await operation(revision);
  }
  for (let i = 0; i < calls.length; i += 1) {
    const expected = [undefined, 0, 5][Math.floor(i / operations.length)];
    assert.deepEqual(calls[i].filter.__v,
      expected === undefined ? { $exists: false } : expected);
    assert.deepEqual(calls[i].update.$inc, { __v: 1 });
    assert.equal(calls[i].update.$set.__v, undefined);
    assert.equal(calls[i].update.$set.updatedAt.toISOString(), '2026-10-11T00:00:00.001Z');
  }
});

test('same-millisecond competing writes have one revision winner and no stale replay', async (t) => {
  const stored = { __v: 5, title: 'Original', nutritionSourceUrlIsPublicHttps: true };
  const calls = [];
  t.mock.method(Recipe, 'findOneAndUpdate', (filter, update) => {
    calls.push({ filter, update });
    const winner = stored.__v === filter.__v;
    if (winner) {
      Object.assign(stored, update.$set);
      stored.__v += update.$inc.__v;
    }
    return { populate: async () => winner ? { ...stored } : null };
  });
  const options = {
    expectedRevision: 5, expectedUpdatedAt: '2026-10-11T00:00:00.000Z',
    nextUpdatedAt: new Date('2026-10-11T00:00:00.001Z'),
  };
  const [first, stale] = await Promise.all([
    recipeRepository.updateById('recipe1', { $set: { title: 'Winner' } }, options),
    recipeRepository.updateById('recipe1', { $set: { title: 'Stale' } }, options),
  ]);
  assert.equal([first, stale].filter(Boolean).length, 1);
  assert.equal(stored.__v, 6);
  assert.equal(stored.title, 'Winner');
  assert.equal(stored.nutritionSourceUrlIsPublicHttps, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.filter.__v), [5, 5]);
  assert.equal(stored.updatedAt.toISOString(), '2026-10-11T00:00:00.001Z');
});

test('sequential Recipe edits in one millisecond advance updatedAt on every write', async (t) => {
  const clock = new Date('2026-10-11T00:00:00.000Z');
  let stored = completeStoredRecipe({
    publicationStatus: 'draft', updatedAt: clock, __v: 2,
  });
  t.mock.method(recipeRepository, 'findRawById', async () => ({ ...stored }));
  t.mock.method(recipeRepository, 'updateById', async (_id, ops, options) => {
    assert.equal(options.expectedRevision, stored.__v);
    assert.ok(options.nextUpdatedAt > stored.updatedAt);
    stored = { ...stored, ...ops.$set, updatedAt: options.nextUpdatedAt, __v: stored.__v + 1 };
    return stored;
  });
  await recipeService.updateRecipe('recipe1', { title: 'First edit' }, { now: clock });
  assert.equal(stored.updatedAt.toISOString(), '2026-10-11T00:00:00.001Z');
  await recipeService.updateRecipe('recipe1', { title: 'Second edit' }, { now: clock });
  assert.equal(stored.updatedAt.toISOString(), '2026-10-11T00:00:00.002Z');
  assert.equal(stored.__v, 4);
});

test('cooking PATCH requires reaffirmation and validates timers against the merged instruction order', async (t) => {
  const updatedAt = new Date('2026-10-11T00:00:00.000Z');
  const existing = completeStoredRecipe({
    publicationStatus: 'draft', __v: 3, updatedAt,
    ingredients: [{ ingredientId: CHICKEN_ID }],
    instructions: ['Prepare ingredients.', 'Cook thoroughly.'],
    cooking: cookingProfile({ stepTimers: [{
      stepOrder: 2, servings: 4, spiceLevel: 'hot', durationSeconds: 90,
    }] }),
  });
  t.mock.method(recipeRepository, 'findRawById', async () => existing);
  t.mock.method(ingredientService, 'findIngredientById', async (id) => activeIngredient(id));
  const writes = [];
  t.mock.method(recipeRepository, 'updateById', async (_id, ops, options) => {
    writes.push({ ops, options });
    return { ...existing, ...ops.$set };
  });
  await assert.rejects(() => recipeService.updateRecipe('recipe1', { servings: 6 }), {
    code: 'RECIPE_COOKING_REVIEW_REQUIRED', statusCode: 409,
  });
  await assert.rejects(() => recipeService.updateRecipe('recipe1', { cooking: cookingProfile() }), {
    code: 'VALIDATION_ERROR', statusCode: 400,
  });
  await assert.rejects(() => recipeService.updateRecipe('recipe1', {
    instructions: ['Only one step.'],
    expectedUpdatedAt: updatedAt.toISOString(),
    cooking: cookingProfile({ stepTimers: [{
      stepOrder: 2, servings: 4, spiceLevel: 'hot', durationSeconds: 90,
    }] }),
  }), { code: 'RECIPE_INCOMPLETE' });
  assert.equal(writes.length, 0);

  await recipeService.updateRecipe('recipe1', {
    servings: 6,
    expectedUpdatedAt: updatedAt.toISOString(),
    cooking: cookingProfile({ stepTimers: [{
      stepOrder: 2, servings: 6, spiceLevel: 'hot', durationSeconds: 120,
    }] }),
  }, { now: updatedAt });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].options.expectedRevision, 3);
  assert.equal(writes[0].options.nextUpdatedAt.toISOString(), '2026-10-11T00:00:00.001Z');
  assert.equal(writes[0].ops.$set.cooking.stepTimers[0].servings, 6);
  await recipeService.updateRecipe('recipe1', {
    instructions: ['Only one step.'], cooking: null, expectedUpdatedAt: updatedAt.toISOString(),
  });
  assert.equal(writes[1].ops.$unset.cooking, '');
});

for (const [label, invalidIngredient, code, statusCode] of [
  ['inactive', inactiveIngredient(GARLIC_ID), 'RECIPE_INGREDIENT_INACTIVE', 400],
  ['deleted', null, 'RECIPE_INGREDIENT_NOT_FOUND', 404],
]) {
  test(`cooking PATCH rejects ${label} saved alternatives before an unrelated write and permits repair`, async (t) => {
    const clock = new Date('2026-10-11T00:00:00.000Z');
    let stored = completeStoredRecipe({
      publicationStatus: 'draft', __v: 5, updatedAt: clock,
      ingredients: [{ ingredientId: CHICKEN_ID }], cooking: cookingProfile(),
    });
    const writes = [];
    t.mock.method(recipeRepository, 'findRawById', async () => stored);
    t.mock.method(ingredientService, 'findIngredientById', async (id) =>
      id === GARLIC_ID ? invalidIngredient : activeIngredient(id));
    t.mock.method(recipeRepository, 'updateById', async (_id, ops, options) => {
      writes.push({ ops, options });
      assert.equal(options.expectedRevision, stored.__v);
      assert.equal(new Date(options.expectedUpdatedAt).getTime(), stored.updatedAt.getTime());
      assert.ok(options.nextUpdatedAt > stored.updatedAt);
      stored = { ...stored, ...ops.$set, updatedAt: options.nextUpdatedAt, __v: stored.__v + 1 };
      for (const field of Object.keys(ops.$unset || {})) delete stored[field];
      return stored;
    });

    await assert.rejects(() => recipeService.updateRecipe('recipe1', {
      title: 'Unrelated edit',
    }, { now: clock }), { code, statusCode });
    await assert.rejects(() => recipeService.updateRecipe('recipe1', {
      cooking: cookingProfile(), expectedUpdatedAt: clock.toISOString(),
    }, { now: clock }), { code, statusCode });
    assert.equal(writes.length, 0, 'both failed PATCH requests must leave the Recipe untouched');
    assert.equal(stored.title, 'Chicken Adobo');
    assert.equal(stored.__v, 5);
    assert.equal(stored.updatedAt.getTime(), clock.getTime());

    await recipeService.updateRecipe('recipe1', {
      cooking: cookingProfile({
        spiceAlternatives: [{
          spiceLevel: 'hot',
          ingredients: [{ ingredientId: OTHER_ID, quantity: 2, unit: 'clove', optional: false }],
        }],
      }),
      expectedUpdatedAt: clock.toISOString(),
    }, { now: clock });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].ops.$set.cooking.spiceAlternatives[0].ingredients[0].ingredientId, OTHER_ID);
    assert.equal('ingredients' in writes[0].ops.$set, false);
    assert.equal(stored.__v, 6);
    assert.equal(stored.updatedAt.toISOString(), '2026-10-11T00:00:00.001Z');
  });
}

test('cooking PATCH preserves a valid omitted profile and clears a broken Draft without checking old references', async (t) => {
  const clock = new Date('2026-10-11T00:00:00.000Z');
  let stored = completeStoredRecipe({
    publicationStatus: 'draft', __v: 2, updatedAt: clock,
    ingredients: [{ ingredientId: CHICKEN_ID }], cooking: cookingProfile(),
  });
  let alternativeActive = true;
  const checkedIds = [];
  const writes = [];
  t.mock.method(recipeRepository, 'findRawById', async () => stored);
  t.mock.method(ingredientService, 'findIngredientById', async (id) => {
    checkedIds.push(id);
    return id === GARLIC_ID && !alternativeActive ? inactiveIngredient(id) : activeIngredient(id);
  });
  t.mock.method(recipeRepository, 'updateById', async (_id, ops, options) => {
    writes.push({ ops, options });
    assert.equal(options.expectedRevision, stored.__v);
    assert.ok(options.nextUpdatedAt > stored.updatedAt);
    stored = { ...stored, ...ops.$set, updatedAt: options.nextUpdatedAt, __v: stored.__v + 1 };
    for (const field of Object.keys(ops.$unset || {})) delete stored[field];
    return stored;
  });

  await recipeService.updateRecipe('recipe1', { title: 'Valid edit' }, { now: clock });
  assert.deepEqual(checkedIds, [GARLIC_ID]);
  assert.equal('cooking' in writes[0].ops.$set, false);
  assert.equal(writes[0].ops.$unset?.cooking, undefined);
  assert.equal(stored.cooking.spiceAlternatives[0].ingredients[0].ingredientId, GARLIC_ID);

  alternativeActive = false;
  await recipeService.updateRecipe('recipe1', {
    cooking: null, expectedUpdatedAt: stored.updatedAt.toISOString(),
  }, { now: clock });
  assert.deepEqual(checkedIds, [GARLIC_ID], 'clearing cooking must not inspect removed references');
  assert.equal(writes[1].ops.$unset.cooking, '');
  assert.equal(stored.cooking, undefined);
  assert.equal(stored.__v, 4);
  assert.equal(stored.updatedAt.toISOString(), '2026-10-11T00:00:00.002Z');
});

test('authored timer stepOrder follows persisted 1-based instruction positions', async (t) => {
  t.mock.method(ingredientService, 'findIngredientById', async (id) => activeIngredient(id));
  let saved;
  t.mock.method(recipeRepository, 'createRecipe', async (doc) => { saved = doc; return doc; });
  await recipeService.createDraft({
    title: 'Draft Adobo', servings: 4,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'piece' }],
    steps: [{ order: 2, text: 'Simmer gently.' }, { order: 1, text: 'Prepare ingredients.' }],
    cooking: cookingProfile({ stepTimers: [{
      stepOrder: 2, servings: 4, spiceLevel: 'hot', durationSeconds: 90,
    }] }),
  });
  assert.deepEqual(saved.instructions, ['Prepare ingredients.', 'Simmer gently.']);
  assert.equal(saved.instructions[saved.cooking.stepTimers[0].stepOrder - 1], 'Simmer gently.');
});

test('inactive alternative ingredients block authoring and restore without a Recipe write', async (t) => {
  const draft = completeStoredRecipe({
    publicationStatus: 'draft', isActive: false, __v: 1,
    updatedAt: new Date('2026-10-11T00:00:00.000Z'),
    ingredients: [{ ingredientId: CHICKEN_ID }],
    cooking: cookingProfile(),
  });
  t.mock.method(ingredientService, 'findIngredientById', async (id) =>
    id === GARLIC_ID ? inactiveIngredient(id) : activeIngredient(id));
  t.mock.method(recipeRepository, 'createRecipe', async () => assert.fail('inactive alternative must not save'));
  t.mock.method(recipeRepository, 'restoreById', async () => assert.fail('inactive alternative must not restore'));
  t.mock.method(recipeRepository, 'findRawById', async () => draft);
  await assert.rejects(() => recipeService.createDraft({
    title: 'Draft Adobo', servings: 4,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'piece' }],
    instructions: ['Cook thoroughly.'], cooking: cookingProfile(),
  }), { code: 'RECIPE_INGREDIENT_INACTIVE' });
  await assert.rejects(() => recipeService.restoreRecipe('recipe1'), {
    code: 'RECIPE_INGREDIENT_INACTIVE',
  });
});

test('Publish rechecks alternative Ingredient activity and saved timer references', async (t) => {
  const draft = completeStoredRecipe({
    publicationStatus: 'draft', __v: 1,
    updatedAt: new Date('2026-10-11T00:00:00.000Z'),
    ingredients: [{ ingredientId: CHICKEN_ID }],
    cooking: cookingProfile(),
  });
  t.mock.method(recipeRepository, 'findRawById', async () => draft);
  t.mock.method(recipeRepository, 'publishById', async () => assert.fail('invalid profile must not publish'));
  t.mock.method(ingredientService, 'findIngredientById', async (id) =>
    id === GARLIC_ID ? inactiveIngredient(id) : activeIngredient(id));
  const readiness = await recipeService.getRecipePublishReadiness('recipe1', {});
  assert.equal(readiness.ready, false);
  assert.equal(readiness.issues[0].path, 'cooking.spiceAlternatives.0.ingredients.0.ingredientId');
  await assert.rejects(() => recipeService.publishRecipe('recipe1'), {
    code: 'RECIPE_INGREDIENT_INACTIVE',
  });
  draft.cooking = cookingProfile({ stepTimers: [{
    stepOrder: 2, servings: 4, spiceLevel: 'hot', durationSeconds: 90,
  }] });
  const staleTimer = await recipeService.getRecipePublishReadiness('recipe1', {});
  assert.equal(staleTimer.ready, false);
  assert.equal(staleTimer.issues[0].path, 'cooking.stepTimers.0.stepOrder');
  await assert.rejects(() => recipeService.publishRecipe('recipe1'), {
    code: 'RECIPE_INCOMPLETE',
  });
});

test('consumer detail offers only usable authored alternatives and their exact timers', async (t) => {
  const recipe = completeStoredRecipe({
    publicationStatus: 'published',
    ingredients: [{ ingredientId: activeIngredient(CHICKEN_ID), optional: false }],
    cooking: cookingProfile({
      defaultSpiceLevel: 'none',
      spiceAlternatives: [
        { spiceLevel: 'mild', ingredients: [
          { ingredientId: activeIngredient(CHICKEN_ID), quantity: 1, unit: 'piece', optional: false },
          { ingredientId: inactiveIngredient(GARLIC_ID), quantity: 1, unit: 'clove', optional: true },
        ] },
        { spiceLevel: 'hot', ingredients: [
          { ingredientId: inactiveIngredient(GARLIC_ID), quantity: 2, unit: 'clove', optional: false },
        ] },
      ],
      stepTimers: [
        { stepOrder: 1, servings: 4, spiceLevel: 'none', durationSeconds: 30 },
        { stepOrder: 1, servings: 4, spiceLevel: 'mild', durationSeconds: 60 },
        { stepOrder: 1, servings: 4, spiceLevel: 'hot', durationSeconds: 90 },
      ],
    }),
  });
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => recipe);
  const view = await recipeService.getRecipeById('recipe1', { isAdmin: false });
  assert.deepEqual(view.cooking.spiceAlternatives.map((entry) => entry.spiceLevel), ['mild']);
  assert.equal(view.cooking.spiceAlternatives[0].ingredients.length, 1);
  assert.deepEqual(view.cooking.stepTimers.map((entry) => entry.spiceLevel), ['none', 'mild']);
  const staff = await recipeService.getRecipeById('recipe1', { isAdmin: true });
  assert.equal(staff.cooking.spiceAlternatives.length, 2);
});

test('selected Shopping import resolves each authored complete list and scales without rounding', async (t) => {
  const recipe = shoppingProfiledRecipe();
  recipe.cooking.spiceAlternatives[2].ingredients.push({
    ingredientId: activeIngredient(OTHER_ID), unit: 'toTaste', optional: true,
  });
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => recipe);
  const expectedRecipeUpdatedAt = recipe.updatedAt.toISOString();
  for (const [spiceLevel, amount, id] of [
    ['none', 1.5, CHICKEN_ID], ['mild', 3, GARLIC_ID],
    ['medium', 4.5, GARLIC_ID], ['hot', 6, GARLIC_ID],
    ['extra_hot', 7.5, GARLIC_ID],
  ]) {
    const resolved = await recipeService.resolveShoppingRecipeSelection('recipe1', {
      servings: 6, spiceLevel, expectedRecipeUpdatedAt,
    });
    assert.equal(resolved.ingredients[0].ingredient.id, id);
    assert.equal(resolved.ingredients[0].quantity, amount);
    assert.equal(resolved.ingredients[0].unit, spiceLevel === 'none' ? 'kg' : 'clove');
    if (spiceLevel === 'hot') {
      assert.equal(resolved.ingredients[1].unit, 'toTaste');
      assert.equal(resolved.ingredients[1].quantity, undefined);
    }
  }
  const boundary = await recipeService.resolveShoppingRecipeSelection('recipe1', {
    servings: 1, spiceLevel: 'mild', expectedRecipeUpdatedAt,
  });
  assert.equal(boundary.ingredients[0].quantity, 0.5);
  assert.equal(boundary.ingredients[0].note, 'authored');
  assert.equal(boundary.ingredients[0].optional, false);
  assert.equal(Object.isFrozen(boundary.ingredients), true);
});

test('selected Shopping import distinguishes hidden, stale, unauthored, and unavailable spice levels', async (t) => {
  let recipe = shoppingProfiledRecipe();
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => recipe);
  const selected = { servings: 4, spiceLevel: 'hot',
    expectedRecipeUpdatedAt: recipe.updatedAt.toISOString() };
  await assert.rejects(() => recipeService.resolveShoppingRecipeSelection('recipe1', {
    ...selected, expectedRecipeUpdatedAt: '2026-10-14T00:00:00.001Z',
  }), { code: 'RECIPE_STALE', statusCode: 409 });
  await assert.rejects(() => recipeService.resolveShoppingRecipeSelection('recipe1', {
    ...selected, spiceLevel: undefined,
  }), { code: 'VALIDATION_ERROR', statusCode: 400 });
  recipe.cooking.spiceAlternatives = recipe.cooking.spiceAlternatives.filter((alt) => alt.spiceLevel !== 'hot');
  await assert.rejects(() => recipeService.resolveShoppingRecipeSelection('recipe1', selected), {
    code: 'RECIPE_SPICE_LEVEL_NOT_OFFERED', statusCode: 400,
  });
  recipe = shoppingProfiledRecipe();
  recipe.cooking.spiceAlternatives[2].ingredients[0].ingredientId = inactiveIngredient(GARLIC_ID);
  await assert.rejects(() => recipeService.resolveShoppingRecipeSelection('recipe1', selected), {
    code: 'RECIPE_SPICE_LEVEL_UNAVAILABLE', statusCode: 409,
  });
  recipe.cooking.spiceAlternatives[2].ingredients[0].optional = true;
  const optional = await recipeService.resolveShoppingRecipeSelection('recipe1', selected);
  assert.deepEqual(optional.ingredients, []);
  recipe = shoppingProfiledRecipe({ isActive: false });
  assert.equal(await recipeService.resolveShoppingRecipeSelection('recipe1', selected), null);
});

test('selected Shopping import handles unprofiled and timer-only Recipes and scaling errors', async (t) => {
  let recipe = shoppingProfiledRecipe({ cooking: undefined });
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => recipe);
  const selected = { servings: 100, expectedRecipeUpdatedAt: recipe.updatedAt.toISOString() };
  const plain = await recipeService.resolveShoppingRecipeSelection('recipe1', selected);
  assert.equal(plain.ingredients[0].quantity, 25);
  await assert.rejects(() => recipeService.resolveShoppingRecipeSelection('recipe1', {
    ...selected, spiceLevel: 'none',
  }), { code: 'RECIPE_SPICE_LEVEL_NOT_OFFERED', statusCode: 400 });
  recipe = shoppingProfiledRecipe({ cooking: {
    schemaVersion: 1, defaultSpiceLevel: null, spiceAlternatives: [], stepTimers: [],
  } });
  assert.equal((await recipeService.resolveShoppingRecipeSelection('recipe1', selected))
    .ingredients[0].quantity, 25);
  recipe = shoppingProfiledRecipe({ cooking: undefined, servings: null });
  await assert.rejects(() => recipeService.resolveShoppingRecipeSelection('recipe1', selected), {
    code: 'RECIPE_SERVINGS_UNAVAILABLE', statusCode: 422,
  });
  recipe = shoppingProfiledRecipe({ cooking: undefined, servings: 1,
    ingredients: [{ ingredientId: activeIngredient(CHICKEN_ID), quantity: Number.MAX_VALUE, unit: 'kg' }],
  });
  await assert.rejects(() => recipeService.resolveShoppingRecipeSelection('recipe1', selected), {
    code: 'RECIPE_QUANTITY_UNSCALABLE', statusCode: 422,
  });
});

test('stale title edit cannot erase a newer nutrition source or derived eligibility fact', async (t) => {
  const updatedAt = new Date('2026-10-11T00:00:00.000Z');
  const snapshot = completeStoredRecipe({ __v: 5, publicationStatus: 'draft', updatedAt });
  const stored = { ...snapshot };
  let writes = 0;
  t.mock.method(recipeRepository, 'findRawById', async () => snapshot);
  t.mock.method(recipeRepository, 'updateById', async (_id, ops, options) => {
    writes += 1;
    if (options.expectedRevision !== stored.__v) return null;
    Object.assign(stored, ops.$set);
    for (const key of Object.keys(ops.$unset || {})) delete stored[key];
    stored.__v += 1;
    return { ...stored };
  });
  const nutrition = balancedNutrition();
  await recipeService.updateRecipe('recipe1', {
    nutrition,
    nutritionSource: { kind: 'manual', label: 'Reviewed panel', url: 'https://example.com/panel' },
  }, { actorId: CHICKEN_ID, now: updatedAt });
  await assert.rejects(
    () => recipeService.updateRecipe('recipe1', { title: 'Stale title edit' }),
    { code: 'RECIPE_EDIT_CONFLICT', statusCode: 409 }
  );
  assert.equal(writes, 2, 'the stale patch must not be retried');
  assert.equal(stored.__v, 6);
  assert.equal(stored.title, snapshot.title);
  assert.equal(stored.nutritionProvenance.sourceUrl, 'https://example.com/panel');
  assert.equal(stored.nutritionSourceUrlIsPublicHttps, true);
  recipeRepository.findRawById.mock.mockImplementation(async () => ({ ...stored }));
  await recipeService.updateRecipe('recipe1', { title: 'Deliberate fresh edit' });
  assert.equal(stored.__v, 7);
  assert.equal(stored.title, 'Deliberate fresh edit');
  assert.equal(stored.nutritionSourceUrlIsPublicHttps, true);
  const reverseSnapshot = { ...stored, nutritionProvenance: { ...stored.nutritionProvenance } };
  recipeRepository.findRawById.mock.mockImplementation(async () => reverseSnapshot);
  await recipeService.updateRecipe('recipe1', { title: 'Reverse winner' });
  await assert.rejects(
    () => recipeService.updateRecipe('recipe1', { nutrition: null }),
    { code: 'RECIPE_EDIT_CONFLICT', statusCode: 409 }
  );
  assert.equal(stored.__v, 8);
  assert.equal(stored.title, 'Reverse winner');
  assert.equal(stored.nutritionProvenance.sourceUrl, 'https://example.com/panel');
  assert.equal(stored.nutritionSourceUrlIsPublicHttps, true);
});

test('listRecipes consumes only the database-eligible page and authoritative total', async (t) => {
  t.mock.method(recipeRepository, 'findConsumerPage', async () => ({
    items: [completeStoredRecipe({
      _id: 'recipe1',
      ingredients: [{ ingredientId: activeIngredient(CHICKEN_ID), optional: false }],
    })],
    total: 1,
  }));

  const result = await recipeService.listRecipes({
    status: 'active',
    page: 1,
    limit: 20,
    sort: 'titleAsc',
    isAdmin: false,
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]._id, 'recipe1');
  assert.equal(result.total, 1);
});

test('listRecipes rejects a mixed consumer page when any present nutrition is malformed', async (t) => {
  t.mock.method(recipeRepository, 'findConsumerPage', async () => ({ items: [
    completeStoredRecipe({
      _id: 'recipe1',
      nutrition: null,
      ingredients: [{ ingredientId: activeIngredient(CHICKEN_ID), optional: false }],
    }),
    completeStoredRecipe({
      _id: 'recipe2',
      nutrition: { schemaVersion: 1, basis: 'perServing', caloriesKcal: 320 },
      ingredients: [{ ingredientId: activeIngredient(GARLIC_ID), optional: false }],
    }),
  ], total: 2 }));

  await assert.rejects(() => recipeService.listRecipes({
    status: 'active', page: 1, limit: 20, sort: 'titleAsc', isAdmin: false,
  }), (error) => error.code === 'RECIPE_NUTRITION_MALFORMED');
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
  t.mock.method(recipeRepository, 'findConsumerPage', async () => ({
    items: [completeStoredRecipe({
      ingredients: [
        { ingredientId: activeIngredient(CHICKEN_ID, 'Chicken'), optional: false },
        { ingredientId: inactiveIngredient(GARLIC_ID, 'Garlic'), optional: true },
      ],
    })],
    total: 1,
  }));

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

test('restoreRecipe re-verifies every stored ingredient and refreshes image eligibility', async (t) => {
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
  let restoreArgs;
  t.mock.method(recipeRepository, 'restoreById', async (id, args) => {
    restoreArgs = args;
    return { _id: id, isActive: true };
  });

  await recipeService.restoreRecipe('recipe1');

  assert.deepEqual(checkedIds.sort(), [CHICKEN_ID, GARLIC_ID].sort());
  assert.equal(restoreArgs.imageUrlIsPublicHttps, false);
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
    expectedRevision: undefined,
    nextUpdatedAt: new Date('2026-09-30T02:00:00.000Z'),
    imageUrlIsPublicHttps: false,
    nutritionSourceUrlIsPublicHttps: false,
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

test('updateRecipe with only { title } preserves content and refreshes image eligibility from merged state', async (t) => {
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

  assert.deepEqual(Object.keys(capturedUpdate.$set), [
    'title', 'imageUrlIsPublicHttps', 'nutritionSourceUrlIsPublicHttps',
  ]);
  assert.equal(capturedUpdate.$set.imageUrlIsPublicHttps, true);
  for (const untouchedField of ['ingredients', 'instructions', 'dietaryTags', 'imageUrl', 'isActive']) {
    assert.equal(untouchedField in capturedUpdate.$set, false, `expected ${untouchedField} to be absent from $set`);
  }
});

test('archiveRecipe sets isActive: false via the repository', async (t) => {
  let archivedId;
  t.mock.method(recipeRepository, 'findRawById', async () => ({ _id: 'recipe1', __v: 5, isActive: true }));
  t.mock.method(recipeRepository, 'archiveById', async (id) => {
    archivedId = id;
    return { _id: id, isActive: false };
  });

  const recipe = await recipeService.archiveRecipe('recipe1');
  assert.equal(archivedId, 'recipe1');
  assert.equal(recipe.isActive, false);
});

test('archiveRecipe throws RECIPE_NOT_FOUND when no document matches', async (t) => {
  t.mock.method(recipeRepository, 'findRawById', async () => null);

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

test('updateRecipe stores complete nutrition with server-derived provenance under existing concurrency authority', async (t) => {
  const updatedAt = new Date('2026-10-05T00:00:00.000Z');
  const acceptedAt = new Date('2026-10-06T00:00:00.000Z');
  const nutrition = {
    schemaVersion: 1, basis: 'perServing', caloriesKcal: 320, proteinGrams: 28,
    carbohydrateGrams: 12, fatGrams: 18, sugarGrams: 3, fiberGrams: 2,
  };
  const existing = completeStoredRecipe({ publicationStatus: 'draft', updatedAt });
  let mutation;
  t.mock.method(recipeRepository, 'findRawById', async () => existing);
  t.mock.method(recipeRepository, 'updateById', async (id, update, options) => {
    mutation = { id, update, options };
    return { ...existing, ...update.$set };
  });

  await recipeService.updateRecipe('recipe1', {
    nutrition,
    nutritionSource: { kind: 'jsonLd', label: 'Schema.org Recipe JSON-LD', url: 'https://example.com/adobo' },
    expectedUpdatedAt: updatedAt.toISOString(),
  }, { actorId: CHICKEN_ID, now: acceptedAt });

  assert.deepEqual(mutation.update.$set.nutrition, nutrition);
  assert.deepEqual(mutation.update.$set.nutritionProvenance, {
    sourceKind: 'jsonLd', sourceLabel: 'Schema.org Recipe JSON-LD', sourceUrl: 'https://example.com/adobo',
    acceptedBy: CHICKEN_ID, acceptedAt,
  });
  assert.equal(mutation.update.$set.nutritionSourceUrlIsPublicHttps, true);
  assert.equal(mutation.update.$set.updatedBy, CHICKEN_ID);
  assert.equal(mutation.options.expectedUpdatedAt, updatedAt.toISOString());
});

test('nutrition clearing removes public data and provenance atomically, while stale writes still conflict', async (t) => {
  const updatedAt = new Date('2026-10-05T00:00:00.000Z');
  const existing = completeStoredRecipe({
    publicationStatus: 'draft', updatedAt,
    nutrition: { schemaVersion: 1, basis: 'perServing', caloriesKcal: 1, proteinGrams: 1, carbohydrateGrams: 1, fatGrams: 1, sugarGrams: 1, fiberGrams: 1 },
    nutritionProvenance: { sourceKind: 'manual', sourceLabel: 'Panel', acceptedBy: CHICKEN_ID, acceptedAt: updatedAt },
  });
  let mutation;
  t.mock.method(recipeRepository, 'findRawById', async () => existing);
  t.mock.method(recipeRepository, 'updateById', async (id, update, options) => {
    mutation = { update, options };
    return existing;
  });
  await recipeService.updateRecipe('recipe1', {
    nutrition: null, expectedUpdatedAt: updatedAt.toISOString(),
  }, { actorId: CHICKEN_ID });
  assert.deepEqual(mutation.update.$unset, { nutrition: '', nutritionProvenance: '' });
  assert.equal(mutation.update.$set.nutritionSourceUrlIsPublicHttps, false);

  await assert.rejects(() => recipeService.updateRecipe('recipe1', {
    nutrition: null, expectedUpdatedAt: '2026-10-04T00:00:00.000Z',
  }, { actorId: CHICKEN_ID }), { code: 'RECIPE_EDIT_CONFLICT', statusCode: 409 });
});

test('consumer detail rejects malformed present nutrition before ordinary usability filtering', async (t) => {
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => completeStoredRecipe({
    nutrition: { schemaVersion: 1, basis: 'perServing', caloriesKcal: 1 },
    ingredients: [{ ingredientId: activeIngredient(CHICKEN_ID), optional: false }],
  }));
  assert.equal(await recipeService.findUsableRecipeById('recipe1'), null);
  await assert.rejects(
    () => recipeService.getRecipeById('recipe1', { isAdmin: false }),
    (error) => error.code === 'RECIPE_NUTRITION_MALFORMED',
  );
});

test('duplicate analysis accepts sourced nutrition without creating persistence provenance', async (t) => {
  mockNoDuplicateCandidates(t);
  t.mock.method(ingredientService, 'findIngredientById', async (id) => activeIngredient(id));
  failOnRecipeWrites(t);
  const nutrition = {
    schemaVersion: 1, basis: 'perServing', caloriesKcal: 320, proteinGrams: 28,
    carbohydrateGrams: 12, fatGrams: 18, sugarGrams: 3, fiberGrams: 2,
  };

  const result = await recipeService.checkRecipeDuplicates({
    candidate: adoboPayload({
      nutrition,
      nutritionSource: { kind: 'manual', label: 'Reviewed laboratory panel' },
    }),
  });

  assert.equal(result.candidates.length, 0);
  assert.match(result.resultDigest, /^[0-9a-f]{64}$/u);
});
test('SHOP5 source summaries use one bounded Recipe lookup and omit hidden titles', async (t) => {
  const visibleId = '507f1f77bcf86cd799439099';
  const hiddenId = '507f1f77bcf86cd799439098';
  const lookup = t.mock.method(recipeRepository, 'findShoppingSourceCandidates', async () => [
    smartRecipe(visibleId, 'Recipe A'),
    smartRecipe(hiddenId, 'Secret', { isActive: false }),
  ]);
  const summaries = await recipeService.findConsumerVisibleShoppingSources([visibleId, hiddenId]);
  assert.equal(lookup.mock.callCount(), 1);
  assert.deepEqual(lookup.mock.calls[0].arguments[0], [visibleId, hiddenId]);
  assert.deepEqual(summaries.get(visibleId), { id: visibleId, title: 'Recipe A' });
  assert.equal(summaries.has(hiddenId), false);
  await assert.rejects(() => recipeService.findConsumerVisibleShoppingSources(
    Array.from({ length: 201 }, () => visibleId)
  ), TypeError);
  assert.equal(lookup.mock.callCount(), 1);
});
