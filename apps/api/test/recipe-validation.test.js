const test = require('node:test');
const assert = require('node:assert/strict');
const { RECIPE_REGIONS, RECIPE_CATEGORIES } = require('@wecooked/contracts');

const {
  createRecipeSchema,
  createDraftSchema,
  updateRecipeSchema,
  listRecipesSchema,
  listSmartCollectionsSchema,
  getSmartCollectionSchema,
  SMART_COLLECTION_KEYS,
  recipeParamsSchema,
  duplicateCheckSchema,
  publishRecipeSchema,
  publishReadinessSchema,
  legacyPublishedRecipeBodySchema,
} = require('../src/modules/recipes/recipe.validation');

const INGREDIENT_ID = '507f1f77bcf86cd799439011';
const OTHER_INGREDIENT_ID = '507f1f77bcf86cd799439012';
const RECIPE_ID = '507f1f77bcf86cd799439099';

test('smart collection validation freezes keys and strict query shapes', () => {
  assert.deepEqual(SMART_COLLECTION_KEYS, [
    'quick-meals', 'balanced-meals', 'weekend-cooking', 'dinner-ideas', 'breakfast',
  ]);
  assert.equal(listSmartCollectionsSchema.safeParse({ query: {} }).success, true);
  for (const query of [{ sort: 'titleAsc' }, { category: 'dinner' }, { predicate: 'anything' }]) {
    assert.equal(listSmartCollectionsSchema.safeParse({ query }).success, false);
  }

  for (const groupKey of SMART_COLLECTION_KEYS) {
    const parsed = getSmartCollectionSchema.safeParse({ params: { groupKey }, query: {} });
    assert.equal(parsed.success, true, groupKey);
    assert.deepEqual(parsed.data.query, { page: 1, limit: 20 });
  }
  for (const groupKey of ['healthy-meals', 'Balanced Meals', 'dinner', '']) {
    assert.equal(getSmartCollectionSchema.safeParse({ params: { groupKey }, query: {} }).success, false);
  }
  assert.equal(getSmartCollectionSchema.safeParse({
    params: { groupKey: 'quick-meals' }, query: { page: '2', limit: '100' },
  }).success, true);
  for (const query of [{ page: '0' }, { limit: '101' }, { sort: 'titleAsc' }, { userId: RECIPE_ID }]) {
    assert.equal(getSmartCollectionSchema.safeParse({ params: { groupKey: 'quick-meals' }, query }).success, false);
  }
});

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

function authoredCooking(overrides = {}) {
  return {
    schemaVersion: 1,
    defaultSpiceLevel: 'mild',
    spiceAlternatives: [{
      spiceLevel: 'hot',
      ingredients: [{ ingredientId: INGREDIENT_ID, quantity: 2, unit: 'kg', optional: false }],
    }],
    stepTimers: [{ stepOrder: 2, servings: 4, spiceLevel: 'hot', durationSeconds: 1800 }],
    ...overrides,
  };
}

