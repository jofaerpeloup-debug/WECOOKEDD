const communityService = require('./community.service');
const { toPublicCommunityPost, toPublicCommunityComment } = require('./community.serializer');
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

const listFollowingPosts = asyncHandler(async (req, res) => {
  const { page, limit } = req.validated.query;
  const result = await communityService.listFollowingPosts({
    viewerId: req.auth.userId,
    page,
    limit,
  });
  sendSuccess(res, {
    posts: result.items.map(toPublicCommunityPost),
    pagination: toPagination({ page, limit, total: result.total }),
  });
});

const followUser = asyncHandler(async (req, res) => {
  sendSuccess(res, await communityService.followUser(req.auth.userId, req.params.userId));
});

const unfollowUser = asyncHandler(async (req, res) => {
  sendSuccess(res, await communityService.unfollowUser(req.auth.userId, req.params.userId));
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

const listComments = asyncHandler(async (req, res) => {
  const { page, limit } = req.validated.query;
  const result = await communityService.listComments({
    viewerId: req.auth.userId,
    postId: req.params.postId,
    page,
    limit,
  });
  sendSuccess(res, {
    comments: result.items.map(toPublicCommunityComment),
    commentCount: result.total,
    pagination: toPagination({ page, limit, total: result.total }),
  });
});

const createComment = asyncHandler(async (req, res) => {
  const result = await communityService.createComment(
    req.auth.userId,
    req.params.postId,
    req.validated.body
  );
  sendSuccess(res, {
    comment: toPublicCommunityComment(result.item),
    commentCount: result.commentCount,
  }, 201);
});

const deleteComment = asyncHandler(async (req, res) => {
  const result = await communityService.deleteComment(req.auth.userId, req.params.commentId);
  sendSuccess(res, result);
});

module.exports = {
  listPosts,
  listFollowingPosts,
  followUser,
  unfollowUser,
  createPost,
  deletePost,
  likePost,
  unlikePost,
  listComments,
  createComment,
  deleteComment,
};
