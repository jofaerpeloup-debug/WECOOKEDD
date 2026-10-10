const test = require('node:test');
const assert = require('node:assert/strict');

const ShoppingList = require('../src/modules/shopping-lists/shopping-list.model');
const { UNITS } = require('../src/shared/constants/measurement-units');

const USER_ID = '507f1f77bcf86cd799439001';
const INGREDIENT_ID = '507f1f77bcf86cd799439011';

function baseList(overrides = {}) {
  return new ShoppingList({ userId: USER_ID, items: [], ...overrides });
}

test('Shopping List consumes the exact shared 17-value canonical unit contract', () => {
  assert.deepEqual(UNITS, [
    'g', 'kg', 'lb', 'oz', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'piece', 'clove', 'slice', 'can', 'pack',
    'bunch', 'pinch', 'toTaste',
  ]);
  assert.deepEqual(ShoppingList.schema.path('items').schema.path('unit').options.enum, UNITS);
});

test('userId is required, references User, and is unique (one list per user)', () => {
  const path = ShoppingList.schema.path('userId');
  assert.equal(path.options.ref, 'User');
  assert.equal(path.options.required, true);
  assert.equal(path.options.unique, true);
});

test('there is a unique index on { userId }', () => {
  const index = ShoppingList.schema.indexes().find(([spec]) => spec.userId === 1 && Object.keys(spec).length === 1);
  assert.ok(index, 'expected an index on userId');
  assert.equal(index[1].unique, true);
});

test('items defaults to an empty array', () => {
  const list = new ShoppingList({ userId: USER_ID });
  assert.deepEqual(list.items.toObject(), []);
});

test('items rejects more than MAX_ITEMS entries', async () => {
  const tooMany = baseList({
    items: Array.from({ length: ShoppingList.MAX_ITEMS + 1 }, () => ({
      ingredientId: INGREDIENT_ID,
      quantity: 1,
      unit: 'piece',
    })),
  });
  await assert.rejects(() => tooMany.validate());

  const atLimit = baseList({
    items: Array.from({ length: ShoppingList.MAX_ITEMS }, () => ({
      ingredientId: INGREDIENT_ID,
      quantity: 1,
      unit: 'piece',
    })),
  });
  await assert.doesNotReject(() => atLimit.validate());
});

test('embedded items keep their own _id for individual PATCH/DELETE addressing', () => {
  const list = baseList({ items: [{ ingredientId: INGREDIENT_ID, quantity: 1, unit: 'piece' }] });
  assert.ok(list.items[0]._id);
});

test('item ingredientId is required and references Ingredient', () => {
  const itemSchema = ShoppingList.schema.path('items').schema;
  const path = itemSchema.path('ingredientId');
  assert.equal(path.options.ref, 'Ingredient');
  assert.equal(path.options.required, true);
});

test('item unit is constrained to the shared measurement-unit enum', () => {
  const invalid = baseList({ items: [{ ingredientId: INGREDIENT_ID, quantity: 1, unit: 'gallon' }] });
  return assert.rejects(() => invalid.validate());
});

test('item quantity is required and must be a finite positive number for a measurable unit', async () => {
  for (const unit of ['lb', 'oz']) {
    const list = baseList({ items: [{ ingredientId: INGREDIENT_ID, quantity: 2.5, unit }] });
    await assert.doesNotReject(() => list.validate(), unit);
    assert.equal(list.items[0].unit, unit);
    assert.equal(list.items[0].quantity, 2.5);
  }
  await assert.rejects(() => baseList({ items: [{ ingredientId: INGREDIENT_ID, unit: 'kg' }] }).validate());
  await assert.rejects(() =>
    baseList({ items: [{ ingredientId: INGREDIENT_ID, quantity: 0, unit: 'kg' }] }).validate()
  );
  await assert.rejects(() =>
    baseList({ items: [{ ingredientId: INGREDIENT_ID, quantity: -1, unit: 'kg' }] }).validate()
  );
});

test('item unit "toTaste" requires quantity to be omitted', async () => {
  const withQuantity = baseList({
    items: [{ ingredientId: INGREDIENT_ID, quantity: 1, unit: 'toTaste' }],
  });
  await assert.rejects(() => withQuantity.validate());

  const withoutQuantity = baseList({ items: [{ ingredientId: INGREDIENT_ID, unit: 'toTaste' }] });
  await assert.doesNotReject(() => withoutQuantity.validate());
  assert.equal(withoutQuantity.items[0].quantity, undefined);
});

test('item isChecked defaults to false', () => {
  const list = baseList({ items: [{ ingredientId: INGREDIENT_ID, quantity: 1, unit: 'piece' }] });
  assert.equal(list.items[0].isChecked, false);
});

test('timestamps are enabled on the ShoppingList document', () => {
  assert.equal(ShoppingList.schema.options.timestamps, true);
});

test('document optimistic concurrency uses the existing Mongoose version key', () => {
  assert.equal(ShoppingList.schema.options.optimisticConcurrency, true);
  assert.equal(ShoppingList.schema.options.versionKey, '__v');
});
