import React, { createContext, useContext, useEffect, useState } from 'react';
import { loadJSON, saveJSON, removeItem } from '../utils/storage';

const AUTH_KEY = 'wecooked:isLoggedIn';
const GUEST_KEY = 'wecooked:isGuest';
const ONBOARDED_KEY = 'wecooked:onboardingSeen';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isGuest, setIsGuest] = useState(false);
  const [onboardingSeen, setOnboardingSeen] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    (async () => {
      const [stored, guest, seen] = await Promise.all([
        loadJSON(AUTH_KEY, false),
        loadJSON(GUEST_KEY, false),
        loadJSON(ONBOARDED_KEY, false),
      ]);
      setIsLoggedIn(!!stored);
      setIsGuest(!!guest);
      setOnboardingSeen(!!seen);
      setIsReady(true);
    })();
  }, []);

  const login = async () => {
    setIsLoggedIn(true);
    setIsGuest(false);
    await Promise.all([saveJSON(AUTH_KEY, true), removeItem(GUEST_KEY)]);
  };

  // Browse-only entry — no account, no persisted sign-in.
  const continueAsGuest = async () => {
    setIsGuest(true);
    setIsLoggedIn(false);
    await Promise.all([saveJSON(GUEST_KEY, true), removeItem(AUTH_KEY)]);
  };

  const logout = async () => {
    setIsLoggedIn(false);
    setIsGuest(false);
    setOnboardingSeen(false);
    await Promise.all([removeItem(AUTH_KEY), removeItem(GUEST_KEY), removeItem(ONBOARDED_KEY)]);
  };

  const markOnboardingSeen = async () => {
    setOnboardingSeen(true);
    await saveJSON(ONBOARDED_KEY, true);
  };

  return (
    <AuthContext.Provider
      value={{
        isLoggedIn,
        isGuest,
        isReady,
        onboardingSeen,
        login,
        continueAsGuest,
        logout,
        markOnboardingSeen,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth() must be called from inside an <AuthProvider>');
  }
  return ctx;
}
