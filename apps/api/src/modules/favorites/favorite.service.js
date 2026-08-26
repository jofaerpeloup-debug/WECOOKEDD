const favoriteRepository = require('./favorite.repository');
const recipeService = require('../recipes/recipe.service');
const { AppError } = require('../../shared/errors/app-error');

const DUPLICATE_KEY_ERROR_CODE = 11000;

const SORT_MAP = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
};

function recipeNotFoundError() {
  return new AppError('Recipe not found.', { statusCode: 404, code: 'RECIPE_NOT_FOUND' });
}

function alreadyExistsError() {
  return new AppError('This recipe is already in your favorites.', {
    statusCode: 409,
    code: 'FAVORITE_ALREADY_EXISTS',
  });
}

function notFoundError() {
  return new AppError('Favorite not found.', { statusCode: 404, code: 'FAVORITE_NOT_FOUND' });
}

// Adds a Favorite for the current user. The Recipe must exist and be
// currently usable for an ordinary user — resolved through RecipeService
// only, never the Recipe model/repository directly (cross-module rule).
// An archived/unusable recipe cannot be newly favorited.
async function addFavorite(userId, recipeId) {
  const recipe = await recipeService.findUsableRecipeById(recipeId);
  if (!recipe) {
    throw recipeNotFoundError();
  }

  let favorite;
  try {
    favorite = await favoriteRepository.createFavorite({ userId, recipeId });
  } catch (err) {
    if (err && err.code === DUPLICATE_KEY_ERROR_CODE) {
      throw alreadyExistsError();
    }
    throw err;
  }

  return { favorite, recipe };
}

async function listFavorites({ userId, page, limit, sort }) {
  const filter = { userId };
  const skip = (page - 1) * limit;
  const [favorites, total] = await Promise.all([
    favoriteRepository.findMany({ filter, sort: SORT_MAP[sort], skip, limit }),
    favoriteRepository.countByFilter(filter),
  ]);

  // Resolve each favorite's Recipe through RecipeService and omit any
  // favorite whose Recipe has since become archived/unusable — the
  // relationship itself is kept (no cascade delete), it just must never be
  // presented as if the recipe were still available. Known V1
  // simplification, the same trade-off documented for Recipe/Substitution
  // list views: pagination.total/totalPages below reflect the pre-filter
  // Favorite count, not the post-filter length of `items`. See
  // docs/architecture/favorites-shopping-list.md.
  const resolved = await Promise.all(
    favorites.map(async (favorite) => ({
      favorite,
      recipe: await recipeService.findUsableRecipeById(favorite.recipeId),
    }))
  );
  const items = resolved.filter((entry) => entry.recipe !== null);

  return { items, total, page, limit };
}

// Deletion must still work even when the referenced Recipe has since
// become archived/unavailable — this only ever touches the Favorite
// collection, never RecipeService.
async function removeFavorite(userId, recipeId) {
  const deleted = await favoriteRepository.deleteByUserAndRecipe(userId, recipeId);
  if (!deleted) {
    throw notFoundError();
  }
  return deleted;
}

module.exports = {
  addFavorite,
  listFavorites,
  removeFavorite,
};