const reviewService = require('./review.service');
const { toPublicReview, toRatingSummary } = require('./review.serializer');
const { sendSuccess } = require('../../shared/http/response');
const { asyncHandler } = require('../../shared/http/async-handler');

function toPagination({ page, limit, total }) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

const listReviews = asyncHandler(async (req, res) => {
  const userId = req.auth.userId;
  const { recipeId } = req.params;
  const { page, limit, sort } = req.validated.query;

  const { items, total, summary, currentUserReview } = await reviewService.listReviews(userId, recipeId, {
    page,
    limit,
    sort,
  });

  sendSuccess(res, {
    summary: toRatingSummary(summary),
    reviews: items.map(toPublicReview),
    pagination: toPagination({ page, limit, total }),
    currentUserReview: currentUserReview ? toPublicReview(currentUserReview) : null,
  });
});

const createReview = asyncHandler(async (req, res) => {
  const userId = req.auth.userId;
  const { recipeId } = req.params;
  const { rating, comment } = req.validated.body;

  const created = await reviewService.createReview(userId, recipeId, { rating, comment });
  sendSuccess(res, { review: toPublicReview(created) }, 201);
});

const updateReview = asyncHandler(async (req, res) => {
  const userId = req.auth.userId;
  const { reviewId } = req.params;
  const patch = req.validated.body;

  const updated = await reviewService.updateReview(userId, reviewId, patch);
  sendSuccess(res, { review: toPublicReview(updated) });
});

const deleteReview = asyncHandler(async (req, res) => {
  const userId = req.auth.userId;
  const { reviewId } = req.params;

  await reviewService.deleteReview(userId, reviewId);
  sendSuccess(res, { deleted: true });
});

module.exports = {
  listReviews,
  createReview,
  updateReview,
  deleteReview,
};
