import React, { createContext, useContext, useEffect, useState } from 'react';
import { loadJSON, saveJSON, removeItem } from '../utils/storage';

const AUTH_KEY = 'wecooked:isLoggedIn';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    (async () => {
      const stored = await loadJSON(AUTH_KEY, false);
      setIsLoggedIn(!!stored);
      setIsReady(true);
    })();
  }, []);

  const login = async () => {
    setIsLoggedIn(true);
    await saveJSON(AUTH_KEY, true);
  };

  const logout = async () => {
    setIsLoggedIn(false);
    await removeItem(AUTH_KEY);
  };

  return (
    <AuthContext.Provider value={{ isLoggedIn, isReady, login, logout }}>
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
