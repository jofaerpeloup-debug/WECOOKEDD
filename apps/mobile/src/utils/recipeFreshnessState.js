export function hasRecipeContent(recipes) {
  return Array.isArray(recipes) && recipes.length > 0;
}

export function shouldBlockRecipeFailure(error, recipes, { background = false } = {}) {
  return Boolean(error) && (!background || !hasRecipeContent(recipes));
}

export function recipeCollectionPhaseAfterFailure(recipes, { background = false } = {}) {
  return background && hasRecipeContent(recipes) ? 'ready' : 'error';
}

export function classifyRecipeDetailFailure(error, hasValidContent) {
  if (error?.isNotFound || error?.code === 'RECIPE_NOT_FOUND') return 'unavailable';
  return hasValidContent ? 'preserve' : 'error';
}
