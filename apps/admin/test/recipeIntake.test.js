import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_RECIPE_INTAKE_BYTES, acceptNutritionSuggestion, parseRecipeIntake,
} from '../src/recipeAuthoring/recipeIntake.js';

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

test('keeps ingredients unresolved and separates metadata disclosure from generic unsupported properties', () => {
  const result = parseRecipeIntake(JSON.stringify(recipe({
    recipeIngredient: ['1 cup rice', '2 eggs'], image: 'https://example.test/food.jpg',
    recipeCuisine: 'Filipino', recipeCategory: 'Dinner', suitableForDiet: 'VeganDiet', nutrition: { calories: '1' },
  })));
  assert.deepEqual(result.unresolved[0].values, ['1 cup rice', '2 eggs']);
  assert.deepEqual(Object.keys(result.values), []);
  assert.deepEqual(result.unsupported.map(({ field }) => field), ['image']);
  assert.deepEqual(result.invalid.map(({ field }) => field), ['nutrition']);
  assert.deepEqual(result.metadata.map(({ source, status, field, value }) => ({ source, status, field, value })), [
    { source: 'recipeCategory', status: 'suggested', field: 'category', value: 'dinner' },
    { source: 'suitableForDiet', status: 'suggested', field: 'dietaryTags', value: 'vegan' },
    { source: 'recipeCuisine', status: 'unsupported', field: undefined, value: undefined },
  ]);
  assert.equal(JSON.stringify(result).includes('ingredientId'), false);
  for (const field of ['imageUrl', 'region', 'category', 'difficulty', 'dietaryTags', 'allergens', 'confirmFilipinoCuisine']) {
    assert.equal(Object.hasOwn(result.values, field), false);
  }
});

test('maps only the four scalar trimmed case-insensitive category suggestions', () => {
  for (const [source, value, label] of [
    [' Breakfast ', 'breakfast', 'Breakfast'], ['LUNCH', 'lunch', 'Lunch'],
    ['Dinner', 'dinner', 'Dinner'], ['snack', 'snack', 'Snack'],
  ]) {
    const result = parseRecipeIntake(JSON.stringify(recipe({ recipeCategory: source })));
    assert.deepEqual(result.metadata, [{
      source: 'recipeCategory', sourceValue: JSON.stringify(source), status: 'suggested',
      field: 'category', value, label,
      reason: 'Exact supported category; Moderator acceptance is required.',
    }], source);
    assert.equal(result.values.category, undefined);
  }
});

test('leaves unsupported and ambiguous category values unresolved without partial matching', () => {
  const cases = [
    ['', 'unsupported'], [17, 'unsupported'], [['Dinner'], 'unsupported'],
    [['Dinner', 'Lunch'], 'ambiguous'], ['Dinner,Lunch', 'ambiguous'],
    ['Dinner / Lunch', 'unsupported'], ['Dinner; Lunch', 'unsupported'],
    ['Dinner entree', 'unsupported'], ['Dessert', 'unsupported'], ['breakfast bowl', 'unsupported'],
  ];
  for (const [source, status] of cases) {
    const result = parseRecipeIntake(JSON.stringify(recipe({ recipeCategory: source })));
    assert.equal(result.metadata.length, 1, JSON.stringify(source));
    assert.equal(result.metadata[0].status, status, JSON.stringify(source));
    assert.equal(result.metadata[0].field, undefined, JSON.stringify(source));
    assert.equal(result.values.category, undefined, JSON.stringify(source));
  }
});

test('maps all allowed dietary identities, representations, order, and deduplication', () => {
  const identities = [
    ['VegetarianDiet', 'vegetarian', 'Vegetarian'],
    ['VeganDiet', 'vegan', 'Vegan'],
    ['GlutenFreeDiet', 'glutenFree', 'Gluten-free'],
  ];
  for (const [identity, value, label] of identities) {
    for (const source of [
      `  ${identity}  `,
      ` https://schema.org/${identity} `,
      { '@id': `https://schema.org/${identity}` },
    ]) {
      const result = parseRecipeIntake(JSON.stringify(recipe({ suitableForDiet: source })));
      assert.deepEqual(result.metadata.map(({ status, field, value: mapped, label: mappedLabel }) => ({ status, field, value: mapped, label: mappedLabel })), [
        { status: 'suggested', field: 'dietaryTags', value, label },
      ], JSON.stringify(source));
      assert.equal(result.values.dietaryTags, undefined);
    }
  }

  const ordered = parseRecipeIntake(JSON.stringify(recipe({
    suitableForDiet: [
      'VeganDiet', 'https://schema.org/VegetarianDiet',
      { '@id': 'https://schema.org/VeganDiet' },
      { '@id': 'https://schema.org/GlutenFreeDiet' },
    ],
  })));
  assert.deepEqual(ordered.metadata.map(({ value }) => value), ['vegan', 'vegetarian', 'glutenFree']);
});

