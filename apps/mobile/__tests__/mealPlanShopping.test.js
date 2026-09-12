const { addPlannedRecipesToShoppingList } = require('../src/utils/mealPlanShopping');

it('deduplicates usable recipe ids, skips unavailable entries, and reports exact partial results', async () => {
  const addRecipe = jest.fn(async (id) => ({ ok: id !== 'r2' }));
  const result = await addPlannedRecipesToShoppingList([
    { recipeId: 'r1', isAvailable: true },
    { recipeId: 'r1', isAvailable: true },
    { recipeId: 'r2', isAvailable: true },
    { recipeId: 'r3', isAvailable: false },
  ], addRecipe);
  expect(addRecipe.mock.calls.map(([id]) => id)).toEqual(['r1', 'r2']);
  expect(result).toEqual({ recipeIds: ['r1', 'r2'], unavailableCount: 1, succeeded: 1, failed: 1, superseded: false });
});

it('stops before a later call when the account/request is no longer current', async () => {
  let current = true;
  const addRecipe = jest.fn(async () => { current = false; return { ok: true }; });
  const result = await addPlannedRecipesToShoppingList([
    { recipeId: 'r1', isAvailable: true },
    { recipeId: 'r2', isAvailable: true },
  ], addRecipe, () => current);
  expect(addRecipe).toHaveBeenCalledTimes(1);
  expect(result.superseded).toBe(true);
});
