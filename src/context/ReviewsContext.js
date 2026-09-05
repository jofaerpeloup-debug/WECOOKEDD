import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { loadJSON, saveJSON } from '../utils/storage';

const STORAGE_KEY = 'wecooked:reviews';

const ReviewsContext = createContext(null);

// Per-recipe star rating the user has left: { [recipeId]: 1..5 }.
export function ReviewsProvider({ children }) {
  const [ratings, setRatings] = useState({});
  const hydrated = useRef(false);

  useEffect(() => {
    (async () => {
      const stored = await loadJSON(STORAGE_KEY, null);
      if (stored && typeof stored === 'object') setRatings(stored);
      hydrated.current = true;
    })();
  }, []);

  useEffect(() => {
    if (hydrated.current) saveJSON(STORAGE_KEY, ratings);
  }, [ratings]);

  const setRating = (recipeId, stars) =>
    setRatings((r) => ({ ...r, [recipeId]: stars }));

  const getRating = (recipeId) => ratings[recipeId] || 0;

  // Blends the user's rating into the recipe's seeded rating/review count.
  const displayFor = (recipe) => {
    const mine = ratings[recipe.id];
    if (!mine) return { rating: recipe.rating, reviews: recipe.reviews, mine: 0 };
    const total = recipe.rating * recipe.reviews + mine;
    const count = recipe.reviews + 1;
    return { rating: Math.round((total / count) * 10) / 10, reviews: count, mine };
  };

  const value = useMemo(() => ({ ratings, setRating, getRating, displayFor }), [ratings]);

  return <ReviewsContext.Provider value={value}>{children}</ReviewsContext.Provider>;
}

export function useReviews() {
  const ctx = useContext(ReviewsContext);
  if (!ctx) throw new Error('useReviews() must be called from inside a <ReviewsProvider>');
  return ctx;
}
