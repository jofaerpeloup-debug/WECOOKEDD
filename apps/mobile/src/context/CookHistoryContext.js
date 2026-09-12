import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { useAuth } from './AuthContext';
import * as cookHistoryService from '../api/cookHistoryService';
import { getCookHistoryErrorMessage } from '../api/cookHistoryErrors';

// ---------------------------------------------------------------------------
// The SINGLE authoritative Cook History stats state — backs Profile's real
// "Cooked" number (uniqueRecipesCooked; see ProfileScreen.js).
//
//   CookModeScreen (Finish)  -> recordCompletion() -\
//                                                     -> cookHistoryService -> /api/v1/cook-history(/stats) -> MongoDB
//   ProfileScreen (read)     -> stats               -/
//
// Deliberately smaller than FavoritesContext: there is no list to page or
// optimistically toggle, only one small stats object to fetch and refresh.
// Ownership still mirrors FavoritesContext/AuthContext exactly — `ownerId` is
// bumped on every auth identity change, and `stats` reads as unavailable
// (null) for any render where the loaded data doesn't belong to the current
// user, so a sign-out or account switch can never show the previous user's
// Cooked count for even one frame.
// ---------------------------------------------------------------------------

const CookHistoryContext = createContext(null);

export function CookHistoryProvider({ children }) {
  const { status: authStatus, user } = useAuth();
  const authUserId = authStatus === 'authenticated' && user ? user.id : null;

  const [stats, setStats] = useState(null);
  const [ownerId, setOwnerId] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [error, setError] = useState(null);

  const mountedRef = useRef(true);
  const sessionRef = useRef(0); // bumped ONLY on auth/user identity change
  const authUserIdRef = useRef(authUserId);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadStats = useCallback(async (session) => {
    const stale = () => session !== sessionRef.current || !mountedRef.current;
    try {
      const fresh = await cookHistoryService.getStats();
      if (stale()) return;
      setStats(fresh);
      setError(null);
      setStatus('ready');
    } catch (err) {
      if (stale()) return;
      setError(getCookHistoryErrorMessage(err));
      setStatus('error');
    }
  }, []);

  // react to auth: wipe the previous user's stats, then load the current one.
  useEffect(() => {
    authUserIdRef.current = authUserId;
    sessionRef.current += 1;
    const session = sessionRef.current;

    setStats(null);
    setError(null);
    setOwnerId(authUserId);

    if (!authUserId) {
      setStatus('idle');
      return;
    }

    setStatus('loading');
    loadStats(session);
  }, [authUserId, loadStats]);

  // Manual reload (e.g. Profile screen focus) — reuses the current session,
  // so it is safely a no-op if the user has already signed out.
  const refreshStats = useCallback(() => {
    if (!authUserIdRef.current) return Promise.resolve();
    return loadStats(sessionRef.current);
  }, [loadStats]);

  // Records one real CookMode completion, then refreshes stats from the
  // server so Profile's Cooked metric picks it up immediately. Never
  // computes the new count locally — the server is the sole source of truth
  // for totalCooks/uniqueRecipesCooked.
  const recordCompletion = useCallback(
    async ({ recipeId, servings }) => {
      const created = await cookHistoryService.recordCompletion({ recipeId, servings });
      await refreshStats();
      return created;
    },
    [refreshStats]
  );

  const trusted = !!authUserId && ownerId === authUserId;
  const effectiveStatus = !authUserId ? 'idle' : trusted ? status : 'loading';

  const value = {
    stats: trusted && effectiveStatus === 'ready' ? stats : null,
    status: effectiveStatus, // 'idle' | 'loading' | 'ready' | 'error'
    error: trusted ? error : null,
    isInitializing: effectiveStatus === 'idle' || effectiveStatus === 'loading',
    refreshStats,
    recordCompletion,
  };

  return <CookHistoryContext.Provider value={value}>{children}</CookHistoryContext.Provider>;
}

export function useCookHistory() {
  const ctx = useContext(CookHistoryContext);
  if (!ctx) {
    throw new Error('useCookHistory() must be called from inside a <CookHistoryProvider>');
  }
  return ctx;
}
