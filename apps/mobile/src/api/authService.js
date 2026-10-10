// Backend auth/session orchestration for the mobile app.
//
// Wraps the auth endpoints and owns token rotation + concurrency. The React
// layer (AuthContext) calls the exported functions and never touches
// tokenStore or client directly.
//
// Endpoints consumed (all under /api/v1):
//   POST /auth/register   -> { user, accessToken, refreshToken }
//   POST /auth/login      -> { user, accessToken, refreshToken }
//   POST /auth/forgot-password -> { passwordResetRequested: true } (no session change)
//   POST /auth/reset-password  -> { passwordReset: true }         (revokes every session)
//   POST /auth/verify-email    -> { emailVerified: true }         (no session change)
//   POST /auth/resend-verification -> { verificationEmailRequested: true } (no session change)
//   POST /auth/refresh    -> { accessToken, refreshToken }        (rotating; no user)
//   POST /auth/logout     -> { loggedOut: true }                  (needs access token)
//   POST /auth/logout-all -> { revokedCount }                     (needs access token)
//   GET  /users/me        -> { user }                             (authoritative identity)

import { api, setAuthAdapter, ApiError } from './client';
import * as tokenStore from './tokenStore';
import { Buffer } from 'buffer';

// Notifies the React layer that the session ended non-interactively (a refresh
// was definitively rejected). Set by AuthContext while mounted.
let onSessionExpired = null;
let localSessionRevision = 0;
let tokenMutationTail = Promise.resolve();

function runTokenMutation(mutation) {
  const result = tokenMutationTail.then(mutation, mutation);
  tokenMutationTail = result.catch(() => {});
  return result;
}

export function setOnSessionExpired(fn) {
  onSessionExpired = typeof fn === 'function' ? fn : null;
}

async function applyTokens(tokens) {
  return runTokenMutation(async () => {
    tokenStore.setAccessToken(tokens?.accessToken || null);
    const persisted = await tokenStore.setRefreshToken(tokens?.refreshToken || null);
    localSessionRevision += 1;
    return persisted;
  });
}

// Ends the session and notifies the React layer exactly once.
async function endSession() {
  await clearLocalSession();
  if (onSessionExpired) onSessionExpired();
}

// --- single-flight rotating refresh ---------------------------------------

// The backend ROTATES the refresh token: each successful /auth/refresh
// consumes the presented token and returns a new one. If several requests
// 401 at once they must NOT each POST /auth/refresh — the first consumes the
// token, the rest would present an already-spent token and fail, tearing down
// an otherwise-valid session. `refreshInFlight` is checked and assigned
// synchronously (the async work is inside the IIFE), so concurrent callers
// deterministically share the one in-flight promise.
let refreshInFlight = null;

