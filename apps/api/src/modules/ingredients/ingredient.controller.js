const ingredientService = require('./ingredient.service');
const { toPublicIngredient } = require('./ingredient.serializer');
const { sendSuccess } = require('../../shared/http/response');
const { asyncHandler } = require('../../shared/http/async-handler');

function toPagination({ page, limit, total }) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

const listIngredients = asyncHandler(async (req, res) => {
  const { search, category, allergen, status, page, limit, sort } = req.validated.query;
  const isAdmin = req.auth.role === 'admin';

  const { items, total } = await ingredientService.listIngredients({
    search,
    category,
    allergen,
    status,
    page,
    limit,
    sort,
    isAdmin,
  });

  sendSuccess(res, {
    ingredients: items.map(toPublicIngredient),
    pagination: toPagination({ page, limit, total }),
  });
});

const getIngredient = asyncHandler(async (req, res) => {
  const { ingredientId } = req.params;
  const isAdmin = req.auth.role === 'admin';

  const ingredient = await ingredientService.getIngredientById(ingredientId, { isAdmin });
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

module.exports = {
  listIngredients,
  getIngredient,
  createIngredient,
  updateIngredient,
  archiveIngredient,
};