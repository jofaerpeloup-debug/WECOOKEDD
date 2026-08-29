// Maps a caught error (usually an ApiError from the shared client) to a short,
// safe, user-facing string for Shopping List actions. Mirrors favoriteErrors.js
// / recipeErrors.js / errorMessages.js — never surfaces raw 5xx bodies, stacks,
// DB internals, or tokens.
//
// One IDEMPOTENT backend outcome is deliberately NOT surfaced as an error:
//   - SHOPPING_LIST_ITEM_NOT_FOUND on a delete -> the item is already gone ->
//     the caller reconciles (reload) instead of showing an error.
// `isItemAlreadyGone` centralises that classification.

import { ApiError } from './client';

const FALLBACK = 'WeCooked is having trouble right now. Please try again shortly.';

/**
 * @param {unknown} err
 * @returns {boolean} true when `err` means "that shopping-list item no longer
 *   exists" — safe to treat a delete as already-done.
 */
export function isItemAlreadyGone(err) {
  if (!(err instanceof ApiError)) return false;
  return err.code === 'SHOPPING_LIST_ITEM_NOT_FOUND' || err.status === 404;
}

export function getShoppingListErrorMessage(err, fallback = FALLBACK) {
  if (!(err instanceof ApiError)) {
    return fallback;
  }
  if (err.isNetworkError) {
    return 'Can’t reach WeCooked. Check your connection and try again.';
  }

  switch (err.code) {
    case 'SHOPPING_LIST_LIMIT_EXCEEDED':
      return 'Your shopping list is full (200 items). Remove some items first.';
    case 'RECIPE_NOT_FOUND':
      return 'This recipe isn’t available anymore.';
    case 'SHOPPING_LIST_ITEM_NOT_FOUND':
      return 'That item is no longer on your list.';
    case 'SHOPPING_LIST_ITEM_ALREADY_EXISTS':
      return 'You already have that ingredient in that unit.';
    case 'INGREDIENT_NOT_FOUND':
    case 'INGREDIENT_INACTIVE':
      return 'That ingredient isn’t available anymore.';
    case 'VALIDATION_ERROR':
      // Fixed message — manual add validates quantity/unit client-side before
      // calling the API, so a VALIDATION_ERROR here is unexpected and a
      // field-level detail string (potentially echoing raw input) adds no
      // value.
      return 'That request wasn’t valid. Please try again.';
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
