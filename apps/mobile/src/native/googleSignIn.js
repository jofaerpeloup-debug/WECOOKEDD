// Thin JS adapter over the WeCooked local native Google Sign-In module.
//
// This is the ONLY seam between the app and the native module. It:
//   * detects absence of the native implementation safely (Expo Go / no dev
//     build) — no import-time crash, no red screen;
//   * exposes `isGoogleSignInAvailable()` for UI readiness;
//   * returns ONLY `{ idToken }` on success;
//   * normalizes native errors to stable `GOOGLE_*` codes + fixed safe messages,
//     collapsing anything unknown to `GOOGLE_PROVIDER_FAILED`;
//   * never persists or logs the nonce or the token.
//
// It holds NO authority: it does not fetch challenges, call the backend, touch
// React state, or manage the authoritative single-flight (that is
// src/auth/googleAuthFlow.js).

import { requireOptionalNativeModule } from 'expo-modules-core';

const NATIVE_MODULE_NAME = 'WeCookedGoogleSignIn';

export const GOOGLE_ERROR_CODES = Object.freeze({
  CANCELLED: 'GOOGLE_CANCELLED',
  IN_PROGRESS: 'GOOGLE_IN_PROGRESS',
  NOT_CONFIGURED: 'GOOGLE_NOT_CONFIGURED',
  UNAVAILABLE: 'GOOGLE_UNAVAILABLE',
  PROVIDER_FAILED: 'GOOGLE_PROVIDER_FAILED',
});

const KNOWN_CODES = new Set(Object.values(GOOGLE_ERROR_CODES));

// Fixed safe messages. These mirror errorMessages.js but exist here too so the
// adapter is self-contained and never has to surface a raw native string.
const SAFE_MESSAGES = Object.freeze({
  GOOGLE_CANCELLED: 'Google sign-in was cancelled.',
  GOOGLE_IN_PROGRESS: 'A Google sign-in is already in progress.',
  GOOGLE_NOT_CONFIGURED: 'Google sign-in isn’t set up in this build yet.',
  GOOGLE_UNAVAILABLE: 'Google sign-in isn’t available on this device right now.',
  GOOGLE_PROVIDER_FAILED: 'Google sign-in didn’t complete. Please try again.',
});

/**
 * A normalized Google sign-in failure. `code` is always one of
 * GOOGLE_ERROR_CODES; `message` is always one of the fixed safe strings. No
 * raw provider text, tokens, nonce, or profile data is ever carried.
 */
export class GoogleSignInError extends Error {
  constructor(code) {
    const safeCode = KNOWN_CODES.has(code) ? code : GOOGLE_ERROR_CODES.PROVIDER_FAILED;
    super(SAFE_MESSAGES[safeCode]);
    this.name = 'GoogleSignInError';
    this.code = safeCode;
  }
}

// `requireOptionalNativeModule` returns null when the native module is not
// present in the running binary. This must NOT throw at import time.
const nativeModule = requireOptionalNativeModule(NATIVE_MODULE_NAME);

export function isGoogleSignInAvailable() {
  return !!nativeModule && typeof nativeModule.signIn === 'function';
}

function normalizeNativeError(err) {
  const code = err && typeof err.code === 'string' ? err.code : null;
  if (code && KNOWN_CODES.has(code)) {
    return new GoogleSignInError(code);
  }
  // Unknown native failure / non-coded error -> generic provider failure.
  return new GoogleSignInError(GOOGLE_ERROR_CODES.PROVIDER_FAILED);
}

/**
 * Runs one interactive Google sign-in for `nonce` and resolves `{ idToken }`.
 * `nonce` is passed through untouched. Rejects with a GoogleSignInError.
 */
export async function signIn({ nonce } = {}) {
  if (!isGoogleSignInAvailable()) {
    throw new GoogleSignInError(GOOGLE_ERROR_CODES.UNAVAILABLE);
  }

  let result;
  try {
    result = await nativeModule.signIn({ nonce });
  } catch (err) {
    throw normalizeNativeError(err);
  }

  const idToken = result && typeof result.idToken === 'string' ? result.idToken : null;
  if (!idToken) {
    throw new GoogleSignInError(GOOGLE_ERROR_CODES.PROVIDER_FAILED);
  }
  return { idToken };
}

/**
 * Best-effort provider-side state clear for WeCooked logout hygiene. Never
 * throws — a failure here must not affect WeCooked logout.
 */
export async function clearState() {
  if (!nativeModule || typeof nativeModule.clearState !== 'function') {
    return;
  }
  try {
    await nativeModule.clearState();
  } catch {
    // best-effort only
  }
}