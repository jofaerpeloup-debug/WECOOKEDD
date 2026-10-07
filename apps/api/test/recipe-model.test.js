const test = require('node:test');
const assert = require('node:assert/strict');

const Recipe = require('../src/modules/recipes/recipe.model');
const { toPublicRecipe, toStaffRecipe } = require('../src/modules/recipes/recipe.serializer');
const { RECIPE_REGIONS, RECIPE_CATEGORIES } = require('@wecooked/contracts');

const INGREDIENT_ID = '507f1f77bcf86cd799439011';
const OTHER_INGREDIENT_ID = '507f1f77bcf86cd799439012';

function baseRecipe(overrides = {}) {
  return new Recipe({
    title: 'Chicken Adobo',
    description: 'A classic Filipino chicken dish braised in soy sauce, vinegar, garlic, and spices.',
    difficulty: 'easy',
    prepTimeMinutes: 15,
    cookTimeMinutes: 40,
    servings: 4,
    ingredients: [{ ingredientId: INGREDIENT_ID, quantity: 1, unit: 'kg' }],
    instructions: [
      'Combine chicken, soy sauce, garlic, and bay leaves.',
      'Marinate for at least 30 minutes.',
      'Simmer until the chicken is cooked through.',
    ],
    ...overrides,
  });
}

test('Recipe exposes the exact 17-value canonical measurement-unit contract', () => {
  assert.deepEqual(Recipe.UNITS, [
    'g', 'kg', 'lb', 'oz', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'piece', 'clove', 'slice', 'can', 'pack',
    'bunch', 'pinch', 'toTaste',
  ]);
});

test('a Draft requires only a title at the persistence layer', async () => {
  const recipe = new Recipe({});
  await assert.rejects(() => recipe.validate(), (err) => {
    assert.ok(err.errors.title);
    return true;
  });
  await assert.doesNotReject(() => new Recipe({ title: 'Draft Adobo' }).validate());
});

test('title is normalized, Unicode-aware, length-limited, and does not require uniqueness', async () => {
  const path = Recipe.schema.path('title');
  assert.equal(path.options.required, true);
  assert.equal(path.options.trim, true);
  assert.equal(path.options.maxlength, Recipe.MAX_TITLE_LENGTH);
  assert.notEqual(path.options.unique, true);
  const normalized = baseRecipe({ title: '  Crème   brûlée  ' });
  await normalized.validate();
  assert.equal(normalized.title, 'Crème brûlée');
  await assert.doesNotReject(() => baseRecipe({ title: 'Ab' }).validate());
  for (const title of ['A', '12', '@@@']) {
    await assert.rejects(() => baseRecipe({ title }).validate(), title);
  }
});

test('cuisine is no longer part of the Recipe schema (retired in M3)', () => {
  assert.equal(Recipe.schema.path('cuisine'), undefined);
  assert.equal(Recipe.CUISINES, undefined);
});

test('region and category are optional exact canonical enums', async () => {
  for (const field of ['region', 'category']) {
    const path = Recipe.schema.path(field);
    assert.equal(path.isRequired, undefined);
  }
  await assert.doesNotReject(() => baseRecipe().validate());
  for (const region of RECIPE_REGIONS) await assert.doesNotReject(() => baseRecipe({ region }).validate());
  for (const category of RECIPE_CATEGORIES) await assert.doesNotReject(() => baseRecipe({ category }).validate());
  for (const region of ['bicol', 'Filipino', 'Luzon', 'not/a/slug']) {
    await assert.rejects(() => baseRecipe({ region }).validate());
  }
  for (const category of ['main-dish', 'dessert', 'medium']) {
    await assert.rejects(() => baseRecipe({ category }).validate());
  }
});

