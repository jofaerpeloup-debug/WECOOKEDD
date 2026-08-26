const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createRecipeSchema,
  updateRecipeSchema,
  listRecipesSchema,
  recipeParamsSchema,
} = require('../src/modules/recipes/recipe.validation');

const INGREDIENT_ID = '507f1f77bcf86cd799439011';
const OTHER_INGREDIENT_ID = '507f1f77bcf86cd799439012';
const RECIPE_ID = '507f1f77bcf86cd799439099';

function validPayload(overrides = {}) {
  return {
    title: 'Chicken Adobo',
    description: 'A classic Filipino chicken dish braised in soy sauce, vinegar, garlic, and spices.',
    cuisine: 'filipino',
    difficulty: 'easy',
    prepTimeMinutes: 15,
    cookTimeMinutes: 40,
    servings: 4,
    ingredients: [
      { ingredientId: INGREDIENT_ID, quantity: 1, unit: 'kg', note: 'cut into serving pieces', optional: false },
      { ingredientId: OTHER_INGREDIENT_ID, quantity: 0.5, unit: 'cup', note: null, optional: false },
    ],
    instructions: [
      'Combine chicken, soy sauce, garlic, and bay leaves.',
      'Marinate for at least 30 minutes.',
      'Simmer until the chicken is cooked through.',
      'Add vinegar and reduce the sauce.',
    ],
    dietaryTags: [],
    imageUrl: null,
    ...overrides,
  };
}

test('createRecipeSchema accepts a valid Filipino recipe payload', () => {
  const result = createRecipeSchema.safeParse({ body: validPayload() });
  assert.equal(result.success, true);
});

test('createRecipeSchema accepts Sinigang na Baboy, Tinolang Manok, and Pancit Bihon fixtures', () => {
  const fixtures = [
    validPayload({ title: 'Sinigang na Baboy', cuisine: 'filipino', difficulty: 'medium' }),
    validPayload({ title: 'Tinolang Manok', cuisine: 'filipino', difficulty: 'easy' }),
    validPayload({ title: 'Pancit Bihon', cuisine: 'filipino', difficulty: 'medium' }),
  ];
  for (const body of fixtures) {
    const result = createRecipeSchema.safeParse({ body });
    assert.equal(result.success, true, `expected ${body.title} to be valid`);
  }
});

test('createRecipeSchema rejects an invalid cuisine', () => {
  const result = createRecipeSchema.safeParse({ body: validPayload({ cuisine: 'klingon' }) });
  assert.equal(result.success, false);
});

test('createRecipeSchema rejects an invalid difficulty', () => {
  const result = createRecipeSchema.safeParse({ body: validPayload({ difficulty: 'nightmare' }) });
  assert.equal(result.success, false);
});

test('createRecipeSchema rejects an invalid ObjectId for an ingredient reference', () => {
  const result = createRecipeSchema.safeParse({
    body: validPayload({ ingredients: [{ ingredientId: 'not-an-id', quantity: 1, unit: 'kg' }] }),
  });
  assert.equal(result.success, false);
});

test('createRecipeSchema rejects a zero, negative, or non-finite quantity', () => {
  for (const quantity of [0, -1, Infinity, -Infinity]) {
    const result = createRecipeSchema.safeParse({
      body: validPayload({ ingredients: [{ ingredientId: INGREDIENT_ID, quantity, unit: 'kg' }] }),
    });
    assert.equal(result.success, false, `expected quantity ${quantity} to be rejected`);
  }
});

test('createRecipeSchema requires quantity for a measurable unit', () => {
  const result = createRecipeSchema.safeParse({
    body: validPayload({ ingredients: [{ ingredientId: INGREDIENT_ID, unit: 'kg' }] }),
  });
  assert.equal(result.success, false);
});

test('createRecipeSchema rejects a quantity when unit is "toTaste" ("salt to taste")', () => {
  const result = createRecipeSchema.safeParse({
    body: validPayload({ ingredients: [{ ingredientId: INGREDIENT_ID, quantity: 1, unit: 'toTaste' }] }),
  });
  assert.equal(result.success, false);
});

