import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as authService from '../api/authService';
import * as googleAuthFlow from '../auth/googleAuthFlow';
import { runBeforePushLogout } from '../notifications/nativePushLifecycle';

const AuthContext = createContext(null);

export function reconcileUser(prev, nextUser) {
  return prev && nextUser && prev.id === nextUser.id ? nextUser : prev;
}

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('restoring');
  const [user, setUser] = useState(null);
  const [sessionIdentity, setSessionIdentity] = useState({
    ownerId: null,
    generation: 0,
    localSessionRevision: authService.getLocalSessionRevision(),
  });
  const mountedRef = useRef(true);
  const authStateRef = useRef({ ownerId: null, generation: 0 });

  const captureSession = useCallback(() => ({
    ownerId: authStateRef.current.ownerId,
    generation: authStateRef.current.generation,
    localSessionRevision: authService.getLocalSessionRevision(),
  }), []);

  const ownsAuthState = useCallback((session) => (
    session
    && authStateRef.current.ownerId === session.ownerId
    && authStateRef.current.generation === session.generation
  ), []);

  const ownsSession = useCallback((session) => (
    ownsAuthState(session)
    && authService.getLocalSessionRevision() === session.localSessionRevision
  ), [ownsAuthState]);

  const installAuthState = useCallback((nextUser, nextStatus) => {
    const nextIdentity = {
      ownerId: nextUser?.id || null,
      generation: authStateRef.current.generation + 1,
      localSessionRevision: authService.getLocalSessionRevision(),
    };
    authStateRef.current = nextIdentity;
    setSessionIdentity(nextIdentity);
    setUser(nextUser);
    setStatus(nextStatus);
  }, []);

  const cleanPushForSession = useCallback(async (session, options = {}) => {
    if (!ownsSession(session)) return false;
    let timeoutId;
    try {
      await Promise.race([
        runBeforePushLogout(options),
        new Promise((resolve) => { timeoutId = setTimeout(resolve, 1500); }),
      ]);
    } catch { /* Push cleanup is best effort and cannot block auth teardown. */ }
    finally { clearTimeout(timeoutId); }
    return ownsSession(session);
  }, [ownsSession]);

  useEffect(() => {
    mountedRef.current = true;
    authService.setOnSessionExpired(() => {
      if (!mountedRef.current) return;
      void runBeforePushLogout({ localOnly: true }).catch(() => {});
      installAuthState(null, 'unauthenticated');
    });

    (async () => {
      try {
        const restored = await authService.restoreSession();
        if (!mountedRef.current) return;
        installAuthState(restored || null, restored ? 'authenticated' : 'unauthenticated');
      } catch {
        if (mountedRef.current) installAuthState(null, 'unauthenticated');
      }
    })();

    return () => {
      mountedRef.current = false;
      authService.setOnSessionExpired(null);
    };
  }, [installAuthState]);

  const signIn = useCallback(async ({ email, password }) => {
    const nextUser = await authService.login({ email, password });
    if (mountedRef.current) installAuthState(nextUser, 'authenticated');
    return nextUser;
  }, [installAuthState]);

  const signInWithGoogle = useCallback(async () => {
    const nextUser = await googleAuthFlow.signInWithGoogle();
    if (mountedRef.current) installAuthState(nextUser, 'authenticated');
    return nextUser;
  }, [installAuthState]);

  const signUp = useCallback(async ({ name, email, password }) => {
    const nextUser = await authService.register({ name, email, password });
    if (mountedRef.current) installAuthState(nextUser, 'authenticated');
    return nextUser;
  }, [installAuthState]);

  const signOut = useCallback(async () => {
    const session = captureSession();
    const cleaned = await cleanPushForSession(session);
    if (!cleaned || !ownsSession(session)) return;
    const cleared = await authService.logout();
    if (cleared && mountedRef.current && ownsAuthState(session)) {
      installAuthState(null, 'unauthenticated');
      void googleAuthFlow.clearNativeState();
    }
  }, [captureSession, cleanPushForSession, installAuthState, ownsAuthState, ownsSession]);

  const signOutEverywhere = useCallback(async () => {
    const session = captureSession();
    const cleaned = await cleanPushForSession(session);
    if (!cleaned || !ownsSession(session)) return;
    const cleared = await authService.logoutAll();
    if (cleared && mountedRef.current && ownsAuthState(session)) {
      installAuthState(null, 'unauthenticated');
      void googleAuthFlow.clearNativeState();
    }
  }, [captureSession, cleanPushForSession, installAuthState, ownsAuthState, ownsSession]);

  const refreshUser = useCallback(async () => {
    const nextUser = await authService.fetchCurrentUser();
    if (mountedRef.current) setUser((prev) => reconcileUser(prev, nextUser));
    return nextUser;
  }, []);

  const endLocalSession = useCallback(async (
    session = captureSession(),
    { cleanPush = true } = {}
  ) => {
    if (!ownsSession(session)) return false;
    if (cleanPush && !(await cleanPushForSession(session, { localOnly: true }))) return false;
    const cleared = await authService.clearLocalSession(session.localSessionRevision);
    if (!cleared || !mountedRef.current || !ownsAuthState(session)) return false;
    installAuthState(null, 'unauthenticated');
    return true;
  }, [captureSession, cleanPushForSession, installAuthState, ownsAuthState, ownsSession]);

  const verifyEmailChange = useCallback(async (token) => {
    const session = captureSession();
    const cleaned = await cleanPushForSession(session);
    if (!cleaned || !ownsSession(session)) {
      throw new Error('Authentication session changed during email verification.');
    }
    const result = await authService.verifyEmailChange(token);
    await endLocalSession(session, { cleanPush: false });
    return result;
  }, [captureSession, cleanPushForSession, endLocalSession, ownsSession]);

  const deactivate = useCallback(async () => {
    const session = captureSession();
    const cleaned = await cleanPushForSession(session);
    if (!cleaned || !ownsSession(session)) return;
    await authService.deactivateAccount();
    if (await endLocalSession(session, { cleanPush: false })) {
      void googleAuthFlow.clearNativeState();
    }
  }, [captureSession, cleanPushForSession, endLocalSession, ownsSession]);

  const syncUser = useCallback((nextUser) => {
    if (!mountedRef.current) return;
    setUser((prev) => reconcileUser(prev, nextUser));
  }, []);

  const linkGoogle = useCallback(async () => {
    syncUser(await googleAuthFlow.linkGoogleAccount());
  }, [syncUser]);

  const value = {
    status,
    sessionIdentity,
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
    captureSession,
    verifyEmailChange,
    deactivate,
    syncUser,
    linkGoogle,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() must be called from inside an <AuthProvider>');
  return ctx;
}
