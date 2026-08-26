const test = require('node:test');
const assert = require('node:assert/strict');

const Recipe = require('../src/modules/recipes/recipe.model');
const { toPublicRecipe } = require('../src/modules/recipes/recipe.serializer');

const INGREDIENT_ID = '507f1f77bcf86cd799439011';
const OTHER_INGREDIENT_ID = '507f1f77bcf86cd799439012';

function baseRecipe(overrides = {}) {
  return new Recipe({
    title: 'Chicken Adobo',
    description: 'A classic Filipino chicken dish braised in soy sauce, vinegar, garlic, and spices.',
    cuisine: 'filipino',
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

test('title, description, cuisine, difficulty, prepTimeMinutes, cookTimeMinutes, and servings are required', async () => {
  const recipe = new Recipe({});
  await assert.rejects(() => recipe.validate(), (err) => {
    for (const field of [
      'title',
      'description',
      'cuisine',
      'difficulty',
      'prepTimeMinutes',
      'cookTimeMinutes',
      'servings',
      'ingredients',
      'instructions',
    ]) {
      assert.ok(err.errors[field], `expected ${field} to be required`);
    }
    return true;
  });
});

test('title is trimmed and length-limited, and does not require uniqueness', () => {
  const path = Recipe.schema.path('title');
  assert.equal(path.options.required, true);
  assert.equal(path.options.trim, true);
  assert.equal(path.options.maxlength, Recipe.MAX_TITLE_LENGTH);
  assert.notEqual(path.options.unique, true);
});

test('cuisine is constrained to the controlled V1 enum and includes filipino without a special type', async () => {
  const path = Recipe.schema.path('cuisine');
  assert.deepEqual(path.options.enum, Recipe.CUISINES);
  assert.ok(Recipe.CUISINES.includes('filipino'));
  assert.ok(Recipe.CUISINES.includes('other'));

  const invalid = baseRecipe({ cuisine: 'klingon' });
  await assert.rejects(() => invalid.validate());
});

test('difficulty is constrained to easy/medium/hard', async () => {
  assert.deepEqual(Recipe.schema.path('difficulty').options.enum, ['easy', 'medium', 'hard']);
  const invalid = baseRecipe({ difficulty: 'nightmare' });
  await assert.rejects(() => invalid.validate());
});

test('prepTimeMinutes and cookTimeMinutes must be non-negative integers within a reasonable bound', async () => {
  await assert.doesNotReject(() => baseRecipe({ prepTimeMinutes: 0, cookTimeMinutes: 0 }).validate());
  await assert.rejects(() => baseRecipe({ prepTimeMinutes: -1 }).validate());
  await assert.rejects(() => baseRecipe({ prepTimeMinutes: 1.5 }).validate());
  await assert.rejects(() => baseRecipe({ prepTimeMinutes: Recipe.MAX_PREP_TIME_MINUTES + 1 }).validate());
  await assert.rejects(() => baseRecipe({ cookTimeMinutes: -1 }).validate());
});

test('servings must be a positive integer within a reasonable bound', async () => {
  await assert.rejects(() => baseRecipe({ servings: 0 }).validate());
  await assert.rejects(() => baseRecipe({ servings: -1 }).validate());
  await assert.rejects(() => baseRecipe({ servings: 1.5 }).validate());
  await assert.rejects(() => baseRecipe({ servings: Recipe.MAX_SERVINGS + 1 }).validate());
  await assert.doesNotReject(() => baseRecipe({ servings: Recipe.MAX_SERVINGS }).validate());
});

test('ingredients requires at least one entry and rejects more than the maximum', async () => {
  await assert.rejects(() => baseRecipe({ ingredients: [] }).validate());

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

test('instructions requires at least one non-empty step, preserves order, and rejects too many steps', async () => {
  await assert.rejects(() => baseRecipe({ instructions: [] }).validate());
  await assert.rejects(() => baseRecipe({ instructions: [''] }).validate());

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

test('there are compound indexes for isActive/cuisine and isActive/difficulty filtering', () => {
  const indexes = Recipe.schema.indexes();
  assert.ok(indexes.some(([spec]) => spec.isActive === 1 && spec.cuisine === 1));
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
    cuisine: 'filipino',
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
    instructions: ['Combine chicken, soy sauce, garlic, and bay leaves.'],
    dietaryTags: [],
    imageUrl: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const publicRecipe = toPublicRecipe(recipe);

  assert.equal(publicRecipe.id, recipe._id);
  assert.equal(publicRecipe.title, 'Chicken Adobo');
  assert.equal(publicRecipe.ingredients[0].ingredient.id, OTHER_INGREDIENT_ID);
  assert.equal(publicRecipe.ingredients[0].ingredient.name, 'Chicken');
  assert.deepEqual(Object.keys(publicRecipe.ingredients[0].ingredient).sort(), ['id', 'name']);
  assert.equal('_id' in publicRecipe, false);
  assert.equal('__v' in publicRecipe, false);
});