test('cooking authoring accepts complete alternatives and exact 1-based timer tuples', () => {
  assert.equal(createRecipeSchema.safeParse({ body: validPayload({ cooking: authoredCooking() }) }).success, true);
  assert.equal(updateRecipeSchema.safeParse({ params: { recipeId: RECIPE_ID }, body: {
    cooking: authoredCooking(),
  } }).success, false);
  assert.equal(updateRecipeSchema.safeParse({ params: { recipeId: RECIPE_ID }, body: {
    cooking: authoredCooking(), expectedUpdatedAt: '2026-10-11T00:00:00.000Z',
  } }).success, true);
  assert.equal(createDraftSchema.safeParse({ body: {
    title: 'Draft Adobo', servings: 4,
    ingredients: validPayload().ingredients,
    steps: [{ order: 2, text: 'Simmer gently.' }, { order: 1, text: 'Prepare ingredients.' }],
    cooking: authoredCooking({ stepTimers: [{ stepOrder: 2, servings: 4, spiceLevel: 'hot', durationSeconds: 30 }] }),
  } }).success, true);
  assert.equal(createRecipeSchema.safeParse({ body: validPayload({
    cooking: authoredCooking({ stepTimers: [{ stepOrder: 0, servings: 4, spiceLevel: 'hot', durationSeconds: 30 }] }),
  }) }).success, false);
  for (const cooking of [
    authoredCooking({ spiceAlternatives: [authoredCooking().spiceAlternatives[0], authoredCooking().spiceAlternatives[0]] }),
    authoredCooking({ spiceAlternatives: [{ ...authoredCooking().spiceAlternatives[0], spiceLevel: 'mild' }] }),
    authoredCooking({ stepTimers: [{ stepOrder: 2, servings: 4, spiceLevel: 'medium', durationSeconds: 30 }] }),
    authoredCooking({ stepTimers: [{ stepOrder: 2, servings: 4, spiceLevel: 'hot', durationSeconds: 30 },
      { stepOrder: 2, servings: 4, spiceLevel: 'hot', durationSeconds: 40 }] }),
    authoredCooking({ stepTimers: [{ stepOrder: 5, servings: 4, spiceLevel: 'hot', durationSeconds: 30 }] }),
    authoredCooking({ stepTimers: [{ stepOrder: 2, servings: 101, spiceLevel: 'hot', durationSeconds: 30 }] }),
    authoredCooking({ stepTimers: [{ stepOrder: 2, servings: 4, spiceLevel: 'hot', durationSeconds: 10801 }] }),
  ]) {
    assert.equal(createRecipeSchema.safeParse({ body: validPayload({ cooking }) }).success, false);
  }
  assert.equal(createDraftSchema.safeParse({ body: { title: 'Draft Adobo', cooking: authoredCooking() } }).success, false);
  assert.equal(createRecipeSchema.safeParse({ body: validPayload({ cooking: {
    schemaVersion: 1, defaultSpiceLevel: null, spiceAlternatives: [],
    stepTimers: [{ stepOrder: 1, servings: 2, spiceLevel: null, durationSeconds: 60 }],
  } }) }).success, true);
});

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

test('listRecipesSchema accepts only frozen total-time buckets', () => {
  for (const totalTimeBucket of ['under-15', '15-to-30', '31-to-60', 'over-60']) {
    const result = listRecipesSchema.safeParse({ query: { totalTimeBucket } });
    assert.equal(result.success, true, totalTimeBucket);
    assert.equal(result.data.query.totalTimeBucket, totalTimeBucket);
  }
  for (const totalTimeBucket of ['', 'under-14', '15-30', '61-plus', '$gt', { $gt: 60 }, ['under-15']]) {
    assert.equal(listRecipesSchema.safeParse({ query: { totalTimeBucket } }).success, false);
  }
});

test('listRecipesSchema parses, bounds, validates, and deduplicates canonical dietaryTags', () => {
  const all = 'vegetarian,vegan,pescatarian,glutenFree,dairyFree,nutFree';
  const accepted = listRecipesSchema.safeParse({ query: { dietaryTags: all } });
  assert.equal(accepted.success, true);
  assert.deepEqual(accepted.data.query.dietaryTags, all.split(','));

  const duplicate = listRecipesSchema.safeParse({
    query: { dietaryTags: 'vegetarian,vegan,vegetarian' },
  });
  assert.equal(duplicate.success, true);
  assert.deepEqual(duplicate.data.query.dietaryTags, ['vegetarian', 'vegan']);

  for (const dietaryTags of [
    '', ' ', 'vegetarian,', ',vegan', 'vegetarian,,vegan', 'Vegetarian',
    'keto', '$ne', 'vegetarian,vegan,pescatarian,glutenFree,dairyFree,nutFree,vegan',
    { $all: ['vegan'] }, ['vegetarian', 'vegan'],
  ]) {
    assert.equal(listRecipesSchema.safeParse({ query: { dietaryTags } }).success, false);
  }
});

test('listRecipesSchema preserves dietaryTag as a one-tag alias and rejects dual representation', () => {
  const alias = listRecipesSchema.safeParse({ query: { dietaryTag: 'vegan' } });
  assert.equal(alias.success, true);
  assert.equal(alias.data.query.dietaryTag, 'vegan');
  assert.equal(listRecipesSchema.safeParse({
    query: { dietaryTag: 'vegan', dietaryTags: 'vegan' },
  }).success, false);
});

