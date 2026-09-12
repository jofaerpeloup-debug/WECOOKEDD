export async function addPlannedRecipesToShoppingList(entries, addRecipe, isCurrent = () => true) {
  const recipeIds = [...new Set(entries.filter((entry) => entry.isAvailable).map((entry) => entry.recipeId))];
  const unavailableCount = entries.filter((entry) => !entry.isAvailable).length;
  let succeeded = 0;
  let failed = 0;

  for (const recipeId of recipeIds) {
    if (!isCurrent()) return { recipeIds, unavailableCount, succeeded, failed, superseded: true };
    const result = await addRecipe(recipeId);
    if (!isCurrent()) return { recipeIds, unavailableCount, succeeded, failed, superseded: true };
    if (result.ok) succeeded += 1;
    else failed += 1;
  }

  return { recipeIds, unavailableCount, succeeded, failed, superseded: false };
}
