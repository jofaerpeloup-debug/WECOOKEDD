const favoriteService = require('./favorite.service');
const { toPublicFavorite } = require('./favorite.serializer');
const { sendSuccess } = require('../../shared/http/response');
const { asyncHandler } = require('../../shared/http/async-handler');

function toPagination({ page, limit, total }) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

const listFavorites = asyncHandler(async (req, res) => {
  const { page, limit, sort } = req.validated.query;
  const userId = req.auth.userId;

  const { items, total } = await favoriteService.listFavorites({ userId, page, limit, sort });

  sendSuccess(res, {
    favorites: items.map(toPublicFavorite),
    pagination: toPagination({ page, limit, total }),
  });
});

const addFavorite = asyncHandler(async (req, res) => {
  const { recipeId } = req.params;
  const userId = req.auth.userId;

  const result = await favoriteService.addFavorite(userId, recipeId);
  sendSuccess(res, { favorite: toPublicFavorite(result) }, 201);
});

const removeFavorite = asyncHandler(async (req, res) => {
  const { recipeId } = req.params;
  const userId = req.auth.userId;

  await favoriteService.removeFavorite(userId, recipeId);
  sendSuccess(res, { deleted: true });
});

module.exports = {
  listFavorites,
  addFavorite,
  removeFavorite,
};