// Maps a caught error (usually an ApiError from the shared client) to a short,
// safe, user-facing string. Never surfaces raw backend messages for 5xx, never
// exposes stacks or DB internals, never logs tokens/credentials.

import { ApiError } from './client';

const FALLBACK = 'Something went wrong. Please try again.';

// Fixed, safe strings for the native Google adapter's stable codes
// (see src/native/googleSignIn.js). These errors are NOT ApiErrors. Raw native
// strings are never surfaced.
const GOOGLE_NATIVE_MESSAGES = {
  GOOGLE_CANCELLED: 'Google sign-in was cancelled.',
  GOOGLE_IN_PROGRESS: 'A Google sign-in is already in progress.',
  GOOGLE_NOT_CONFIGURED:
    'Google sign-in isn’t set up in this build yet — please log in with your email and password.',
  GOOGLE_UNAVAILABLE:
    'Google sign-in isn’t available on this device right now — please log in with your email and password.',
  GOOGLE_PROVIDER_FAILED:
    'Google sign-in didn’t complete. Please try again, or use your email and password.',
};

export function getAuthErrorMessage(err, fallback = FALLBACK) {
  // GOOGLE_* is checked first and for ANY error class: these codes are raised
  // both by the native adapter (plain errors) and by the JS flow's
  // single-flight guard (an ApiError), and they never collide with a backend
  // code, so one lookup keeps both safely mapped.
  if (err && typeof err.code === 'string' && GOOGLE_NATIVE_MESSAGES[err.code]) {
    return GOOGLE_NATIVE_MESSAGES[err.code];
  }
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

    // --- password reset completion / email verification ---
    // Fixed, generic wording for both: never distinguishes malformed, expired,
    // or already-used — that distinction is exactly what the backend's own
    // single error code already withholds.
    case 'AUTH_PASSWORD_RESET_TOKEN_INVALID':
      return 'This password reset link is invalid or has expired. Request a new one and try again.';
    case 'AUTH_EMAIL_VERIFICATION_TOKEN_INVALID':
      return 'This verification link is invalid or has expired. Request a new one and try again.';

    // --- authenticated password change (Security screen) ---
    case 'AUTH_CURRENT_PASSWORD_INVALID':
      return 'Current password is incorrect.';
    case 'AUTH_PASSWORD_CHANGE_UNAVAILABLE':
      return 'This account signed up with Google and has no WeCooked password to change.';

    // --- Google social login (B4.1 backend codes) ---
    case 'AUTH_SOCIAL_CHALLENGE_INVALID':
      return 'Google sign-in didn’t complete. Please try again.';
    case 'AUTH_SOCIAL_CREDENTIAL_INVALID':
      return 'We couldn’t verify that Google account. Please try again.';
    case 'AUTH_ACCOUNT_LINK_REQUIRED':
      return 'An account with this email already exists. Please log in with your WeCooked email and password.';
    case 'AUTH_SOCIAL_LOGIN_UNAVAILABLE':
      return 'Google sign-in isn’t available for this account. Please log in with your email and password.';
    case 'AUTH_SOCIAL_EMAIL_REQUIRED':
      return 'Your Google account needs a verified email before it can be used to sign in. Please log in with your email and password.';
    // --- Google account linking (B4.3A) ---
    // Fixed strings: these two 409s must never fall through to the backend's
    // own message, and must not hint at which other account owns the identity.
    case 'AUTH_SOCIAL_IDENTITY_IN_USE':
      return 'That Google account is already linked to a different WeCooked account.';
    case 'AUTH_SOCIAL_PROVIDER_ALREADY_LINKED':
      return 'A different Google account is already linked to your WeCooked account.';

    case 'AUTH_PROVIDER_UNAVAILABLE':
      return 'Google sign-in is temporarily unavailable. Please try again shortly.';
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
