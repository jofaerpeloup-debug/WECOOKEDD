const { z } = require('zod');
const { objectIdSchema } = require('../../shared/validation/object-id');
const { CAPTION_MAX_LENGTH } = require('./community-post.model');

const pageSchema = z.coerce.number().int().min(1).default(1);
const limitSchema = z.coerce.number().int().min(1).max(100).default(20);

const captionSchema = z
  .string('Caption is required.')
  .trim()
  .min(1, 'Caption is required.')
  .max(CAPTION_MAX_LENGTH, `Caption must be ${CAPTION_MAX_LENGTH} characters or fewer.`);

const listCommunityPostsSchema = z.object({
  query: z.object({ page: pageSchema, limit: limitSchema }).strict(),
});

const createCommunityPostSchema = z.object({
  body: z.object({ caption: captionSchema, recipeId: objectIdSchema.optional() }).strict(),
});

const communityPostParamsSchema = z.object({
  params: z.object({ postId: objectIdSchema }).strict(),
});

module.exports = {
  listCommunityPostsSchema,
  createCommunityPostSchema,
  communityPostParamsSchema,
};
