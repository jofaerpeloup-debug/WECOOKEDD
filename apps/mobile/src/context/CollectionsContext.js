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
import * as collectionService from '../api/collectionService';
import { getCollectionErrorMessage, isIdempotentCollectionOutcome } from '../api/collectionErrors';

// ---------------------------------------------------------------------------
// The SINGLE authoritative state for the current user's real, user-created
// Collections (M5A) — distinct from Favorites, which keeps its own
// FavoritesContext/FavoritesProvider and is never touched by this file:
//
//   CollectionsProvider
//     -> collectionService -> shared api client -> /api/v1/collections -> MongoDB
//
// Ownership is always the authenticated backend identity; this provider never
// sends a userId. It observes the existing AuthContext (never modifies it)
// and follows the same cross-user leak guard as FavoritesContext:
//
//   - `sessionRef` bumps on every auth/user identity change and invalidates
//     every outstanding list request for the old user.
//   - `listGenRef` bumps on every (re)load and decides which list request wins.
//   - The loaded state is tagged with the user id it belongs to (`ownerId`);
//     `collections` reads as EMPTY the instant `ownerId !== currentAuthUserId`,
//     so User A's collections cannot render for even one frame under User B.
//
// Unlike FavoritesContext, mutations here are NOT optimistic: Collections
// data is touched from exactly two focused surfaces (Saved's create/delete,
// the add-to-collection picker), not an app-wide per-recipe icon, so a
// simple await-then-reconcile-local-state model is enough and avoids the
// extra pending/rollback machinery Favorites needs for its ubiquitous heart
// icon. See collection.service.js (backend) for the ownership/BOLA rules
// this context's calls rely on.
// ---------------------------------------------------------------------------

const EMPTY_ARRAY = [];

const CollectionsContext = createContext(null);

export function CollectionsProvider({ children }) {
  const { status: authStatus, user } = useAuth();
  const authUserId = authStatus === 'authenticated' && user ? user.id : null;

  const [collections, setCollections] = useState([]);
  // The user id `collections` was loaded / cleared for. Compared against
  // `authUserId` at render time to gate exposure (cross-user leak guard).
  const [ownerId, setOwnerId] = useState(null);
  // 'idle' (no session yet) | 'loading' (initial load) | 'ready' | 'error'
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);

  const mountedRef = useRef(true);
  const sessionRef = useRef(0); // bumped ONLY on auth/user identity change
  const listGenRef = useRef(0); // bumped on every (re)load
  const authUserIdRef = useRef(authUserId);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async (listGen, session) => {
    const stale = () =>
      listGen !== listGenRef.current || session !== sessionRef.current || !mountedRef.current;
    try {
      const { collections: fetched } = await collectionService.listCollections();
      if (stale()) return;
      setCollections(fetched);
      setError(null);
      setStatus('ready');
    } catch (err) {
      if (stale()) return;
      setError(getCollectionErrorMessage(err));
      setStatus('error');
    }
  }, []);

  // --- react to auth: wipe previous user, then load current user ------------
  useEffect(() => {
    authUserIdRef.current = authUserId;

    sessionRef.current += 1;
    listGenRef.current += 1;
    const session = sessionRef.current;
    const listGen = listGenRef.current;

    setCollections([]);
    setError(null);
    setOwnerId(authUserId);

    if (!authUserId) {
      setStatus('idle');
      return;
    }

    setStatus('loading');
    load(listGen, session);
  }, [authUserId, load]);

  // --- manual reload (Saved pull-to-refresh / screen focus) ----------------
  const reload = useCallback(() => {
    if (!authUserIdRef.current) return Promise.resolve();
    listGenRef.current += 1;
    const listGen = listGenRef.current;
    const session = sessionRef.current;
    return load(listGen, session);
  }, [load]);

  const createCollection = useCallback(async ({ name, description }) => {
    if (!authUserIdRef.current) {
      return { ok: false, error: 'Your session has expired. Please log in again.' };
    }
    const session = sessionRef.current;
    try {
      const collection = await collectionService.createCollection({ name, description });
      if (session === sessionRef.current && mountedRef.current) {
        setCollections((list) => [{ ...collection, recipeCount: 0, coverImageUrls: [] }, ...list]);
      }
      return { ok: true, collection };
    } catch (err) {
      return { ok: false, error: getCollectionErrorMessage(err) };
    }
  }, []);

  const deleteCollection = useCallback(async (collectionId) => {
    if (!authUserIdRef.current) {
      return { ok: false, error: 'Your session has expired. Please log in again.' };
    }
    const session = sessionRef.current;
    try {
      await collectionService.deleteCollection(collectionId);
      if (session === sessionRef.current && mountedRef.current) {
        setCollections((list) => list.filter((c) => c.id !== collectionId));
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: getCollectionErrorMessage(err) };
    }
  }, []);

  const addRecipeToCollection = useCallback(async (collectionId, recipeId) => {
    if (!authUserIdRef.current) {
      return { ok: false, error: 'Your session has expired. Please log in again.' };
    }
    const session = sessionRef.current;
    try {
      await collectionService.addRecipeToCollection(collectionId, recipeId);
      if (session === sessionRef.current && mountedRef.current) {
        setCollections((list) =>
          list.map((c) => (c.id === collectionId ? { ...c, recipeCount: c.recipeCount + 1 } : c))
        );
      }
      return { ok: true };
    } catch (err) {
      if (isIdempotentCollectionOutcome(err, 'add')) {
        return { ok: true, idempotent: true };
      }
      return { ok: false, error: getCollectionErrorMessage(err) };
    }
  }, []);

  const removeRecipeFromCollection = useCallback(async (collectionId, recipeId) => {
    if (!authUserIdRef.current) {
      return { ok: false, error: 'Your session has expired. Please log in again.' };
    }
    const session = sessionRef.current;
    try {
      await collectionService.removeRecipeFromCollection(collectionId, recipeId);
      if (session === sessionRef.current && mountedRef.current) {
        setCollections((list) =>
          list.map((c) => (c.id === collectionId ? { ...c, recipeCount: Math.max(0, c.recipeCount - 1) } : c))
        );
      }
      return { ok: true };
    } catch (err) {
      if (isIdempotentCollectionOutcome(err, 'remove')) {
        return { ok: true, idempotent: true };
      }
      return { ok: false, error: getCollectionErrorMessage(err) };
    }
  }, []);

  // --- derived, gated on ownership -----------------------------------------
  const trusted = !!authUserId && ownerId === authUserId;
  const visibleCollections = trusted ? collections : EMPTY_ARRAY;
  const effectiveStatus = !authUserId ? 'idle' : trusted ? status : 'loading';

  const value = useMemo(
    () => ({
      collections: visibleCollections,
      status: effectiveStatus, // 'idle' | 'loading' | 'ready' | 'error'
      error: trusted ? error : null,
      isInitializing: effectiveStatus === 'idle' || effectiveStatus === 'loading',
      reload,
      createCollection,
      deleteCollection,
      addRecipeToCollection,
      removeRecipeFromCollection,
    }),
    [
      visibleCollections,
      effectiveStatus,
      error,
      trusted,
      reload,
      createCollection,
      deleteCollection,
      addRecipeToCollection,
      removeRecipeFromCollection,
    ]
  );

  return <CollectionsContext.Provider value={value}>{children}</CollectionsContext.Provider>;
}

export function useCollections() {
  const ctx = useContext(CollectionsContext);
  if (!ctx) {
    throw new Error('useCollections() must be called from inside a <CollectionsProvider>');
  }
  return ctx;
}
