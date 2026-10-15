jest.mock('../src/api/client', () => ({ api: { get: jest.fn() } }));

const { api } = require('../src/api/client');
const {
  getRecipe, listRecipes, parseRecipeNutrition,
  listSmartCollections, getSmartCollection, SMART_COLLECTION_DEFINITIONS,
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

function smartSummaries() {
  return SMART_COLLECTION_DEFINITIONS.map(({ key, name }, index) => ({
    key,
    name,
    recipeCount: index,
    coverImageUrls: index === 0 ? ['https://example.com/quick.jpg'] : [],
  }));
}

it('requests and strictly parses all five smart collection summaries in frozen order', async () => {
  api.get.mockResolvedValue({ smartCollections: smartSummaries() });
  await expect(listSmartCollections()).resolves.toEqual({ smartCollections: smartSummaries() });
  expect(api.get).toHaveBeenCalledWith('/recipes/smart-collections');
});

it.each([
  { smartCollections: smartSummaries().slice(0, 4) },
  { smartCollections: [...smartSummaries()].reverse() },
  { smartCollections: smartSummaries().map((entry, index) => index === 1 ? { ...entry, name: 'Healthy Meals' } : entry) },
  { smartCollections: smartSummaries().map((entry, index) => index === 0 ? { ...entry, recipeCount: '1' } : entry) },
  { smartCollections: smartSummaries().map((entry, index) => index === 0 ? { ...entry, coverImageUrls: ['http://private.test/a.jpg'] } : entry) },
  { smartCollections: smartSummaries(), clientPredicate: true },
])('rejects malformed smart collection summary success %#', async (payload) => {
  api.get.mockResolvedValue(payload);
  await expect(listSmartCollections()).rejects.toMatchObject({ code: 'SMART_COLLECTION_RESPONSE_MALFORMED' });
});

it('requests one immutable smart key with only page/limit and strictly parses identity, recipes, and pagination', async () => {
  const payload = {
    smartCollection: { key: 'balanced-meals', name: 'Balanced Meals' },
    recipes: [{ id: 'r1', title: 'Balanced Adobo', nutrition: nutrition() }],
    pagination: { page: 2, limit: 20, total: 21, totalPages: 2 },
  };
  api.get.mockResolvedValue(payload);
  await expect(getSmartCollection('balanced-meals', { page: 2, limit: 20 })).resolves.toEqual(payload);
  expect(api.get).toHaveBeenCalledWith('/recipes/smart-collections/balanced-meals', {
    query: { page: 2, limit: 20 },
  });
});

it('accepts truthful empty and past-end smart pages', async () => {
  api.get.mockResolvedValueOnce({
    smartCollection: { key: 'breakfast', name: 'Breakfast' },
    recipes: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  }).mockResolvedValueOnce({
    smartCollection: { key: 'breakfast', name: 'Breakfast' },
    recipes: [],
    pagination: { page: 3, limit: 20, total: 21, totalPages: 2 },
  });
  await expect(getSmartCollection('breakfast')).resolves.toMatchObject({ recipes: [], pagination: { totalPages: 0 } });
  await expect(getSmartCollection('breakfast', { page: 3 })).resolves.toMatchObject({ recipes: [], pagination: { page: 3 } });
});

it.each([
  ['healthy-meals', { page: 1, limit: 20 }],
  ['Balanced Meals', { page: 1, limit: 20 }],
  ['quick-meals', { page: 0, limit: 20 }],
  ['quick-meals', { page: 1, limit: 101 }],
])('rejects an invalid smart request before transport: %s', async (key, params) => {
  await expect(getSmartCollection(key, params)).rejects.toMatchObject({ code: 'SMART_COLLECTION_RESPONSE_MALFORMED' });
  expect(api.get).not.toHaveBeenCalled();
});

it.each([
  {
    smartCollection: { key: 'breakfast', name: 'Dinner Ideas' }, recipes: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  },
  {
    smartCollection: { key: 'breakfast', name: 'Breakfast' }, recipes: [{ id: 'r1' }, { id: 'r1' }],
    pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
  },
  {
    smartCollection: { key: 'breakfast', name: 'Breakfast' }, recipes: [{ id: 'bad', nutrition: nutrition({ fiberGrams: '5' }) }],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  },
  {
    smartCollection: { key: 'breakfast', name: 'Breakfast' }, recipes: [],
    pagination: { page: 2, limit: 20, total: 0, totalPages: 0 },
  },
  {
    smartCollection: { key: 'breakfast', name: 'Breakfast' }, recipes: [],
    pagination: { page: 1, limit: 20, total: 21, totalPages: 1 },
  },
  {
    smartCollection: { key: 'breakfast', name: 'Breakfast' }, recipes: [{ id: 'only-one' }],
    pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
  },
])('rejects malformed or inconsistent smart detail success %#', async (payload) => {
  api.get.mockResolvedValue(payload);
  await expect(getSmartCollection('breakfast')).rejects.toMatchObject({
    code: expect.stringMatching(/SMART_COLLECTION_RESPONSE_MALFORMED|RECIPE_NUTRITION_MALFORMED/),
  });
});

const pagination = { page: 1, limit: 20, total: 1, totalPages: 1 };
const rankedRecipe = {
  id: '507f1f77bcf86cd799439001',
  title: 'Adobo',
  ratingSummary: { averageRating: 4.7, ratingCount: 9 },
};

beforeEach(() => jest.clearAllMocks());

it('sends only frozen list keys including exclusion and ranking sorts', async () => {
  api.get.mockResolvedValue({ recipes: [rankedRecipe], pagination });
  await listRecipes({
    search: 'adobo', region: 'central-luzon', category: 'dinner', difficulty: 'easy',
    dietaryTag: 'dairyFree', ingredientId: 'ingredient', maxPrepTimeMinutes: 30,
    excludeRecipeId: '507f1f77bcf86cd799439099', sort: 'topRated', page: 1, limit: 20,
    status: 'all', popularity: 99,
  });
  expect(api.get).toHaveBeenCalledWith('/recipes', { query: {
    search: 'adobo', region: 'central-luzon', category: 'dinner', difficulty: 'easy',
    dietaryTag: 'dairyFree', ingredientId: 'ingredient', maxPrepTimeMinutes: 30,
    excludeRecipeId: '507f1f77bcf86cd799439099', sort: 'topRated', page: 1, limit: 20,
  } });
});

it.each([
  ['missing recipes', { pagination }],
  ['missing pagination', { recipes: [rankedRecipe] }],
  ['malformed recipe id', { recipes: [{ ...rankedRecipe, id: 'local-1' }], pagination }],
  ['missing summary', { recipes: [{ ...rankedRecipe, ratingSummary: undefined }], pagination }],
  ['zero count', { recipes: [{ ...rankedRecipe, ratingSummary: { averageRating: 5, ratingCount: 0 } }], pagination }],
  ['non-numeric average', { recipes: [{ ...rankedRecipe, ratingSummary: { averageRating: '5', ratingCount: 2 } }], pagination }],
])('fails closed for topRated with %s', async (_label, payload) => {
  api.get.mockResolvedValue(payload);
  await expect(listRecipes({ sort: 'topRated' })).rejects.toMatchObject({
    code: 'INVALID_RANKED_RECIPE_RESPONSE',
  });
});

it('requires a real ranked envelope for relevance without requiring ratingSummary', async () => {
  api.get.mockResolvedValue({ recipes: [{ id: rankedRecipe.id, title: 'Adobo' }], pagination });
  await expect(listRecipes({ sort: 'relevance', search: 'adobo' })).resolves.toEqual({
    recipes: [{ id: rankedRecipe.id, title: 'Adobo', nutrition: null }], pagination,
  });
});

it('preserves non-ranked legacy envelope handling', async () => {
  api.get.mockResolvedValue({});
  await expect(listRecipes({ sort: 'newest' })).resolves.toEqual({ recipes: [], pagination: null });
});
