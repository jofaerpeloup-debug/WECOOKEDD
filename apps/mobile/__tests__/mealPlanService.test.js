jest.mock('../src/api/client', () => ({ api: { get: jest.fn(), post: jest.fn(), del: jest.fn() } }));

const { api } = require('../src/api/client');
const { getMealPlan, createMealPlanEntry, removeMealPlanEntry, clearMealPlanRange } = require('../src/api/mealPlanService');

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

it('propagates API failures without fabricating mutation success', async () => {
  const error = new Error('offline');
  api.post.mockRejectedValue(error);
  await expect(createMealPlanEntry({ dateKey: '2026-09-14', recipeId: 'r1' })).rejects.toBe(error);
});
