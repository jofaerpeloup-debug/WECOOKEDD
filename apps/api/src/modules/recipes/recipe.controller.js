const recipeService = require('./recipe.service');
const { toPublicRecipe, toStaffRecipe } = require('./recipe.serializer');
const { sendSuccess } = require('../../shared/http/response');
const { asyncHandler } = require('../../shared/http/async-handler');
const { CAPABILITIES, hasCapability } = require('../../shared/security/capabilities');

function toPagination({ page, limit, total }) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

const listRecipes = asyncHandler(async (req, res) => {
  const {
    search,
    region,
    category,
    difficulty,
    dietaryTag,
    ingredientId,
    maxPrepTimeMinutes,
    status,
    page,
    limit,
    sort,
  } = req.validated.query;
  const canReadAll = hasCapability(req.auth.role, CAPABILITIES.CATALOG_READ_ALL);

  const { items, total } = await recipeService.listRecipes({
    search,
    region,
    category,
    difficulty,
    dietaryTag,
    ingredientId,
    maxPrepTimeMinutes,
    status,
    page,
    limit,
    sort,
    isAdmin: canReadAll,
  });

  sendSuccess(res, {
    recipes: items.map(canReadAll ? toStaffRecipe : toPublicRecipe),
    pagination: toPagination({ page, limit, total }),
  });
});

const getRecipe = asyncHandler(async (req, res) => {
  const { recipeId } = req.params;
  const canReadAll = hasCapability(req.auth.role, CAPABILITIES.CATALOG_READ_ALL);

  const recipe = await recipeService.getRecipeById(recipeId, { isAdmin: canReadAll });
  sendSuccess(res, { recipe: canReadAll ? toStaffRecipe(recipe) : toPublicRecipe(recipe) });
});

const createRecipe = asyncHandler(async (req, res) => {
  const recipe = await recipeService.createRecipe(req.body, { actorId: req.auth.userId });
  sendSuccess(res, { recipe: toStaffRecipe(recipe) }, 201);
});

const createDraft = asyncHandler(async (req, res) => {
  const recipe = await recipeService.createDraft(req.body, { actorId: req.auth.userId });
  sendSuccess(res, { recipe: toStaffRecipe(recipe) }, 201);
});

const updateRecipe = asyncHandler(async (req, res) => {
  const { recipeId } = req.params;
  const recipe = await recipeService.updateRecipe(recipeId, req.body, { actorId: req.auth.userId });
  sendSuccess(res, { recipe: toStaffRecipe(recipe) });
});

const publishRecipe = asyncHandler(async (req, res) => {
  const { recipeId } = req.params;
  const recipe = await recipeService.publishRecipe(recipeId, req.body, { actorId: req.auth.userId });
  sendSuccess(res, { recipe: toStaffRecipe(recipe) });
});

const archiveRecipe = asyncHandler(async (req, res) => {
  const { recipeId } = req.params;
  const recipe = await recipeService.archiveRecipe(recipeId, req.body || {}, { actorId: req.auth.userId });
  sendSuccess(res, { recipe: toStaffRecipe(recipe) });
});

const restoreRecipe = asyncHandler(async (req, res) => {
  const { recipeId } = req.params;
  const recipe = await recipeService.restoreRecipe(recipeId, req.body, { actorId: req.auth.userId });
  sendSuccess(res, { recipe: toStaffRecipe(recipe) });
});

module.exports = {
  listRecipes,
  getRecipe,
  createRecipe,
  createDraft,
  updateRecipe,
  publishRecipe,
  archiveRecipe,
  restoreRecipe,
};
