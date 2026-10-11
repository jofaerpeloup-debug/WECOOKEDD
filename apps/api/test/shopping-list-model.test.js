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
  assert.equal(path.options.required.call({ type: undefined }), true);
  assert.equal(path.options.required.call({ type: 'custom' }), false);
});

test('SHOP5 custom rows have server IDs and no fabricated Ingredient fields', async () => {
  const valid = baseList({ items: [{ type: 'custom', label: 'Milk' }] });
  await assert.doesNotReject(() => valid.validate());
  assert.ok(valid.items[0]._id);
  assert.equal(valid.items[0].ingredientId, undefined);
  assert.equal(valid.items[0].unit, undefined);
  const invalid = baseList({ items: [{ type: 'custom', label: 'Milk', ingredientId: INGREDIENT_ID }] });
  await assert.rejects(() => invalid.validate());
});

test('SHOP5 rejects every present Custom cross-type field, including null', async () => {
  const forbidden = {
    ingredientId: INGREDIENT_ID,
    quantity: 1,
    unit: 'kg',
    originKind: 'recipe',
    sourceRecipeIds: [INGREDIENT_ID],
    quantityEdited: false,
  };
  for (const [field, value] of Object.entries(forbidden)) {
    for (const present of [null, value]) {
      const list = baseList({ items: [{ type: 'custom', label: 'Milk', [field]: present }] });
      await assert.rejects(() => list.validate(), `${field}: ${String(present)}`);
    }
  }
  await assert.doesNotReject(() => baseList({ items: [{ type: 'custom', label: 'Milk' }] }).validate());
});

test('SHOP5 recipe origin requires a source and valid legacy rows remain valid', async () => {
  await assert.rejects(() => baseList({ items: [{
    type: 'ingredient', ingredientId: INGREDIENT_ID, quantity: 1, unit: 'kg', originKind: 'recipe',
  }] }).validate());
  await assert.doesNotReject(() => baseList({ items: [{
    type: 'ingredient', ingredientId: INGREDIENT_ID, quantity: 1, unit: 'kg',
    originKind: 'recipe', sourceRecipeIds: [INGREDIENT_ID], quantityEdited: false,
  }] }).validate());
  await assert.doesNotReject(() => baseList({ items: [{
    ingredientId: INGREDIENT_ID, quantity: 1, unit: 'kg',
  }] }).validate());
  await assert.rejects(() => baseList({ items: [{
    ingredientId: INGREDIENT_ID, quantity: 1, unit: 'kg', sourceRecipeIds: [],
  }] }).validate());
});

test('SHOP5 hydration records missing and uncastable stored checked values before defaults', () => {
  const raw = (item) => ShoppingList.hydrate({
    userId: USER_ID, __v: 0, items: [{ _id: INGREDIENT_ID, type: 'custom', label: 'Milk', ...item }],
  }).items[0];
  assert.equal(raw({ isChecked: false }).$locals.shoppingStoredShapeValid, true);
  assert.equal(raw({}).isChecked, false);
  assert.equal(raw({}).$locals.shoppingStoredShapeValid, false);
  assert.equal(raw({ isChecked: 'invalid' }).$locals.shoppingStoredShapeValid, false);
  assert.equal(raw({ isChecked: null }).$locals.shoppingStoredShapeValid, false);
});

test('SHOP5 parent hydration keeps raw items-array validity despite defaults and casts', () => {
  const cases = [
    ['missing', {}, false],
    ['null', { items: null }, false],
    ['object', { items: {} }, false],
    ['string', { items: 'invalid' }, false],
    ['number', { items: 7 }, false],
    ['array', { items: [] }, true],
  ];
  for (const [name, raw, valid] of cases) {
    const list = ShoppingList.hydrate({ userId: USER_ID, __v: 0, ...raw });
    assert.equal(list.$locals.shoppingStoredItemsArray, valid, name);
    assert.equal(list.isNew, false, name);
    assert.equal(list.__v, 0, name);
    assert.equal(Object.hasOwn(list.toObject(), 'shoppingStoredItemsArray'), false, name);
    if (name === 'missing') assert.deepEqual(list.items.toObject(), []);
    if (name === 'object') assert.equal(Array.isArray(list.items), true);
  }
  const fresh = new ShoppingList({ userId: USER_ID });
  assert.equal(Object.hasOwn(fresh.$locals, 'shoppingStoredItemsArray'), false);
  assert.deepEqual(fresh.items.toObject(), []);
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
