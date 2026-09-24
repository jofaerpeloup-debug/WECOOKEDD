const test = require('node:test');
const assert = require('node:assert/strict');

const Ingredient = require('../src/modules/ingredients/ingredient.model');
const { toPublicIngredient } = require('../src/modules/ingredients/ingredient.serializer');

test('name is required, trimmed, and length-limited', () => {
  const path = Ingredient.schema.path('name');
  assert.equal(path.options.required, true);
  assert.equal(path.options.trim, true);
  assert.equal(path.options.maxlength, 100);
});

test('normalizedName is required, uniquely indexed, and excluded from the default projection', () => {
  const path = Ingredient.schema.path('normalizedName');
  assert.equal(path.options.required, true);
  assert.equal(path.options.unique, true);
  assert.equal(path.options.select, false);

  const index = Ingredient.schema.indexes().find(([spec]) => spec.normalizedName === 1);
  assert.ok(index, 'expected a unique index on normalizedName');
  assert.equal(index[1].unique, true);
});

test('there is a useful compound index for isActive/category filtering', () => {
  const index = Ingredient.schema.indexes().find(([spec]) => spec.isActive === 1 && spec.category === 1);
  assert.ok(index, 'expected a compound index on { isActive, category }');
});

test('aliases default to [] and reject more than 20 entries', async () => {
  const ingredient = new Ingredient({
    name: 'Sugar',
    normalizedName: 'sugar',
    category: 'sweetener',
  });
  assert.deepEqual(ingredient.aliases, []);

  const tooMany = new Ingredient({
    name: 'Sugar',
    normalizedName: 'sugar',
    category: 'sweetener',
    aliases: Array.from({ length: 21 }, (_, i) => `alias-${i}`),
  });
  await assert.rejects(() => tooMany.validate());
});

test('category is required and constrained to the controlled enum', async () => {
  const path = Ingredient.schema.path('category');
  assert.equal(path.options.required, true);
  assert.deepEqual(path.options.enum, Ingredient.CATEGORIES);

  const invalid = new Ingredient({ name: 'Sugar', normalizedName: 'sugar', category: 'not-a-category' });
  await assert.rejects(() => invalid.validate());

  assert.deepEqual(Ingredient.CATEGORIES, [
    'produce', 'meat', 'seafood', 'dairy', 'egg', 'grain', 'legume', 'nutSeed',
    'herb', 'spice', 'oilFat', 'sweetener', 'baking', 'condiment', 'beverage',
    'protein', 'pantry', 'soy',
  ]);
  for (const category of ['protein', 'pantry', 'soy']) {
    const valid = new Ingredient({ name: category, normalizedName: category, category });
    await valid.validate();
  }

  const retired = new Ingredient({ name: 'Other', normalizedName: 'other', category: 'other' });
  await assert.rejects(() => retired.validate());
});

test('allergenTags default to [] and reject values outside the controlled enum', async () => {
  const ingredient = new Ingredient({ name: 'Milk', normalizedName: 'milk', category: 'dairy' });
  assert.deepEqual(ingredient.allergenTags, []);

  const invalid = new Ingredient({
    name: 'Milk',
    normalizedName: 'milk',
    category: 'dairy',
    allergenTags: ['not-a-real-allergen'],
  });
  await assert.rejects(() => invalid.validate());
});

test('isActive defaults to true', () => {
  const ingredient = new Ingredient({ name: 'Milk', normalizedName: 'milk', category: 'dairy' });
  assert.equal(ingredient.isActive, true);
});

test('timestamps are enabled', () => {
  assert.equal(Ingredient.schema.options.timestamps, true);
});

test('toPublicIngredient exposes id (not _id) and hides normalizedName/__v', () => {
  const ingredient = new Ingredient({
    name: 'Brown Sugar',
    normalizedName: 'brown sugar',
    category: 'sweetener',
    aliases: ['light brown sugar'],
    allergenTags: [],
  });
  const publicIngredient = toPublicIngredient(ingredient);

  assert.equal(publicIngredient.id, String(ingredient._id));
  assert.equal(publicIngredient.name, 'Brown Sugar');
  assert.equal('normalizedName' in publicIngredient, false);
  assert.equal('_id' in publicIngredient, false);
  assert.equal('__v' in publicIngredient, false);
  assert.equal(JSON.stringify(publicIngredient).includes('normalizedName'), false);
});

test('a hydrated legacy Other ingredient remains readable and serializable', () => {
  const legacy = Ingredient.hydrate({
    _id: '507f1f77bcf86cd799439011',
    name: 'Legacy ingredient',
    normalizedName: 'legacy ingredient',
    category: 'other',
    allergenTags: [],
    isActive: true,
  });

  const serialized = toPublicIngredient(legacy);
  assert.equal(serialized.category, 'other');
  assert.deepEqual(serialized.allergenTags, []);
});
