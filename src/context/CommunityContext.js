import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { communityPosts as initialPosts, chef } from '../data/mockData';
import { loadJSON, saveJSON } from '../utils/storage';

const STORAGE_KEY = 'wecooked:communityPosts';
const FOLLOWING_KEY = 'wecooked:communityFollowing';
const BOOKMARKS_KEY = 'wecooked:communityBookmarks';

const CommunityContext = createContext(null);

let nextId = 0;
const genId = () => `post-${Date.now()}-${nextId++}`;
let nextCommentId = 0;
const genCommentId = () => `comment-${Date.now()}-${nextCommentId++}`;

// One-time migration for posts saved before `ts` existed (they only had the
// frozen `time: 'Just now'` string, which is exactly the "never updates"
// bug being fixed here). A user-created post's own id already embeds its
// real creation time (`post-<Date.now()>-<seq>`), so this recovers the
// EXACT original timestamp rather than guessing — no need to touch seed
// posts (ids like 'c1'), which keep their static `time` string as-is.
function backfillTimestamps(list) {
  return list.map((p) => {
    if (p.ts) return p;
    const m = /^post-(\d+)-/.exec(p.id);
    return m ? { ...p, ts: Number(m[1]) } : p;
  });
}

export function CommunityProvider({ children }) {
  const [posts, setPosts] = useState(initialPosts);
  // Authors are only ever identified by name in this mock feed (no stable
  // author ids exist), so `following` is a Set of author names — same
  // identity check `isMine` already uses in CommunityScreen. Starts empty,
  // Instagram-style: the "For You" tab is never restricted to who you
  // follow, so there's always a way to discover someone's posts (and their
  // Follow button) before you've followed anyone.
  const [following, setFollowing] = useState(() => new Set());
  const [bookmarkedIds, setBookmarkedIds] = useState(() => new Set());
  const hydrated = useRef(false);

  useEffect(() => {
    (async () => {
      const [storedPosts, storedFollowing, storedBookmarks] = await Promise.all([
        loadJSON(STORAGE_KEY, null),
        loadJSON(FOLLOWING_KEY, null),
        loadJSON(BOOKMARKS_KEY, null),
      ]);
      if (storedPosts) setPosts(backfillTimestamps(storedPosts));
      if (Array.isArray(storedFollowing)) setFollowing(new Set(storedFollowing));
      if (Array.isArray(storedBookmarks)) setBookmarkedIds(new Set(storedBookmarks));
      hydrated.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    saveJSON(STORAGE_KEY, posts);
  }, [posts]);

  useEffect(() => {
    if (!hydrated.current) return;
    saveJSON(FOLLOWING_KEY, Array.from(following));
  }, [following]);

  useEffect(() => {
    if (!hydrated.current) return;
    saveJSON(BOOKMARKS_KEY, Array.from(bookmarkedIds));
  }, [bookmarkedIds]);

  const addPost = ({ caption, image, recipeTag, recipeId }) => {
    const post = {
      id: genId(),
      author: { name: chef.name, avatar: chef.avatar },
      // A real timestamp, not a frozen "Just now" string — CommunityScreen
      // derives the displayed label from this with timeAgo() so it actually
      // counts up as time passes, instead of staying stuck at "Just now"
      // forever.
      ts: Date.now(),
      image: image || null,
      caption,
      recipeTag: recipeTag || null,
      recipeId: recipeId || null,
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

  const toggleFollow = (authorName) =>
    setFollowing((prev) => {
      const next = new Set(prev);
      if (next.has(authorName)) next.delete(authorName);
      else next.add(authorName);
      return next;
    });
  const isFollowing = (authorName) => following.has(authorName);

  const toggleBookmark = (postId) =>
    setBookmarkedIds((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  const isBookmarked = (postId) => bookmarkedIds.has(postId);

  const value = useMemo(
    () => ({
      posts,
      addPost,
      removePost,
      toggleLike,
      addComment,
      following,
      toggleFollow,
      isFollowing,
      bookmarkedIds,
      toggleBookmark,
      isBookmarked,
    }),
    [posts, following, bookmarkedIds]
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
