import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { loadJSON, saveJSON } from '../utils/storage';

const STORAGE_KEY = 'wecooked:recentlyViewedIds';
const MAX_ITEMS = 12;

const RecentlyViewedContext = createContext(null);

export function RecentlyViewedProvider({ children }) {
  const [recentIds, setRecentIds] = useState([]);
  const hydrated = useRef(false);

  useEffect(() => {
    (async () => {
      const stored = await loadJSON(STORAGE_KEY, null);
      if (stored) setRecentIds(stored);
      hydrated.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    saveJSON(STORAGE_KEY, recentIds);
  }, [recentIds]);

  const addRecentlyViewed = (id) =>
    setRecentIds((prev) => [id, ...prev.filter((x) => x !== id)].slice(0, MAX_ITEMS));

  const clearRecentlyViewed = () => setRecentIds([]);

  const value = useMemo(
    () => ({ recentIds, addRecentlyViewed, clearRecentlyViewed }),
    [recentIds]
  );

  return (
    <RecentlyViewedContext.Provider value={value}>{children}</RecentlyViewedContext.Provider>
  );
}

export function useRecentlyViewed() {
  const ctx = useContext(RecentlyViewedContext);
  if (!ctx) throw new Error('useRecentlyViewed() must be called from inside a <RecentlyViewedProvider>');
  return ctx;
}
