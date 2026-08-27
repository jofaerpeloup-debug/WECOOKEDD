// Backend auth/session orchestration for the mobile app.
//
// Wraps the auth endpoints and owns token rotation + concurrency. The React
// layer (AuthContext) calls the exported functions and never touches
// tokenStore or client directly.
//
// Endpoints consumed (all under /api/v1):
//   POST /auth/register   -> { user, accessToken, refreshToken }
//   POST /auth/login      -> { user, accessToken, refreshToken }
//   POST /auth/refresh    -> { accessToken, refreshToken }        (rotating; no user)
//   POST /auth/logout     -> { loggedOut: true }                  (needs access token)
//   POST /auth/logout-all -> { revokedCount }                     (needs access token)
//   GET  /users/me        -> { user }                             (authoritative identity)

import { api, setAuthAdapter, ApiError } from './client';
import * as tokenStore from './tokenStore';

// Notifies the React layer that the session ended non-interactively (a refresh
// was definitively rejected). Set by AuthContext while mounted.
let onSessionExpired = null;

export function setOnSessionExpired(fn) {
  onSessionExpired = typeof fn === 'function' ? fn : null;
}

async function applyTokens(tokens) {
  tokenStore.setAccessToken(tokens?.accessToken || null);
  return tokenStore.setRefreshToken(tokens?.refreshToken || null);
}

// Ends the session and notifies the React layer exactly once.
async function endSession() {
  await tokenStore.clearSession();
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
    await tokenStore.clearSession();
    throw new ApiError('Refresh token could not be persisted to secure storage.', {
      code: SESSION_PERSIST_FAILED,
    });
  }
  // /users/me is authoritative for identity/session state; fall back to the
  // auth-response user only if that follow-up read is briefly unavailable.
  try {
    return await fetchCurrentUser();
  } catch {
    return data.user;
  }
}

export async function login({ email, password }) {
  const data = await api.post('/auth/login', {
    auth: false,
    body: { email, password },
  });
  return establishSession(data);
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

export async function logout() {
  try {
    // Revokes just this session server-side. Needs a valid access token; the
    // shared client will transparently refresh+retry once if it has expired.
    await api.post('/auth/logout');
  } catch {
    // Best effort — local cleanup below must happen regardless of the result.
  }
  await tokenStore.clearSession();
}

export async function logoutAll() {
  try {
    await api.post('/auth/logout-all');
  } catch {
    // Best effort — see logout().
  }
  await tokenStore.clearSession();
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
    await tokenStore.clearSession();
    return null;
  }
}
