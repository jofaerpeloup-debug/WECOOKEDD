import React, { createContext, useContext, useEffect, useState } from 'react';
import { loadJSON, saveJSON, removeItem } from '../utils/storage';

const AUTH_KEY = 'wecooked:isLoggedIn';
const ONBOARDED_KEY = 'wecooked:onboardingSeen';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [onboardingSeen, setOnboardingSeen] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    (async () => {
      const [stored, seen] = await Promise.all([
        loadJSON(AUTH_KEY, false),
        loadJSON(ONBOARDED_KEY, false),
      ]);
      setIsLoggedIn(!!stored);
      setOnboardingSeen(!!seen);
      setIsReady(true);
    })();
  }, []);

  const login = async () => {
    setIsLoggedIn(true);
    await saveJSON(AUTH_KEY, true);
  };

  const logout = async () => {
    setIsLoggedIn(false);
    setOnboardingSeen(false);
    await Promise.all([removeItem(AUTH_KEY), removeItem(ONBOARDED_KEY)]);
  };

  const markOnboardingSeen = async () => {
    setOnboardingSeen(true);
    await saveJSON(ONBOARDED_KEY, true);
  };

  return (
    <AuthContext.Provider
      value={{ isLoggedIn, isReady, onboardingSeen, login, logout, markOnboardingSeen }}
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
