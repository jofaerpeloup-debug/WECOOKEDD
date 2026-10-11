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

test('Shopping List request schemas reject nonfinite measurable lb/oz quantities', () => {
  for (const unit of ['lb', 'oz']) {
    for (const quantity of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN]) {
      assert.equal(
        createItemSchema.safeParse({ body: { ingredientId: VALID_ID, quantity, unit } }).success,
        false,
        `create ${unit} ${String(quantity)}`
      );
      assert.equal(
        patchItemSchema.safeParse({ params: { itemId: VALID_ID }, body: { quantity, unit } }).success,
        false,
        `patch ${unit} ${String(quantity)}`
      );
    }
  }
});

test('createItemSchema rejects an invalid ingredientId', () => {
  const result = createItemSchema.safeParse({ body: { ingredientId: 'not-an-id', quantity: 1, unit: 'kg' } });
  assert.equal(result.success, false);
});

test('createItemSchema rejects an invalid unit', () => {
  const result = createItemSchema.safeParse({ body: { ingredientId: VALID_ID, quantity: 1, unit: 'gallon' } });
  assert.equal(result.success, false);
});

test('Shopping List request schemas accept only exact canonical lb/oz values', () => {
  for (const unit of ['lb', 'oz']) {
    assert.equal(createItemSchema.safeParse({ body: { ingredientId: VALID_ID, quantity: 2.5, unit } }).success, true, unit);
    assert.equal(patchItemSchema.safeParse({ params: { itemId: VALID_ID }, body: { quantity: 2.5, unit } }).success, true, unit);
  }
  for (const unit of ['lb.', 'lbs', 'pound', 'oz.', 'ounce', 'LB', 'OZ', 'fl oz', 'stone']) {
    assert.equal(createItemSchema.safeParse({ body: { ingredientId: VALID_ID, quantity: 1, unit } }).success, false, unit);
    assert.equal(patchItemSchema.safeParse({ params: { itemId: VALID_ID }, body: { quantity: 1, unit } }).success, false, unit);
  }
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

const acceptedShop5Labels = [["\"Milk\"","Milk"],["\"\\uAE40\\uCE58\"","김치"],["\"\\u5BFF\\u53F8\"","寿司"],["\"Cafe\\u0301\"","Café"],["\"\\u0020Milk\\u00A0\"","Milk"],["\"\\u0645\\u06CC\\u200C\\u0631\\u0648\\u0645\"","می‌روم"],["\"\\uD83C\\uDF4E\"","🍎"],["\"\\uD83D\\uDC69\\u200D\\uD83C\\uDF73\"","👩‍🍳"]];
const rejectedShop5Labels = ["\"\\u2800\"","\"\\u3164\"","\"\\uFFA0\"","\"\\u115F\"","\"\\u1160\"","\"\\u115F\\u1160\"","\"\\u2800\\u3164\\uFFA0\"","\"\\u0020\\u2800\\u00A0\"","\"Milk\\u2800\"","\"Milk\\u3164\"","\"Milk\\uFFA0\"","\"\\u200B\"","\"Milk\\u200B\"","\"\\u0301\"","\"\\u200D\"","\"A\\u200D\"","\"A\\u200D\\u200DB\"","\"\\u00ADMilk\""];

test('SHOP5 literal Unicode vectors normalize and validate every label', () => {
  assert.equal(acceptedShop5Labels.length, 8);
  assert.equal(rejectedShop5Labels.length, 18);
  const { normalizeCustomLabel } = require('../src/modules/shopping-lists/shopping-list.custom-label');
  const { v2CreateItemSchema } = require('../src/modules/shopping-lists/shopping-list.validation');
  for (const [token, expected] of acceptedShop5Labels) {
    const value = JSON.parse(token);
    assert.equal(normalizeCustomLabel(value), expected, token);
    const parsed = v2CreateItemSchema.safeParse({ body: { type: 'custom', label: value }, query: {} });
    assert.equal(parsed.success, true, token);
    assert.equal(parsed.data.body.label, expected, token);
  }
  for (const token of rejectedShop5Labels) {
    const value = JSON.parse(token);
    assert.equal(normalizeCustomLabel(value), null, token);
    const parsed = v2CreateItemSchema.safeParse({ body: { type: 'custom', label: value }, query: {} });
    assert.equal(parsed.success, false, token);
    assert.ok(parsed.error.issues.some((issue) => issue.path.includes('label')), token);
  }
});

test('SHOP5 rejects surplus fields, edge joiners, controls, and scalar overflow', () => {
  const { normalizeCustomLabel } = require('../src/modules/shopping-lists/shopping-list.custom-label');
  for (const value of ['A\u200D ', 'Milk\u2060', 'Milk\uFEFF', 'Milk\u202E', 'Milk\u0001', 'A'.repeat(81), '', '\uD800']) {
    assert.equal(normalizeCustomLabel(value), null);
  }
  assert.equal(normalizeCustomLabel('A'.repeat(80)), 'A'.repeat(80));
  const { v2CreateItemSchema } = require('../src/modules/shopping-lists/shopping-list.validation');
  assert.equal(v2CreateItemSchema.safeParse({ body: { type: 'custom', label: 'Milk', ownerId: VALID_ID }, query: {} }).success, false);
});
