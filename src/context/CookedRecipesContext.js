import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { loadJSON, saveJSON } from '../utils/storage';

const STORAGE_KEY = 'wecooked:cookedRecipeIds';

const CookedRecipesContext = createContext(null);

export function CookedRecipesProvider({ children }) {
  const [cookedIds, setCookedIds] = useState(() => new Set());
  const hydrated = useRef(false);

  useEffect(() => {
    (async () => {
      const stored = await loadJSON(STORAGE_KEY, null);
      if (stored) setCookedIds(new Set(stored));
      hydrated.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    saveJSON(STORAGE_KEY, Array.from(cookedIds));
  }, [cookedIds]);

  const markCooked = (id) =>
    setCookedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });

  const hasCooked = (id) => cookedIds.has(id);

  const value = useMemo(
    () => ({ cookedIds, markCooked, hasCooked, cookedCount: cookedIds.size }),
    [cookedIds]
  );

  return (
    <CookedRecipesContext.Provider value={value}>{children}</CookedRecipesContext.Provider>
  );
}

export function useCookedRecipes() {
  const ctx = useContext(CookedRecipesContext);
  if (!ctx) throw new Error('useCookedRecipes() must be called from inside a <CookedRecipesProvider>');
  return ctx;
}
