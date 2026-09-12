// Maps a caught error (usually an ApiError from the shared client) to a
// short, safe, user-facing string for Collections actions. Mirrors
// favoriteErrors.js exactly — never surfaces raw 5xx bodies, stacks, DB
// internals, or tokens.
//
// The two IDEMPOTENT backend outcomes are deliberately NOT surfaced as
// errors — they mean the backend is already in the state the user wanted:
//   - COLLECTION_RECIPE_ALREADY_EXISTS on add    -> already in it -> success
//   - COLLECTION_RECIPE_NOT_FOUND      on remove -> already gone  -> success
// `isIdempotentCollectionOutcome` centralises that classification so a
// caller never treats a harmless duplicate/already-removed outcome as a
// failure.

import { ApiError } from './client';

const FALLBACK = 'WeCooked is having trouble right now. Please try again shortly.';

/**
 * @param {unknown} err
 * @param {'add'|'remove'} action
 * @returns {boolean} true when `err` means "the membership is already in the
 *   state this action was trying to reach".
 */
export function isIdempotentCollectionOutcome(err, action) {
  if (!(err instanceof ApiError)) return false;
  if (action === 'add') return err.code === 'COLLECTION_RECIPE_ALREADY_EXISTS' || err.status === 409;
  if (action === 'remove') return err.code === 'COLLECTION_RECIPE_NOT_FOUND' || err.status === 404;
  return false;
}

export function getCollectionErrorMessage(err, fallback = FALLBACK) {
  if (!(err instanceof ApiError)) {
    return fallback;
  }
  if (err.isNetworkError) {
    return 'Can’t reach WeCooked. Check your connection and try again.';
  }

  switch (err.code) {
    case 'COLLECTION_NOT_FOUND':
      return 'That collection isn’t available anymore.';
    case 'RECIPE_NOT_FOUND':
      return 'This recipe isn’t available anymore.';
    case 'COLLECTION_RECIPE_ALREADY_EXISTS':
      return 'This recipe is already in that collection.';
    case 'COLLECTION_RECIPE_NOT_FOUND':
      return 'That recipe isn’t in this collection.';
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
