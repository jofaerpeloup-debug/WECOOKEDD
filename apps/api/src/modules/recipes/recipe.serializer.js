// Only ever exposes id/name from a populated Ingredient sub-document —
// never isActive or any other internal Ingredient field.
function toIngredientSummary(ingredient) {
  if (!ingredient) {
    return null;
  }
  return {
    id: String(ingredient._id),
    name: ingredient.name,
  };
}

function toPublicRecipeIngredient(entry) {
  return {
    ingredient: toIngredientSummary(entry.ingredientId),
    quantity: entry.quantity ?? null,
    unit: entry.unit,
    note: entry.note ?? null,
    optional: entry.optional ?? false,
  };
}

// Maps a Recipe document to the public API representation, field-by-field
// rather than spreading the document, so __v and any other internal field
// is never leaked.
function toPublicRecipe(recipe) {
  return {
    id: String(recipe._id),
    title: recipe.title,
    description: recipe.description,
    cuisine: recipe.cuisine,
    difficulty: recipe.difficulty,
    prepTimeMinutes: recipe.prepTimeMinutes,
    cookTimeMinutes: recipe.cookTimeMinutes,
    servings: recipe.servings,
    ingredients: recipe.ingredients.map(toPublicRecipeIngredient),
    instructions: recipe.instructions,
    dietaryTags: recipe.dietaryTags ?? [],
    imageUrl: recipe.imageUrl ?? null,
    isActive: recipe.isActive,
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
  };
}

module.exports = { toPublicRecipe };