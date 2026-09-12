function toRecipeSummary(recipe) {
  if (!recipe) return null;
  return {
    id: String(recipe._id ?? recipe.id),
    title: recipe.title,
    region: recipe.region ?? null,
    category: recipe.category ?? null,
    difficulty: recipe.difficulty,
    prepTimeMinutes: recipe.prepTimeMinutes,
    cookTimeMinutes: recipe.cookTimeMinutes,
    imageUrl: recipe.imageUrl ?? null,
  };
}

function toPublicMealPlanEntry({ entry, recipe }) {
  return {
    id: String(entry._id),
    dateKey: entry.dateKey,
    recipeId: String(entry.recipeId),
    isAvailable: !!recipe,
    recipe: toRecipeSummary(recipe),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

module.exports = { toRecipeSummary, toPublicMealPlanEntry };
