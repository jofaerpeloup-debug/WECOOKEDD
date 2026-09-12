// Real Community M10A transport. The shared client owns authentication and
// refresh; this module allowlists payload/query fields and never sends identity
// or aggregate fields supplied by UI state.

import { api } from './client';

const LIST_PARAM_KEYS = ['page', 'limit'];

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
