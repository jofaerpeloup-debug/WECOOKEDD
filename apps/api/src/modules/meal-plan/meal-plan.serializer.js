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
    ownerId: String(entry.userId),
    dateKey: entry.dateKey,
    recipeId: String(entry.recipeId),
    isAvailable: !!recipe,
    recipe: toRecipeSummary(recipe),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    reminder: entry.reminder ? {
      localTime: entry.reminder.localTime,
      timeZone: entry.reminder.timeZone,
      fireAt: entry.reminder.fireAt,
    } : null,
    reminderRevision: entry.reminderRevision ?? 0,
  };
}

module.exports = { toRecipeSummary, toPublicMealPlanEntry };
