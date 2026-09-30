import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_RECIPE_INTAKE_BYTES, parseRecipeIntake } from '../src/recipeAuthoring/recipeIntake.js';

const recipe = (patch = {}) => ({ '@context': 'https://schema.org', '@type': 'Recipe', ...patch });
const encoder = new TextEncoder();

function sizedRecipe(byteLength, fill = 'x') {
  const empty = JSON.stringify(recipe({ padding: '' }));
  const available = byteLength - encoder.encode(empty).byteLength;
  const fillBytes = encoder.encode(fill).byteLength;
  const fillCount = Math.floor(available / fillBytes);
  const remainder = available - (fillCount * fillBytes);
  const input = JSON.stringify(recipe({ padding: `${fill.repeat(fillCount)}${'x'.repeat(remainder)}` }));
  assert.equal(encoder.encode(input).byteLength, byteLength);
  return input;
}

test('rejects malformed, oversized, absent, multiple, and unsupported structures', () => {
  assert.equal(parseRecipeIntake('{').error.code, 'MALFORMED_JSON');
  assert.equal(parseRecipeIntake('x'.repeat(MAX_RECIPE_INTAKE_BYTES + 1)).error.code, 'INPUT_TOO_LARGE');
  assert.equal(parseRecipeIntake(JSON.stringify({ '@type': 'Article' })).error.code, 'NO_RECIPE');
  assert.equal(parseRecipeIntake(JSON.stringify([recipe(), recipe()])).error.code, 'MULTIPLE_RECIPES');
  assert.equal(parseRecipeIntake(JSON.stringify({ '@graph': {} })).error.code, 'UNSUPPORTED_STRUCTURE');
});

test('enforces the exact UTF-8 byte boundary including multibyte input', () => {
  assert.equal(parseRecipeIntake(sizedRecipe(MAX_RECIPE_INTAKE_BYTES)).ok, true);
  assert.equal(parseRecipeIntake(sizedRecipe(MAX_RECIPE_INTAKE_BYTES + 1)).error.code, 'INPUT_TOO_LARGE');
  const multibyteNearLimit = sizedRecipe(MAX_RECIPE_INTAKE_BYTES, 'é');
  assert.equal(parseRecipeIntake(multibyteNearLimit).ok, true);
  assert.equal(parseRecipeIntake(`${multibyteNearLimit}é`).error.code, 'INPUT_TOO_LARGE');
});

test('accepts direct, array, and @graph forms with string or array Recipe type', () => {
  assert.equal(parseRecipeIntake(JSON.stringify(recipe({ name: 'Adobo' }))).ok, true);
  assert.equal(parseRecipeIntake(JSON.stringify([recipe({ name: 'Adobo' })])).ok, true);
  assert.equal(parseRecipeIntake(JSON.stringify({ '@graph': [recipe({ name: 'Adobo' })] })).ok, true);
  assert.equal(parseRecipeIntake(JSON.stringify(recipe({ '@type': ['Thing', 'Recipe'], name: 'Adobo' }))).ok, true);
});

test('maps approved text, time, yield, and ordered instruction fields', () => {
  const result = parseRecipeIntake(JSON.stringify(recipe({
    name: 'Chicken Adobo', description: 'A braised Filipino dish.', prepTime: 'PT15M', cookTime: 'PT1H5M',
    recipeYield: 'Makes 4 servings', recipeInstructions: ['Prepare ingredients.', { '@type': 'HowToStep', text: 'Simmer until tender.' }],
  })));
  assert.deepEqual(result.values, {
    title: 'Chicken Adobo', description: 'A braised Filipino dish.', prepTimeMinutes: 15,
    cookTimeMinutes: 65, servings: 4, instructions: ['Prepare ingredients.', 'Simmer until tender.'],
  });
});

test('accepts valid whole-minute ISO duration forms and rejects fractions before later components', () => {
  for (const [duration, minutes] of [['PT1H30M', 90], ['PT1.5H', 90], ['P0.5D', 720], ['P0.1W', 1008]]) {
    const result = parseRecipeIntake(JSON.stringify(recipe({ prepTime: duration })));
    assert.equal(result.values.prepTimeMinutes, minutes, duration);
  }
  for (const duration of ['PT0.5H30M', 'PT0.5M30S', 'P0.5DT1H', 'P1W2D', 'P1DT']) {
    const result = parseRecipeIntake(JSON.stringify(recipe({ prepTime: duration })));
    assert.equal(result.values.prepTimeMinutes, undefined, duration);
    assert.deepEqual(result.invalid.map(({ field }) => field), ['prepTime'], duration);
  }
});

test('maps every exact serving/person yield form with normalization and 1-100 boundaries', () => {
  const accepted = [
    ['1 serving', 1], ['4 servings', 4], ['0004 servings', 4], ['1 person', 1], ['6 people', 6],
    ['Serves 4', 4], ['SERVES\t4 SERVING', 4], [' serves 4 servings ', 4],
    ['Serves 4 person', 4], ['Serves 4 people', 4],
    ['Makes 4 serving', 4], ['  MAKES\n１００ SERVINGS  ', 100],
  ];
  for (const [value, servings] of accepted) {
    const result = parseRecipeIntake(JSON.stringify(recipe({ recipeYield: value })));
    assert.equal(result.values.servings, servings, value);
    assert.deepEqual(result.invalid, [], value);
  }
});