test('createRecipeSchema allows unit "toTaste" with quantity omitted or explicitly null', () => {
  const omitted = createRecipeSchema.safeParse({
    body: validPayload({ ingredients: [{ ingredientId: INGREDIENT_ID, unit: 'toTaste', note: 'salt to taste' }] }),
  });
  assert.equal(omitted.success, true);

  const nulled = createRecipeSchema.safeParse({
    body: validPayload({
      ingredients: [{ ingredientId: INGREDIENT_ID, quantity: null, unit: 'toTaste', note: 'salt to taste' }],
    }),
  });
  assert.equal(nulled.success, true);
});

test('createRecipeSchema rejects an unknown ingredient unit', () => {
  const result = createRecipeSchema.safeParse({
    body: validPayload({ ingredients: [{ ingredientId: INGREDIENT_ID, quantity: 1, unit: 'gallon' }] }),
  });
  assert.equal(result.success, false);
});

test('createRecipeSchema rejects unknown top-level fields', () => {
  const result = createRecipeSchema.safeParse({ body: validPayload({ notARealField: true }) });
  assert.equal(result.success, false);
});

test('createRecipeSchema rejects unknown fields on an embedded ingredient entry', () => {
  const result = createRecipeSchema.safeParse({
    body: validPayload({
      ingredients: [{ ingredientId: INGREDIENT_ID, quantity: 1, unit: 'kg', extra: 'nope' }],
    }),
  });
  assert.equal(result.success, false);
});

test('createRecipeSchema rejects an empty ingredients array', () => {
  const result = createRecipeSchema.safeParse({ body: validPayload({ ingredients: [] }) });
  assert.equal(result.success, false);
});

test('createRecipeSchema rejects an empty instructions array', () => {
  const result = createRecipeSchema.safeParse({ body: validPayload({ instructions: [] }) });
  assert.equal(result.success, false);
});

test('createRecipeSchema rejects a blank instruction step', () => {
  const result = createRecipeSchema.safeParse({ body: validPayload({ instructions: ['   '] }) });
  assert.equal(result.success, false);
});

test('createRecipeSchema defaults dietaryTags to [] and preserves valid values', () => {
  const withoutTags = createRecipeSchema.safeParse({ body: validPayload({ dietaryTags: undefined }) });
  assert.equal(withoutTags.success, true);
  assert.deepEqual(withoutTags.data.body.dietaryTags, []);

  const withTags = createRecipeSchema.safeParse({ body: validPayload({ dietaryTags: ['dairyFree', 'glutenFree'] }) });
  assert.equal(withTags.success, true);
});

test('createRecipeSchema rejects an invalid dietary tag', () => {
  const result = createRecipeSchema.safeParse({ body: validPayload({ dietaryTags: ['not-a-tag'] }) });
  assert.equal(result.success, false);
});

test('createRecipeSchema rejects a non-URL imageUrl but allows null', () => {
  const invalid = createRecipeSchema.safeParse({ body: validPayload({ imageUrl: 'not-a-url' }) });
  assert.equal(invalid.success, false);

  const nullUrl = createRecipeSchema.safeParse({ body: validPayload({ imageUrl: null }) });
  assert.equal(nullUrl.success, true);

  const validUrl = createRecipeSchema.safeParse({
    body: validPayload({ imageUrl: 'https://example.com/adobo.jpg' }),
  });
  assert.equal(validUrl.success, true);
});

test('createRecipeSchema rejects out-of-range prepTimeMinutes/cookTimeMinutes/servings', () => {
  assert.equal(createRecipeSchema.safeParse({ body: validPayload({ prepTimeMinutes: -1 }) }).success, false);
  assert.equal(createRecipeSchema.safeParse({ body: validPayload({ prepTimeMinutes: 1.5 }) }).success, false);
  assert.equal(createRecipeSchema.safeParse({ body: validPayload({ cookTimeMinutes: -1 }) }).success, false);
  assert.equal(createRecipeSchema.safeParse({ body: validPayload({ servings: 0 }) }).success, false);
  assert.equal(createRecipeSchema.safeParse({ body: validPayload({ servings: 1.5 }) }).success, false);
});

test('updateRecipeSchema accepts a single-field partial update', () => {
  const result = updateRecipeSchema.safeParse({
    params: { recipeId: RECIPE_ID },
    body: { title: 'Chicken Adobo (Updated)' },
  });
  assert.equal(result.success, true);
});

test('updateRecipeSchema rejects an empty body', () => {
  const result = updateRecipeSchema.safeParse({ params: { recipeId: RECIPE_ID }, body: {} });
  assert.equal(result.success, false);
});

