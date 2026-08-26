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

function toPublicSubstitution(substitution) {
  return {
    id: String(substitution._id),
    sourceIngredient: toIngredientSummary(substitution.sourceIngredientId),
    substituteIngredient: toIngredientSummary(substitution.substituteIngredientId),
    ratio: {
      sourceAmount: substitution.ratio.sourceAmount,
      substituteAmount: substitution.ratio.substituteAmount,
    },
    contexts: substitution.contexts ?? [],
    notes: substitution.notes ?? null,
    isActive: substitution.isActive,
    createdAt: substitution.createdAt,
    updatedAt: substitution.updatedAt,
  };
}

module.exports = { toPublicSubstitution };