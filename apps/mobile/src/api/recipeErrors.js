// Maps a caught error (usually an ApiError from the shared client) to a short,
// safe, user-facing string for Recipe screens. Mirrors the approach in
// errorMessages.js (auth) — never surfaces raw 5xx bodies, stacks, DB
// internals, or tokens.

import { ApiError } from './client';

const FALLBACK = 'Something went wrong loading recipes. Please try again.';

export function getRecipeErrorMessage(err, fallback = FALLBACK) {
  if (!(err instanceof ApiError)) {
    return fallback;
  }
  if (err.isNetworkError) {
    return 'Can’t reach WeCooked. Check your connection and try again.';
  }

  switch (err.code) {
    case 'RECIPE_NOT_FOUND':
      return 'This recipe isn’t available anymore.';
    case 'VALIDATION_ERROR':
      return err.details?.[0]?.message || 'That request wasn’t valid. Please try again.';
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