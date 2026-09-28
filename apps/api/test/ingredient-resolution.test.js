const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_CANDIDATES, normalizeResolverName, parseIngredientLine, resolveIngredientLine, resolveIngredientLines,
} = require('../src/modules/ingredients/ingredient-resolution');

const ingredient = (id, name, aliases = [], category = 'pantry') => ({ _id: id, name, aliases, category });

test('normalization is limited to trim, lowercase, and Unicode whitespace collapse', () => {
  assert.equal(normalizeResolverName('  Crème\u00a0  FRAÎCHE  '), 'crème fraîche');
  assert.notEqual(normalizeResolverName('tomatoes'), normalizeResolverName('tomato'));
  assert.notEqual(normalizeResolverName('creme fraiche'), normalizeResolverName('crème fraîche'));
});

test('parses the frozen quantity grammar and rejects unsafe quantities without discarding source text', () => {
  for (const [line, quantity] of [['2 cups rice', 2], ['0.5 cup rice', 0.5], ['.5 cup rice', 0.5], ['1/2 cup rice', 0.5], ['1 1/2 cups rice', 1.5]]) {
    assert.equal(parseIngredientLine(line).quantity, quantity, line);
  }
  for (const line of ['0 cups rice', '-1 cup rice', '1/0 cup rice', '+1 cup rice', '1-2 cups rice', '½ cup rice', 'one cup rice']) {
    const parsed = parseIngredientLine(line);
    assert.equal(parsed.quantity, null, line);
    assert.equal(parsed.name, line, line);
  }
});

test('rejects malformed numeric prefixes wholly while preserving valid boundary forms', () => {
  for (const [line, expected] of [
    ['2 cups rice', { quantity: 2, unit: 'cup', name: 'rice' }],
    ['0.5 cup rice', { quantity: 0.5, unit: 'cup', name: 'rice' }],
    ['.5 cup rice', { quantity: 0.5, unit: 'cup', name: 'rice' }],
    ['1/2 cup rice', { quantity: 0.5, unit: 'cup', name: 'rice' }],
    ['1 1/2 cups rice', { quantity: 1.5, unit: 'cup', name: 'rice' }],
  ]) assert.deepEqual(parseIngredientLine(line), expected, line);

  for (const line of [
    '1 2 cups rice', '1 to 2 cups rice', '1 - 2 cups rice', '1 2/3/4 cups rice', '1 0/2 cup rice',
    '1 / 2 / 3 cups rice', '1 + 2 cups rice', '1 or 2 cups rice', '1 – 2 cups rice',
    '1 to2 cups rice', '1 or2 cups rice', '1 x2 cups rice', '1 & 2 cups rice', '1 ~ 2 cups rice',
    '1 arbitrary 2 cups rice', '1 ½ cups rice',
  ]) assert.deepEqual(parseIngredientLine(line), { quantity: null, unit: null, name: line }, line);

  assert.deepEqual(parseIngredientLine('  1 to 2 cups rice  '), { quantity: null, unit: null, name: '1 to 2 cups rice' });
  assert.deepEqual(parseIngredientLine('1 0/2 cup rice to taste'), {
    quantity: null, unit: null, name: '1 0/2 cup rice to taste',
  });
  assert.deepEqual(parseIngredientLine('1 cup 2% milk'), { quantity: 1, unit: 'cup', name: '2% milk' });
  assert.deepEqual(parseIngredientLine('1 xylitol'), { quantity: 1, unit: null, name: 'xylitol' });
  assert.deepEqual(parseIngredientLine('1 & pepper'), { quantity: 1, unit: null, name: '& pepper' });
});

test('maps every controlled source unit, optional of, quantity-only, and exact trailing to taste', () => {
  const cases = {
    g: 'g', gram: 'g', grams: 'g', kg: 'kg', kilogram: 'kg', kilograms: 'kg',
    lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb', oz: 'oz', ounce: 'oz', ounces: 'oz',
    ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
    l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l', tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
    tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp', cup: 'cup', cups: 'cup', piece: 'piece', pieces: 'piece',
    clove: 'clove', cloves: 'clove', slice: 'slice', slices: 'slice', can: 'can', cans: 'can', pack: 'pack', packs: 'pack',
    bunch: 'bunch', bunches: 'bunch', pinch: 'pinch', pinches: 'pinch',
  };
  for (const [token, unit] of Object.entries(cases)) {
    assert.deepEqual(parseIngredientLine(`2 ${token} of rice`), { quantity: 2, unit, name: 'rice' }, token);
    assert.deepEqual(parseIngredientLine(`2 ${token.toUpperCase()}. rice`), { quantity: 2, unit, name: 'rice' }, `${token}.`);
  }
  assert.deepEqual(parseIngredientLine('2 large eggs'), { quantity: 2, unit: null, name: 'large eggs' });
  assert.deepEqual(parseIngredientLine('salt to taste'), { quantity: null, unit: 'toTaste', name: 'salt' });
  assert.deepEqual(parseIngredientLine('to taste'), { quantity: null, unit: 'toTaste', name: null });
});