async function performRefresh() {
  if (!refreshInFlight) {
    // `refreshInFlight` stays set for the WHOLE operation — network call *and*
    // the token-store writes that follow — and is cleared once, in `finally`.
    // Nothing else may rotate `current` while this runs.
    refreshInFlight = (async () => {
      try {
        const current = await tokenStore.getRefreshToken();
        if (!current) return false;

        let data;
        try {
          data = await api.post('/auth/refresh', {
            auth: false,
            body: { refreshToken: current },
          });
        } catch (err) {
          // A transient network failure must not destroy a still-valid refresh
          // token — the caller's request just fails for now and can be retried.
          if (err instanceof ApiError && err.isNetworkError) {
            return false;
          }
          // A real rejection (invalid / expired / already-rotated / revoked
          // session) is terminal — but only tear the session down if the token
          // we tried is still the current one. A concurrent login or logout
          // may have replaced/cleared it while this request was in flight, and
          // that newer state must win (a stale failure must never sign out a
          // session that has since been re-established).
          if ((await tokenStore.getRefreshToken()) === current) {
            await endSession();
          }
          return false;
        }

        // Success: the backend has now invalidated `current`.
        if ((await tokenStore.getRefreshToken()) !== current) {
          // Superseded mid-flight — these rotated tokens belong to a session
          // that no longer exists on this device. Discard them untouched.
          return false;
        }

        tokenStore.setAccessToken(data?.accessToken || null);
        const persisted = await tokenStore.setRefreshToken(data?.refreshToken || null);
        if (!persisted) {
          // The rotated refresh token could not be stored and `current` is now
          // dead on the backend, so the session can't be continued or restored
          // safely. End it cleanly now rather than fail unpredictably on the
          // next refresh / app restart. (No insecure fallback store.)
          await endSession();
          return false;
        }
        return true;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

setAuthAdapter({
  getAccessToken: () => tokenStore.getAccessToken(),
  refreshAccessToken: performRefresh,
});

// --- identity -----------------------------------------------------------

export function fetchCurrentUser() {
  return api.get('/users/me').then((data) => data.user);
}

// --- interactive auth --------------------------------------------------

// Stable code for "the freshly issued refresh token could not be saved to
// SecureStore". Mapped to a safe user-facing string in errorMessages.js; the
// message passed here is internal and never shown.
export const SESSION_PERSIST_FAILED = 'SESSION_PERSIST_FAILED';

/**
 * Shared tail of login() and register(): persist the just-issued tokens and
 * resolve the authoritative user.
 *
 * On native, if the refresh token cannot be written to SecureStore the session
 * is unusable — it could not survive a token rotation or an app restart — so we
 * must NOT let the app become authenticated. Best-effort revoke the
 * just-created backend session (the access token is still in memory here),
 * wipe all local auth state, and throw. (Web persistence never fails — it is
 * memory-only by design — so this path is native-only in practice.)
 */
async function establishSession(data) {
  const persisted = await applyTokens(data);
  if (!persisted) {
    try {
      await api.post('/auth/logout');
    } catch {
      // best effort — the session is being torn down locally regardless
    }
    await clearLocalSession();
    throw new ApiError('Refresh token could not be persisted to secure storage.', {
      code: SESSION_PERSIST_FAILED,
    });
  }
  // /users/me is authoritative for identity/session state; fall back to the
  // auth-response user only if that follow-up read is briefly unavailable.
  try {
    return await fetchCurrentUser();
  } catch (err) {
    // The auth response remains server-authoritative enough for a temporary
    // transport/5xx outage. A definitive client/auth rejection is different:
    // the shared client may already have cleared the rejected session, so
    // returning data.user would create an authenticated UI with no live tokens.
    if (err instanceof ApiError && (err.isNetworkError || err.status >= 500)) {
      return data.user;
    }
    await clearLocalSession();
    throw err;
  }
}

export async function login({ email, password }) {
  const data = await api.post('/auth/login', {
    auth: false,
    body: { email, password },
  });
  return establishSession(data);
}

// --- password reset request ------------------------------------------
//
//   POST /auth/forgot-password  body { email }
//        -> { passwordResetRequested: true }                  (public)
//
// Request step only: the backend mails the reset link and answers the SAME way
// whether or not an account exists, so the caller learns nothing about the
// address. Deliberately NOT part of the session paths — this issues no tokens,
// so it must not touch tokenStore, applyTokens, establishSession or
// endSession, and a signed-in caller's session is left exactly as it was.
// Completing the reset happens off-device via that emailed link.
export function forgotPassword(email) {
  return api.post('/auth/forgot-password', {
    auth: false,
    body: { email },
  });
}

// --- password reset completion ----------------------------------------
//
//   POST /auth/reset-password  body { token, newPassword }
//        -> { passwordReset: true }                          (public)
//
// The backend revokes EVERY session for the account on success. This device
// may or may not currently hold one of those sessions (the link is usually
// opened signed-out, but a stale link opened while still signed in is
// possible) — either way, clearLocalSession() below is called unconditionally
// afterward so the app can never keep appearing authenticated with
// server-revoked credentials. `auth: false`: the token itself is the
// credential, not the caller's session.
export function resetPassword({ token, newPassword }) {
  return api.post('/auth/reset-password', {
    auth: false,
    body: { token, newPassword },
  });
}

// Clears local token storage without calling /auth/logout — used after a
// password reset, where the server session (if any existed on this device)
// is already revoked by the reset itself, so hitting /auth/logout again would
// just be a pointless extra request against an already-dead session.
export function getLocalSessionRevision() {
  return localSessionRevision;
}

// A local discriminator only. The API still validates the signed token and session generation.
export function getLocalSessionId() {
  try {
    const token = tokenStore.getAccessToken();
    const parts = token?.split('.');
    if (parts?.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return /^[0-9a-f]{24}$/i.test(payload.sessionId) ? payload.sessionId : null;
  } catch { return null; }
}

export function clearLocalSession(expectedRevision) {
  return runTokenMutation(async () => {
    if (expectedRevision !== undefined && expectedRevision !== localSessionRevision) {
      return false;
    }
    await tokenStore.clearSession();
    localSessionRevision += 1;
    return true;
  });
}

// --- email verification -------------------------------------------------
//
//   POST /auth/verify-email        body { token }    -> { emailVerified: true }
//   POST /auth/resend-verification body { email }     -> { verificationEmailRequested: true }
//
// Both are public and unauthenticated like forgot/reset-password: the token
// (or, for resend, the generic public response) carries no session identity.
// Neither touches tokenStore or the session — verifying an email changes no
// credential and the caller's session (if any) is left exactly as it was.
export function verifyEmail(token) {
  return api.post('/auth/verify-email', {
    auth: false,
    body: { token },
  });
}

export function resendVerification(email) {
  return api.post('/auth/resend-verification', {
    auth: false,
    body: { email },
  });
}

export function requestEmailChange({ newEmail, currentPassword }) {
  return api.post('/auth/email-change', { body: { newEmail, currentPassword } });
}

export function cancelEmailChange() {
  return api.post('/auth/email-change/cancel', { body: {} });
}

export function verifyEmailChange(token) {
  return api.post('/auth/email-change/verify', { auth: false, body: { token } });
}

export function deactivateAccount() {
  return api.post('/auth/deactivate', { body: { confirmation: 'DEACTIVATE' } });
}

// --- Google social login (B4.1 backend contract) ----------------------
//
// Two public, unauthenticated endpoints. The mobile app never sends a nonce,
// email, name, sub, role, status, audience, clientId, or userId — only the
// exact bodies below.
//
//   POST /auth/social/challenge  body { provider: 'google' }
//        -> { challengeId, nonce, expiresAt }
//   POST /auth/social/google     body { idToken, challengeId }
//        -> { user, accessToken, refreshToken }
//
// A 401 (AUTH_SOCIAL_CREDENTIAL_INVALID) from these `auth: false` calls does
// NOT trigger the WeCooked refresh+retry — the shared client only refreshes
// when `auth` is true (see client.js).

export function getSocialChallenge() {
  return api.post('/auth/social/challenge', {
    auth: false,
    body: { provider: 'google' },
  });
}

export async function googleLogin({ idToken, challengeId }) {
  const data = await api.post('/auth/social/google', {
    auth: false,
    body: { idToken, challengeId },
  });
  // Reuse the exact same session-establishment path as password login/register.
  return establishSession(data);
}

// --- Google account linking (B4.3A) ----------------------------------
//
// Account management for an ALREADY authenticated WeCooked user. Both calls go
// out with the normal bearer token (`auth` defaults to true), and neither
// touches the session:
//
//   POST /auth/social/challenge/link  body { provider: 'google' }
//        -> { challengeId, nonce, expiresAt }   (bound server-side to req.auth)
//   POST /auth/social/google/link     body { idToken, challengeId }
//        -> { user }                            (NO tokens in the response)
//
// The link challenge's owner is the authenticated backend principal — the app
// never sends, and could not choose, a userId.

export function getSocialLinkChallenge() {
  return api.post('/auth/social/challenge/link', {
    body: { provider: 'google' },
  });
}

/**
 * Attaches a Google identity to the current user and returns the updated
 * public user.
 *
 * Deliberately does NOT go through establishSession(): the backend issues no
 * tokens here and the caller's session must survive untouched, so this writes
 * neither the access token nor the refresh token and never clears the session.
 */
export async function linkGoogleAccount({ idToken, challengeId }) {
  const data = await api.post('/auth/social/google/link', {
    body: { idToken, challengeId },
  });
  return data.user;
}

export async function register({ name, email, password }) {
  // The backend issues a full session on registration (access + refresh token
  // in the response), so a successful register is also a sign-in.
  const data = await api.post('/auth/register', {
    auth: false,
    body: { name, email, password },
  });
  return establishSession(data);
}

// --- authenticated password change (Security screen) -------------------
//
//   POST /auth/change-password  body { currentPassword, newPassword }
//        -> { passwordChanged: true }
//
// Needs a valid access token (the shared client transparently refresh+retries
// once). The backend revokes EVERY session for this user on success — this
// device's tokens are dead the instant the response lands, so the caller must
// follow a success with AuthContext.signOut() rather than keep using the
// session. Deliberately not part of establishSession/endSession: it issues no
// tokens of its own.
export function changePassword({ currentPassword, newPassword }) {
  return api.post('/auth/change-password', {
    body: { currentPassword, newPassword },
  });
}

export async function logout() {
  const sessionRevision = getLocalSessionRevision();
  try {
    // Revokes just this session server-side. Needs a valid access token; the
    // shared client will transparently refresh+retry once if it has expired.
    await api.post('/auth/logout');
  } catch {
    // Best effort — local cleanup below must happen regardless of the result.
  }
  // Authoritative: local WeCooked session is now cleared. Provider-side (Google)
  // logout hygiene is not this module's concern — the React auth boundary
  // (AuthContext) triggers it best-effort, detached, after the state flip.
  return clearLocalSession(sessionRevision);
}

export async function logoutAll() {
  const sessionRevision = getLocalSessionRevision();
  try {
    await api.post('/auth/logout-all');
  } catch {
    // Best effort — see logout().
  }
  return clearLocalSession(sessionRevision);
}

// --- startup session restore ----------------------------------------

/**
 * Rebuilds the session from the persisted refresh token on app launch.
 * Returns the current user on success, or null (signed-out) otherwise.
 * On a definitive auth failure the stored token is cleared; on a transient
 * network failure it is left in place so a later attempt can succeed.
 */
export async function restoreSession() {
  const refreshToken = await tokenStore.getRefreshToken();
  if (!refreshToken) return null;

  const refreshed = await performRefresh();
  if (!refreshed) return null;

  try {
    return await fetchCurrentUser();
  } catch (err) {
    if (err instanceof ApiError && err.isNetworkError) {
      // Refresh succeeded and rotated; we just can't confirm identity right
      // now. Stay signed-out for this launch without discarding the token.
      return null;
    }
    await clearLocalSession();
    return null;
  }
}
