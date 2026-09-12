const { z } = require('zod');
const { objectIdSchema } = require('../../shared/validation/object-id');
const { COMMENT_MAX_LENGTH } = require('./review.model');

const sortSchema = z.enum(['newest', 'oldest'], 'Invalid sort value.').default('newest');
const pageSchema = z.coerce.number().int().min(1).default(1);
const limitSchema = z.coerce.number().int().min(1).max(100).default(20);

// Strictly `z.number()` — never `z.coerce.number()` — so "3", true, null, and
// NaN are all rejected rather than silently coerced. `.int()` rejects
// decimals; `.min(1).max(5)` rejects 0 and 6+.
const ratingSchema = z
  .number('Rating is required.')
  .int('Rating must be a whole number.')
  .min(1, 'Rating must be between 1 and 5.')
  .max(5, 'Rating must be between 1 and 5.');

const commentSchema = z
  .string()
  .trim()
  .max(COMMENT_MAX_LENGTH, `Comment must be ${COMMENT_MAX_LENGTH} characters or fewer.`);

const recipeReviewParamsSchema = z.object({
  params: z.object({ recipeId: objectIdSchema }).strict(),
});

const reviewParamsSchema = z.object({
  params: z.object({ reviewId: objectIdSchema }).strict(),
});

const listReviewsSchema = z.object({
  params: z.object({ recipeId: objectIdSchema }).strict(),
  query: z
    .object({
      page: pageSchema,
      limit: limitSchema,
      sort: sortSchema,
    })
    .strict(),
});

// Body carries only rating/comment — never userId/ownerId. Ownership is
// derived solely from req.auth.userId (see review.controller.js), and
// recipeId comes only from the URL param, never the body.
const createReviewSchema = z.object({
  params: z.object({ recipeId: objectIdSchema }).strict(),
  body: z
    .object({
      rating: ratingSchema,
      comment: commentSchema.optional(),
    })
    .strict(),
});

// Deliberately excludes userId/ownerId/recipeId/createdAt/updatedAt — a PATCH
// can never touch ownership or which recipe the review belongs to, only the
// allowlisted rating/comment fields. Every other field is a 400
// VALIDATION_ERROR via `.strict()`, never silently dropped.
const patchReviewSchema = z.object({
  params: z.object({ reviewId: objectIdSchema }).strict(),
  body: z
    .object({
      rating: ratingSchema.optional(),
      comment: commentSchema.optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field must be provided.',
    }),
});

module.exports = {
  recipeReviewParamsSchema,
  reviewParamsSchema,
  listReviewsSchema,
  createReviewSchema,
  patchReviewSchema,
};
