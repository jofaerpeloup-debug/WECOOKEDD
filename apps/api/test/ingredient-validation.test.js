const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createIngredientSchema,
  updateIngredientSchema,
  listIngredientsSchema,
  ingredientParamsSchema,
} = require('../src/modules/ingredients/ingredient.validation');

const VALID_ID = '507f1f77bcf86cd799439011';

test('createIngredientSchema accepts a valid body', () => {
  const result = createIngredientSchema.safeParse({
    body: { name: 'Butter', aliases: ['unsalted butter'], category: 'dairy', allergenTags: ['milk'] },
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.body.allergenTags, ['milk']);
});

test('createIngredientSchema defaults aliases/allergenTags to [] when omitted', () => {
  const result = createIngredientSchema.safeParse({ body: { name: 'Butter', category: 'dairy' } });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.body.aliases, []);
  assert.deepEqual(result.data.body.allergenTags, []);
});

test('createIngredientSchema rejects an invalid category', () => {
  const result = createIngredientSchema.safeParse({ body: { name: 'Butter', category: 'not-real' } });
  assert.equal(result.success, false);
});

test('createIngredientSchema rejects an invalid allergen tag', () => {
  const result = createIngredientSchema.safeParse({
    body: { name: 'Butter', category: 'dairy', allergenTags: ['not-real'] },
  });
  assert.equal(result.success, false);
});

test('createIngredientSchema rejects unknown fields', () => {
  const result = createIngredientSchema.safeParse({
    body: { name: 'Butter', category: 'dairy', isActive: false },
  });
  assert.equal(result.success, false);
});

test('createIngredientSchema rejects a missing name', () => {
  const result = createIngredientSchema.safeParse({ body: { category: 'dairy' } });
  assert.equal(result.success, false);
});

test('createIngredientSchema rejects more than 20 aliases', () => {
  const result = createIngredientSchema.safeParse({
    body: {
      name: 'Butter',
      category: 'dairy',
      aliases: Array.from({ length: 21 }, (_, i) => `alias-${i}`),
    },
  });
  assert.equal(result.success, false);
});

test('updateIngredientSchema accepts a single-field partial update', () => {
  const result = updateIngredientSchema.safeParse({
    params: { ingredientId: VALID_ID },
    body: { name: 'Salted Butter' },
  });
  assert.equal(result.success, true);
});

test('updateIngredientSchema rejects an empty body', () => {
  const result = updateIngredientSchema.safeParse({ params: { ingredientId: VALID_ID }, body: {} });
  assert.equal(result.success, false);
});

test('updateIngredientSchema does not default omitted aliases to [] (would wipe existing aliases)', () => {
  const result = updateIngredientSchema.safeParse({
    params: { ingredientId: VALID_ID },
    body: { name: 'Salted Butter' },
  });
  assert.equal(result.success, true);
  assert.equal('aliases' in result.data.body, false);
});

test('updateIngredientSchema allows isActive reactivation', () => {
  const result = updateIngredientSchema.safeParse({
    params: { ingredientId: VALID_ID },
    body: { isActive: true },
  });
  assert.equal(result.success, true);
});

test('updateIngredientSchema rejects an invalid ingredientId param', () => {
  const result = updateIngredientSchema.safeParse({
    params: { ingredientId: 'not-an-id' },
    body: { name: 'X' },
  });
  assert.equal(result.success, false);
});

test('ingredientParamsSchema accepts a valid ObjectId and rejects an invalid one', () => {
  assert.equal(ingredientParamsSchema.safeParse({ params: { ingredientId: VALID_ID } }).success, true);
  assert.equal(ingredientParamsSchema.safeParse({ params: { ingredientId: 'nope' } }).success, false);
});

test('listIngredientsSchema applies defaults for status/sort/page/limit', () => {
  const result = listIngredientsSchema.safeParse({ query: {} });
  assert.equal(result.success, true);
  assert.equal(result.data.query.status, 'active');
  assert.equal(result.data.query.sort, 'nameAsc');
  assert.equal(result.data.query.page, 1);
  assert.equal(result.data.query.limit, 20);
});

test('listIngredientsSchema coerces page/limit from query strings', () => {
  const result = listIngredientsSchema.safeParse({ query: { page: '2', limit: '50' } });
  assert.equal(result.success, true);
  assert.equal(result.data.query.page, 2);
  assert.equal(result.data.query.limit, 50);
});

test('listIngredientsSchema rejects a limit above 100', () => {
  const result = listIngredientsSchema.safeParse({ query: { limit: '101' } });
  assert.equal(result.success, false);
});

test('listIngredientsSchema rejects an invalid status value', () => {
  const result = listIngredientsSchema.safeParse({ query: { status: 'deleted' } });
  assert.equal(result.success, false);
});

test('listIngredientsSchema rejects an invalid sort value', () => {
  const result = listIngredientsSchema.safeParse({ query: { sort: 'random' } });
  assert.equal(result.success, false);
});

test('listIngredientsSchema rejects unknown query params', () => {
  const result = listIngredientsSchema.safeParse({ query: { foo: 'bar' } });
  assert.equal(result.success, false);
});