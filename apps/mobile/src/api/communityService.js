// Real Community M10A transport. The shared client owns authentication and
// refresh; this module allowlists payload/query fields and never sends identity
// or aggregate fields supplied by UI state.

import { api } from './client';

const LIST_PARAM_KEYS = ['page', 'limit'];
const INVALID_COMMENT_RESPONSE = 'Invalid Community comment response.';
const INVALID_FEED_RESPONSE = 'Invalid Community feed response.';
const INVALID_FOLLOW_RESPONSE = 'Invalid Community follow response.';
const INVALID_BOOKMARK_RESPONSE = 'Invalid Community bookmark response.';

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isAvatarUrl(value) {
  return value === null || (isNonEmptyString(value) && /^https:\/\//i.test(value));
}

function hasExactKeys(value, keys) {
  return isRecord(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}

function isPublicAuthor(author) {
  return author === null || (hasExactKeys(author, ['id', 'name', 'avatarUrl'])
    && isNonEmptyString(author.id)
    && isNonEmptyString(author.name)
    && isAvatarUrl(author.avatarUrl));
}

function isRecipeAttachment(attachment) {
  if (attachment === null) return true;
  if (!hasExactKeys(attachment, ['isAvailable', 'recipe'])
    || typeof attachment.isAvailable !== 'boolean') return false;
  if (!attachment.isAvailable) return attachment.recipe === null;
  return hasExactKeys(attachment.recipe, ['id', 'title', 'imageUrl'])
    && isNonEmptyString(attachment.recipe.id)
    && isNonEmptyString(attachment.recipe.title)
    && (attachment.recipe.imageUrl === null || isNonEmptyString(attachment.recipe.imageUrl));
}

function isPublicPost(post) {
  return hasExactKeys(post, [
    'id', 'caption', 'createdAt', 'author', 'recipeAttachment', 'likeCount',
    'likedByCurrentUser', 'commentCount', 'isOwner', 'isFollowingAuthor',
    'bookmarkedByCurrentUser',
  ])
    && isNonEmptyString(post.id)
    && isNonEmptyString(post.caption)
    && post.caption.length <= 2000
    && isNonEmptyString(post.createdAt)
    && !Number.isNaN(Date.parse(post.createdAt))
    && isPublicAuthor(post.author)
    && isRecipeAttachment(post.recipeAttachment)
    && Number.isInteger(post.likeCount) && post.likeCount >= 0
    && typeof post.likedByCurrentUser === 'boolean'
    && Number.isInteger(post.commentCount) && post.commentCount >= 0
    && typeof post.isOwner === 'boolean'
    && typeof post.isFollowingAuthor === 'boolean'
    && typeof post.bookmarkedByCurrentUser === 'boolean';
}

function isPublicComment(comment) {
  if (!hasExactKeys(comment, ['id', 'body', 'author', 'createdAt', 'isOwner'])
    || !isNonEmptyString(comment.id)
    || !isNonEmptyString(comment.body)
    || comment.body.length > 1000
    || !isNonEmptyString(comment.createdAt)
    || Number.isNaN(Date.parse(comment.createdAt))
    || typeof comment.isOwner !== 'boolean') return false;
  return isPublicAuthor(comment.author);
}

function isPagination(pagination, commentCount) {
  return hasExactKeys(pagination, ['page', 'limit', 'total', 'totalPages'])
    && Number.isInteger(pagination.page) && pagination.page >= 1
    && Number.isInteger(pagination.limit) && pagination.limit >= 1 && pagination.limit <= 100
    && Number.isInteger(pagination.total) && pagination.total >= 0
    && Number.isInteger(pagination.totalPages) && pagination.totalPages >= 0
    && pagination.total === commentCount
    && pagination.totalPages === Math.ceil(pagination.total / pagination.limit);
}

function isFeedPagination(pagination, postCount) {
  return hasExactKeys(pagination, ['page', 'limit', 'total', 'totalPages'])
    && Number.isInteger(pagination.page) && pagination.page >= 1
    && Number.isInteger(pagination.limit) && pagination.limit >= 1 && pagination.limit <= 100
    && Number.isInteger(pagination.total) && pagination.total >= 0
    && Number.isInteger(pagination.totalPages) && pagination.totalPages >= 0
    && pagination.totalPages === Math.ceil(pagination.total / pagination.limit)
    && postCount <= pagination.limit
    && (pagination.total === 0
      ? pagination.totalPages === 0 && pagination.page === 1
      : pagination.page <= pagination.totalPages);
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

function listPostsAt(path, params) {
  return api.get(path, { query: buildQuery(params) }).then((data) => {
    if (!hasExactKeys(data, ['posts', 'pagination'])
      || !Array.isArray(data.posts)
      || !data.posts.every(isPublicPost)
      || !isFeedPagination(data.pagination, data.posts.length)) {
      throw new Error(INVALID_FEED_RESPONSE);
    }
    return data;
  });
}

export function listCommunityPosts(params = {}) {
  return listPostsAt('/community/posts', params);
}

export function listFollowingCommunityPosts(params = {}) {
  return listPostsAt('/community/posts/following', params);
}

export function listSavedCommunityPosts(params = {}) {
  return listPostsAt('/community/posts/saved', params);
}

export function setCommunityAuthorFollowed(userId, following) {
  const path = `/community/users/${encodeURIComponent(userId)}/follow`;
  const request = following ? api.post(path) : api.del(path);
  return request.then((data) => {
    if (!hasExactKeys(data, ['following']) || data.following !== following) {
      throw new Error(INVALID_FOLLOW_RESPONSE);
    }
    return data;
  });
}

export function createCommunityPost({ caption, recipeId }) {
  const body = { caption };
  if (recipeId) body.recipeId = recipeId;
  return api.post('/community/posts', { body }).then((data) => {
    if (!hasExactKeys(data, ['post']) || !isPublicPost(data.post)) {
      throw new Error(INVALID_FEED_RESPONSE);
    }
    return data.post;
  });
}

export function deleteCommunityPost(postId) {
  return api.del(`/community/posts/${encodeURIComponent(postId)}`).then((data) => {
    if (!hasExactKeys(data, ['deleted']) || data.deleted !== true) {
      throw new Error(INVALID_FEED_RESPONSE);
    }
    return true;
  });
}

export function setCommunityPostLiked(postId, liked) {
  const path = `/community/posts/${encodeURIComponent(postId)}/likes`;
  return (liked ? api.post(path) : api.del(path)).then((data) => {
    if (!hasExactKeys(data, ['liked', 'likeCount'])
      || data.liked !== liked
      || !Number.isInteger(data.likeCount)
      || data.likeCount < 0) throw new Error(INVALID_FEED_RESPONSE);
    return data;
  });
}

export function setCommunityPostBookmarked(postId, bookmarked) {
  const path = `/community/posts/${encodeURIComponent(postId)}/bookmarks`;
  return (bookmarked ? api.post(path) : api.del(path)).then((data) => {
    if (!hasExactKeys(data, ['bookmarked']) || data.bookmarked !== bookmarked) {
      throw new Error(INVALID_BOOKMARK_RESPONSE);
    }
    return data;
  });
}

export function listCommunityComments(postId, params = {}) {
  return api
    .get(`/community/posts/${encodeURIComponent(postId)}/comments`, {
      query: buildQuery(params),
    })
    .then((data) => {
      const commentCount = commentCountFrom(data);
      if (!hasExactKeys(data, ['comments', 'commentCount', 'pagination'])
        || !Array.isArray(data.comments)
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
      if (!hasExactKeys(data, ['comment', 'commentCount'])
        || !isPublicComment(data.comment)) throw new Error(INVALID_COMMENT_RESPONSE);
      return { comment: data.comment, commentCount: commentCountFrom(data) };
    });
}

export function deleteCommunityComment(commentId) {
  return api.del(`/community/comments/${encodeURIComponent(commentId)}`).then((data) => {
    if (!hasExactKeys(data, ['deleted', 'commentCount'])
      || data.deleted !== true) throw new Error(INVALID_COMMENT_RESPONSE);
    return { deleted: true, commentCount: commentCountFrom(data) };
  });
}
