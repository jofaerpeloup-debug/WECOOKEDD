// Only the fields a mobile Saved/CollectionDetail screen needs from the
// underlying Recipe — never its ingredients/instructions or any Mongoose
// internals. Mirrors favorite.serializer.js#toFavoriteRecipeSummary exactly;
// duplicated locally rather than imported, matching this codebase's existing
// convention of no shared cross-module serializer file.
function toCollectionRecipeSummary(recipe) {
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

// Built field-by-field so userId/__v/other internals are never leaked.
function toPublicCollectionDetail(collection) {
  return {
    id: String(collection._id),
    name: collection.name,
    description: collection.description ?? null,
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
  };
}

// List-card shape: collection metadata plus enough real data to render a
// Saved-screen card (recipeCount + up to COVER_LIMIT real cover image URLs).
// Never a fabricated cover — an empty collection's coverImageUrls is [].
function toPublicCollection({ collection, recipeCount, coverRecipes }) {
  return {
    ...toPublicCollectionDetail(collection),
    recipeCount,
    coverImageUrls: (coverRecipes || [])
      .map((recipe) => recipe.imageUrl ?? null)
      .filter((url) => url !== null),
  };
}

// Maps a { membership, recipe } pair (recipe always already resolved as
// usable by CollectionService) to the public API representation.
function toPublicCollectionRecipe({ membership, recipe }) {
  return {
    id: String(membership._id),
    recipe: toCollectionRecipeSummary(recipe),
    createdAt: membership.createdAt,
  };
}

module.exports = {
  toCollectionRecipeSummary,
  toPublicCollectionDetail,
  toPublicCollection,
  toPublicCollectionRecipe,
};
