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

  // Reconcile the context with a server-authoritative public-user payload that
  // a self-mutation already returned (PATCH /users/me responds with the same
  // `toPublicUser` shape as GET /users/me — no follow-up read is needed). This
  // is NOT a general-purpose setter: the functional update only installs the
  // payload when it belongs to the SAME still-authenticated user, so a profile
  // write that resolves after a sign-out or a user switch is ignored.
  const syncUser = useCallback((nextUser) => {
    if (!mountedRef.current) return;
    setUser((prev) => (prev && nextUser && prev.id === nextUser.id ? nextUser : prev));
  }, []);

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
    syncUser,
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
