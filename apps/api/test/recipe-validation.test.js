const test = require('node:test');
const assert = require('node:assert/strict');
const { RECIPE_REGIONS, RECIPE_CATEGORIES } = require('@wecooked/contracts');

const {
  createRecipeSchema,
  createDraftSchema,
  updateRecipeSchema,
  listRecipesSchema,
  recipeParamsSchema,
  duplicateCheckSchema,
  publishRecipeSchema,
  publishReadinessSchema,
  legacyPublishedRecipeBodySchema,
} = require('../src/modules/recipes/recipe.validation');

const INGREDIENT_ID = '507f1f77bcf86cd799439011';
const OTHER_INGREDIENT_ID = '507f1f77bcf86cd799439012';
const RECIPE_ID = '507f1f77bcf86cd799439099';

function validPayload(overrides = {}) {
  return {
    confirmFilipinoCuisine: true,
    title: 'Chicken Adobo',
    description: 'A classic Filipino chicken dish braised in soy sauce, vinegar, garlic, and spices.',
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

test('duplicate-check validation accepts exactly one strict subject form', () => {
  const expectedUpdatedAt = '2026-09-29T00:00:00.000Z';
  const { confirmFilipinoCuisine, ...candidate } = validPayload();
  assert.equal(duplicateCheckSchema.safeParse({ body: { recipeId: RECIPE_ID, expectedUpdatedAt } }).success, true);
  assert.equal(duplicateCheckSchema.safeParse({ body: { candidate } }).success, true);
  assert.equal(duplicateCheckSchema.safeParse({ body: { recipeId: RECIPE_ID, expectedUpdatedAt, candidate } }).success, false);
  assert.equal(duplicateCheckSchema.safeParse({ body: { recipeId: RECIPE_ID } }).success, false);
  assert.equal(duplicateCheckSchema.safeParse({ body: { candidate, sourceUrl: 'https://example.com' } }).success, false);
});

test('duplicate acknowledgement preserves strict types and shape while semantic absence reaches service enforcement', () => {
  const duplicateReview = { resultDigest: 'a'.repeat(64), confirmDistinctRecipe: true };
  for (const accepted of [
    duplicateReview,
    {},
    { resultDigest: 'a'.repeat(64) },
    { confirmDistinctRecipe: true },
    { confirmDistinctRecipe: false },
  ]) {
    assert.equal(createRecipeSchema.safeParse({ body: validPayload({ duplicateReview: accepted }) }).success, true);
    assert.equal(publishRecipeSchema.safeParse({ params: { recipeId: RECIPE_ID }, body: {
      confirmFilipinoCuisine: true, duplicateReview: accepted,
    } }).success, true);
  }
  for (const invalid of [
    { resultDigest: 'A'.repeat(64), confirmDistinctRecipe: true },
    { resultDigest: 'a'.repeat(63), confirmDistinctRecipe: true },
    { resultDigest: 'a'.repeat(64), confirmDistinctRecipe: 'true' },
    { resultDigest: 'a'.repeat(64), confirmDistinctRecipe: true, score: 100 },
    null,
    [],
    'reviewed',
  ]) {
    assert.equal(createRecipeSchema.safeParse({ body: validPayload({ duplicateReview: invalid }) }).success, false);
    assert.equal(publishRecipeSchema.safeParse({ params: { recipeId: RECIPE_ID }, body: {
      confirmFilipinoCuisine: true, duplicateReview: invalid,
    } }).success, false);
  }
});

test('publish-readiness validation requires a strict saved-version request and reuses DUP1 acknowledgement shape', () => {
  const expectedUpdatedAt = '2026-09-30T00:00:00.000Z';
  const base = { params: { recipeId: RECIPE_ID }, body: { expectedUpdatedAt } };
  assert.equal(publishReadinessSchema.safeParse(base).success, true);
  assert.equal(publishReadinessSchema.safeParse({
    ...base,
    body: {
      expectedUpdatedAt,
      duplicateReview: { resultDigest: 'a'.repeat(64), confirmDistinctRecipe: true },
    },
  }).success, true);

  for (const invalid of [
    { params: { recipeId: RECIPE_ID }, body: {} },
    { params: { recipeId: 'invalid' }, body: { expectedUpdatedAt } },
    { ...base, body: { expectedUpdatedAt, confirmFilipinoCuisine: true } },
    { ...base, body: { expectedUpdatedAt, extra: true } },
    { ...base, body: { expectedUpdatedAt, duplicateReview: { resultDigest: 'A'.repeat(64) } } },
    { ...base, body: { expectedUpdatedAt, duplicateReview: { confirmDistinctRecipe: 'true' } } },
  ]) {
    assert.equal(publishReadinessSchema.safeParse(invalid).success, false);
  }
});

test('createRecipeSchema accepts a valid Filipino recipe payload', () => {
  const result = createRecipeSchema.safeParse({ body: validPayload() });
  assert.equal(result.success, true);
});

test('createRecipeSchema accepts Sinigang na Baboy, Tinolang Manok, and Pancit Bihon fixtures', () => {
  const fixtures = [
    validPayload({ title: 'Sinigang na Baboy', difficulty: 'medium' }),
    validPayload({ title: 'Tinolang Manok', difficulty: 'easy' }),
    validPayload({ title: 'Pancit Bihon', difficulty: 'medium' }),
  ];
  for (const body of fixtures) {
    const result = createRecipeSchema.safeParse({ body });
    assert.equal(result.success, true, `expected ${body.title} to be valid`);
  }
});

test('createRecipeSchema rejects a retired cuisine field (strict body)', () => {
  const result = createRecipeSchema.safeParse({ body: validPayload({ cuisine: 'filipino' }) });
  assert.equal(result.success, false);
});

test('createRecipeSchema accepts exact optional canonical region/category values', () => {
  const result = createRecipeSchema.safeParse({
    body: validPayload({ region: 'central-luzon', category: 'dinner' }),
  });
  assert.equal(result.success, true);
  assert.equal(result.data.body.region, 'central-luzon');
  assert.equal(result.data.body.category, 'dinner');

  for (const region of RECIPE_REGIONS) assert.equal(createRecipeSchema.safeParse({ body: validPayload({ region }) }).success, true, region);
  for (const category of RECIPE_CATEGORIES) assert.equal(createRecipeSchema.safeParse({ body: validPayload({ category }) }).success, true, category);

  // Neither field is required.
  assert.equal(createRecipeSchema.safeParse({ body: validPayload() }).success, true);
});

test('createRecipeSchema rejects a region/category value that is not a slug', () => {
  assert.equal(createRecipeSchema.safeParse({ body: validPayload({ region: 'not/a/slug' }) }).success, false);
  assert.equal(createRecipeSchema.safeParse({ body: validPayload({ category: '' }) }).success, false);
  assert.equal(
    createRecipeSchema.safeParse({ body: validPayload({ category: 'x'.repeat(65) }) }).success,
    false
  );
});

test('Draft create, PATCH, and list filters reject aliases and semantic-axis leakage', () => {
  for (const region of ['tondo', 'bicol', 'mangaldan', 'Filipino', 'Philippine', 'Asian', 'Luzon', 'Visayas', 'Mindanao']) {
    assert.equal(createDraftSchema.safeParse({ body: { title: 'Draft', region } }).success, false, region);
    assert.equal(updateRecipeSchema.safeParse({ params: { recipeId: RECIPE_ID }, body: { region } }).success, false, region);
    assert.equal(listRecipesSchema.safeParse({ query: { region } }).success, false, region);
  }
  for (const category of ['dessert', 'brunch', 'appetizer', 'soup', 'pasta', 'stew', 'fine-dining-restaurant', 'medium']) {
    assert.equal(createDraftSchema.safeParse({ body: { title: 'Draft', category } }).success, false, category);
    assert.equal(updateRecipeSchema.safeParse({ params: { recipeId: RECIPE_ID }, body: { category } }).success, false, category);
    assert.equal(listRecipesSchema.safeParse({ query: { category } }).success, false, category);
  }
  assert.equal(createDraftSchema.safeParse({ body: { title: 'Draft' } }).success, true);
});

test('stored-record completeness accepts only the five frozen legacy dispositions without weakening writes', () => {
  const { confirmFilipinoCuisine, ...stored } = validPayload();
  for (const region of ['tondo', 'bicol', 'mangaldan']) {
    assert.equal(legacyPublishedRecipeBodySchema.safeParse({ ...stored, region }).success, true, region);
    assert.equal(createRecipeSchema.safeParse({ body: validPayload({ region }) }).success, false, region);
  }
  for (const category of ['fine-dining-restaurant', 'medium']) {
    assert.equal(legacyPublishedRecipeBodySchema.safeParse({ ...stored, category }).success, true, category);
    assert.equal(createRecipeSchema.safeParse({ body: validPayload({ category }) }).success, false, category);
  }
  assert.equal(legacyPublishedRecipeBodySchema.safeParse({ ...stored, region: 'cebu' }).success, false);
  assert.equal(legacyPublishedRecipeBodySchema.safeParse({ ...stored, category: 'dessert' }).success, false);
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

test('Recipe request schemas accept only exact canonical lb/oz values', () => {
  for (const unit of ['lb', 'oz']) {
    const ingredients = [{ ingredientId: INGREDIENT_ID, quantity: 2.5, unit }];
    const created = createRecipeSchema.safeParse({ body: validPayload({ ingredients }) });
    assert.equal(created.success, true, unit);
    assert.equal(created.data.body.ingredients[0].unit, unit);
    assert.equal(updateRecipeSchema.safeParse({ params: { recipeId: RECIPE_ID }, body: { ingredients } }).success, true, unit);
  }
  for (const unit of ['lb.', 'lbs', 'pound', 'oz.', 'ounce', 'LB', 'OZ', 'fl oz', 'stone']) {
    const ingredients = [{ ingredientId: INGREDIENT_ID, quantity: 1, unit }];
    assert.equal(createRecipeSchema.safeParse({ body: validPayload({ ingredients }) }).success, false, unit);
    assert.equal(updateRecipeSchema.safeParse({ params: { recipeId: RECIPE_ID }, body: { ingredients } }).success, false, unit);
  }
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

test('createRecipeSchema requires either instructions or structured steps', () => {
  const body = validPayload();
  delete body.instructions;
  assert.equal(createRecipeSchema.safeParse({ body }).success, false);
});

test('createRecipeSchema accepts structured steps in place of instructions', () => {
  const body = validPayload();
  delete body.instructions;
  body.steps = [
    { order: 1, text: 'Combine the marinade.' },
    { order: 2, text: 'Simmer until tender.' },
  ];
  const result = createRecipeSchema.safeParse({ body });
  assert.equal(result.success, true);
});

test('createRecipeSchema rejects steps with a blank, duplicate, or non-contiguous order', () => {
  const withBlank = validPayload();
  delete withBlank.instructions;
  withBlank.steps = [{ order: 1, text: '   ' }];
  assert.equal(createRecipeSchema.safeParse({ body: withBlank }).success, false);

  const dup = validPayload();
  delete dup.instructions;
  dup.steps = [{ order: 1, text: 'A' }, { order: 1, text: 'B' }];
  assert.equal(createRecipeSchema.safeParse({ body: dup }).success, false);

  const gap = validPayload();
  delete gap.instructions;
  gap.steps = [{ order: 1, text: 'A' }, { order: 3, text: 'C' }];
  assert.equal(createRecipeSchema.safeParse({ body: gap }).success, false);
});

test('createRecipeSchema accepts instructions + steps only when they describe the same ordered text', () => {
  const same = validPayload({ instructions: ['Heat oil.', 'Add garlic.'] });
  same.steps = [{ order: 2, text: 'Add garlic.' }, { order: 1, text: 'Heat oil.' }];
  assert.equal(createRecipeSchema.safeParse({ body: same }).success, true);

  const conflicting = validPayload({ instructions: ['Heat oil.', 'Add garlic.'] });
  conflicting.steps = [{ order: 1, text: 'Heat oil.' }, { order: 2, text: 'Add onion.' }];
  assert.equal(createRecipeSchema.safeParse({ body: conflicting }).success, false);
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

test('updateRecipeSchema accepts null clears and exact canonical values only', () => {
  const clearRegion = updateRecipeSchema.safeParse({
    params: { recipeId: RECIPE_ID },
    body: { region: null },
  });
  assert.equal(clearRegion.success, true);
  assert.equal(clearRegion.data.body.region, null);

  const clearCategory = updateRecipeSchema.safeParse({
    params: { recipeId: RECIPE_ID },
    body: { category: null },
  });
  assert.equal(clearCategory.success, true);
  assert.equal(clearCategory.data.body.category, null);

  const setRegion = updateRecipeSchema.safeParse({
    params: { recipeId: RECIPE_ID },
    body: { region: 'central-luzon' },
  });
  assert.equal(setRegion.success, true);
  assert.equal(setRegion.data.body.region, 'central-luzon');

  // Empty string and non-slugs are still rejected — clearing requires `null`.
  assert.equal(
    updateRecipeSchema.safeParse({ params: { recipeId: RECIPE_ID }, body: { region: '' } }).success,
    false
  );
  assert.equal(
    updateRecipeSchema.safeParse({ params: { recipeId: RECIPE_ID }, body: { category: 'bad/slug' } }).success,
    false
  );
});

test('createRecipeSchema still rejects a null region/category (clear is PATCH-only)', () => {
  assert.equal(createRecipeSchema.safeParse({ body: validPayload({ region: null }) }).success, false);
  assert.equal(createRecipeSchema.safeParse({ body: validPayload({ category: null }) }).success, false);
});

test('updateRecipeSchema rejects direct lifecycle mutation via isActive', () => {
  const result = updateRecipeSchema.safeParse({ params: { recipeId: RECIPE_ID }, body: { isActive: true } });
  assert.equal(result.success, false);
});

test('createRecipeSchema requires literal true Filipino-cuisine confirmation', () => {
  const missing = validPayload();
  delete missing.confirmFilipinoCuisine;
  assert.equal(createRecipeSchema.safeParse({ body: missing }).success, false);
  assert.equal(
    createRecipeSchema.safeParse({ body: validPayload({ confirmFilipinoCuisine: false }) }).success,
    false
  );
  for (const value of ['true', 1, {}, []]) {
    assert.equal(
      createRecipeSchema.safeParse({ body: validPayload({ confirmFilipinoCuisine: value }) }).success,
      false
    );
  }
  assert.equal(
    createRecipeSchema.safeParse({ body: validPayload({ confirmFilipinoCuisine: true }) }).success,
    true
  );
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

test('listRecipesSchema accepts exact canonical region/category filters', () => {
  const result = listRecipesSchema.safeParse({
    query: {
      search: 'adobo',
      region: 'central-luzon',
      category: 'dinner',
      difficulty: 'easy',
      dietaryTag: 'dairyFree',
      ingredientId: INGREDIENT_ID,
      maxPrepTimeMinutes: '30',
    },
  });
  assert.equal(result.success, true);
  assert.equal(result.data.query.maxPrepTimeMinutes, 30);
  assert.equal(result.data.query.region, 'central-luzon');
  assert.equal(result.data.query.category, 'dinner');
});

test('listRecipesSchema rejects a retired cuisine query param and an invalid region slug', () => {
  assert.equal(listRecipesSchema.safeParse({ query: { cuisine: 'filipino' } }).success, false);
  assert.equal(listRecipesSchema.safeParse({ query: { region: 'not/a/slug' } }).success, false);
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
