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
const { recordCompletion, getStats, getRecipeStatus } = require('../src/api/cookHistoryService');

beforeEach(() => {
  jest.clearAllMocks();
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
