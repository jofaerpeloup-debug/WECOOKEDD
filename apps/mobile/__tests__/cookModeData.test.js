const {
  clampCookStepIndex,
  cookModeIngredientChecklist,
  cookModeSteps,
  hasRecipeDetailData,
} = require('../src/utils/recipe');

describe('Recipe Detail hydration boundary', () => {
  it('accepts a full PublicRecipe payload', () => {
    expect(
      hasRecipeDetailData({ ingredients: [], instructions: [], steps: [] })
    ).toBe(true);
  });

  it('rejects the Favorites summary shape', () => {
    expect(
      hasRecipeDetailData({
        id: 'recipe-id',
        title: 'Summary only',
        prepTimeMinutes: 10,
        cookTimeMinutes: 20,
      })
    ).toBe(false);
  });
});

describe('CookMode real recipe step adapter', () => {
  it('prefers the public structured steps and respects their explicit order', () => {
    const recipe = {
      steps: [
        { order: 2, text: 'Simmer until tender.' },
        { order: 1, text: 'Combine the ingredients.' },
      ],
      instructions: ['This fallback must not win.'],
    };

    expect(cookModeSteps(recipe)).toEqual([
      { order: 1, text: 'Combine the ingredients.' },
      { order: 2, text: 'Simmer until tender.' },
    ]);
  });

  it('falls back to real instruction strings for legacy API compatibility', () => {
    expect(cookModeSteps({ instructions: ['First.', 'Second.'] })).toEqual([
      { order: 1, text: 'First.' },
      { order: 2, text: 'Second.' },
    ]);
  });

  it('never adds a title or timer duration to real steps', () => {
    const [step] = cookModeSteps({ steps: [{ order: 1, text: 'Cook gently.' }] });
    expect(step).toEqual({ order: 1, text: 'Cook gently.' });
    expect(step).not.toHaveProperty('title');
    expect(step).not.toHaveProperty('seconds');
  });
});

describe('CookMode step boundaries', () => {
  it('clamps negative, out-of-range, and invalid indexes', () => {
    expect(clampCookStepIndex(-1, 3)).toBe(0);
    expect(clampCookStepIndex(0, 3)).toBe(0);
    expect(clampCookStepIndex(2, 3)).toBe(2);
    expect(clampCookStepIndex(3, 3)).toBe(2);
    expect(clampCookStepIndex(99, 3)).toBe(2);
    expect(clampCookStepIndex(Number.NaN, 3)).toBe(0);
    expect(clampCookStepIndex(4, 0)).toBe(0);
  });
});

describe('CookMode serving display', () => {
  it('scales structured quantities from the real base servings without mutation', () => {
    const recipe = {
      servings: 4,
      ingredients: [
        {
          ingredient: { id: 'chicken-id', name: 'Chicken' },
          quantity: 1,
          unit: 'kg',
          note: 'cut into pieces',
          optional: false,
        },
        {
          ingredient: { id: 'pepper-id', name: 'Black pepper' },
          quantity: null,
          unit: 'toTaste',
          note: null,
          optional: true,
        },
      ],
    };
    const before = JSON.parse(JSON.stringify(recipe));

    expect(cookModeIngredientChecklist(recipe, 8)).toEqual([
      { name: 'Chicken (cut into pieces)', qty: '2 kg' },
      { name: 'Black pepper · optional', qty: 'To taste' },
    ]);
    expect(recipe).toEqual(before);
  });

  it('uses the existing route display lines only when structured ingredients are unavailable', () => {
    expect(cookModeIngredientChecklist({}, 4, ['1 kg Chicken'])).toEqual([
      { name: '1 kg Chicken', qty: '' },
    ]);
  });
});
