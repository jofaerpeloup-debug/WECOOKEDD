// Maps a caught error (usually an ApiError from the shared client) to a short,
// safe, user-facing string for the ingredient-substitutes lookup. Mirrors
// recipeErrors.js / ingredientErrors.js — never surfaces raw 5xx bodies,
// stacks, DB internals, or tokens.
//
// An EMPTY substitutes array is NOT an error: the sheet renders a normal
// "No substitutions available." state for it and never calls this mapper.

import { ApiError } from './client';

const FALLBACK = 'Couldn’t load substitutes. Please try again.';

export function getSubstitutionErrorMessage(err, fallback = FALLBACK) {
  if (!(err instanceof ApiError)) {
    return fallback;
  }
  if (err.isNetworkError) {
    return 'Can’t reach WeCooked. Check your connection and try again.';
  }

  switch (err.code) {
    case 'VALIDATION_ERROR':
      // The sheet only ever sends a canonical ingredient id it already
      // validated, so a field-level detail would add nothing useful here.
      return 'Couldn’t look up substitutes for this ingredient.';
    case 'FORBIDDEN':
      // Not expected on the mobile read path — mobile never sends
      // status=inactive/all. Handled defensively as a generic failure.
      return 'Couldn’t load substitutes. Please try again.';
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