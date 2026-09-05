import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { loadJSON, saveJSON } from '../utils/storage';

const STORAGE_KEY = 'wecooked:searchHistory';
const MAX = 8;

const SearchHistoryContext = createContext(null);

export function SearchHistoryProvider({ children }) {
  const [recent, setRecent] = useState([]);
  const [filters, setFilters] = useState({ timeBkt: null, difficulty: null, dietary: [], category: null });
  const hydrated = useRef(false);

  useEffect(() => {
    (async () => {
      const stored = await loadJSON(STORAGE_KEY, null);
      if (stored?.recent) setRecent(stored.recent);
      if (stored?.filters) setFilters((f) => ({ ...f, ...stored.filters }));
      hydrated.current = true;
    })();
  }, []);

  useEffect(() => {
    if (hydrated.current) saveJSON(STORAGE_KEY, { recent, filters });
  }, [recent, filters]);

  const addRecent = (q) => {
    const t = String(q).trim();
    if (!t) return;
    setRecent((r) => [t, ...r.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, MAX));
  };
  const clearRecent = () => setRecent([]);

  const value = useMemo(
    () => ({ recent, addRecent, clearRecent, filters, setFilters }),
    [recent, filters]
  );

  return <SearchHistoryContext.Provider value={value}>{children}</SearchHistoryContext.Provider>;
}

export function useSearchHistory() {
  const ctx = useContext(SearchHistoryContext);
  if (!ctx) throw new Error('useSearchHistory() must be called from inside a <SearchHistoryProvider>');
  return ctx;
}
