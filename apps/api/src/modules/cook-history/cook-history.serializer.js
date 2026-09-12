// Only the fields a mobile history list/card would need from the underlying
// Recipe — never its ingredients/instructions or any Mongoose internals.
// Mirrors favorite.serializer.js#toFavoriteRecipeSummary.
function toHistoryRecipeSummary(recipe) {
  return {
    id: String(recipe._id),
    title: recipe.title,
    region: recipe.region ?? null,
    category: recipe.category ?? null,
    difficulty: recipe.difficulty,
    prepTimeMinutes: recipe.prepTimeMinutes,
    cookTimeMinutes: recipe.cookTimeMinutes,
    imageUrl: recipe.imageUrl ?? null,
  };
}

// Maps a { entry, recipe } pair (recipe always already resolved as usable by
// CookHistoryService) to the public API representation. Built field-by-field
// so userId/__v/other internals are never leaked — no email, no role, no
// fabricated recipe snapshot.
function toPublicCookHistoryEntry({ entry, recipe }) {
  return {
    id: String(entry._id),
    recipe: toHistoryRecipeSummary(recipe),
    servings: entry.servings ?? null,
    completedAt: entry.completedAt,
  };
}

function toPublicCookHistoryStats(stats) {
  return {
    totalCooks: stats.totalCooks,
    uniqueRecipesCooked: stats.uniqueRecipesCooked,
  };
}

// Boolean-only — never a count, an event id, or any recipe/user detail.
function toPublicCookHistoryStatus(status) {
  return { hasCooked: status.hasCooked };
}

module.exports = {
  toPublicCookHistoryEntry,
  toHistoryRecipeSummary,
  toPublicCookHistoryStats,
  toPublicCookHistoryStatus,
};
