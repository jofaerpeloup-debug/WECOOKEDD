const recipeRepository = require('../recipes/recipe.repository');
const substitutionRepository = require('../substitutions/substitution.repository');
const { AppError } = require('../../shared/errors/app-error');

function activeDependenciesError({ recipe, substitution }) {
  return new AppError('Ingredient is used by active catalog content and cannot be archived.', {
    statusCode: 409,
    code: 'INGREDIENT_HAS_ACTIVE_DEPENDENCIES',
    details: { recipe, substitution },
  });
}

async function assertIngredientCanDeactivate(ingredientId) {
  const [recipe, substitution] = await Promise.all([
    recipeRepository.hasActiveConsumerRecipeUsingIngredient(ingredientId),
    substitutionRepository.hasActiveSubstitutionUsingIngredient(ingredientId),
  ]);

  if (recipe || substitution) {
    throw activeDependenciesError({ recipe, substitution });
  }
}

module.exports = { assertIngredientCanDeactivate };
