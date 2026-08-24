import React, { createContext, useContext, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { lightColors, darkColors, typography, spacing, radius, buildShadow } from './theme';

const ThemeContext = createContext(null);

// mode: 'system' | 'light' | 'dark' — 'system' follows the OS setting via
// useColorScheme() and updates live if the user flips their phone's
// appearance while the app is open.
export function ThemeProvider({ children }) {
  const systemScheme = useColorScheme();
  const [mode, setMode] = useState('system');

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
