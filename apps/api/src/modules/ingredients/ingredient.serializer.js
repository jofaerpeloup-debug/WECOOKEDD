// Maps an Ingredient document to the public API representation. Never
// reads normalizedName (internal uniqueness key) or __v — both are simply
// omitted here since the object is built field-by-field rather than
// spread from the document.
function toPublicIngredient(ingredient) {
  return {
    id: String(ingredient._id),
    name: ingredient.name,
    aliases: ingredient.aliases ?? [],
    category: ingredient.category,
    allergenTags: ingredient.allergenTags ?? [],
    isActive: ingredient.isActive,
    createdAt: ingredient.createdAt,
    updatedAt: ingredient.updatedAt,
  };
}

function toResolutionIngredient(ingredient) {
  return {
    id: String(ingredient._id),
    name: ingredient.name,
    category: ingredient.category,
  };
}

module.exports = { toPublicIngredient, toResolutionIngredient };
