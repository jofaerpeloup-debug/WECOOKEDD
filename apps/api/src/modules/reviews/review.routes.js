const { Router } = require('express');
const reviewController = require('./review.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/authenticate.middleware');
const {
  listReviewsSchema,
  createReviewSchema,
  reviewParamsSchema,
  patchReviewSchema,
} = require('./review.validation');

// Registers full paths directly (rather than mounting under a `/reviews`
// prefix) so both the recipe-nested list/create routes and the standalone
// by-id update/delete routes live in one router, matching the API surface
// exactly: GET/POST /recipes/:recipeId/reviews, PATCH/DELETE /reviews/:reviewId.
// Mounted at the v1 router root in routes/v1.routes.js.
const router = Router();

router.get(
  '/recipes/:recipeId/reviews',
  authenticate,
  validate(listReviewsSchema),
  reviewController.listReviews
);
router.post(
  '/recipes/:recipeId/reviews',
  authenticate,
  validate(createReviewSchema),
  reviewController.createReview
);

router.patch(
  '/reviews/:reviewId',
  authenticate,
  validate(patchReviewSchema),
  reviewController.updateReview
);
router.delete(
  '/reviews/:reviewId',
  authenticate,
  validate(reviewParamsSchema),
  reviewController.deleteReview
);

module.exports = router;
