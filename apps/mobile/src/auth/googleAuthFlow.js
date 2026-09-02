// Google sign-in orchestration for the mobile app.
//
// Owns the AUTHORITATIVE JS single-flight (mirrors authService's
// `refreshInFlight` pattern) and the fixed per-attempt sequence:
//
//   1. fetch a NEW WeCooked social challenge  (authService.getSocialChallenge)
//   2. receive the raw 43-char base64url nonce
//   3. call the native adapter with the EXACT nonce
//   4. receive ONLY the Google idToken
//   5. exchange { idToken, challengeId } with the backend
//      (authService.googleLogin -> existing establishSession)
//   6. return the authoritative WeCooked user
//
// It holds NO React state and NO persistence. challengeId + nonce live only in
// the running call's closure and are never stored, logged, or put in an error.
// Cancellation / provider failure / backend failure all abandon the challenge;
// the next call fetches a fresh one. There is no automatic Google retry.

import { ApiError } from '../api/client';
import * as authService from '../api/authService';
import * as nativeGoogleSignIn from '../native/googleSignIn';

const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

let inFlight = null;

async function runAttempt() {
  // 1-2. Fresh challenge. Never reused across attempts.
  const challenge = await authService.getSocialChallenge();
  const challengeId = challenge && challenge.challengeId;
  const nonce = challenge && challenge.nonce;

  if (!challengeId || typeof nonce !== 'string' || !NONCE_PATTERN.test(nonce)) {
    // Malformed challenge — safe, nonce-free error.
    throw new ApiError('Google sign-in could not be started.', {
      code: 'AUTH_SOCIAL_CHALLENGE_INVALID',
      status: 400,
    });
  }

  // 3-4. Native interactive Google sign-in with the EXACT nonce. Only the
  // idToken comes back.
  const { idToken } = await nativeGoogleSignIn.signIn({ nonce });

  // 5. Backend exchange — EXACTLY { idToken, challengeId }, nothing else.
  //    Success flows through the existing establishSession() path.
  const user = await authService.googleLogin({ idToken, challengeId });

  // 6. Authoritative WeCooked user.
  return user;
}

/**
 * Runs one Google sign-in attempt. Concurrent callers share the one in-flight
 * promise — a second call never creates a second challenge or native operation.
 * The in-flight slot is always cleared in `finally`, so the next call after a
 * completed / cancelled / failed attempt starts fresh.
 */
export function signInWithGoogle() {
  if (inFlight) {
    return inFlight;
  }
  inFlight = (async () => {
    try {
      return await runAttempt();
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** True while an attempt is running. UX/diagnostics only — not a guard. */
export function isInFlight() {
  return inFlight !== null;
}

/** Whether the native Google module is present in this build. */
export function isAvailable() {
  return nativeGoogleSignIn.isGoogleSignInAvailable();
}

/**
 * The Google-provider seam for WeCooked logout hygiene. Best-effort and fully
 * defensive: delegates to the native adapter, swallows any rejection, exposes
 * nothing, logs nothing, and never throws. No timeout — callers fire-and-forget.
 */
export async function clearNativeState() {
  try {
    await nativeGoogleSignIn.clearState();
  } catch {
    // swallow — provider cleanup is best-effort only
  }
}