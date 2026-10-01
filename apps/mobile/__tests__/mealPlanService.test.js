jest.mock('../src/api/client', () => {
  class ApiError extends Error {
    constructor(message, options = {}) {
      super(message);
      Object.assign(this, { code: 'UNKNOWN', status: 0, kind: 'api', details: [] }, options);
    }
    get isNetworkError() { return this.kind === 'network'; }
  }
  return { ApiError, api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), del: jest.fn() } };
});

const { ApiError, api } = require('../src/api/client');
const { getMealPlan, createMealPlanEntry, moveMealPlanEntry, removeMealPlanEntry, clearMealPlanRange } = require('../src/api/mealPlanService');
const { getMealPlanErrorState } = require('../src/api/mealPlanErrors');

beforeEach(() => jest.clearAllMocks());

it('fetches only the explicit bounded date range and preserves unavailable entries', async () => {
  api.get.mockResolvedValue({ mealPlan: [{ id: 'e1', dateKey: '2026-09-14', recipeId: 'r1', isAvailable: false, recipe: null }] });
  const result = await getMealPlan('2026-09-14', '2026-09-20');
  expect(api.get).toHaveBeenCalledWith('/meal-plan', { query: { startDate: '2026-09-14', endDate: '2026-09-20' } });
  expect(result[0]).toMatchObject({ id: 'e1', isAvailable: false, recipe: null });
});

it('creates with only dateKey and recipeId', async () => {
  api.post.mockResolvedValue({ mealPlanEntry: { id: 'e1', dateKey: '2026-09-14', recipeId: 'r1', isAvailable: true, recipe: { id: 'r1' } } });
  await createMealPlanEntry({ dateKey: '2026-09-14', recipeId: 'r1', userId: 'must-not-send' });
  expect(api.post).toHaveBeenCalledWith('/meal-plan', { body: { dateKey: '2026-09-14', recipeId: 'r1' } });
});

it('removes one encoded entry id and clears only an explicit range', async () => {
  api.del.mockResolvedValueOnce({ deleted: true }).mockResolvedValueOnce({ deletedCount: 4 });
  await expect(removeMealPlanEntry('entry/id')).resolves.toBe(true);
  await expect(clearMealPlanRange('2026-09-14', '2026-09-20')).resolves.toEqual({ deletedCount: 4 });
  expect(api.del).toHaveBeenNthCalledWith(1, '/meal-plan/entry%2Fid');
  expect(api.del).toHaveBeenNthCalledWith(2, '/meal-plan', { query: { startDate: '2026-09-14', endDate: '2026-09-20' } });
});

it('moves one encoded entry with the exact conditional PATCH body and normalizes success', async () => {
  api.patch.mockResolvedValue({
    mealPlanEntry: {
      id: 'entry/id',
      dateKey: '2026-09-16',
      recipeId: 'r1',
      isAvailable: false,
      recipe: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-14T09:00:00.000Z',
      userId: 'must-not-retain',
    },
  });
  await expect(moveMealPlanEntry('entry/id', {
    dateKey: '2026-09-16',
    expectedUpdatedAt: '2026-09-14T08:30:00.000Z',
    recipeId: 'must-not-send',
  })).resolves.toEqual({
    id: 'entry/id',
    dateKey: '2026-09-16',
    recipeId: 'r1',
    isAvailable: false,
    recipe: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-14T09:00:00.000Z',
  });
  expect(api.patch).toHaveBeenCalledWith('/meal-plan/entry%2Fid', {
    body: { dateKey: '2026-09-16', expectedUpdatedAt: '2026-09-14T08:30:00.000Z' },
  });
});

it.each([
  ['MEAL_PLAN_ENTRY_ALREADY_EXISTS', 409, 'duplicate'],
  ['MEAL_PLAN_ENTRY_STALE', 409, 'stale'],
  ['MEAL_PLAN_ENTRY_NOT_FOUND', 404, 'notFound'],
  ['INTERNAL_SERVER_ERROR', 500, 'generic'],
])('propagates %s and normalizes it to the %s public state', async (code, status, kind) => {
  const error = new ApiError('raw backend detail', { code, status });
  api.patch.mockRejectedValue(error);
  await expect(moveMealPlanEntry('e1', { dateKey: '2026-09-16', expectedUpdatedAt: 'current' })).rejects.toBe(error);
  const publicState = getMealPlanErrorState(error);
  expect(publicState.kind).toBe(kind);
  expect(publicState.message).not.toContain('raw backend detail');
});

it('normalizes transport failure without exposing its raw detail', () => {
  const state = getMealPlanErrorState(new ApiError('private transport detail', { kind: 'network' }));
  expect(state.kind).toBe('network');
  expect(state.message).toContain('connection');
  expect(state.message).not.toContain('private transport detail');
});

it('propagates API failures without fabricating mutation success', async () => {
  const error = new Error('offline');
  api.post.mockRejectedValue(error);
  await expect(createMealPlanEntry({ dateKey: '2026-09-14', recipeId: 'r1' })).rejects.toBe(error);
});
