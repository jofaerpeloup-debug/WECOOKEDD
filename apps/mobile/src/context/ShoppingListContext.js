import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { shoppingList as initialList } from '../data/mockData';
import { loadJSON, saveJSON } from '../utils/storage';

const STORAGE_KEY = 'wecooked:shoppingList';

const ShoppingListContext = createContext(null);

// A counter (not just Date.now()) guarantees unique ids even when several
// items are created within the same millisecond — e.g. two recipes' worth
// of ingredients added back to back. Colliding ids would make remove()
// delete an item from one recipe and a same-id item from another at once.
let nextId = 0;
const genId = (prefix) => `${prefix}-${Date.now()}-${nextId++}`;

export function ShoppingListProvider({ children }) {
  const [list, setList] = useState(initialList);
  const hydrated = useRef(false);

  useEffect(() => {
    (async () => {
      const stored = await loadJSON(STORAGE_KEY, null);
      if (stored) setList({ ...initialList, ...stored });
      hydrated.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    saveJSON(STORAGE_KEY, list);
  }, [list]);

  const toggle = (category, id) => {
    setList((prev) => ({
      ...prev,
      [category]: prev[category].map((item) =>
        item.id === id ? { ...item, checked: !item.checked } : item
      ),
    }));
  };

  const remove = (category, id) => {
    setList((prev) => ({
      ...prev,
      [category]: prev[category].filter((item) => item.id !== id),
    }));
  };

  const addItem = (category, name) => {
    setList((prev) => ({
      ...prev,
      [category]: [
        ...prev[category],
        { id: genId('custom'), name, checked: false },
      ],
    }));
  };

  const addIngredients = (recipeName, ingredients) => {
    setList((prev) => {
      const existing = new Set(
        prev.recipeItems
          .filter((i) => i.source === recipeName)
          .map((i) => i.name.toLowerCase())
      );
      const newItems = ingredients
        .filter((ing) => !existing.has(ing.toLowerCase()))
        .map((ing) => ({
          id: genId('recipe'),
          name: ing,
          checked: false,
          source: recipeName,
        }));
      if (newItems.length === 0) return prev;
      return { ...prev, recipeItems: [...prev.recipeItems, ...newItems] };
    });
  };

  const value = useMemo(
    () => ({ list, toggle, remove, addItem, addIngredients }),
    [list]
  );

  return (
    <ShoppingListContext.Provider value={value}>{children}</ShoppingListContext.Provider>
  );
}

export function useShoppingList() {
  const ctx = useContext(ShoppingListContext);
  if (!ctx) {
    throw new Error('useShoppingList() must be called from inside a <ShoppingListProvider>');
  }
  return ctx;
}
