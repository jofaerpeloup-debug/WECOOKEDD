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

// Derived structured cooking steps. Mongo persists `instructions: string[]`
// as the source of truth (see docs/architecture/recipes.md); `steps` is a
// deterministic 1-based view of that same array, given to later
// RecipeDetail / CookMode work without any storage change. A legacy recipe
// with plain string instructions produces valid `steps` unchanged.
function toStructuredSteps(instructions) {
  return (Array.isArray(instructions) ? instructions : []).map((text, index) => ({
    order: index + 1,
    text,
  }));
}

// Maps a Recipe document to the public API representation, field-by-field
// rather than spreading the document, so __v, a legacy physical `cuisine`
// property, and any other internal field is never leaked. `cuisine` is
// retired from the target contract (M3) — old documents may still carry it
// in Mongo but it is never read here.
function toPublicRecipe(recipe) {
  return {
    id: String(recipe._id),
    title: recipe.title,
    description: recipe.description,
    region: recipe.region ?? null,
    category: recipe.category ?? null,
    difficulty: recipe.difficulty,
    prepTimeMinutes: recipe.prepTimeMinutes,
    cookTimeMinutes: recipe.cookTimeMinutes,
    servings: recipe.servings,
    ingredients: recipe.ingredients.map(toPublicRecipeIngredient),
    instructions: recipe.instructions,
    steps: toStructuredSteps(recipe.instructions),
    dietaryTags: recipe.dietaryTags ?? [],
    imageUrl: recipe.imageUrl ?? null,
    isActive: recipe.isActive,
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
  };
}

module.exports = { toPublicRecipe, toStructuredSteps };