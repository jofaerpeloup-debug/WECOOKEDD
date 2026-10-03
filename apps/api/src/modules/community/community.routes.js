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
  communityFollowSchema,
} = require('./community.validation');

const router = Router();

router.get('/posts', authenticate, validate(listCommunityPostsSchema), communityController.listPosts);
router.get(
  '/posts/following',
  authenticate,
  validate(listCommunityPostsSchema),
  communityController.listFollowingPosts
);
router.post(
  '/users/:userId/follow',
  authenticate,
  validate(communityFollowSchema),
  communityController.followUser
);
router.delete(
  '/users/:userId/follow',
  authenticate,
  validate(communityFollowSchema),
  communityController.unfollowUser
);
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
