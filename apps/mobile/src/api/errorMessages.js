// Maps a caught error (usually an ApiError from the shared client) to a short,
// safe, user-facing string. Never surfaces raw backend messages for 5xx, never
// exposes stacks or DB internals, never logs tokens/credentials.

import { ApiError } from './client';

const FALLBACK = 'Something went wrong. Please try again.';

export function getAuthErrorMessage(err, fallback = FALLBACK) {
  if (!(err instanceof ApiError)) {
    return fallback;
  }
  if (err.isNetworkError) {
    return 'Can’t reach WeCooked. Check your connection and try again.';
  }

  switch (err.code) {
    case 'AUTH_INVALID_CREDENTIALS':
      return 'That email or password doesn’t match our records.';
    case 'AUTH_ACCOUNT_SUSPENDED':
      return 'This account has been suspended. Contact support for help.';
    case 'USER_EMAIL_ALREADY_EXISTS':
      return 'An account with this email already exists. Try logging in instead.';
    case 'VALIDATION_ERROR':
      return err.details?.[0]?.message || 'Please check your details and try again.';
    case 'RATE_LIMIT_EXCEEDED':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'SESSION_PERSIST_FAILED':
      return 'We couldn’t securely save your session. Please try again.';
    case 'AUTH_REFRESH_TOKEN_INVALID':
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