test('updateRecipeSchema does not default omitted ingredients/instructions/dietaryTags (would wipe stored arrays)', () => {
  const result = updateRecipeSchema.safeParse({
    params: { recipeId: RECIPE_ID },
    body: { title: 'New Title' },
  });
  assert.equal(result.success, true);
  assert.equal('ingredients' in result.data.body, false);
  assert.equal('instructions' in result.data.body, false);
  assert.equal('dietaryTags' in result.data.body, false);
});

test('updateRecipeSchema treats a provided ingredients array as a full replacement and validates every entry', () => {
  const result = updateRecipeSchema.safeParse({
    params: { recipeId: RECIPE_ID },
    body: { ingredients: [{ ingredientId: INGREDIENT_ID, unit: 'kg' }] },
  });
  assert.equal(result.success, false);

  const valid = updateRecipeSchema.safeParse({
    params: { recipeId: RECIPE_ID },
    body: { ingredients: [{ ingredientId: INGREDIENT_ID, quantity: 2, unit: 'kg' }] },
  });
  assert.equal(valid.success, true);
});

test('updateRecipeSchema allows reactivation via isActive: true', () => {
  const result = updateRecipeSchema.safeParse({ params: { recipeId: RECIPE_ID }, body: { isActive: true } });
  assert.equal(result.success, true);
});

test('updateRecipeSchema rejects unknown fields', () => {
  const result = updateRecipeSchema.safeParse({
    params: { recipeId: RECIPE_ID },
    body: { title: 'x', notReal: true },
  });
  assert.equal(result.success, false);
});

test('recipeParamsSchema accepts a valid ObjectId and rejects an invalid one', () => {
  assert.equal(recipeParamsSchema.safeParse({ params: { recipeId: RECIPE_ID } }).success, true);
  assert.equal(recipeParamsSchema.safeParse({ params: { recipeId: 'nope' } }).success, false);
});

test('listRecipesSchema applies defaults for status/sort/page/limit', () => {
  const result = listRecipesSchema.safeParse({ query: {} });
  assert.equal(result.success, true);
  assert.equal(result.data.query.status, 'active');
  assert.equal(result.data.query.sort, 'titleAsc');
  assert.equal(result.data.query.page, 1);
  assert.equal(result.data.query.limit, 20);
});

test('listRecipesSchema accepts search, cuisine, difficulty, dietaryTag, ingredientId, and maxPrepTimeMinutes', () => {
  const result = listRecipesSchema.safeParse({
    query: {
      search: 'adobo',
      cuisine: 'filipino',
      difficulty: 'easy',
      dietaryTag: 'dairyFree',
      ingredientId: INGREDIENT_ID,
      maxPrepTimeMinutes: '30',
    },
  });
  assert.equal(result.success, true);
  assert.equal(result.data.query.maxPrepTimeMinutes, 30);
});

test('listRecipesSchema rejects an invalid ingredientId', () => {
  const result = listRecipesSchema.safeParse({ query: { ingredientId: 'nope' } });
  assert.equal(result.success, false);
});

test('listRecipesSchema rejects an invalid sort value (no raw Mongo sort syntax)', () => {
  assert.equal(listRecipesSchema.safeParse({ query: { sort: 'nameAsc' } }).success, false);
  assert.equal(listRecipesSchema.safeParse({ query: { sort: '{ title: 1 }' } }).success, false);
});

test('listRecipesSchema caps limit at 100', () => {
  const result = listRecipesSchema.safeParse({ query: { limit: '500' } });
  assert.equal(result.success, false);
});

test('listRecipesSchema rejects unknown query params', () => {
  const result = listRecipesSchema.safeParse({ query: { foo: 'bar' } });
  assert.equal(result.success, false);
});

test('listRecipesSchema accepts status active/inactive/all and rejects anything else', () => {
  assert.equal(listRecipesSchema.safeParse({ query: { status: 'active' } }).success, true);
  assert.equal(listRecipesSchema.safeParse({ query: { status: 'inactive' } }).success, true);
  assert.equal(listRecipesSchema.safeParse({ query: { status: 'all' } }).success, true);
  assert.equal(listRecipesSchema.safeParse({ query: { status: 'archived' } }).success, false);
});