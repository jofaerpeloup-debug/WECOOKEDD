jest.mock('../src/api/client', () => {
  class ApiError extends Error {
    constructor(message, opts = {}) {
      super(message);
      this.name = 'ApiError';
      Object.assign(this, { code: 'UNKNOWN', status: 0, details: [], kind: 'api' }, opts);
    }
  }
  return {
    api: { get: jest.fn(), post: jest.fn() },
    ApiError,
  };
});

const { api } = require('../src/api/client');
const { getHistory, recordCompletion, getStats, getRecipeStatus } = require('../src/api/cookHistoryService');

beforeEach(() => {
  jest.clearAllMocks();
});

const historyEntry = {
  id: 'event-1',
  recipe: {
    id: 'recipe-1',
    title: 'Chicken Adobo',
    region: 'central-luzon',
    category: 'main-dish',
    difficulty: 'easy',
    prepTimeMinutes: 15,
    cookTimeMinutes: 40,
    imageUrl: 'https://images.example/adobo.jpg',
  },
  servings: 4,
  completedAt: '2026-09-27T04:00:00.000Z',
};

describe('cookHistoryService.getHistory', () => {
  it('GETs the exact list endpoint with page, limit, and newest sort', async () => {
    const payload = {
      cookHistory: [historyEntry],
      pagination: { page: 2, limit: 20, total: 41, totalPages: 3 },
    };
    api.get.mockResolvedValue(payload);

    const result = await getHistory({ page: 2, limit: 20, sort: 'newest' });

    expect(api.get).toHaveBeenCalledWith('/cook-history', {
      query: { page: 2, limit: 20, sort: 'newest' },
    });
    expect(result).toEqual(payload);
  });

  it('preserves empty intermediate pages and raw pagination authority', async () => {
    const payload = {
      cookHistory: [],
      pagination: { page: 1, limit: 20, total: 27, totalPages: 2 },
    };
    api.get.mockResolvedValue(payload);

    await expect(getHistory({ page: 1, limit: 20, sort: 'newest' })).resolves.toEqual(payload);
  });

  it('does not add client timestamps, event ids, recipes, or other query authority', async () => {
    api.get.mockResolvedValue({
      cookHistory: [historyEntry],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const result = await getHistory({
      page: 1,
      limit: 20,
      sort: 'newest',
      userId: 'not-allowed',
      completedAt: 'client-time',
    });

    expect(api.get.mock.calls[0][1].query).toEqual({ page: 1, limit: 20, sort: 'newest' });
    expect(result.cookHistory[0]).toBe(historyEntry);
  });

  it.each([
    undefined,
    {},
    { cookHistory: [], pagination: null },
    { cookHistory: 'not-an-array', pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } },
    { cookHistory: [{ ...historyEntry, id: '' }], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } },
    { cookHistory: [{ ...historyEntry, completedAt: 'not-a-date' }], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } },
    { cookHistory: [historyEntry], pagination: { page: 1, limit: 20, total: -1, totalPages: 0 } },
    { cookHistory: [historyEntry], pagination: { page: 2, limit: 20, total: 1, totalPages: 1 } },
  ])('fails closed for malformed successful response %#', async (payload) => {
    api.get.mockResolvedValue(payload);

    await expect(getHistory({ page: 1, limit: 20, sort: 'newest' })).rejects.toMatchObject({
      code: 'INVALID_COOK_HISTORY_PAYLOAD',
    });
  });
});

describe('cookHistoryService.recordCompletion', () => {
  it('POSTs only recipeId when no servings is given', async () => {
    api.post.mockResolvedValue({
      cookHistory: { id: 'ch1', recipe: { id: 'r1' }, servings: null, completedAt: '2026-01-01T00:00:00.000Z' },
    });

    const result = await recordCompletion({ recipeId: 'r1' });

    expect(api.post).toHaveBeenCalledWith('/cook-history', { body: { recipeId: 'r1' } });
    expect(result).toEqual({
      id: 'ch1',
      recipe: { id: 'r1' },
      servings: null,
      completedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('POSTs the real selected servings when provided', async () => {
    api.post.mockResolvedValue({ cookHistory: { id: 'ch2', servings: 6 } });

    await recordCompletion({ recipeId: 'r1', servings: 6 });

    expect(api.post).toHaveBeenCalledWith('/cook-history', { body: { recipeId: 'r1', servings: 6 } });
  });

  it('never sends userId, ownerId, or completedAt from the client', async () => {
    api.post.mockResolvedValue({ cookHistory: {} });

    await recordCompletion({ recipeId: 'r1', servings: 4 });

    const [, opts] = api.post.mock.calls[0];
    expect(Object.keys(opts.body).sort()).toEqual(['recipeId', 'servings']);
  });

  it('propagates a RECIPE_NOT_FOUND ApiError as-is', async () => {
    const err = Object.assign(new Error('Recipe not found.'), { code: 'RECIPE_NOT_FOUND', status: 404 });
    api.post.mockRejectedValue(err);

    await expect(recordCompletion({ recipeId: 'missing' })).rejects.toBe(err);
  });
});

describe('cookHistoryService.getStats', () => {
  it('GETs /cook-history/stats and returns the raw stats object', async () => {
    api.get.mockResolvedValue({ stats: { totalCooks: 3, uniqueRecipesCooked: 2 } });

    const result = await getStats();

    expect(api.get).toHaveBeenCalledWith('/cook-history/stats');
    expect(result).toEqual({ totalCooks: 3, uniqueRecipesCooked: 2 });
  });
});

describe('cookHistoryService.getRecipeStatus', () => {
  it('GETs the recipe-scoped status endpoint and returns the boolean payload', async () => {
    api.get.mockResolvedValue({ hasCooked: true });

    const result = await getRecipeStatus('r1');

    expect(api.get).toHaveBeenCalledWith('/cook-history/recipes/r1/status');
    expect(result).toEqual({ hasCooked: true });
  });

  it('URL-encodes the recipeId', async () => {
    api.get.mockResolvedValue({ hasCooked: false });

    await getRecipeStatus('weird id/with slash');

    expect(api.get).toHaveBeenCalledWith('/cook-history/recipes/weird%20id%2Fwith%20slash/status');
  });

  it('propagates a RECIPE_NOT_FOUND ApiError as-is, never fabricating a status', async () => {
    const err = Object.assign(new Error('Recipe not found.'), { code: 'RECIPE_NOT_FOUND', status: 404 });
    api.get.mockRejectedValue(err);

    await expect(getRecipeStatus('missing')).rejects.toBe(err);
  });
});
