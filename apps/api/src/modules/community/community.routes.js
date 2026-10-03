const { Router } = require('express');
const communityController = require('./community.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/authenticate.middleware');
const {
  listCommunityPostsSchema,
  createCommunityPostSchema,
  communityPostParamsSchema,
  listCommunityCommentsSchema,
  createCommunityCommentSchema,
  communityCommentParamsSchema,
} = require('./community.validation');

const router = Router();

router.get('/posts', authenticate, validate(listCommunityPostsSchema), communityController.listPosts);
router.post('/posts', authenticate, validate(createCommunityPostSchema), communityController.createPost);
router.delete(
  '/posts/:postId',
  authenticate,
  validate(communityPostParamsSchema),
  communityController.deletePost
);
router.post(
  '/posts/:postId/likes',
  authenticate,
  validate(communityPostParamsSchema),
  communityController.likePost
);
router.delete(
  '/posts/:postId/likes',
  authenticate,
  validate(communityPostParamsSchema),
  communityController.unlikePost
);
router.get(
  '/posts/:postId/comments',
  authenticate,
  validate(listCommunityCommentsSchema),
  communityController.listComments
);
router.post(
  '/posts/:postId/comments',
  authenticate,
  validate(createCommunityCommentSchema),
  communityController.createComment
);
router.delete(
  '/comments/:commentId',
  authenticate,
  validate(communityCommentParamsSchema),
  communityController.deleteComment
);

module.exports = router;
