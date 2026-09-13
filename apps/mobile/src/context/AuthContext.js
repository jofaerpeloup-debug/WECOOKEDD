import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as authService from '../api/authService';
import * as googleAuthFlow from '../auth/googleAuthFlow';

// Single source of truth for auth/session state. Three states:
//   'restoring'      — app just launched, trying to rebuild a session
//   'authenticated'  — backend session is live, `user` is the /users/me payload
//   'unauthenticated'— no session (never had one, signed out, or session ended)
//
// The access token lives in memory in authService; the refresh token lives in
// SecureStore. This context holds none of that — only the derived state and
// the authoritative backend `user` object.

const AuthContext = createContext(null);

/**
 * Identity-guarded reconciliation of a server-authoritative public-user
 * payload into the currently held user. Installs `nextUser` ONLY when it
 * belongs to the same still-authenticated user, so a write that resolves after
 * a sign-out or a user switch is ignored rather than switching the session.
 * Exported so the rule itself can be asserted directly, without standing up a
 * provider.
 */
export function reconcileUser(prev, nextUser) {
  return prev && nextUser && prev.id === nextUser.id ? nextUser : prev;
}

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('restoring');
  const [user, setUser] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    // A refresh rejected mid-session (expired/revoked) flips us to signed-out.
    authService.setOnSessionExpired(() => {
      if (!mountedRef.current) return;
      setUser(null);
      setStatus('unauthenticated');
    });

    (async () => {
      try {
        const restored = await authService.restoreSession();
        if (!mountedRef.current) return;
        if (restored) {
          setUser(restored);
          setStatus('authenticated');
        } else {
          setUser(null);
          setStatus('unauthenticated');
        }
      } catch {
        if (!mountedRef.current) return;
        setUser(null);
        setStatus('unauthenticated');
      }
    })();

    return () => {
      mountedRef.current = false;
      authService.setOnSessionExpired(null);
    };
  }, []);

  const signIn = useCallback(async ({ email, password }) => {
    const u = await authService.login({ email, password });
    if (mountedRef.current) {
      setUser(u);
      setStatus('authenticated');
    }
    return u;
  }, []);

  // Google sign-in. All orchestration (single-flight, challenge, native call,
  // backend exchange) lives in googleAuthFlow; this context only reconciles the
  // authoritative user it returns into auth state — exactly like signIn(). No
  // nonce / challengeId / Google idToken / Google profile is held here.
  const signInWithGoogle = useCallback(async () => {
    const u = await googleAuthFlow.signInWithGoogle();
    if (mountedRef.current) {
      setUser(u);
      setStatus('authenticated');
    }
    return u;
  }, []);

  const signUp = useCallback(async ({ name, email, password }) => {
    const u = await authService.register({ name, email, password });
    if (mountedRef.current) {
      setUser(u);
      setStatus('authenticated');
    }
    return u;
  }, []);

  const signOut = useCallback(async () => {
    await authService.logout();
    if (mountedRef.current) {
      setUser(null);
      setStatus('unauthenticated');
    }
    // Best-effort Google provider cleanup, AFTER the auth-state flip and
    // deliberately NOT awaited — a slow/hung native clear must never delay
    // visible logout. clearNativeState never throws.
    void googleAuthFlow.clearNativeState();
  }, []);

  const signOutEverywhere = useCallback(async () => {
    await authService.logoutAll();
    if (mountedRef.current) {
      setUser(null);
      setStatus('unauthenticated');
    }
    void googleAuthFlow.clearNativeState();
  }, []);

  const refreshUser = useCallback(async () => {
    const u = await authService.fetchCurrentUser();
    if (mountedRef.current) setUser(u);
    return u;
  }, []);

  // Ends the session LOCALLY only — no /auth/logout call. Used after a
  // password reset: the backend already revoked every session for the
  // account as part of the reset itself, so a device that happened to be
  // signed in (an edge case — the ordinary path is opening the reset link
  // signed out) must stop appearing authenticated, but hitting /auth/logout
  // again would just be a pointless request against an already-dead session.
  // A no-op if there was no local session to begin with.
  const endLocalSession = useCallback(async () => {
    await authService.clearLocalSession();
    if (mountedRef.current) {
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  // Reconcile the context with a server-authoritative public-user payload that
  // a self-mutation already returned (PATCH /users/me responds with the same
  // `toPublicUser` shape as GET /users/me — no follow-up read is needed). This
  // is NOT a general-purpose setter: see reconcileUser above.
  const syncUser = useCallback((nextUser) => {
    if (!mountedRef.current) return;
    setUser((prev) => reconcileUser(prev, nextUser));
  }, []);

  // Google ACCOUNT LINKING — not a sign-in. The backend attaches the verified
  // Google identity to the already-authenticated user and returns the updated
  // public user with no tokens, so this deliberately does not touch `status`
  // and does not setUser() directly: the updated payload (including its
  // `authIdentities`) goes through the same identity-guarded syncUser as any
  // other self-mutation, which keeps the active user's identity unchanged.
  //
  // Resolves with NOTHING, on purpose. A sign-out or user switch can land while
  // the link is in flight, and syncUser then refuses to install the payload —
  // returning it anyway would hand the caller a user object this context
  // rejected, which they could render as "the current linked account". Success
  // is the absence of a rejection; the linked state is read from `user` like
  // every other piece of auth state, so AuthContext stays the sole authority.
  // Headless — callers own their own UI state.
  const linkGoogle = useCallback(async () => {
    syncUser(await googleAuthFlow.linkGoogleAccount());
  }, [syncUser]);

  const value = {
    status,
    user,
    isReady: status !== 'restoring',
    isLoggedIn: status === 'authenticated',
    signIn,
    signInWithGoogle,
    signUp,
    signOut,
    signOutEverywhere,
    refreshUser,
    endLocalSession,
    syncUser,
    linkGoogle,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth() must be called from inside an <AuthProvider>');
  }
  return ctx;
}
