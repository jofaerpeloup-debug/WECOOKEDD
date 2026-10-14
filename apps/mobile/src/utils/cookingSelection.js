// Consumer Recipe detail already omits unavailable authored alternatives.
// Keep each alternative as a complete list; never merge it with the default.
export function authoredSpiceLevels(recipe) {
  const cooking = recipe?.cooking;
  if (cooking?.schemaVersion !== 1 || cooking.defaultSpiceLevel == null) return [];
  return [cooking.defaultSpiceLevel, ...(cooking.spiceAlternatives || []).map((item) => item.spiceLevel)];
}

export function selectedCookingIngredients(recipe, spiceLevel) {
  const levels = authoredSpiceLevels(recipe);
  if (levels.length === 0 || spiceLevel === levels[0]) return recipe?.ingredients || [];
  const alternative = recipe.cooking.spiceAlternatives.find((item) => item.spiceLevel === spiceLevel);
  return alternative ? alternative.ingredients : null;
}

export function matchingCookingTimer(recipe, stepOrder, servings, spiceLevel) {
  const cooking = recipe?.cooking;
  if (cooking?.schemaVersion !== 1 || !Array.isArray(cooking.stepTimers)) return null;
  const levels = authoredSpiceLevels(recipe);
  if (levels.length > 0 ? !levels.includes(spiceLevel) : spiceLevel !== null) return null;
  return cooking.stepTimers.find((timer) =>
    timer.stepOrder === stepOrder && timer.servings === servings
    && timer.spiceLevel === spiceLevel
    && Number.isInteger(timer.durationSeconds)
    && timer.durationSeconds >= 1 && timer.durationSeconds <= 10800
  ) || null;
}
