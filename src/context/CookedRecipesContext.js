import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { loadJSON, saveJSON } from '../utils/storage';

const STORAGE_KEY = 'wecooked:cookedRecipeIds';
const HISTORY_KEY = 'wecooked:cookedHistory';
const MAX_HISTORY = 200;

let seq = 0;
const genId = () => `ch-${Date.now()}-${seq++}`;

const CookedRecipesContext = createContext(null);

export function CookedRecipesProvider({ children }) {
  const [cookedIds, setCookedIds] = useState(() => new Set());
  // Every finished cook, most-recent-first — a log, distinct from `cookedIds`
  // (a one-time "have I ever cooked this" set used elsewhere for badges).
  // Repeats of the same recipe each get their own entry here.
  const [history, setHistory] = useState([]);
  const hydrated = useRef(false);

  useEffect(() => {
    (async () => {
      const [ids, hist] = await Promise.all([
        loadJSON(STORAGE_KEY, null),
        loadJSON(HISTORY_KEY, null),
      ]);
      const idSet = ids ? new Set(ids) : new Set();
      let finalHistory = Array.isArray(hist) ? hist : [];

      // One-time backfill: `cookedIds` predates this history log, so a
      // recipe marked cooked before the log existed has no matching entry
      // — it would otherwise count toward `cookedCount` while silently
      // missing from the visible history. Give it a placeholder entry
      // (ts: null, shown as "Earlier") appended at the end rather than
      // vanishing.
      const known = new Set(finalHistory.map((h) => h.recipeId));
      const missingIds = Array.from(idSet).filter((id) => !known.has(id));
      if (missingIds.length) {
        finalHistory = [...finalHistory, ...missingIds.map((id) => ({ id: genId(), recipeId: id, ts: null }))];
      }

      setCookedIds(idSet);
      setHistory(finalHistory);
      hydrated.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    saveJSON(STORAGE_KEY, Array.from(cookedIds));
  }, [cookedIds]);

  useEffect(() => {
    if (!hydrated.current) return;
    saveJSON(HISTORY_KEY, history);
  }, [history]);

  const markCooked = (id) => {
    setCookedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    setHistory((prev) => [{ id: genId(), recipeId: id, ts: Date.now() }, ...prev].slice(0, MAX_HISTORY));
  };

  const hasCooked = (id) => cookedIds.has(id);

  const value = useMemo(
    () => ({ cookedIds, markCooked, hasCooked, cookedCount: cookedIds.size, history }),
    [cookedIds, history]
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
