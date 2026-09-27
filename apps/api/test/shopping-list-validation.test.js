const test = require('node:test');
const assert = require('node:assert/strict');

const {
  itemParamsSchema,
  recipeParamsSchema,
  createItemSchema,
  patchItemSchema,
} = require('../src/modules/shopping-lists/shopping-list.validation');

const VALID_ID = '507f1f77bcf86cd799439011';

test('itemParamsSchema accepts a valid ObjectId and rejects an invalid one', () => {
  assert.equal(itemParamsSchema.safeParse({ params: { itemId: VALID_ID } }).success, true);
  assert.equal(itemParamsSchema.safeParse({ params: { itemId: 'not-an-id' } }).success, false);
});

test('recipeParamsSchema accepts a valid ObjectId and rejects an invalid one', () => {
  assert.equal(recipeParamsSchema.safeParse({ params: { recipeId: VALID_ID } }).success, true);
  assert.equal(recipeParamsSchema.safeParse({ params: { recipeId: 'not-an-id' } }).success, false);
});

test('createItemSchema accepts a valid measurable-unit item', () => {
  const result = createItemSchema.safeParse({
    body: { ingredientId: VALID_ID, quantity: 2, unit: 'piece' },
  });
  assert.equal(result.success, true);
});

test('createItemSchema accepts a toTaste item with quantity omitted', () => {
  const result = createItemSchema.safeParse({ body: { ingredientId: VALID_ID, unit: 'toTaste' } });
  assert.equal(result.success, true);
});

test('createItemSchema accepts a toTaste item with quantity explicitly null', () => {
  const result = createItemSchema.safeParse({
    body: { ingredientId: VALID_ID, unit: 'toTaste', quantity: null },
  });
  assert.equal(result.success, true);
});

test('createItemSchema rejects a toTaste item with a quantity', () => {
  const result = createItemSchema.safeParse({
    body: { ingredientId: VALID_ID, unit: 'toTaste', quantity: 1 },
  });
  assert.equal(result.success, false);
});

test('createItemSchema rejects a measurable unit with quantity omitted', () => {
  const result = createItemSchema.safeParse({ body: { ingredientId: VALID_ID, unit: 'kg' } });
  assert.equal(result.success, false);
});

test('createItemSchema rejects a non-positive quantity', () => {
  assert.equal(
    createItemSchema.safeParse({ body: { ingredientId: VALID_ID, quantity: 0, unit: 'kg' } }).success,
    false
  );
  assert.equal(
    createItemSchema.safeParse({ body: { ingredientId: VALID_ID, quantity: -1, unit: 'kg' } }).success,
    false
  );
});

test('createItemSchema rejects an invalid ingredientId', () => {
  const result = createItemSchema.safeParse({ body: { ingredientId: 'not-an-id', quantity: 1, unit: 'kg' } });
  assert.equal(result.success, false);
});

test('createItemSchema rejects an invalid unit', () => {
  const result = createItemSchema.safeParse({ body: { ingredientId: VALID_ID, quantity: 1, unit: 'gallon' } });
  assert.equal(result.success, false);
});

test('createItemSchema rejects unknown body fields', () => {
  const result = createItemSchema.safeParse({
    body: { ingredientId: VALID_ID, quantity: 1, unit: 'kg', userId: VALID_ID },
  });
  assert.equal(result.success, false);
});

test('createItemSchema rejects client-supplied category', () => {
  const result = createItemSchema.safeParse({
    body: { ingredientId: VALID_ID, quantity: 1, unit: 'kg', category: 'produce' },
  });
  assert.equal(result.success, false);
});

test('patchItemSchema rejects an empty body', () => {
  const result = patchItemSchema.safeParse({ params: { itemId: VALID_ID }, body: {} });
  assert.equal(result.success, false);
});

test('patchItemSchema accepts a single-field isChecked change', () => {
  const result = patchItemSchema.safeParse({ params: { itemId: VALID_ID }, body: { isChecked: true } });
  assert.equal(result.success, true);
});

test('patchItemSchema accepts quantity and unit together, without requiring cross-field validity here', () => {
  const result = patchItemSchema.safeParse({
    params: { itemId: VALID_ID },
    body: { quantity: 3, unit: 'clove' },
  });
  assert.equal(result.success, true);
});

test('patchItemSchema accepts quantity: null (explicit clear) alongside a unit change', () => {
  const result = patchItemSchema.safeParse({
    params: { itemId: VALID_ID },
    body: { unit: 'toTaste', quantity: null },
  });
  assert.equal(result.success, true);
});

test('patchItemSchema rejects a negative or zero quantity', () => {
  assert.equal(
    patchItemSchema.safeParse({ params: { itemId: VALID_ID }, body: { quantity: 0 } }).success,
    false
  );
});

test('patchItemSchema rejects ingredientId (identity changes are not allowed via PATCH)', () => {
  const result = patchItemSchema.safeParse({
    params: { itemId: VALID_ID },
    body: { ingredientId: VALID_ID },
  });
  assert.equal(result.success, false);
});

test('patchItemSchema rejects unknown body fields', () => {
  const result = patchItemSchema.safeParse({
    params: { itemId: VALID_ID },
    body: { isChecked: true, extra: 'nope' },
  });
  assert.equal(result.success, false);
});

test('patchItemSchema rejects client-supplied category', () => {
  const result = patchItemSchema.safeParse({
    params: { itemId: VALID_ID },
    body: { category: 'produce' },
  });
  assert.equal(result.success, false);
});
