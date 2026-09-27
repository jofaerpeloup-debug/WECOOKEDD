// Reviews/Ratings feature service for the mobile app — the single data path
// for a recipe's real server-backed rating summary and reviews:
//
//   RecipeDetailScreen
//     -> reviewService
//     -> api (src/api/client.js — shared, UNCHANGED)
//     -> Express REST API (/api/v1/recipes/:recipeId/reviews, /api/v1/reviews/:reviewId)
//     -> MongoDB
//
// Every call requires authentication; the shared client already attaches the
// bearer access token and performs one transparent refresh+retry. This module
// never calls `fetch`, never touches the token store, and NEVER sends a
// userId, averageRating, or ratingCount — ownership is always derived from
// the authenticated backend identity, and the rating aggregate is always
// server-computed. A client-supplied one is rejected by the backend's strict
// Zod schema anyway.

import { api } from './client';

// The only query keys the backend list endpoint implements
// (review.validation.js#listReviewsSchema — a STRICT schema, so any other
// key is a 400 VALIDATION_ERROR).
const LIST_PARAM_KEYS = ['page', 'limit', 'sort'];

function buildQuery(params) {
  const query = {};
  for (const key of LIST_PARAM_KEYS) {
    const value = params[key];
    if (value === undefined || value === null || value === '') continue;
    query[key] = value;
  }
  return query;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isPublicReview(review) {
  return !!review
    && typeof review === 'object'
    && typeof review.id === 'string'
    && review.id.length > 0
    && Number.isInteger(review.rating)
    && review.rating >= 1
    && review.rating <= 5
    && (review.comment === null || typeof review.comment === 'string')
    && (review.author === null || (
      typeof review.author === 'object'
      && typeof review.author.id === 'string'
      && typeof review.author.name === 'string'
    ))
    && typeof review.createdAt === 'string'
    && !Number.isNaN(Date.parse(review.createdAt))
    && typeof review.updatedAt === 'string'
    && !Number.isNaN(Date.parse(review.updatedAt));
}

function requireReviewListPayload(data) {
  const summary = data && data.summary;
  const pagination = data && data.pagination;
  const currentUserReview = data && data.currentUserReview;
  const validAverageRating = typeof summary?.averageRating === 'number'
    && Number.isFinite(summary.averageRating)
    && summary.averageRating >= 1
    && summary.averageRating <= 5;
  const validSummary = !!summary
    && typeof summary === 'object'
    && isNonNegativeInteger(summary.ratingCount)
    && (
      (summary.ratingCount === 0 && summary.averageRating === null)
      || (summary.ratingCount > 0 && validAverageRating)
    );
  const validPagination = !!pagination
    && typeof pagination === 'object'
    && Number.isInteger(pagination.page)
    && pagination.page >= 1
    && Number.isInteger(pagination.limit)
    && pagination.limit >= 1
    && isNonNegativeInteger(pagination.total)
    && isNonNegativeInteger(pagination.totalPages);

  if (!validSummary
    || !Array.isArray(data && data.reviews)
    || !data.reviews.every(isPublicReview)
    || !validPagination
    || !Object.prototype.hasOwnProperty.call(data, 'currentUserReview')
    || (currentUserReview !== null && !isPublicReview(currentUserReview))) {
    const error = new Error('The review response did not match the expected contract.');
    error.code = 'INVALID_REVIEW_PAYLOAD';
    throw error;
  }

  return {
    summary,
    reviews: data.reviews,
    pagination,
    currentUserReview,
  };
}

/**
 * GET /api/v1/recipes/:recipeId/reviews
 * @param {string} recipeId  backend Recipe id (Mongo ObjectId string).
 * @param {{ page?: number, limit?: number, sort?: 'newest'|'oldest' }} [params]
 * @returns {Promise<{
 *   summary: { averageRating: number|null, ratingCount: number },
 *   reviews: object[],
 *   pagination: { page: number, limit: number, total: number, totalPages: number } | null,
 *   currentUserReview: object|null,
 * }>}
 *   Each review is `{ id, rating, comment, author: { id, name } | null, createdAt, updatedAt }`.
 *   `summary.averageRating` is null (never a fabricated 0) when ratingCount is 0.
 *   `currentUserReview` is the authenticated caller's own review for this
 *   recipe, or null if they haven't rated it yet — never inferred client-side.
 *   Throws ApiError RECIPE_NOT_FOUND (404) when the recipe is unknown,
 *   archived, or unusable.
 */
export function getRecipeReviews(recipeId, params = {}) {
  return api
    .get(`/recipes/${encodeURIComponent(recipeId)}/reviews`, { query: buildQuery(params) })
    .then(requireReviewListPayload);
}

/**
 * POST /api/v1/recipes/:recipeId/reviews
 * @param {string} recipeId  backend Recipe id.
 * @param {{ rating: number, comment?: string }} body  rating is 1-5, integer.
 * @returns {Promise<object>} the created review.
 *   Throws ApiError:
 *     - REVIEW_ALREADY_EXISTS (409) — caller already has a review; use updateReview instead
 *     - RECIPE_NOT_FOUND      (404) — recipe unknown / archived / unusable
 *     - VALIDATION_ERROR      (400) — invalid rating/comment
 */
export function createRecipeReview(recipeId, { rating, comment }) {
  const body = { rating };
  if (comment !== undefined) body.comment = comment;
  return api.post(`/recipes/${encodeURIComponent(recipeId)}/reviews`, { body }).then((data) => data.review);
}

/**
 * PATCH /api/v1/reviews/:reviewId
 * @param {string} reviewId  the caller's own review id (from currentUserReview.id).
 * @param {{ rating?: number, comment?: string }} patch  at least one field required.
 * @returns {Promise<object>} the updated review.
 *   Throws ApiError REVIEW_NOT_FOUND (404) if the review doesn't exist or
 *   isn't owned by the caller.
 */
export function updateReview(reviewId, patch = {}) {
  const body = {};
  if (patch.rating !== undefined) body.rating = patch.rating;
  if (patch.comment !== undefined) body.comment = patch.comment;
  return api.patch(`/reviews/${encodeURIComponent(reviewId)}`, { body }).then((data) => data.review);
}

/**
 * DELETE /api/v1/reviews/:reviewId
 * @param {string} reviewId  the caller's own review id.
 * @returns {Promise<{ deleted: true }>} Throws ApiError REVIEW_NOT_FOUND (404)
 *   if the review doesn't exist or isn't owned by the caller.
 */
export function deleteReview(reviewId) {
  return api.del(`/reviews/${encodeURIComponent(reviewId)}`);
}
