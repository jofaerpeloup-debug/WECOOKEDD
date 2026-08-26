const { z } = require('zod');
const { objectIdSchema } = require('../../shared/validation/object-id');

const sortSchema = z.enum(['newest', 'oldest'], 'Invalid sort value.').default('newest');
const pageSchema = z.coerce.number().int().min(1).default(1);
const limitSchema = z.coerce.number().int().min(1).max(100).default(20);

const favoriteParamsSchema = z.object({
  params: z.object({ recipeId: objectIdSchema }).strict(),
});

const listFavoritesSchema = z.object({
  query: z
    .object({
      page: pageSchema,
      limit: limitSchema,
      sort: sortSchema,
    })
    .strict(),
});

module.exports = { favoriteParamsSchema, listFavoritesSchema };