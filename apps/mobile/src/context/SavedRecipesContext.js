import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { recipes, savedRecipeIds } from '../data/mockData';
import { loadJSON, saveJSON } from '../utils/storage';

const STORAGE_KEY = 'wecooked:savedRecipeIds';

const SavedRecipesContext = createContext(null);

export function SavedRecipesProvider({ children }) {
  const [savedIds, setSavedIds] = useState(() => new Set(savedRecipeIds));
  const hydrated = useRef(false);

  useEffect(() => {
    (async () => {
      const stored = await loadJSON(STORAGE_KEY, null);
      if (stored) setSavedIds(new Set(stored));
      hydrated.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    saveJSON(STORAGE_KEY, Array.from(savedIds));
  }, [savedIds]);

  const toggleSaved = (id) => {
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const isSaved = (id) => savedIds.has(id);

  const savedRecipes = useMemo(
    () => recipes.filter((r) => savedIds.has(r.id)),
    [savedIds]
  );

  const value = useMemo(
    () => ({ savedIds, toggleSaved, isSaved, savedRecipes }),
    [savedIds, savedRecipes]
  );

  return (
    <SavedRecipesContext.Provider value={value}>{children}</SavedRecipesContext.Provider>
  );
}

export function useSavedRecipes() {
  const ctx = useContext(SavedRecipesContext);
  if (!ctx) {
    throw new Error('useSavedRecipes() must be called from inside a <SavedRecipesProvider>');
  }
  return ctx;
}
