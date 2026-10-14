const {
  authoredSpiceLevels,
  selectedCookingIngredients,
  matchingCookingTimer,
} = require('../src/utils/cookingSelection');
const { cookModeIngredientChecklist } = require('../src/utils/recipe');

const base = [{ ingredient: { id: 'base', name: 'Base' } }];
const hot = [{ ingredient: { id: 'hot', name: 'Hot' } }];
const recipe = {
  ingredients: base,
  cooking: {
    schemaVersion: 1, defaultSpiceLevel: 'mild',
    spiceAlternatives: [{ spiceLevel: 'hot', ingredients: hot }],
    stepTimers: [{ stepOrder: 2, servings: 4, spiceLevel: 'hot', durationSeconds: 90 }],
  },
};

it('returns complete authored lists and rejects a missing alternative', () => {
  expect(authoredSpiceLevels(recipe)).toEqual(['mild', 'hot']);
  expect(selectedCookingIngredients(recipe, 'mild')).toBe(base);
  expect(selectedCookingIngredients(recipe, 'hot')).toBe(hot);
  expect(selectedCookingIngredients(recipe, 'medium')).toBeNull();
  expect(selectedCookingIngredients({ ingredients: base, cooking: null }, null)).toBe(base);
});

it('matches a timer only when the full authored tuple matches', () => {
  expect(matchingCookingTimer(recipe, 2, 4, 'hot')).toBe(recipe.cooking.stepTimers[0]);
  for (const tuple of [[1, 4, 'hot'], [2, 5, 'hot'], [2, 4, 'mild'], [2, 4, 'medium']]) {
    expect(matchingCookingTimer(recipe, ...tuple)).toBeNull();
  }
  const timerOnly = { cooking: { schemaVersion: 1, defaultSpiceLevel: null, spiceAlternatives: [],
    stepTimers: [{ stepOrder: 1, servings: 2, spiceLevel: null, durationSeconds: 5 }] } };
  expect(matchingCookingTimer(timerOnly, 1, 2, null)).toBe(timerOnly.cooking.stepTimers[0]);
  expect(matchingCookingTimer(timerOnly, 1, 2, 'hot')).toBeNull();
});

it('keeps repeated usages, notes, optional rows and quantity-free toTaste in the selected checklist', () => {
  const selected = [
    { ingredient: { id: 'hot', name: 'Chili' }, quantity: 2, unit: 'piece', note: 'chopped' },
    { ingredient: { id: 'hot', name: 'Chili' }, quantity: null, unit: 'toTaste', optional: true },
  ];
  expect(cookModeIngredientChecklist({ ...recipe, servings: 4 }, 6, [], selected)).toEqual([
    { name: 'Chili (chopped)', qty: '3 piece' },
    { name: 'Chili · optional', qty: 'To taste' },
  ]);
  expect(cookModeIngredientChecklist(recipe, 4, ['Default ingredient must not reappear'], [])).toEqual([]);
});