test('a legacy document that physically still carries cuisine serializes without leaking it', () => {
  const legacy = {
    _id: '507f1f77bcf86cd7994390aa',
    title: 'Old Adobo',
    description: 'Predates the M3 schema.',
    cuisine: 'filipino',
    difficulty: 'easy',
    prepTimeMinutes: 10,
    cookTimeMinutes: 30,
    servings: 4,
    ingredients: [],
    instructions: ['Cook.'],
    dietaryTags: [],
    imageUrl: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const publicRecipe = toPublicRecipe(legacy);
  assert.equal('cuisine' in publicRecipe, false);
  assert.equal(publicRecipe.region, null);
  assert.equal(publicRecipe.category, null);
});

test('difficulty is constrained to easy/medium/hard', async () => {
  assert.deepEqual(Recipe.schema.path('difficulty').options.enum, ['easy', 'medium', 'hard']);
  const invalid = baseRecipe({ difficulty: 'nightmare' });
  await assert.rejects(() => invalid.validate());
});

test('new persistence requires optional prep >= 1 and cook >= 3 while hydrated legacy zeros remain readable', async () => {
  await assert.doesNotReject(() => baseRecipe({ prepTimeMinutes: undefined }).validate());
  await assert.rejects(() => baseRecipe({ publicationStatus: 'published', cookTimeMinutes: undefined }).validate());
  await assert.doesNotReject(() => baseRecipe({ prepTimeMinutes: undefined, cookTimeMinutes: 3 }).validate());
  await assert.doesNotReject(() => baseRecipe({ prepTimeMinutes: 1, cookTimeMinutes: 1440 }).validate());
  await assert.rejects(() => baseRecipe({ prepTimeMinutes: 0 }).validate());
  await assert.rejects(() => baseRecipe({ prepTimeMinutes: -1 }).validate());
  await assert.rejects(() => baseRecipe({ prepTimeMinutes: 1.5 }).validate());
  await assert.rejects(() => baseRecipe({ prepTimeMinutes: Recipe.MAX_PREP_TIME_MINUTES + 1 }).validate());
  await assert.rejects(() => baseRecipe({ cookTimeMinutes: 0 }).validate());
  await assert.rejects(() => baseRecipe({ cookTimeMinutes: 1 }).validate());
  await assert.rejects(() => baseRecipe({ cookTimeMinutes: 2 }).validate());
  await assert.rejects(() => baseRecipe({ cookTimeMinutes: -1 }).validate());
  await assert.rejects(() => baseRecipe({ cookTimeMinutes: 3.5 }).validate());
  await assert.rejects(() => baseRecipe({ cookTimeMinutes: Recipe.MAX_COOK_TIME_MINUTES + 1 }).validate());

  const legacy = Recipe.hydrate(baseRecipe({ prepTimeMinutes: 0, cookTimeMinutes: 0 }).toObject({ depopulate: true }));
  assert.equal(legacy.prepTimeMinutes, 0);
  assert.equal(legacy.cookTimeMinutes, 0);
});

test('servings must be a positive integer within a reasonable bound', async () => {
  await assert.rejects(() => baseRecipe({ servings: 0 }).validate());
  await assert.rejects(() => baseRecipe({ servings: -1 }).validate());
  await assert.rejects(() => baseRecipe({ servings: 1.5 }).validate());
  await assert.rejects(() => baseRecipe({ servings: Recipe.MAX_SERVINGS + 1 }).validate());
  await assert.doesNotReject(() => baseRecipe({ servings: Recipe.MAX_SERVINGS }).validate());
});

test('ingredients allows an empty Draft list and rejects more than the maximum', async () => {
  await assert.doesNotReject(() => baseRecipe({ ingredients: [] }).validate());

  const tooMany = baseRecipe({
    ingredients: Array.from({ length: Recipe.MAX_INGREDIENTS + 1 }, () => ({
      ingredientId: INGREDIENT_ID,
      quantity: 1,
      unit: 'piece',
    })),
  });
  await assert.rejects(() => tooMany.validate());
});

test('embedded ingredient usage references Ingredient and requires a controlled unit', () => {
  const recipe = baseRecipe();
  const entry = recipe.ingredients[0];
  assert.equal(String(entry.ingredientId), INGREDIENT_ID);
  assert.equal(entry.unit, 'kg');
  assert.equal(entry.optional, false);
});

test('the same ingredient may appear twice in one recipe (garlic for marinade and garnish)', async () => {
  const recipe = baseRecipe({
    ingredients: [
      { ingredientId: INGREDIENT_ID, quantity: 3, unit: 'clove', note: 'minced for marinade' },
      { ingredientId: INGREDIENT_ID, quantity: 1, unit: 'clove', note: 'thinly sliced for garnish', optional: true },
    ],
  });
  await assert.doesNotReject(() => recipe.validate());
  assert.equal(recipe.ingredients.length, 2);
});

test('quantity is required and must be a finite positive number for a measurable unit', async () => {
  for (const unit of ['lb', 'oz']) {
    const recipe = baseRecipe({ ingredients: [{ ingredientId: INGREDIENT_ID, quantity: 2.5, unit }] });
    await assert.doesNotReject(() => recipe.validate(), unit);
    assert.equal(recipe.ingredients[0].unit, unit);
    assert.equal(recipe.ingredients[0].quantity, 2.5);
  }
  await assert.rejects(() =>
    baseRecipe({ ingredients: [{ ingredientId: INGREDIENT_ID, unit: 'kg' }] }).validate()
  );
  await assert.rejects(() =>
    baseRecipe({ ingredients: [{ ingredientId: INGREDIENT_ID, quantity: 0, unit: 'kg' }] }).validate()
  );
  await assert.rejects(() =>
    baseRecipe({ ingredients: [{ ingredientId: INGREDIENT_ID, quantity: -1, unit: 'kg' }] }).validate()
  );
  await assert.rejects(() =>
    baseRecipe({ ingredients: [{ ingredientId: INGREDIENT_ID, quantity: Infinity, unit: 'kg' }] }).validate()
  );
});

test('unit "toTaste" requires quantity to be omitted (salt to taste)', async () => {
  const withQuantity = baseRecipe({
    ingredients: [{ ingredientId: INGREDIENT_ID, quantity: 1, unit: 'toTaste' }],
  });
  await assert.rejects(() => withQuantity.validate());

  const withoutQuantity = baseRecipe({
    ingredients: [{ ingredientId: INGREDIENT_ID, unit: 'toTaste', note: 'salt to taste' }],
  });
  await assert.doesNotReject(() => withoutQuantity.validate());
  assert.equal(withoutQuantity.ingredients[0].quantity, undefined);
});

test('an unknown unit is rejected by the controlled enum', async () => {
  const invalid = baseRecipe({
    ingredients: [{ ingredientId: INGREDIENT_ID, quantity: 1, unit: 'gallon' }],
  });
  await assert.rejects(() => invalid.validate());
});

test('ingredient optional flag defaults to false', () => {
  const recipe = baseRecipe();
  assert.equal(recipe.ingredients[0].optional, false);
});

test('instructions allows an empty Draft list, rejects non-meaningful persisted steps, preserves order, and enforces the maximum', async () => {
  await assert.doesNotReject(() => baseRecipe({ instructions: [] }).validate());
  for (const instruction of ['', 'A', '12', '@@@']) {
    await assert.rejects(() => baseRecipe({ instructions: [instruction] }).validate(), instruction);
  }
  await assert.doesNotReject(() => baseRecipe({ instructions: ['Mix'] }).validate());
  await assert.doesNotReject(() => baseRecipe({ instructions: ['Añade 2 tazas.'] }).validate());

  const ordered = baseRecipe({ instructions: ['Step one.', 'Step two.', 'Step three.'] });
  await ordered.validate();
  assert.deepEqual(ordered.instructions, ['Step one.', 'Step two.', 'Step three.']);

  const tooMany = baseRecipe({
    instructions: Array.from({ length: Recipe.MAX_INSTRUCTIONS + 1 }, (_, i) => `Step ${i}`),
  });
  await assert.rejects(() => tooMany.validate());
});

test('instructions are trimmed', () => {
  const recipe = baseRecipe({ instructions: ['  Simmer until tender.  '] });
  assert.equal(recipe.instructions[0], 'Simmer until tender.');
});

test('dietaryTags default to [] and reject values outside the controlled enum', async () => {
  const recipe = baseRecipe();
  assert.deepEqual(recipe.dietaryTags, []);

  const invalid = baseRecipe({ dietaryTags: ['not-a-real-tag'] });
  await assert.rejects(() => invalid.validate());

  const valid = baseRecipe({ dietaryTags: ['dairyFree', 'glutenFree'] });
  await assert.doesNotReject(() => valid.validate());
});

test('imageUrl is optional and may be absent', async () => {
  const recipe = baseRecipe();
  assert.equal(recipe.imageUrl, undefined);
  await assert.doesNotReject(() => recipe.validate());
});

test('isActive defaults to true', () => {
  const recipe = baseRecipe();
  assert.equal(recipe.isActive, true);
});

test('timestamps are enabled', () => {
  assert.equal(Recipe.schema.options.timestamps, true);
});

test('there are compound indexes for isActive/region, isActive/category and isActive/difficulty filtering', () => {
  const indexes = Recipe.schema.indexes();
  assert.ok(indexes.some(([spec]) => spec.isActive === 1 && spec.region === 1));
  assert.ok(indexes.some(([spec]) => spec.isActive === 1 && spec.category === 1));
  assert.ok(indexes.some(([spec]) => spec.isActive === 1 && spec.difficulty === 1));
});

test('there is an index on ingredients.ingredientId for "recipes using this ingredient" lookups', () => {
  const indexes = Recipe.schema.indexes();
  assert.ok(indexes.some(([spec]) => spec['ingredients.ingredientId'] === 1));
});

test('there is a title index backing titleAsc/titleDesc sort and search', () => {
  const indexes = Recipe.schema.indexes();
  assert.ok(indexes.some(([spec]) => spec.title === 1 && Object.keys(spec).length === 1));
});

test('toPublicRecipe exposes id (not _id), populated ingredient summaries, and hides __v', () => {
  // A plain object standing in for a populated Recipe document (as
  // recipe.repository.js#findByIdWithIngredients would return), rather
  // than a `new Recipe(...)` instance — ingredients.ingredientId here is a
  // populated Ingredient sub-object, not a raw ObjectId, matching how the
  // routes/service tests exercise the serializer.
  const recipe = {
    _id: '507f1f77bcf86cd799439099',
    title: 'Chicken Adobo',
    description: 'A classic Filipino chicken dish braised in soy sauce and vinegar.',
    region: 'central-luzon',
    category: 'dinner',
    difficulty: 'easy',
    prepTimeMinutes: 15,
    cookTimeMinutes: 40,
    servings: 4,
    ingredients: [
      {
        ingredientId: { _id: OTHER_INGREDIENT_ID, name: 'Chicken', isActive: true },
        quantity: 1,
        unit: 'kg',
        note: 'cut into serving pieces',
        optional: false,
      },
    ],
    instructions: ['Combine chicken, soy sauce, garlic, and bay leaves.', 'Simmer until done.'],
    dietaryTags: [],
    imageUrl: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const publicRecipe = toPublicRecipe(recipe);

  assert.equal(publicRecipe.id, recipe._id);
  assert.equal(publicRecipe.title, 'Chicken Adobo');
  assert.equal(publicRecipe.region, 'central-luzon');
  assert.equal(publicRecipe.category, 'dinner');
  assert.equal('cuisine' in publicRecipe, false);
  // Derived structured steps mirror the persisted instruction array, 1-based.
  assert.deepEqual(publicRecipe.steps, [
    { order: 1, text: 'Combine chicken, soy sauce, garlic, and bay leaves.' },
    { order: 2, text: 'Simmer until done.' },
  ]);
  assert.deepEqual(publicRecipe.instructions, recipe.instructions);
  assert.equal(publicRecipe.ingredients[0].ingredient.id, OTHER_INGREDIENT_ID);
  assert.equal(publicRecipe.ingredients[0].ingredient.name, 'Chicken');
  assert.deepEqual(Object.keys(publicRecipe.ingredients[0].ingredient).sort(), ['id', 'name']);
  assert.equal('_id' in publicRecipe, false);
  assert.equal('__v' in publicRecipe, false);
});

const validNutrition = () => ({
  schemaVersion: 1,
  basis: 'perServing',
  caloriesKcal: 320,
  proteinGrams: 28,
  carbohydrateGrams: 12,
  fatGrams: 18,
  sugarGrams: 3,
  fiberGrams: 2,
});

const nutritionProvenance = () => ({
  sourceKind: 'manual',
  sourceLabel: 'Laboratory nutrition panel',
  sourceUrl: 'https://example.com/nutrition',
  acceptedBy: INGREDIENT_ID,
  acceptedAt: new Date('2026-10-06T00:00:00.000Z'),
});

test('Recipe persists only a complete exact v1 nutrition object with matching internal provenance', async () => {
  const explicitNull = baseRecipe({ nutrition: null });
  await assert.doesNotReject(() => explicitNull.validate());
  assert.equal(explicitNull.nutrition, null);

  await assert.doesNotReject(() => baseRecipe({
    nutrition: validNutrition(),
    nutritionProvenance: nutritionProvenance(),
  }).validate());

  for (const nutrition of [
    { ...validNutrition(), caloriesKcal: '320' },
    { ...validNutrition(), proteinGrams: -1 },
    { ...validNutrition(), fatGrams: Number.NaN },
    { ...validNutrition(), sugarGrams: Number.POSITIVE_INFINITY },
    Object.fromEntries(Object.entries(validNutrition()).filter(([key]) => key !== 'fiberGrams')),
  ]) {
    await assert.rejects(() => baseRecipe({ nutrition, nutritionProvenance: nutritionProvenance() }).validate());
  }
  await assert.rejects(() => baseRecipe({ nutrition: validNutrition() }).validate(), /provenance/);
  await assert.rejects(() => baseRecipe({ nutritionProvenance: nutritionProvenance() }).validate(), /requires nutrition/);
  await assert.rejects(() => baseRecipe({
    nutrition: { ...validNutrition(), sodiumGrams: 1 },
    nutritionProvenance: nutritionProvenance(),
  }).validate());
});

test('public nutrition serialization is exact, complete-or-null, and redacts all provenance', () => {
  const base = {
    _id: '507f1f77bcf86cd799439099', title: 'Adobo', ingredients: [], instructions: [],
    dietaryTags: [], isActive: true,
  };
  assert.equal(toPublicRecipe(base).nutrition, null);
  assert.equal(toPublicRecipe({ ...base, nutrition: null }).nutrition, null);

  const recipe = { ...base, nutrition: validNutrition(), nutritionProvenance: nutritionProvenance() };
  const consumer = toPublicRecipe(recipe);
  const staff = toStaffRecipe(recipe);
  assert.deepEqual(consumer.nutrition, validNutrition());
  assert.deepEqual(Object.keys(consumer.nutrition), Object.keys(validNutrition()));
  assert.equal('nutritionProvenance' in consumer, false);
  assert.equal(JSON.stringify(consumer).includes(INGREDIENT_ID), false);
  assert.deepEqual(staff.nutritionSource, {
    kind: 'manual', label: 'Laboratory nutrition panel', url: 'https://example.com/nutrition',
  });
  assert.equal(JSON.stringify(staff).includes('acceptedBy'), false);
  assert.equal(JSON.stringify(staff).includes('acceptedAt'), false);
});

test('present malformed stored nutrition fails closed instead of becoming unavailable or partial', () => {
  const base = {
    _id: '507f1f77bcf86cd799439099', title: 'Adobo', ingredients: [], instructions: [],
    dietaryTags: [], isActive: true,
  };
  for (const nutrition of [
    { ...validNutrition(), fiberGrams: undefined },
    { ...validNutrition(), caloriesKcal: '320' },
    { ...validNutrition(), internalActorId: INGREDIENT_ID },
  ]) {
    assert.throws(() => toPublicRecipe({ ...base, nutrition }), (error) => error.code === 'RECIPE_NUTRITION_MALFORMED');
  }
});
