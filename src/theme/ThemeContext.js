import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { lightColors, darkColors, typography, spacing, radius, buildShadow } from './theme';
import { loadJSON, saveJSON } from '../utils/storage';

const ThemeContext = createContext(null);
const MODE_KEY = 'wecooked:themeMode';

// mode: 'light' | 'dark' — an explicit choice only. No "System" option: the
// app doesn't follow the OS appearance, it remembers whatever you picked in
// Settings (persisted across launches).
export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState('light');

  useEffect(() => {
    (async () => {
      const stored = await loadJSON(MODE_KEY, null);
      if (stored === 'light' || stored === 'dark') setModeState(stored);
    })();
  }, []);

  const setMode = (next) => {
    const v = next === 'dark' ? 'dark' : 'light';
    setModeState(v);
    saveJSON(MODE_KEY, v);
  };

  const isDark = mode === 'dark';
  const colors = isDark ? darkColors : lightColors;

  const value = useMemo(
    () => ({
      mode,
      setMode,
      isDark,
      colors,
      typography,
      spacing,
      radius,
      shadow: buildShadow(colors),
    }),
    [mode, isDark, colors]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme() must be called from inside a <ThemeProvider>');
  }
  return ctx;
}
