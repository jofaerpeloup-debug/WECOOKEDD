import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { communityPosts as initialPosts, chef } from '../data/mockData';
import { loadJSON, saveJSON } from '../utils/storage';

const STORAGE_KEY = 'wecooked:communityPosts';

const CommunityContext = createContext(null);

let nextId = 0;
const genId = () => `post-${Date.now()}-${nextId++}`;

export function CommunityProvider({ children }) {
  const [posts, setPosts] = useState(initialPosts);
  const hydrated = useRef(false);

  useEffect(() => {
    (async () => {
      const stored = await loadJSON(STORAGE_KEY, null);
      if (stored) setPosts(stored);
      hydrated.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    saveJSON(STORAGE_KEY, posts);
  }, [posts]);

  const addPost = ({ caption, image, recipeTag }) => {
    const post = {
      id: genId(),
      author: { name: chef.name, avatar: chef.avatar },
      time: 'Just now',
      image: image || null,
      caption,
      recipeTag: recipeTag || null,
      likes: 0,
      comments: 0,
    };
    setPosts((prev) => [post, ...prev]);
  };

  const removePost = (id) => {
    setPosts((prev) => prev.filter((p) => p.id !== id));
  };

  const value = useMemo(() => ({ posts, addPost, removePost }), [posts]);

  return (
    <CommunityContext.Provider value={value}>{children}</CommunityContext.Provider>
  );
}

export function useCommunity() {
  const ctx = useContext(CommunityContext);
  if (!ctx) {
    throw new Error('useCommunity() must be called from inside a <CommunityProvider>');
  }
  return ctx;
}
