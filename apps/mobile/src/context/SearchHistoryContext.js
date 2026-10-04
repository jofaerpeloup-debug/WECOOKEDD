import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuth } from './AuthContext';
import { loadJSON, removeItem, saveJSON } from '../utils/storage';

const SearchHistoryContext = createContext(null);
const SEARCH_HISTORY_PREFIX = 'wecooked:recentSearches:user:';
export const SEARCH_HISTORY_MAX = 8;

export function searchHistoryKey(userId) {
  const id = typeof userId === 'string' ? userId.trim() : '';
  return id ? `${SEARCH_HISTORY_PREFIX}${id}` : null;
}

export function normalizeSearchHistory(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const normalized = [];
  for (const candidate of value) {
    if (typeof candidate !== 'string') continue;
    const term = candidate.trim();
    const identity = term.toLocaleLowerCase();
    if (!term || seen.has(identity)) continue;
    seen.add(identity);
    normalized.push(term);
    if (normalized.length === SEARCH_HISTORY_MAX) break;
  }
  return normalized;
}

export function SearchHistoryProvider({ children }) {
  const { user } = useAuth();
  const userId = typeof user?.id === 'string' ? user.id.trim() : '';
  const key = searchHistoryKey(userId);
  const [ownedHistory, setOwnedHistory] = useState({ userId: '', items: [] });
  const generationRef = useRef(0);
  const historyRef = useRef([]);
  const ownerRef = useRef({ userId: '', key: null, generation: 0 });

  const recentSearches = ownedHistory.userId === userId ? ownedHistory.items : [];

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    ownerRef.current = { userId, key, generation };
    historyRef.current = [];
    setOwnedHistory({ userId, items: [] });
    if (!key) return undefined;

    let active = true;
    (async () => {
      const stored = await loadJSON(key, []);
      if (
        !active ||
        generation !== generationRef.current ||
        ownerRef.current.userId !== userId ||
        ownerRef.current.key !== key
      ) return;
      const normalized = normalizeSearchHistory(stored);
      historyRef.current = normalized;
      setOwnedHistory({ userId, items: normalized });
      if (JSON.stringify(normalized) !== JSON.stringify(stored)) {
        void saveJSON(key, normalized);
      }
    })();

    return () => {
      active = false;
    };
  }, [key, userId]);

  const recordSearch = useCallback((rawValue) => {
    const owner = ownerRef.current;
    if (!owner.key || !owner.userId || owner.generation !== generationRef.current) return;
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!value) return;
    const next = normalizeSearchHistory([
      value,
      ...historyRef.current.filter(
        (term) => term.toLocaleLowerCase() !== value.toLocaleLowerCase()
      ),
    ]);
    historyRef.current = next;
    setOwnedHistory({ userId: owner.userId, items: next });
    void saveJSON(owner.key, next);
  }, []);

  const clearSearchHistory = useCallback(() => {
    const owner = ownerRef.current;
    if (!owner.key || !owner.userId || owner.generation !== generationRef.current) return;
    historyRef.current = [];
    setOwnedHistory({ userId: owner.userId, items: [] });
    void removeItem(owner.key);
  }, []);

  const value = useMemo(
    () => ({ recentSearches, recordSearch, clearSearchHistory }),
    [recentSearches, recordSearch, clearSearchHistory]
  );

  return <SearchHistoryContext.Provider value={value}>{children}</SearchHistoryContext.Provider>;
}

export function useSearchHistory() {
  const value = useContext(SearchHistoryContext);
  if (!value) throw new Error('useSearchHistory must be used within SearchHistoryProvider');
  return value;
}
