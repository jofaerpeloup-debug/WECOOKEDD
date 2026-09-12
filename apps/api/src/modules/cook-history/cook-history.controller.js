const cookHistoryService = require('./cook-history.service');
const {
  toPublicCookHistoryEntry,
  toPublicCookHistoryStats,
  toPublicCookHistoryStatus,
} = require('./cook-history.serializer');
const { sendSuccess } = require('../../shared/http/response');
const { asyncHandler } = require('../../shared/http/async-handler');

function toPagination({ page, limit, total }) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

const recordCompletion = asyncHandler(async (req, res) => {
  const userId = req.auth.userId;
  const { recipeId, servings } = req.validated.body;

  const result = await cookHistoryService.recordCompletion(userId, { recipeId, servings });
  sendSuccess(res, { cookHistory: toPublicCookHistoryEntry(result) }, 201);
});

const listHistory = asyncHandler(async (req, res) => {
  const userId = req.auth.userId;
  const { page, limit, sort } = req.validated.query;

  const { items, total } = await cookHistoryService.listHistory({ userId, page, limit, sort });

  sendSuccess(res, {
    cookHistory: items.map(toPublicCookHistoryEntry),
    pagination: toPagination({ page, limit, total }),
  });
});

const getStats = asyncHandler(async (req, res) => {
  const userId = req.auth.userId;

  const stats = await cookHistoryService.getStats(userId);
  sendSuccess(res, { stats: toPublicCookHistoryStats(stats) });
});

const getRecipeStatus = asyncHandler(async (req, res) => {
  const userId = req.auth.userId;
  const { recipeId } = req.validated.params;

  const status = await cookHistoryService.getRecipeStatus(userId, recipeId);
  sendSuccess(res, toPublicCookHistoryStatus(status));
});

module.exports = {
  recordCompletion,
  listHistory,
  getStats,
  getRecipeStatus,
};
