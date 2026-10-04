const { z } = require('zod');
const { objectIdSchema } = require('../../shared/validation/object-id');
const { CAPTION_MAX_LENGTH } = require('./community-post.model');
const { COMMENT_MAX_LENGTH } = require('./community-comment.model');

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

const communityFollowSchema = z.object({
  params: z.object({ userId: objectIdSchema }).strict(),
  body: z.object({}).strict().default({}),
  query: z.object({}).strict(),
});

const createCommunityPostSchema = z.object({
  body: z.object({ caption: captionSchema, recipeId: objectIdSchema.optional() }).strict(),
});

const communityPostParamsSchema = z.object({
  params: z.object({ postId: objectIdSchema }).strict(),
});

const communityBookmarkSchema = z.object({
  params: z.object({ postId: objectIdSchema }).strict(),
  body: z.object({}).strict().default({}),
  query: z.object({}).strict(),
});

const commentBodySchema = z
  .string('Comment is required.')
  .trim()
  .min(1, 'Comment is required.')
  .max(COMMENT_MAX_LENGTH, `Comment must be ${COMMENT_MAX_LENGTH} characters or fewer.`);

const listCommunityCommentsSchema = z.object({
  params: z.object({ postId: objectIdSchema }).strict(),
  query: z.object({ page: pageSchema, limit: limitSchema }).strict(),
});

const createCommunityCommentSchema = z.object({
  params: z.object({ postId: objectIdSchema }).strict(),
  body: z.object({ body: commentBodySchema }).strict(),
});

const communityCommentParamsSchema = z.object({
  params: z.object({ commentId: objectIdSchema }).strict(),
});

module.exports = {
  listCommunityPostsSchema,
  communityFollowSchema,
  createCommunityPostSchema,
  communityPostParamsSchema,
  communityBookmarkSchema,
  listCommunityCommentsSchema,
  createCommunityCommentSchema,
  communityCommentParamsSchema,
};
