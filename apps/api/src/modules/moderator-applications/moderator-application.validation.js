const { z } = require('zod');
const { objectIdSchema } = require('../../shared/validation/object-id');
const {
  APPLICATION_STATUSES,
  REJECTION_REASON_MAX_LENGTH,
} = require('./moderator-application.model');

const emptyBodySchema = z.object({}).strict();
const pageSchema = z.coerce.number().int().min(1).default(1);
const limitSchema = z.coerce.number().int().min(1).max(100).default(20);

const applySchema = z.object({ body: emptyBodySchema });

const listSchema = z.object({
  query: z
    .object({
      status: z.enum(APPLICATION_STATUSES, 'Invalid application status.').default('pending'),
      page: pageSchema,
      limit: limitSchema,
    })
    .strict(),
});

const decisionParamsSchema = z.object({
  params: z.object({ applicationId: objectIdSchema }).strict(),
  body: emptyBodySchema,
});

const rejectionSchema = z.object({
  params: z.object({ applicationId: objectIdSchema }).strict(),
  body: z
    .object({
      reason: z
        .string()
        .trim()
        .min(1, 'Rejection reason is required.')
        .max(
          REJECTION_REASON_MAX_LENGTH,
          `Rejection reason must be ${REJECTION_REASON_MAX_LENGTH} characters or fewer.`
        ),
    })
    .strict(),
});

const demotionSchema = z.object({
  params: z.object({ userId: objectIdSchema }).strict(),
  body: emptyBodySchema,
});

module.exports = { applySchema, listSchema, decisionParamsSchema, rejectionSchema, demotionSchema };
