import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useColorScheme } from 'react-native';
import { lightColors, darkColors, typography, spacing, radius, buildShadow } from './theme';
import { loadJSON, saveJSON } from '../utils/storage';

const ThemeContext = createContext(null);
const THEME_MODE_KEY = 'wecooked:themeMode';
const VALID_MODES = ['system', 'light', 'dark'];

// mode: 'system' | 'light' | 'dark' — 'system' follows the OS setting via
// useColorScheme() and updates live if the user flips their phone's
// appearance while the app is open.
export function ThemeProvider({ children }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState('system');
  const selectedDuringHydration = useRef(false);
  const writeQueue = useRef(Promise.resolve());

  useEffect(() => {
    let active = true;
    loadJSON(THEME_MODE_KEY, 'system').then((stored) => {
      if (active && !selectedDuringHydration.current && VALID_MODES.includes(stored)) {
        setModeState(stored);
      }
    });
    return () => { active = false; };
  }, []);

  const setMode = useCallback((next) => {
    if (!VALID_MODES.includes(next)) return;
    selectedDuringHydration.current = true;
    setModeState(next);
    writeQueue.current = writeQueue.current.then(() => saveJSON(THEME_MODE_KEY, next));
  }, []);

  const resolvedScheme = mode === 'system' ? systemScheme || 'light' : mode;
  const isDark = resolvedScheme === 'dark';
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
    [mode, isDark, colors, setMode]
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
