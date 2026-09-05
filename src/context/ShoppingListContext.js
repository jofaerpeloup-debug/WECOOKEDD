import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { shoppingList as initialItems } from '../data/mockData';
import { loadJSON, saveJSON } from '../utils/storage';

const STORAGE_KEY = 'wecooked:groceryList';

const ShoppingListContext = createContext(null);

let seq = 0;
const genId = () => `g-${Date.now()}-${seq++}`;

const CAT_HINTS = [
  { cat: 'Meat', words: ['chicken', 'pork', 'beef', 'shrimp', 'sausage', 'longganisa', 'bacon', 'oxtail', 'shank', 'fish'] },
  { cat: 'Produce', words: ['garlic', 'onion', 'tomato', 'ginger', 'chili', 'pepper', 'papaya', 'cabbage', 'carrot', 'bean', 'radish', 'kangkong', 'eggplant', 'calamansi', 'leaf', 'leaves', 'corn', 'potato', 'blossom'] },
];
const catFor = (name) => {
  const n = String(name).toLowerCase();
  for (const { cat, words } of CAT_HINTS) if (words.some((w) => n.includes(w))) return cat;
  return 'Pantry';
};

export function ShoppingListProvider({ children }) {
  const [items, setItems] = useState(initialItems);
  const hydrated = useRef(false);

  useEffect(() => {
    (async () => {
      const stored = await loadJSON(STORAGE_KEY, null);
      if (Array.isArray(stored)) setItems(stored);
      hydrated.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    saveJSON(STORAGE_KEY, items);
  }, [items]);

  const toggle = (id) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, checked: !i.checked } : i)));

  const remove = (id) => setItems((prev) => prev.filter((i) => i.id !== id));

  // Adds a user-typed item; category is guessed from the name.
  const addCustom = (name, qty = '') => {
    const n = String(name).trim();
    if (!n) return;
    setItems((prev) => [
      ...prev,
      { id: genId(), cat: catFor(n), name: n, qty: String(qty).trim(), checked: false },
    ]);
  };

  const addFromRecipe = (recipe) => {
    setItems((prev) => {
      const have = new Set(prev.map((i) => i.name.toLowerCase()));
      const additions = (recipe.ingredients || [])
        .filter((ing) => !have.has(String(ing.name).toLowerCase()))
        .map((ing) => ({
          id: genId(),
          cat: catFor(ing.name),
          name: ing.name,
          qty: ing.qty || '',
          checked: false,
        }));
      return additions.length ? [...prev, ...additions] : prev;
    });
  };

  const value = useMemo(
    () => ({ items, toggle, remove, addCustom, addFromRecipe }),
    [items]
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
