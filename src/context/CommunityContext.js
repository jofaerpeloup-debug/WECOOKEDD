import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { communityPosts as initialPosts, chef } from '../data/mockData';
import { loadJSON, saveJSON } from '../utils/storage';

const STORAGE_KEY = 'wecooked:communityPosts';

const CommunityContext = createContext(null);

let nextId = 0;
const genId = () => `post-${Date.now()}-${nextId++}`;
let nextCommentId = 0;
const genCommentId = () => `comment-${Date.now()}-${nextCommentId++}`;

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

  // Persisted per-post state — survives app restart, unlike the old
  // component-local `liked` map it replaces.
  const toggleLike = (id) => {
    setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, likedByMe: !p.likedByMe } : p)));
  };

  // Real comments you actually write. Seed posts ship with a baseline
  // `comments` count (other cooks' pre-existing activity) but no individual
  // text for those — only what's added here is ever shown.
  const addComment = (postId, text) => {
    const t = String(text).trim();
    if (!t) return;
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId
          ? { ...p, myComments: [...(p.myComments || []), { id: genCommentId(), text: t, ts: Date.now() }] }
          : p
      )
    );
  };

  const value = useMemo(
    () => ({ posts, addPost, removePost, toggleLike, addComment }),
    [posts]
  );

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
