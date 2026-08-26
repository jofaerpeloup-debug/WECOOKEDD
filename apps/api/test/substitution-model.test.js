const test = require('node:test');
const assert = require('node:assert/strict');

const Substitution = require('../src/modules/substitutions/substitution.model');

const SOURCE_ID = '507f1f77bcf86cd799439011';
const SUBSTITUTE_ID = '507f1f77bcf86cd799439012';

test('sourceIngredientId and substituteIngredientId reference Ingredient and are required', () => {
  const sourcePath = Substitution.schema.path('sourceIngredientId');
  const substitutePath = Substitution.schema.path('substituteIngredientId');
  assert.equal(sourcePath.options.ref, 'Ingredient');
  assert.equal(sourcePath.options.required, true);
  assert.equal(substitutePath.options.ref, 'Ingredient');
  assert.equal(substitutePath.options.required, true);
});

test('there is a unique compound index on { sourceIngredientId, substituteIngredientId }', () => {
  const index = Substitution.schema
    .indexes()
    .find(([spec]) => spec.sourceIngredientId === 1 && spec.substituteIngredientId === 1);
  assert.ok(index, 'expected a compound index on the ordered pair');
  assert.equal(index[1].unique, true);
});

test('ratio requires sourceAmount and substituteAmount to be finite and greater than zero', async () => {
  const negative = new Substitution({
    sourceIngredientId: SOURCE_ID,
    substituteIngredientId: SUBSTITUTE_ID,
    ratio: { sourceAmount: -1, substituteAmount: 0.75 },
  });
  await assert.rejects(() => negative.validate());

  const zero = new Substitution({
    sourceIngredientId: SOURCE_ID,
    substituteIngredientId: SUBSTITUTE_ID,
    ratio: { sourceAmount: 1, substituteAmount: 0 },
  });
  await assert.rejects(() => zero.validate());

  const infinite = new Substitution({
    sourceIngredientId: SOURCE_ID,
    substituteIngredientId: SUBSTITUTE_ID,
    ratio: { sourceAmount: 1, substituteAmount: Infinity },
  });
  await assert.rejects(() => infinite.validate());

  const valid = new Substitution({
    sourceIngredientId: SOURCE_ID,
    substituteIngredientId: SUBSTITUTE_ID,
    ratio: { sourceAmount: 1, substituteAmount: 0.75 },
  });
  await assert.doesNotReject(() => valid.validate());
});

test('ratio is required', async () => {
  const missingRatio = new Substitution({
    sourceIngredientId: SOURCE_ID,
    substituteIngredientId: SUBSTITUTE_ID,
  });
  await assert.rejects(() => missingRatio.validate());
});

test('contexts default to [] and reject more than 10 entries', async () => {
  const substitution = new Substitution({
    sourceIngredientId: SOURCE_ID,
    substituteIngredientId: SUBSTITUTE_ID,
    ratio: { sourceAmount: 1, substituteAmount: 1 },
  });
  assert.deepEqual(substitution.contexts, []);

  const tooMany = new Substitution({
    sourceIngredientId: SOURCE_ID,
    substituteIngredientId: SUBSTITUTE_ID,
    ratio: { sourceAmount: 1, substituteAmount: 1 },
    contexts: Array.from({ length: 11 }, (_, i) => `context-${i}`),
  });
  await assert.rejects(() => tooMany.validate());
});

test('isActive defaults to true', () => {
  const substitution = new Substitution({
    sourceIngredientId: SOURCE_ID,
    substituteIngredientId: SUBSTITUTE_ID,
    ratio: { sourceAmount: 1, substituteAmount: 1 },
  });
  assert.equal(substitution.isActive, true);
});

test('timestamps are enabled', () => {
  assert.equal(Substitution.schema.options.timestamps, true);
});