const recipeService = require('./recipe.service');
const { toPublicRecipe } = require('./recipe.serializer');
const { sendSuccess } = require('../../shared/http/response');
const { asyncHandler } = require('../../shared/http/async-handler');

function toPagination({ page, limit, total }) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

const listRecipes = asyncHandler(async (req, res) => {
  const {
    search,
    cuisine,
    difficulty,
    dietaryTag,
    ingredientId,
    maxPrepTimeMinutes,
    status,
    page,
    limit,
    sort,
  } = req.validated.query;
  const isAdmin = req.auth.role === 'admin';

  const { items, total } = await recipeService.listRecipes({
    search,
    cuisine,
    difficulty,
    dietaryTag,
    ingredientId,
    maxPrepTimeMinutes,
    status,
    page,
    limit,
    sort,
    isAdmin,
  });

  sendSuccess(res, {
    recipes: items.map(toPublicRecipe),
    pagination: toPagination({ page, limit, total }),
  });
});

const getRecipe = asyncHandler(async (req, res) => {
  const { recipeId } = req.params;
  const isAdmin = req.auth.role === 'admin';

  const recipe = await recipeService.getRecipeById(recipeId, { isAdmin });
  sendSuccess(res, { recipe: toPublicRecipe(recipe) });
});

const createRecipe = asyncHandler(async (req, res) => {
  const recipe = await recipeService.createRecipe(req.body);
  sendSuccess(res, { recipe: toPublicRecipe(recipe) }, 201);
});

const updateRecipe = asyncHandler(async (req, res) => {
  const { recipeId } = req.params;
  const recipe = await recipeService.updateRecipe(recipeId, req.body);
  sendSuccess(res, { recipe: toPublicRecipe(recipe) });
});

const archiveRecipe = asyncHandler(async (req, res) => {
  const { recipeId } = req.params;
  const recipe = await recipeService.archiveRecipe(recipeId);
  sendSuccess(res, { recipe: toPublicRecipe(recipe) });
});

module.exports = {
  listRecipes,
  getRecipe,
  createRecipe,
  updateRecipe,
  archiveRecipe,
};