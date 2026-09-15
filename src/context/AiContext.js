import React, { createContext, useContext, useEffect, useState } from 'react';
import { loadJSON, saveJSON, removeItem } from '../utils/storage';

// The optional OpenAI API key that upgrades "Ask the Chef" from rule-based
// to a real model. Two ways to provide it:
//   1. EXPO_PUBLIC_OPENAI_API_KEY in .env  — baked in at build time
//   2. pasted in-app (Settings → Intelligence) — stored only on this device
// A device key wins over the .env one.
const KEY = 'wecooked:openaiKey';
const ENV_KEY = (process.env.EXPO_PUBLIC_OPENAI_API_KEY || '').trim();

// A real OpenAI key starts with "sk-" (classic or "sk-proj-..." project
// keys) and is at least ~24 chars after that. This rejects blanks and
// leftover placeholders so a bad value silently keeps the built-in
// assistant instead of firing failing requests every message.
export function looksLikeApiKey(k) {
  return typeof k === 'string' && /^sk-\S{20,}$/.test(k.trim());
}

const AiContext = createContext(null);

export function AiProvider({ children }) {
  const [deviceKey, setDeviceKey] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const stored = await loadJSON(KEY, '');
      setDeviceKey(typeof stored === 'string' ? stored : '');
      setReady(true);
    })();
  }, []);

  // Only treat a key as usable if it's well-formed.
  const deviceKeyValid = looksLikeApiKey(deviceKey);
  const envKeyValid = looksLikeApiKey(ENV_KEY);
  const apiKey = deviceKeyValid ? deviceKey.trim() : envKeyValid ? ENV_KEY : '';
  const keySource = deviceKeyValid ? 'device' : envKeyValid ? 'env' : null;

  const setApiKey = async (next) => {
    const v = (next || '').trim();
    setDeviceKey(v);
    if (v) await saveJSON(KEY, v);
    else await removeItem(KEY);
  };

  return (
    <AiContext.Provider
      value={{
        apiKey,
        deviceKey,
        hasKey: !!apiKey,
        keySource,
        hasEnvKey: envKeyValid,
        ready,
        setApiKey,
      }}
    >
      {children}
    </AiContext.Provider>
  );
}

export function useAi() {
  const ctx = useContext(AiContext);
  if (!ctx) throw new Error('useAi() must be called from inside an <AiProvider>');
  return ctx;
}
