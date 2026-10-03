import { ApiError } from './client';

const FALLBACK = 'WeCooked is having trouble right now. Please try again shortly.';

export function getCommunityErrorMessage(err, fallback = FALLBACK) {
  if (!(err instanceof ApiError)) return fallback;
  if (err.isNetworkError) return 'Can’t reach WeCooked. Check your connection and try again.';

  switch (err.code) {
    case 'COMMUNITY_POST_NOT_FOUND':
      return 'This post is no longer available.';
    case 'COMMUNITY_COMMENT_NOT_FOUND':
      return 'This comment is no longer available.';
    case 'COMMUNITY_FOLLOW_TARGET_NOT_FOUND':
      return 'This cook is no longer available.';
    case 'COMMUNITY_SELF_FOLLOW_NOT_ALLOWED':
      return 'You cannot follow yourself.';
    case 'RECIPE_NOT_FOUND':
      return 'That recipe is no longer available.';
    case 'VALIDATION_ERROR':
      return err.details?.[0]?.message || 'Please check your post and try again.';
    case 'RATE_LIMIT_EXCEEDED':
      return 'Too many requests. Please wait a moment and try again.';
    case 'AUTH_SESSION_INVALID':
    case 'AUTH_TOKEN_INVALID':
    case 'AUTH_TOKEN_MISSING':
      return 'Your session has expired. Please log in again.';
    default:
      if (err.status >= 500) return FALLBACK;
      return err.message || fallback;
  }
}
