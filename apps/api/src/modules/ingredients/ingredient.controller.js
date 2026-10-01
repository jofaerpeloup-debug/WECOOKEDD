const ingredientService = require('./ingredient.service');
const { toPublicIngredient } = require('./ingredient.serializer');
const { sendSuccess } = require('../../shared/http/response');
const { asyncHandler } = require('../../shared/http/async-handler');
const { CAPABILITIES, hasCapability } = require('../../shared/security/capabilities');

function toPagination({ page, limit, total }) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

const listIngredients = asyncHandler(async (req, res) => {
  const { search, category, allergen, status, page, limit, sort } = req.validated.query;
  const canReadAll = hasCapability(req.auth.role, CAPABILITIES.CATALOG_READ_ALL);

  const { items, total } = await ingredientService.listIngredients({
    search,
    category,
    allergen,
    status,
    page,
    limit,
    sort,
    isAdmin: canReadAll,
  });

  sendSuccess(res, {
    ingredients: items.map(toPublicIngredient),
    pagination: toPagination({ page, limit, total }),
  });
});

const getIngredient = asyncHandler(async (req, res) => {
  const { ingredientId } = req.params;
  const canReadAll = hasCapability(req.auth.role, CAPABILITIES.CATALOG_READ_ALL);

  const ingredient = await ingredientService.getIngredientById(ingredientId, { isAdmin: canReadAll });
  sendSuccess(res, { ingredient: toPublicIngredient(ingredient) });
});

const createIngredient = asyncHandler(async (req, res) => {
  const ingredient = await ingredientService.createIngredient(req.body);
  sendSuccess(res, { ingredient: toPublicIngredient(ingredient) }, 201);
});

const updateIngredient = asyncHandler(async (req, res) => {
  const { ingredientId } = req.params;
  const ingredient = await ingredientService.updateIngredient(ingredientId, req.body);
  sendSuccess(res, { ingredient: toPublicIngredient(ingredient) });
});

const archiveIngredient = asyncHandler(async (req, res) => {
  const { ingredientId } = req.params;
  const ingredient = await ingredientService.archiveIngredient(ingredientId);
  sendSuccess(res, { ingredient: toPublicIngredient(ingredient) });
});

const resolveIngredients = asyncHandler(async (req, res) => {
  const resolutions = await ingredientService.resolveIngredients(req.validated.body.lines);
  sendSuccess(res, { resolutions });
});

const findAliasCollisions = asyncHandler(async (req, res) => {
  const warnings = await ingredientService.findAliasCollisions(req.validated.body);
  sendSuccess(res, { warnings });
});

module.exports = {
  listIngredients,
  getIngredient,
  createIngredient,
  updateIngredient,
  archiveIngredient,
  resolveIngredients,
  findAliasCollisions,
};