test('maps noun-first yields case-insensitively with approved surrounding whitespace', () => {
  for (const [recipeYield, servings] of [
    ['  4 SERVINGS  ', 4],
    ['  1 SeRvInG  ', 1],
    ['  6 PeOpLe  ', 6],
    ['  1 PERSON  ', 1],
  ]) {
    const result = parseRecipeIntake(JSON.stringify(recipe({ recipeYield })));
    assert.equal(result.values.servings, servings, recipeYield);
    assert.deepEqual(result.invalid, [], recipeYield);
  }
});

test('rejects the required ambiguous yield matrix and exact-vocabulary near misses', () => {
  const rejected = [
    '4', 4, '1 loaf', '12 cookies', 'Makes 2 cakes', '4-6 servings', '4–6 servings',
    'about 4 servings', 'serves four', '4 portions', '4 plates', '4 guests', 'feeds 4',
    'Serves: 4', '4 servings total', 'Makes 4 people', 'Makes 4',
  ];
  for (const value of rejected) {
    const result = parseRecipeIntake(JSON.stringify(recipe({ recipeYield: value })));
    assert.equal(result.values.servings, undefined, String(value));
    assert.deepEqual(result.invalid.map(({ field }) => field), ['recipeYield'], String(value));
  }
});

test('rejects missing semantics, unsupported shapes, bounds, fractions, qualifiers, and multiple numbers', () => {
  const rejected = [
    '', '   ', null, true, [], {}, { '@type': 'QuantitativeValue', value: 4, unitText: 'servings' },
    0, 101, 4.5, '0 servings', '101 servings', '−4 servings', '+4 servings', '4½ servings', '4.5 servings',
    '4/5 servings', '4 to 6 servings', '4 through 6 servings', '4 or 6 servings',
    'approximately 4 servings', 'approx. 4 servings', 'around 4 servings', 'up to 4 servings',
    'at least 4 servings', '~4 servings', 'four servings', 'dozen servings', '4 and a half servings',
  ];
  for (const value of rejected) {
    const result = parseRecipeIntake(JSON.stringify(recipe({ recipeYield: value })));
    assert.equal(result.values.servings, undefined, JSON.stringify(value));
    assert.deepEqual(result.invalid.map(({ field }) => field), ['recipeYield'], JSON.stringify(value));
    assert.match(result.invalid[0].message, /exact serving\/person count from 1 to 100/u);
  }
  const absent = parseRecipeIntake(JSON.stringify(recipe()));
  assert.equal(absent.values.servings, undefined);
  assert.deepEqual(absent.invalid, []);
});

test('reports invalid durations, ambiguous yields, and unsupported instruction variants without mapping them', () => {
  const result = parseRecipeIntake(JSON.stringify(recipe({
    prepTime: '15 minutes', cookTime: 'PT1.5M', recipeYield: '4-6 servings',
    recipeInstructions: [{ '@type': 'HowToSection', text: 'Unsupported section' }],
  })));
  assert.deepEqual(result.values, {});
  assert.deepEqual(result.invalid.map(({ field }) => field), ['prepTime', 'cookTime', 'recipeYield', 'recipeInstructions']);
  assert.equal(parseRecipeIntake(JSON.stringify(recipe({ recipeYield: '-4 servings' }))).values.servings, undefined);
});

test('keeps ingredients unresolved and reports unsupported properties without controlled-field or image inference', () => {
  const result = parseRecipeIntake(JSON.stringify(recipe({
    recipeIngredient: ['1 cup rice', '2 eggs'], image: 'https://example.test/food.jpg',
    recipeCuisine: 'Filipino', recipeCategory: 'Dinner', suitableForDiet: 'VeganDiet', nutrition: { calories: '1' },
  })));
  assert.deepEqual(result.unresolved[0].values, ['1 cup rice', '2 eggs']);
  assert.deepEqual(Object.keys(result.values), []);
  assert.deepEqual(result.unsupported.map(({ field }) => field), ['image', 'recipeCuisine', 'recipeCategory', 'suitableForDiet', 'nutrition']);
  assert.equal(JSON.stringify(result).includes('ingredientId'), false);
  for (const field of ['imageUrl', 'region', 'category', 'difficulty', 'dietaryTags', 'allergens', 'confirmFilipinoCuisine']) {
    assert.equal(Object.hasOwn(result.values, field), false);
  }
});

test('@graph wrapper properties are classified as unsupported and never mapped', () => {
  const result = parseRecipeIntake(JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [recipe({ name: 'Example' })],
    image: 'https://example.test/example.jpg',
    difficulty: 'Easy',
  }));
  assert.equal(result.values.title, 'Example');
  assert.deepEqual(result.unsupported, [
    { field: 'image', location: '@graph wrapper', message: 'Not mapped to the WeCooked Recipe form.' },
    { field: 'difficulty', location: '@graph wrapper', message: 'Not mapped to the WeCooked Recipe form.' },
  ]);
  assert.equal(Object.hasOwn(result.values, 'imageUrl'), false);
  assert.equal(Object.hasOwn(result.values, 'difficulty'), false);
});
