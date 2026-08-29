// Maps a caught error (usually an ApiError from the shared client) to a short,
// safe, user-facing string for the canonical ingredient search. Mirrors
// recipeErrors.js / favoriteErrors.js — never surfaces raw 5xx bodies, stacks,
// DB internals, or tokens.

import { ApiError } from './client';

const FALLBACK = 'Couldn’t search ingredients. Please try again.';

export function getIngredientErrorMessage(err, fallback = FALLBACK) {
  if (!(err instanceof ApiError)) {
    return fallback;
  }
  if (err.isNetworkError) {
    return 'Can’t reach WeCooked. Check your connection and try again.';
  }

  switch (err.code) {
    case 'VALIDATION_ERROR':
      // The picker only ever sends a trimmed search string; a field-level
      // detail would add nothing useful here.
      return 'That search wasn’t valid. Try a different term.';
    case 'RATE_LIMIT_EXCEEDED':
      return 'Too many requests. Please wait a moment and try again.';
    case 'AUTH_SESSION_INVALID':
    case 'AUTH_TOKEN_INVALID':
    case 'AUTH_TOKEN_MISSING':
      return 'Your session has expired. Please log in again.';
    default:
      if (err.status >= 500) {
        return 'WeCooked is having trouble right now. Please try again shortly.';
      }
      return err.message || fallback;
  }
}