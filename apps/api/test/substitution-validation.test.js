const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSubstitutionSchema,
  updateSubstitutionSchema,
  listSubstitutionsSchema,
  substitutionParamsSchema,
} = require('../src/modules/substitutions/substitution.validation');

const SOURCE_ID = '507f1f77bcf86cd799439011';
const SUBSTITUTE_ID = '507f1f77bcf86cd799439012';

test('createSubstitutionSchema accepts a valid body', () => {
  const result = createSubstitutionSchema.safeParse({
    body: {
      sourceIngredientId: SOURCE_ID,
      substituteIngredientId: SUBSTITUTE_ID,
      ratio: { sourceAmount: 1, substituteAmount: 0.75 },
      contexts: ['baking'],
      notes: 'Works well in cakes.',
    },
  });
  assert.equal(result.success, true);
});

test('createSubstitutionSchema defaults contexts to []', () => {
  const result = createSubstitutionSchema.safeParse({
    body: {
      sourceIngredientId: SOURCE_ID,
      substituteIngredientId: SUBSTITUTE_ID,
      ratio: { sourceAmount: 1, substituteAmount: 0.75 },
    },
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.body.contexts, []);
});

test('createSubstitutionSchema rejects invalid ObjectIds', () => {
  const result = createSubstitutionSchema.safeParse({
    body: {
      sourceIngredientId: 'not-an-id',
      substituteIngredientId: SUBSTITUTE_ID,
      ratio: { sourceAmount: 1, substituteAmount: 0.75 },
    },
  });
  assert.equal(result.success, false);
});

test('createSubstitutionSchema rejects a zero or negative ratio amount', () => {
  const zero = createSubstitutionSchema.safeParse({
    body: {
      sourceIngredientId: SOURCE_ID,
      substituteIngredientId: SUBSTITUTE_ID,
      ratio: { sourceAmount: 1, substituteAmount: 0 },
    },
  });
  assert.equal(zero.success, false);

  const negative = createSubstitutionSchema.safeParse({
    body: {
      sourceIngredientId: SOURCE_ID,
      substituteIngredientId: SUBSTITUTE_ID,
      ratio: { sourceAmount: -1, substituteAmount: 1 },
    },
  });
  assert.equal(negative.success, false);
});

test('createSubstitutionSchema rejects identical source/substitute ids', () => {
  const result = createSubstitutionSchema.safeParse({
    body: {
      sourceIngredientId: SOURCE_ID,
      substituteIngredientId: SOURCE_ID,
      ratio: { sourceAmount: 1, substituteAmount: 1 },
    },
  });
  assert.equal(result.success, false);
  assert.equal(result.error.issues[0].message, 'sourceIngredientId and substituteIngredientId must be different.');
});

test('createSubstitutionSchema rejects unknown fields', () => {
  const result = createSubstitutionSchema.safeParse({
    body: {
      sourceIngredientId: SOURCE_ID,
      substituteIngredientId: SUBSTITUTE_ID,
      ratio: { sourceAmount: 1, substituteAmount: 1 },
      isActive: false,
    },
  });
  assert.equal(result.success, false);
});

test('createSubstitutionSchema rejects more than 10 contexts', () => {
  const result = createSubstitutionSchema.safeParse({
    body: {
      sourceIngredientId: SOURCE_ID,
      substituteIngredientId: SUBSTITUTE_ID,
      ratio: { sourceAmount: 1, substituteAmount: 1 },
      contexts: Array.from({ length: 11 }, (_, i) => `context-${i}`),
    },
  });
  assert.equal(result.success, false);
});

test('updateSubstitutionSchema accepts a single-field partial update', () => {
  const result = updateSubstitutionSchema.safeParse({
    params: { substitutionId: SOURCE_ID },
    body: { notes: 'Updated guidance.' },
  });
  assert.equal(result.success, true);
});

test('updateSubstitutionSchema rejects an empty body', () => {
  const result = updateSubstitutionSchema.safeParse({
    params: { substitutionId: SOURCE_ID },
    body: {},
  });
  assert.equal(result.success, false);
});

test('updateSubstitutionSchema does not default omitted contexts to [] (would wipe existing contexts)', () => {
  const result = updateSubstitutionSchema.safeParse({
    params: { substitutionId: SOURCE_ID },
    body: { notes: 'x' },
  });
  assert.equal(result.success, true);
  assert.equal('contexts' in result.data.body, false);
});

test('updateSubstitutionSchema rejects identical source/substitute ids when both are provided', () => {
  const result = updateSubstitutionSchema.safeParse({
    params: { substitutionId: SOURCE_ID },
    body: { sourceIngredientId: SOURCE_ID, substituteIngredientId: SOURCE_ID },
  });
  assert.equal(result.success, false);
});

test('updateSubstitutionSchema allows changing only one side of the pair', () => {
  const result = updateSubstitutionSchema.safeParse({
    params: { substitutionId: SOURCE_ID },
    body: { sourceIngredientId: SUBSTITUTE_ID },
  });
  assert.equal(result.success, true);
});

test('updateSubstitutionSchema allows isActive reactivation', () => {
  const result = updateSubstitutionSchema.safeParse({
    params: { substitutionId: SOURCE_ID },
    body: { isActive: true },
  });
  assert.equal(result.success, true);
});

test('substitutionParamsSchema accepts a valid ObjectId and rejects an invalid one', () => {
  assert.equal(
    substitutionParamsSchema.safeParse({ params: { substitutionId: SOURCE_ID } }).success,
    true
  );
  assert.equal(
    substitutionParamsSchema.safeParse({ params: { substitutionId: 'nope' } }).success,
    false
  );
});

test('listSubstitutionsSchema applies defaults for status/sort/page/limit', () => {
  const result = listSubstitutionsSchema.safeParse({ query: {} });
  assert.equal(result.success, true);
  assert.equal(result.data.query.status, 'active');
  assert.equal(result.data.query.sort, 'newest');
  assert.equal(result.data.query.page, 1);
  assert.equal(result.data.query.limit, 20);
});

test('listSubstitutionsSchema accepts sourceIngredientId as the primary filter', () => {
  const result = listSubstitutionsSchema.safeParse({ query: { sourceIngredientId: SOURCE_ID } });
  assert.equal(result.success, true);
  assert.equal(result.data.query.sourceIngredientId, SOURCE_ID);
});

test('listSubstitutionsSchema rejects an invalid sourceIngredientId', () => {
  const result = listSubstitutionsSchema.safeParse({ query: { sourceIngredientId: 'nope' } });
  assert.equal(result.success, false);
});

test('listSubstitutionsSchema rejects an invalid sort value (ingredient-only sorts are not valid here)', () => {
  const result = listSubstitutionsSchema.safeParse({ query: { sort: 'nameAsc' } });
  assert.equal(result.success, false);
});

test('listSubstitutionsSchema rejects unknown query params', () => {
  const result = listSubstitutionsSchema.safeParse({ query: { foo: 'bar' } });
  assert.equal(result.success, false);
});