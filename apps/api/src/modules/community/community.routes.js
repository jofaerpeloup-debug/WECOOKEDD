const { Router } = require('express');
const communityController = require('./community.controller');
const { validate } = require('../../middleware/validate.middleware');
const { authenticate } = require('../../middleware/authenticate.middleware');
const {
  listCommunityPostsSchema,
  createCommunityPostSchema,
  communityPostParamsSchema,
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

module.exports = router;