test('listRecipesSchema accepts only the frozen Draft publication filter and updated-time sort', () => {
  const accepted = listRecipesSchema.safeParse({
    query: { publicationStatus: 'draft', status: 'active', sort: 'updatedDesc' },
  });
  assert.equal(accepted.success, true);
  assert.equal(accepted.data.query.publicationStatus, 'draft');
  assert.equal(accepted.data.query.sort, 'updatedDesc');
  assert.equal(listRecipesSchema.safeParse({ query: {} }).success, true);
  for (const publicationStatus of ['published', 'all', 'Draft', '']) {
    assert.equal(listRecipesSchema.safeParse({ query: { publicationStatus } }).success, false, publicationStatus);
  }
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

test('listRecipesSchema accepts frozen ranking sorts and strict exclusion', () => {
  assert.equal(listRecipesSchema.safeParse({ query: { sort: 'topRated', excludeRecipeId: RECIPE_ID } }).success, true);
  assert.equal(listRecipesSchema.safeParse({ query: { sort: 'relevance', search: 'adobo' } }).success, true);
  assert.equal(listRecipesSchema.safeParse({ query: { sort: 'relevance' } }).success, false);
  assert.equal(listRecipesSchema.safeParse({ query: { sort: 'relevance', search: '   ' } }).success, false);
  assert.equal(listRecipesSchema.safeParse({ query: { excludeRecipeId: 'bad' } }).success, false);
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

const validNutrition = () => ({
  schemaVersion: 1, basis: 'perServing', caloriesKcal: 320, proteinGrams: 28,
  carbohydrateGrams: 12, fatGrams: 18, sugarGrams: 3, fiberGrams: 2,
});
const validNutritionSource = () => ({
  kind: 'manual', label: 'Laboratory nutrition panel', url: 'https://example.com/nutrition',
});

test('Recipe write validation accepts only complete exact v1 per-serving nutrition with source material', () => {
  const accepted = validPayload({ nutrition: validNutrition(), nutritionSource: validNutritionSource() });
  assert.equal(createRecipeSchema.safeParse({ body: accepted }).success, true);
  assert.equal(createDraftSchema.safeParse({ body: {
    title: 'Draft nutrition', nutrition: validNutrition(), nutritionSource: validNutritionSource(),
  } }).success, true);
  assert.equal(updateRecipeSchema.safeParse({
    params: { recipeId: RECIPE_ID },
    body: { nutrition: validNutrition(), nutritionSource: validNutritionSource() },
  }).success, true);
  assert.equal(updateRecipeSchema.safeParse({
    params: { recipeId: RECIPE_ID }, body: { nutrition: null },
  }).success, true);
});

test('Recipe nutrition validation rejects partial, extra, coerced, nonfinite, negative, and unsourced input', () => {
  const invalidNutrition = [
    { ...validNutrition(), fiberGrams: undefined },
    { ...validNutrition(), caloriesKcal: '320' },
    { ...validNutrition(), proteinGrams: -1 },
    { ...validNutrition(), fatGrams: Number.NaN },
    { ...validNutrition(), sugarGrams: Number.POSITIVE_INFINITY },
    { ...validNutrition(), sodiumGrams: 1 },
    { ...validNutrition(), schemaVersion: 2 },
    { ...validNutrition(), basis: 'totalRecipe' },
  ];
  for (const nutrition of invalidNutrition) {
    assert.equal(createRecipeSchema.safeParse({ body: validPayload({
      nutrition, nutritionSource: validNutritionSource(),
    }) }).success, false);
  }
  assert.equal(createRecipeSchema.safeParse({ body: validPayload({ nutrition: validNutrition() }) }).success, false);
  assert.equal(updateRecipeSchema.safeParse({
    params: { recipeId: RECIPE_ID }, body: { nutritionSource: validNutritionSource() },
  }).success, false);
  assert.equal(updateRecipeSchema.safeParse({
    params: { recipeId: RECIPE_ID }, body: {
      nutrition: validNutrition(), nutritionSource: { ...validNutritionSource(), acceptedBy: INGREDIENT_ID },
    },
  }).success, false);
  assert.equal(updateRecipeSchema.safeParse({
    params: { recipeId: RECIPE_ID }, body: {
      nutrition: validNutrition(), nutritionSource: validNutritionSource(), nutritionAcceptedAt: '2026-10-06T00:00:00Z',
    },
  }).success, false);
});

test('duplicate-check candidate accepts complete sourced nutrition and rejects malformed nutrition', () => {
  const { confirmFilipinoCuisine, ...candidate } = validPayload({
    nutrition: validNutrition(),
    nutritionSource: validNutritionSource(),
  });
  assert.equal(duplicateCheckSchema.safeParse({ body: { candidate } }).success, true);
  assert.equal(duplicateCheckSchema.safeParse({ body: {
    candidate: { ...candidate, nutrition: { ...candidate.nutrition, fiberGrams: undefined } },
  } }).success, false);
});
