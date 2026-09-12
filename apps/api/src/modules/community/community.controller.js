const communityService = require('./community.service');
const { toPublicCommunityPost } = require('./community.serializer');
const { sendSuccess } = require('../../shared/http/response');
const { asyncHandler } = require('../../shared/http/async-handler');

function toPagination({ page, limit, total }) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

const listPosts = asyncHandler(async (req, res) => {
  const { page, limit } = req.validated.query;
  const result = await communityService.listPosts({
    viewerId: req.auth.userId,
    page,
    limit,
  });
  sendSuccess(res, {
    posts: result.items.map(toPublicCommunityPost),
    pagination: toPagination({ page, limit, total: result.total }),
  });
});

const createPost = asyncHandler(async (req, res) => {
  const result = await communityService.createPost(req.auth.userId, req.validated.body);
  sendSuccess(res, { post: toPublicCommunityPost(result) }, 201);
});

const deletePost = asyncHandler(async (req, res) => {
  await communityService.deletePost(req.auth.userId, req.params.postId);
  sendSuccess(res, { deleted: true });
});

const likePost = asyncHandler(async (req, res) => {
  const state = await communityService.likePost(req.auth.userId, req.params.postId);
  sendSuccess(res, state);
});

const unlikePost = asyncHandler(async (req, res) => {
  const state = await communityService.unlikePost(req.auth.userId, req.params.postId);
  sendSuccess(res, state);
});

module.exports = { listPosts, createPost, deletePost, likePost, unlikePost };
