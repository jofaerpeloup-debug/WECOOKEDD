jest.mock('../src/api/client', () => ({ api: { get: jest.fn() } }));

const { api } = require('../src/api/client');
const {
  getRecipe, listRecipes, parseRecipeNutrition,
} = require('../src/api/recipeService');

beforeEach(() => jest.clearAllMocks());

function nutrition(overrides = {}) {
  return {
    schemaVersion: 1, basis: 'perServing', caloriesKcal: 320, proteinGrams: 28,
    carbohydrateGrams: 12, fatGrams: 18, sugarGrams: 3, fiberGrams: 2,
    ...overrides,
  };
}

it('treats missing and explicit null nutrition as clean unavailability', async () => {
  expect(parseRecipeNutrition(undefined)).toBeNull();
  expect(parseRecipeNutrition(null)).toBeNull();
  api.get.mockResolvedValueOnce({ recipe: { id: 'r1', title: 'Adobo' } });
  await expect(getRecipe('r1')).resolves.toEqual({ id: 'r1', title: 'Adobo', nutrition: null });
});

it('preserves the complete exact authoritative per-serving object without derivation', async () => {
  const authoritative = nutrition({ caloriesKcal: 0, fiberGrams: 2.5 });
  api.get.mockResolvedValue({ recipe: { id: 'r1', nutrition: authoritative } });
  await expect(getRecipe('r1')).resolves.toEqual({ id: 'r1', nutrition: authoritative });
  expect(api.get).toHaveBeenCalledWith('/recipes/r1');
});

it.each([
  nutrition({ schemaVersion: 2 }),
  nutrition({ basis: 'totalRecipe' }),
  nutrition({ caloriesKcal: '320' }),
  nutrition({ proteinGrams: -1 }),
  nutrition({ fatGrams: Number.NaN }),
  nutrition({ sugarGrams: Number.POSITIVE_INFINITY }),
  { ...nutrition(), fiberGrams: undefined },
  { ...nutrition(), staffId: 'private' },
  [],
])('rejects malformed present nutrition at the service boundary', (value) => {
  expect(() => parseRecipeNutrition(value)).toThrow(expect.objectContaining({ code: 'RECIPE_NUTRITION_MALFORMED' }));
});

it('rejects an entire mixed list response when any present nutrition member is malformed', async () => {
  api.get.mockResolvedValue({
    recipes: [
      { id: 'good', nutrition: nutrition() },
      { id: 'bad', nutrition: { ...nutrition(), fiberGrams: undefined } },
      { id: 'never-partial', nutrition: null },
    ],
    pagination: { page: 1, limit: 20, total: 3, totalPages: 1 },
  });
  await expect(listRecipes({ page: 1, status: 'never-send' })).rejects.toMatchObject({
    code: 'RECIPE_NUTRITION_MALFORMED',
  });
  expect(api.get).toHaveBeenCalledWith('/recipes', { query: { page: 1 } });
});

it('parses every valid list item and keeps pagination unchanged', async () => {
  const pagination = { page: 1, limit: 20, total: 2, totalPages: 1 };
  api.get.mockResolvedValue({ recipes: [
    { id: 'r1', nutrition: nutrition() }, { id: 'r2' },
  ], pagination });
  await expect(listRecipes()).resolves.toEqual({
    recipes: [{ id: 'r1', nutrition: nutrition() }, { id: 'r2', nutrition: null }],
    pagination,
  });
});