test('normalizes frozen pound/ounce examples and retains unsupported punctuation in the name hint', () => {
  assert.deepEqual(parseIngredientLine('3/4 lb. spaghetti'), { quantity: 0.75, unit: 'lb', name: 'spaghetti' });
  assert.deepEqual(parseIngredientLine('8 OZ pancit canton noodles'), { quantity: 8, unit: 'oz', name: 'pancit canton noodles' });
  assert.deepEqual(parseIngredientLine('1 TbSp. of soy sauce'), { quantity: 1, unit: 'tbsp', name: 'soy sauce' });
  assert.deepEqual(parseIngredientLine('2 cups. rice'), { quantity: 2, unit: 'cup', name: 'rice' });
  for (const [line, name] of [
    ['1 fl oz milk', 'fl oz milk'],
    ['1 lb.. spaghetti', 'lb.. spaghetti'],
    ['1 lb, spaghetti', 'lb, spaghetti'],
    ['1 stone beef', 'stone beef'],
  ]) assert.deepEqual(parseIngredientLine(line), { quantity: 1, unit: null, name }, line);
});

test('passes canonical pound/ounce hints into resolver classification without changing name matching', () => {
  const spaghetti = resolveIngredientLine('3/4 lb. spaghetti', [ingredient('1', 'Spaghetti')]);
  assert.deepEqual(spaghetti.parsed, { quantity: 0.75, unit: 'lb', name: 'spaghetti' });
  assert.equal(spaghetti.match.kind, 'exact');

  const noodles = resolveIngredientLine('8 OZ pancit canton noodles', [ingredient('2', 'Pancit Canton Noodles')]);
  assert.deepEqual(noodles.parsed, { quantity: 8, unit: 'oz', name: 'pancit canton noodles' });
  assert.equal(noodles.match.kind, 'exact');
});

test('classifies exact, ambiguous, possible, none, and unparsed without deduplicating input lines', () => {
  const catalog = [
    ingredient('1', 'Rice', ['white rice']),
    ingredient('2', 'Egg', ['eggs']),
    ingredient('3', 'Egg substitute', ['eggs']),
    ingredient('4', 'Chicken breast'),
  ];
  const results = resolveIngredientLines(['1 cup rice', 'eggs', 'boneless chicken breast', 'tomatoes', '2 cups', '1 cup rice'], catalog);
  assert.deepEqual(results.map(({ match }) => match.kind), ['exact', 'ambiguous', 'possible', 'none', 'unparsed', 'exact']);
  assert.deepEqual(results.map(({ index }) => index), [0, 1, 2, 3, 4, 5]);
  assert.equal(results[0].match.totalCandidates, 1);
  assert.equal(results[0].match.candidates[0].matchedOn, 'name');
  assert.equal(results[1].match.totalCandidates, 2);
});

test('counts an Ingredient once, prefers exact then canonical evidence, and keeps literal token boundaries', () => {
  const catalog = [
    ingredient('1', 'Rice', ['rice', 'white rice']),
    ingredient('2', 'White Rice', ['rice']),
  ];
  const ambiguous = resolveIngredientLine('rice', catalog);
  assert.equal(ambiguous.match.kind, 'ambiguous');
  assert.equal(ambiguous.match.totalCandidates, 2);
  assert.equal(ambiguous.match.candidates[0].ingredient.name, 'Rice');
  assert.equal(ambiguous.match.candidates[0].matchedOn, 'name');
  assert.equal(resolveIngredientLine('red large onion', [ingredient('3', 'red onion')]).match.kind, 'none');
  assert.equal(resolveIngredientLine('tomatoes', [ingredient('4', 'Tomato')]).match.kind, 'none');
  assert.equal(resolveIngredientLine('salt,', [ingredient('5', 'Salt')]).match.kind, 'none');
});

test('orders possible candidates deterministically and reports the bounded complete-catalog count', () => {
  const catalog = Array.from({ length: 12 }, (_, index) => ingredient(String(index + 1), `${String.fromCharCode(65 + index)} rice`));
  const result = resolveIngredientLine('rice', catalog);
  assert.equal(result.match.kind, 'possible');
  assert.equal(result.match.totalCandidates, 12);
  assert.equal(result.match.candidates.length, MAX_CANDIDATES);
  assert.equal(result.match.truncated, true);
  assert.deepEqual(result.match.candidates.slice(0, 3).map(({ ingredient: item }) => item.name), ['A rice', 'B rice', 'C rice']);
});

test('returns only bounded public candidate fields', () => {
  const result = resolveIngredientLine('rice', [ingredient('1', 'Rice', ['grain'])]);
  assert.deepEqual(result.match.candidates[0], {
    ingredient: { id: '1', name: 'Rice', category: 'pantry' }, matchedOn: 'name', matchedText: 'Rice',
  });
  assert.equal(JSON.stringify(result).includes('normalizedName'), false);
  assert.equal(JSON.stringify(result).includes('allergenTags'), false);
});
