// Google sign-in and account-link orchestration for the mobile app.
//
// Owns the AUTHORITATIVE JS single-flight (mirrors authService's
// `refreshInFlight` pattern) and the fixed per-attempt sequence:
//
//   1. fetch a NEW WeCooked social challenge for this mode
//      (login -> authService.getSocialChallenge,
//       link  -> authService.getSocialLinkChallenge, which is authenticated and
//       bound server-side to the current user)
//   2. receive the raw 43-char base64url nonce
//   3. call the native adapter with the EXACT nonce
//   4. receive ONLY the Google idToken
//   5. exchange { idToken, challengeId } with the backend
//      (login -> authService.googleLogin, which establishes a session;
//       link  -> authService.linkGoogleAccount, which does NOT)
//   6. return the authoritative WeCooked user
//
// Both modes share ONE in-flight slot, because they share one scarce resource:
// the device's single interactive Google operation. It holds NO React state and
// NO persistence. challengeId + nonce live only in the running call's closure
// and are never stored, logged, or put in an error. Cancellation / provider
// failure / backend failure all abandon the challenge; the next call fetches a
// fresh one. There is no automatic Google retry.

import { ApiError } from '../api/client';
import * as authService from '../api/authService';
import * as nativeGoogleSignIn from '../native/googleSignIn';

const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const LOGIN = 'login';
const LINK = 'link';

// The single native-operation slot, plus which mode currently holds it.
let inFlight = null;
let inFlightMode = null;

async function runAttempt(mode) {
  // 1-2. Fresh challenge of the correct intent. Never reused across attempts,
  // and a login challenge is not usable by the link exchange (or vice versa) —
  // the backend enforces that separation.
  const challenge =
    mode === LINK
      ? await authService.getSocialLinkChallenge()
      : await authService.getSocialChallenge();
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
  //    login flows through the existing establishSession() path; link never
  //    does, and returns the updated user only.
  const user =
    mode === LINK
      ? await authService.linkGoogleAccount({ idToken, challengeId })
      : await authService.googleLogin({ idToken, challengeId });

  // 6. Authoritative WeCooked user.
  return user;
}

/**
 * Runs one attempt in `mode`, or joins the running one.
 *
 * Concurrent callers of the SAME mode share the one in-flight promise — a
 * second call never creates a second challenge or native operation. A call in
 * the OTHER mode cannot join (a link must never resolve with a login's session
 * switch, or the reverse) and is rejected with the stable GOOGLE_IN_PROGRESS
 * code instead, so there is still never a second native operation. The slot is
 * always cleared in `finally`, so the next call after a completed / cancelled /
 * failed attempt starts fresh.
 */
function run(mode) {
  if (inFlight) {
    if (inFlightMode === mode) {
      return inFlight;
    }
    return Promise.reject(
      new ApiError('A Google operation is already in progress.', {
        code: 'GOOGLE_IN_PROGRESS',
        status: 409,
      })
    );
  }
  inFlightMode = mode;
  inFlight = (async () => {
    try {
      return await runAttempt(mode);
    } finally {
      inFlight = null;
      inFlightMode = null;
    }
  })();
  return inFlight;
}

/** Interactive Google sign-in / first-time Google account creation. */
export function signInWithGoogle() {
  return run(LOGIN);
}

/**
 * Attaches a Google identity to the CURRENT authenticated user. Resolves with
 * the updated public user; the caller's WeCooked session is untouched.
 */
export function linkGoogleAccount() {
  return run(LINK);
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