test('rejects dietary near misses and unsupported diets without inference', () => {
  const unsupported = [
    [], [['VeganDiet']], 'LowLactoseDiet', 'pescatarian', 'dairyFree', 'nutFree',
    'vegandiet', 'http://schema.org/VeganDiet', 'https://www.schema.org/VeganDiet',
    'https://schema.org/VeganDiet/', 'https://schema.org/VeganDiet?x=1',
    'https://schema.org/VeganDiet#x', 'schema:VeganDiet', './VeganDiet',
    { '@id': 'https://schema.org/VeganDiet', name: 'Vegan' },
    { '@id': 'https://schema.org/vegandiet' },
  ];
  for (const source of unsupported) {
    const result = parseRecipeIntake(JSON.stringify(recipe({ suitableForDiet: source })));
    assert.equal(result.metadata.some(({ status }) => status === 'suggested'), false, JSON.stringify(source));
    assert.equal(result.values.dietaryTags, undefined, JSON.stringify(source));
  }
  const mixed = parseRecipeIntake(JSON.stringify(recipe({
    suitableForDiet: ['VeganDiet', 'LowLactoseDiet', 'nutFree'],
  })));
  assert.deepEqual(mixed.metadata.map(({ status, value }) => [status, value]), [
    ['suggested', 'vegan'], ['unsupported', undefined], ['unsupported', undefined],
  ]);
  assert.equal(mixed.metadata.some(({ value }) => value === 'vegetarian'), false);
});

test('discloses cuisine without ever suggesting Region', () => {
  for (const source of [
    'Filipino', 'Philippine', 'Asian', 'Southeast Asian', 'Luzon', 'Visayas', 'Mindanao',
    'Ilocano', 'Bicolano', 'Kapampangan', 'Cebuano', 'ncr', 'National Capital Region', 17,
  ]) {
    const result = parseRecipeIntake(JSON.stringify(recipe({ recipeCuisine: source })));
    assert.equal(result.metadata[0].status, 'unsupported', JSON.stringify(source));
    assert.equal(result.metadata[0].field, undefined, JSON.stringify(source));
    assert.equal(result.values.region, undefined, JSON.stringify(source));
  }
  const array = parseRecipeIntake(JSON.stringify(recipe({ recipeCuisine: ['Ilocano', 'Bicolano'] })));
  assert.equal(array.metadata[0].status, 'ambiguous');
  assert.equal(array.values.region, undefined);
});

test('bounds metadata source display and preserves JSON text for safe React escaping', () => {
  const source = `<script>alert("x")</script>${'x'.repeat(300)}`;
  const result = parseRecipeIntake(JSON.stringify(recipe({ recipeCuisine: source })));
  assert.equal(result.metadata[0].sourceValue.length, 200);
  assert.match(result.metadata[0].sourceValue, /… \[truncated\]$/u);
  assert.equal(result.metadata[0].sourceValue.startsWith('"<script>'), true);
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

function jsonLdNutrition(overrides = {}) {
  return {
    '@type': 'NutritionInformation', servingSize: '1 serving', calories: '320 kcal',
    proteinContent: '28 g', carbohydrateContent: '12 grams', fatContent: '18 g',
    sugarContent: '3 g', fiberContent: '2 g', ...overrides,
  };
}

test('complete explicit Schema.org nutrition creates only a per-serving suggestion with source disclosure', () => {
  const result = parseRecipeIntake(JSON.stringify(recipe({
    nutrition: jsonLdNutrition(), author: { '@type': 'Person', name: 'Untrusted author' },
  })), { sourceUrl: 'https://example.com/final-recipe' });
  assert.deepEqual(result.nutritionSuggestion, {
    status: 'suggested',
    nutrition: {
      schemaVersion: 1, basis: 'perServing', caloriesKcal: 320, proteinGrams: 28,
      carbohydrateGrams: 12, fatGrams: 18, sugarGrams: 3, fiberGrams: 2,
    },
    source: { kind: 'jsonLd', label: 'Schema.org Recipe JSON-LD', url: 'https://example.com/final-recipe' },
    reason: 'Complete explicit per-serving nutrition; Moderator acceptance is required.',
  });
  assert.equal('nutrition' in result.values, false);
  assert.ok(result.unsupported.some(({ field }) => field === 'author'));
  assert.equal(JSON.stringify(result.nutritionSuggestion).includes('Untrusted author'), false);
});

test('JSON-LD nutrition never guesses units, basis, missing values, totals, or partial suggestions', () => {
  for (const nutrition of [
    jsonLdNutrition({ servingSize: undefined }), jsonLdNutrition({ servingSize: '4 servings' }),
    jsonLdNutrition({ calories: '320 calories' }), jsonLdNutrition({ proteinContent: 28 }),
    jsonLdNutrition({ carbohydrateContent: '12 oz' }), jsonLdNutrition({ fiberContent: undefined }),
    jsonLdNutrition({ sugarContent: '-1 g' }), { ...jsonLdNutrition(), '@type': 'Thing' },
  ]) {
    const result = parseRecipeIntake(JSON.stringify(recipe({ nutrition })));
    assert.equal(result.nutritionSuggestion, null);
    assert.ok(result.invalid.some(({ field }) => field.startsWith('nutrition')));
  }
});

test('nutrition suggestion requires explicit Moderator acceptance before entering the form', () => {
  const suggestion = parseRecipeIntake(JSON.stringify(recipe({ nutrition: jsonLdNutrition() }))).nutritionSuggestion;
  const changes = [];
  const outcome = acceptNutritionSuggestion({
    suggestion, change: (field, value) => changes.push([field, value]),
  });
  assert.deepEqual(outcome, { status: 'accepted', changed: true });
  assert.deepEqual(changes, [
    ['nutrition', {
      caloriesKcal: '320', proteinGrams: '28', carbohydrateGrams: '12',
      fatGrams: '18', sugarGrams: '3', fiberGrams: '2',
    }],
    ['nutritionSource', { kind: 'jsonLd', label: 'Schema.org Recipe JSON-LD', url: '' }],
  ]);
});
