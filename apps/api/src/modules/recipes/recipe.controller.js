const recipeService = require('./recipe.service');
const recipeUrlImportService = require('./recipe-url-import.service');
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
    publicationStatus,
    region,
    category,
    difficulty,
    dietaryTag,
    dietaryTags,
    ingredientId,
    excludeRecipeId,
    maxPrepTimeMinutes,
    totalTimeBucket,
    status,
    page,
    limit,
    sort,
  } = req.validated.query;
  const canReadAll = hasCapability(req.auth.role, CAPABILITIES.CATALOG_READ_ALL);

  const { items, total } = await recipeService.listRecipes({
    search,
    publicationStatus,
    region,
    category,
    difficulty,
    dietaryTag,
    dietaryTags,
    ingredientId,
    excludeRecipeId,
    maxPrepTimeMinutes,
    totalTimeBucket,
    status,
    page,
    limit,
    sort,
    isAdmin: canReadAll,
  });

  sendSuccess(res, {
    recipes: items.map((recipe) => (
      canReadAll
        ? toStaffRecipe(recipe, { includeRatingSummary: sort === 'topRated' })
        : toPublicRecipe(recipe, { includeRatingSummary: sort === 'topRated' })
    )),
    pagination: toPagination({ page, limit, total }),
  });
});

const listSmartCollections = asyncHandler(async (req, res) => {
  const smartCollections = await recipeService.listSmartCollections();
  sendSuccess(res, { smartCollections });
});

const getSmartCollection = asyncHandler(async (req, res) => {
  const { groupKey } = req.validated.params;
  const { page, limit } = req.validated.query;
  const { smartCollection, items, total } = await recipeService.getSmartCollection({
    groupKey,
    page,
    limit,
  });
  sendSuccess(res, {
    smartCollection,
    recipes: items.map(toPublicRecipe),
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

const checkRecipeDuplicates = asyncHandler(async (req, res) => {
  const duplicateReview = await recipeService.checkRecipeDuplicates(req.body);
  sendSuccess(res, { duplicateReview });
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

const getRecipePublishReadiness = asyncHandler(async (req, res) => {
  const { recipeId } = req.params;
  const publishReadiness = await recipeService.getRecipePublishReadiness(recipeId, req.body);
  sendSuccess(res, { publishReadiness });
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

const importRecipeUrl = asyncHandler(async (req, res) => {
  const result = await recipeUrlImportService.importRecipeUrl(req.body.url);
  sendSuccess(res, result);
});

module.exports = {
  listRecipes,
  listSmartCollections,
  getSmartCollection,
  getRecipe,
  createRecipe,
  createDraft,
  checkRecipeDuplicates,
  updateRecipe,
  getRecipePublishReadiness,
  publishRecipe,
  archiveRecipe,
  restoreRecipe,
  importRecipeUrl,
};
