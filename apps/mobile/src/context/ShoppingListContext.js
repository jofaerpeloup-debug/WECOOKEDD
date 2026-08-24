import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { shoppingList as initialList } from '../data/mockData';
import { loadJSON, saveJSON } from '../utils/storage';

const STORAGE_KEY = 'wecooked:shoppingList';

const ShoppingListContext = createContext(null);

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
        { id: `custom-${Date.now()}`, name, checked: false },
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
        .map((ing, i) => ({
          id: `recipe-${Date.now()}-${i}`,
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
