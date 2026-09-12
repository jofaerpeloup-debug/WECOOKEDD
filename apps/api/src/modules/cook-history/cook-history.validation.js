const { z } = require('zod');
const { objectIdSchema } = require('../../shared/validation/object-id');
const { SERVINGS_MIN, SERVINGS_MAX } = require('./cook-history.model');

const sortSchema = z.enum(['newest', 'oldest'], 'Invalid sort value.').default('newest');
const pageSchema = z.coerce.number().int().min(1).default(1);
const limitSchema = z.coerce.number().int().min(1).max(100).default(20);

// Strictly `z.number()` — never `z.coerce.number()` — so "3", true, null, and
// NaN are all rejected rather than silently coerced. `.int()` rejects
// decimals; `.min/.max` enforce a sensible positive bound.
const servingsSchema = z
  .number('Servings must be a number.')
  .int('Servings must be a whole number.')
  .min(SERVINGS_MIN, `Servings must be between ${SERVINGS_MIN} and ${SERVINGS_MAX}.`)
  .max(SERVINGS_MAX, `Servings must be between ${SERVINGS_MIN} and ${SERVINGS_MAX}.`);

// Create allowlist is deliberately just recipeId/servings — userId, ownerId,
// completedAt, createdAt, updatedAt, role, and any recipe-snapshot field
// (recipeTitle, recipeImage, ...) are all rejected by `.strict()` rather than
// silently dropped. Ownership and completion time are always server-derived
// (see cook-history.controller.js / cook-history.service.js).
const createCookHistorySchema = z.object({
  body: z
    .object({
      recipeId: objectIdSchema,
      servings: servingsSchema.optional(),
    })
    .strict(),
});

const listCookHistorySchema = z.object({
  query: z
    .object({
      page: pageSchema,
      limit: limitSchema,
      sort: sortSchema,
    })
    .strict(),
});

// No inputs today, but validated with a strict empty schema anyway so a
// stray query param is a clean 400 rather than a silently ignored no-op —
// consistent with every other endpoint in this module.
const cookHistoryStatsSchema = z.object({
  query: z.object({}).strict(),
});

// recipeId comes only from the URL param — a strict empty query (and no
// body) means a client-supplied userId can never even reach the controller.
const cookHistoryRecipeStatusSchema = z.object({
  params: z.object({ recipeId: objectIdSchema }).strict(),
  query: z.object({}).strict(),
});

module.exports = {
  createCookHistorySchema,
  listCookHistorySchema,
  cookHistoryStatsSchema,
  cookHistoryRecipeStatusSchema,
};
