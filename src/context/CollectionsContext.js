import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { loadJSON, saveJSON } from '../utils/storage';

const STORAGE_KEY = 'wecooked:userCollections';

const CollectionsContext = createContext(null);

let seq = 0;
const genId = () => `uc-${Date.now()}-${seq++}`;

// User-created collections: { id, title, recipeIds: [] }. The built-in
// "smart" collections (Quick Meals, Healthy Meals, …) are derived elsewhere.
export function CollectionsProvider({ children }) {
  const [collections, setCollections] = useState([]);
  const hydrated = useRef(false);

  useEffect(() => {
    (async () => {
      const stored = await loadJSON(STORAGE_KEY, null);
      if (Array.isArray(stored)) setCollections(stored);
      hydrated.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    saveJSON(STORAGE_KEY, collections);
  }, [collections]);

  const addCollection = (title) => {
    const id = genId();
    setCollections((c) => [...c, { id, title: (title || '').trim() || 'New Collection', recipeIds: [] }]);
    return id;
  };

  const removeCollection = (id) => setCollections((c) => c.filter((x) => x.id !== id));

  const toggleInCollection = (collectionId, recipeId) =>
    setCollections((c) =>
      c.map((col) => {
        if (col.id !== collectionId) return col;
        const has = col.recipeIds.includes(recipeId);
        return { ...col, recipeIds: has ? col.recipeIds.filter((r) => r !== recipeId) : [...col.recipeIds, recipeId] };
      })
    );

  const isInCollection = (collectionId, recipeId) =>
    !!collections.find((c) => c.id === collectionId)?.recipeIds.includes(recipeId);

  const value = useMemo(
    () => ({ collections, addCollection, removeCollection, toggleInCollection, isInCollection }),
    [collections]
  );

  return <CollectionsContext.Provider value={value}>{children}</CollectionsContext.Provider>;
}

export function useCollections() {
  const ctx = useContext(CollectionsContext);
  if (!ctx) throw new Error('useCollections() must be called from inside a <CollectionsProvider>');
  return ctx;
}
