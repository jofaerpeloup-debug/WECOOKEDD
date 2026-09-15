// Backend local-auth session for the Staff Portal.
//
// This is the authoritative gate for the dashboard and for every WeCooked REST
// API call: register/login establishes the session, GET /api/v1/users/me keeps
// the current backend identity available, and /staff/me determines the portal
// destination. A client-supplied role is never sent or trusted.
//
// Token handling in this development slice (see
// docs/architecture/admin-api-integration.md — "temporary compromises"):
//   - access token: in memory only (module scope), never persisted.
//   - refresh token: kept in memory, and mirrored to sessionStorage so a page
//     reload can restore the session instead of forcing re-login. sessionStorage
//     (not localStorage) is per-tab and cleared when the tab closes. The
//     long-term target is an HttpOnly Secure refresh cookie — that is a later
//     auth-hardening task and is intentionally NOT implemented here.

import { useCallback, useEffect, useState } from 'react';
import { api, setAuthAdapter } from './apiClient.js';
import { registrationPayload } from './staffContracts.js';

const REFRESH_STORAGE_KEY = 'wecooked.admin.refreshToken';

let accessToken = null;
let refreshToken = null;
let refreshInFlight = null;
// Set by the active useBackendAuth() hook so a hard session failure (refresh
// rejected) can flip the UI back to the sign-in screen.
let onSessionExpired = null;

function readStoredRefreshToken() {
  try {
    return window.sessionStorage.getItem(REFRESH_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function writeStoredRefreshToken(token) {
  try {
    if (token) window.sessionStorage.setItem(REFRESH_STORAGE_KEY, token);
    else window.sessionStorage.removeItem(REFRESH_STORAGE_KEY);
  } catch {
    // Storage unavailable (private mode, disabled) — the session just won't
    // survive a reload. Not fatal.
  }
}

function setTokens(tokens) {
  accessToken = tokens?.accessToken || null;
  refreshToken = tokens?.refreshToken || null;
  writeStoredRefreshToken(refreshToken);
}

function clearTokens() {
  accessToken = null;
  refreshToken = null;
  writeStoredRefreshToken(null);
}

// Single-flight refresh. The backend ROTATES the refresh token, so two
// concurrent 401s must not both POST /auth/refresh — the second would present
// an already-consumed token and fail, tearing down an otherwise-valid session.
// `refreshInFlight` is checked and set synchronously (no `await` between the
// check and the assignment), so concurrent callers deterministically share the
// one in-flight promise; whoever wins starts it, everyone else awaits it and
// then retries with the freshly-set access token. Resolves true on success,
// false on failure (which clears the session exactly once).
async function performRefresh() {
  if (!refreshInFlight) {
    const current = refreshToken || readStoredRefreshToken();
    if (!current) return false;

    refreshInFlight = (async () => {
      try {
        const data = await api.post('/auth/refresh', {
          auth: false,
          body: { refreshToken: current },
        });
        setTokens(data);
        return true;
      } catch {
        clearTokens();
        if (onSessionExpired) onSessionExpired();
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

setAuthAdapter({
  getAccessToken: () => accessToken,
  refreshAccessToken: performRefresh,
});

async function loginRequest(email, password) {
  const data = await api.post('/auth/login', {
    auth: false,
    body: { email, password },
  });
  setTokens(data);
  return data.user;
}

async function registerRequest(details) {
  const data = await api.post('/auth/register', {
    auth: false,
    body: registrationPayload(details),
  });
  setTokens(data);
  return data.user;
}

async function logoutRequest() {
  try {
    await api.post('/auth/logout');
  } catch {
    // Best effort — the session is being discarded client-side regardless.
  }
  clearTokens();
}

function fetchCurrentUser() {
  return api.get('/users/me').then((data) => data.user);
}

// Rebuild a session from a persisted refresh token after a page reload.
async function restoreSession() {
  if (!readStoredRefreshToken()) return null;
  const refreshed = await performRefresh();
  if (!refreshed) return null;
  try {
    return await fetchCurrentUser();
  } catch {
    clearTokens();
    return null;
  }
}

/**
 * The one backend-auth entry point for React. Exposes:
 *   status: "checking" | "anonymous" | "authenticated"
 *   user:   backend user object (id, name, email, role, status, ...) | null
 *   login / logout / refreshUser
 */
export function useBackendAuth() {
  const [status, setStatus] = useState('checking');
  const [user, setUser] = useState(null);

  useEffect(() => {
    let cancelled = false;

    onSessionExpired = () => {
      if (cancelled) return;
      setUser(null);
      setStatus('anonymous');
    };

    (async () => {
      const restored = await restoreSession();
      if (cancelled) return;
      if (restored) {
        setUser(restored);
        setStatus('authenticated');
      } else {
        setUser(null);
        setStatus('anonymous');
      }
    })();

    return () => {
      cancelled = true;
      onSessionExpired = null;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const userFromLogin = await loginRequest(email, password);
    // Derive admin access from a fresh backend read rather than only the login
    // response body.
    let currentUser = userFromLogin;
    try {
      currentUser = await fetchCurrentUser();
    } catch {
      // Keep the login-response user if /users/me is briefly unavailable.
    }
    setUser(currentUser);
    setStatus('authenticated');
    return currentUser;
  }, []);

  const register = useCallback(async (details) => {
    const registeredUser = await registerRequest(details);
    setUser(registeredUser);
    setStatus('authenticated');
    return registeredUser;
  }, []);

  const logout = useCallback(async () => {
    await logoutRequest();
    setUser(null);
    setStatus('anonymous');
  }, []);

  const refreshUser = useCallback(async () => {
    const fresh = await fetchCurrentUser();
    setUser(fresh);
    return fresh;
  }, []);

  return { status, user, login, register, logout, refreshUser };
}
