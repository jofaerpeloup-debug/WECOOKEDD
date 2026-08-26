// Only the fields a mobile favorites screen needs from the underlying
// Recipe — never its ingredients/instructions or any Mongoose internals.
function toFavoriteRecipeSummary(recipe) {
  return {
    id: String(recipe._id),
    title: recipe.title,
    cuisine: recipe.cuisine,
    difficulty: recipe.difficulty,
    prepTimeMinutes: recipe.prepTimeMinutes,
    cookTimeMinutes: recipe.cookTimeMinutes,
    imageUrl: recipe.imageUrl ?? null,
  };
}

// Maps a { favorite, recipe } pair (recipe always already resolved as
// usable by FavoriteService) to the public API representation. Built
// field-by-field so userId/__v/other internals are never leaked.
function toPublicFavorite({ favorite, recipe }) {
  return {
    id: String(favorite._id),
    recipe: toFavoriteRecipeSummary(recipe),
    createdAt: favorite.createdAt,
  };
}

module.exports = { toPublicFavorite, toFavoriteRecipeSummary };