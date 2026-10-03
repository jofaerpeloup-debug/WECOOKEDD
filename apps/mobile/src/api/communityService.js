// Real Community M10A transport. The shared client owns authentication and
// refresh; this module allowlists payload/query fields and never sends identity
// or aggregate fields supplied by UI state.

import { api } from './client';

const LIST_PARAM_KEYS = ['page', 'limit'];
const INVALID_COMMENT_RESPONSE = 'Invalid Community comment response.';

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPublicComment(comment) {
  if (!isRecord(comment)
    || !isNonEmptyString(comment.id)
    || !isNonEmptyString(comment.body)
    || comment.body.length > 1000
    || !isNonEmptyString(comment.createdAt)
    || Number.isNaN(Date.parse(comment.createdAt))
    || typeof comment.isOwner !== 'boolean') return false;
  return comment.author === null || (isRecord(comment.author)
    && isNonEmptyString(comment.author.id)
    && isNonEmptyString(comment.author.name));
}

function isPagination(pagination, commentCount) {
  return isRecord(pagination)
    && Number.isInteger(pagination.page) && pagination.page >= 1
    && Number.isInteger(pagination.limit) && pagination.limit >= 1 && pagination.limit <= 100
    && Number.isInteger(pagination.total) && pagination.total >= 0
    && Number.isInteger(pagination.totalPages) && pagination.totalPages >= 0
    && pagination.total === commentCount
    && pagination.totalPages === Math.ceil(pagination.total / pagination.limit);
}

function commentCountFrom(data) {
  if (!Number.isInteger(data && data.commentCount) || data.commentCount < 0) {
    throw new Error(INVALID_COMMENT_RESPONSE);
  }
  return data.commentCount;
}

function buildQuery(params) {
  const query = {};
  for (const key of LIST_PARAM_KEYS) {
    const value = params[key];
    if (value === undefined || value === null || value === '') continue;
    query[key] = value;
  }
  return query;
}

export function listCommunityPosts(params = {}) {
  return api.get('/community/posts', { query: buildQuery(params) }).then((data) => ({
    posts: Array.isArray(data && data.posts) ? data.posts : [],
    pagination: (data && data.pagination) || null,
  }));
}

export function createCommunityPost({ caption, recipeId }) {
  const body = { caption };
  if (recipeId) body.recipeId = recipeId;
  return api.post('/community/posts', { body }).then((data) => data.post);
}

export function deleteCommunityPost(postId) {
  return api.del(`/community/posts/${encodeURIComponent(postId)}`).then((data) => data.deleted === true);
}

export function setCommunityPostLiked(postId, liked) {
  const path = `/community/posts/${encodeURIComponent(postId)}/likes`;
  return (liked ? api.post(path) : api.del(path)).then((data) => ({
    liked: data.liked === true,
    likeCount: Number.isInteger(data.likeCount) && data.likeCount >= 0 ? data.likeCount : 0,
  }));
}

export function listCommunityComments(postId, params = {}) {
  return api
    .get(`/community/posts/${encodeURIComponent(postId)}/comments`, {
      query: buildQuery(params),
    })
    .then((data) => {
      const commentCount = commentCountFrom(data);
      if (!Array.isArray(data && data.comments)
        || !data.comments.every(isPublicComment)
        || !isPagination(data.pagination, commentCount)) throw new Error(INVALID_COMMENT_RESPONSE);
      return {
        comments: data.comments,
        commentCount,
        pagination: data.pagination,
      };
    });
}

export function createCommunityComment(postId, body) {
  return api
    .post(`/community/posts/${encodeURIComponent(postId)}/comments`, { body: { body } })
    .then((data) => {
      if (!data || !isPublicComment(data.comment)) throw new Error(INVALID_COMMENT_RESPONSE);
      return { comment: data.comment, commentCount: commentCountFrom(data) };
    });
}

export function deleteCommunityComment(commentId) {
  return api.del(`/community/comments/${encodeURIComponent(commentId)}`).then((data) => {
    if (!data || data.deleted !== true) throw new Error(INVALID_COMMENT_RESPONSE);
    return { deleted: true, commentCount: commentCountFrom(data) };
  });
}
