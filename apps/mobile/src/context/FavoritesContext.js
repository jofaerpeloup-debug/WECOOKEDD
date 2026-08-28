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
import * as favoriteService from '../api/favoriteService';
import { getFavoriteErrorMessage, isIdempotentFavoriteOutcome } from '../api/favoriteErrors';

// ---------------------------------------------------------------------------
// The SINGLE authoritative Favorites state for API (backend) recipes.
//
//   FavoritesProvider
//     -> favoriteService -> shared api client -> /api/v1/favorites -> MongoDB
//
// Legacy / mock recipes (ids like "r4") are NOT handled here — they keep using
// SavedRecipesContext. A mock id must never reach this provider.
//
// Ownership is always the authenticated backend identity; this provider never
// sends a userId. It observes the existing AuthContext (it never modifies it)
// and is strictly user-scoped:
//
//   - `sessionRef` is bumped on every auth/user identity change and invalidates
//     every outstanding list page AND every outstanding mutation for the old
//     user.
//   - `listGenRef` is bumped on every (re)load and decides which list request
//     wins. It is DELIBERATELY separate from `sessionRef` so a focus / pull
//     reload can never strand an in-flight mutation's cleanup.
//   - The loaded state is tagged with the user id it belongs to (`ownerId`).
//     `favorites` / `favoriteIds` / `isFavorite` are exposed as EMPTY the
//     instant `ownerId !== currentAuthenticatedUserId`, so User A's favorites
//     cannot render for even one frame under User B (a render happens before
//     the clearing effect runs).
//
// Pagination note (backend V1): GET /favorites paginates BEFORE filtering out
// unusable recipes, so `pagination.total` / `totalPages` can overcount and a
// page can be short/empty without being the last one. The multi-page load
// pages strictly against `totalPages` (never stops on a short page) and dedupes
// by public `recipe.id`. UI counts use the loaded array length, never `total`.
// ---------------------------------------------------------------------------

const PAGE_LIMIT = 100;
// Hard safety guard on the fetch-all-pages loop (100 * 50 = 5000 favorites).
// Normal termination is `page > totalPages`; this only bounds a backend that
// reports an absurd `totalPages`.
const MAX_PAGES = 50;

const EMPTY_ARRAY = [];
const EMPTY_SET = new Set();

const FavoritesContext = createContext(null);

const hasKey = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// The favorite-summary fields the backend returns nested under each favorite —
// used to synthesise an optimistic entry from a full PublicRecipe (or a list
// card object) so the Saved screen updates immediately on an add.
function toRecipeSummary(recipe) {
  const r = recipe || {};
  return {
    id: r.id,
    title: r.title ?? null,
    cuisine: r.cuisine ?? null,
    difficulty: r.difficulty ?? null,
    prepTimeMinutes: r.prepTimeMinutes ?? null,
    cookTimeMinutes: r.cookTimeMinutes ?? null,
    imageUrl: r.imageUrl ?? null,
  };
}

export function FavoritesProvider({ children }) {
  const { status: authStatus, user } = useAuth();
  const authUserId = authStatus === 'authenticated' && user ? user.id : null;

  // entries: recipeId -> { favoriteId: string | null, recipe: <summary>, createdAt, optimistic? }
  const [entries, setEntries] = useState({});
  // The user id `entries` was loaded / cleared for. Compared against
  // `authUserId` at render time to gate exposure (cross-user leak guard).
  const [ownerId, setOwnerId] = useState(null);
  // 'idle' (no session yet) | 'loading' (initial load) | 'ready' | 'error' (initial load failed, nothing to show)
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  // recipeId -> true  (a POST/DELETE is in flight for it)
  const [pending, setPending] = useState({});
  // recipeId -> boolean  (desired state while a mutation is in flight; overlays `entries` for isFavorite)
  const [pendingTargets, setPendingTargets] = useState({});

  // --- refs: latest values readable inside async closures --------------------
  const mountedRef = useRef(true);
  const sessionRef = useRef(0); // bumped ONLY on auth/user identity change
  const listGenRef = useRef(0); // bumped on every (re)load
  const entriesRef = useRef(entries);
  const statusRef = useRef(status);
  const pendingIdsRef = useRef(new Set()); // in-flight mutation ids
  const pendingTargetsRef = useRef({}); // mirror of pendingTargets for the reload merge
  const authUserIdRef = useRef(authUserId);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  useEffect(() => {
    pendingTargetsRef.current = pendingTargets;
  }, [pendingTargets]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // --- multi-page load (initial + reload) -----------------------------------
  const loadAllPages = useCallback(async (listGen, session) => {
    // Stale if a newer load superseded it (listGen), the auth session changed
    // under it (session), or the provider unmounted.
    const stale = () =>
      listGen !== listGenRef.current || session !== sessionRef.current || !mountedRef.current;

    try {
      const acc = {};
      let page = 1;
      let totalPages = 1;

      do {
        const { favorites: fetched, pagination } = await favoriteService.listFavorites({
          page,
          limit: PAGE_LIMIT,
          sort: 'newest',
        });
        if (stale()) return;

        for (const fav of fetched) {
          if (!fav || !fav.recipe || fav.recipe.id == null) continue;
          if (hasKey(acc, fav.recipe.id)) continue; // dedupe by public recipe id
          acc[fav.recipe.id] = {
            favoriteId: fav.id ?? null,
            recipe: fav.recipe,
            createdAt: fav.createdAt ?? null,
          };
        }

        totalPages = (pagination && pagination.totalPages) || 1;
        page += 1;
        // Never stop on `fetched.length < PAGE_LIMIT` — the backend filters
        // unusable recipes AFTER paginating, so a short/empty page is not the
        // end. Page strictly against totalPages, bounded by MAX_PAGES.
      } while (page <= totalPages && page <= MAX_PAGES);

      if (stale()) return;

      // Fold in mutations that landed while the multi-page load was running so
      // a slower list response can't undo a newer optimistic add/remove.
      setEntries(() => {
        const next = { ...acc };
        pendingIdsRef.current.forEach((id) => {
          const target = pendingTargetsRef.current[id];
          if (target) {
            if (!hasKey(next, id)) {
              next[id] =
                entriesRef.current[id] || {
                  favoriteId: null,
                  recipe: toRecipeSummary({ id }),
                  createdAt: new Date().toISOString(),
                  optimistic: true,
                };
            }
          } else {
            delete next[id];
          }
        });
        return next;
      });
      setError(null);
      setStatus('ready');
    } catch (err) {
      if (stale()) return;
      const message = getFavoriteErrorMessage(err);
      if (statusRef.current === 'ready') {
        // A failed REFRESH: keep the list we already have, surface a soft note.
        setError(message);
      } else {
        // Initial load failed with nothing to show.
        setError(message);
        setStatus('error');
      }
    }
  }, []);

  // --- react to auth: wipe previous user, then load current user ------------
  useEffect(() => {
    authUserIdRef.current = authUserId;

    // An auth identity change invalidates every outstanding list page AND
    // every outstanding mutation belonging to the previous user.
    sessionRef.current += 1;
    listGenRef.current += 1;
    const session = sessionRef.current;
    const listGen = listGenRef.current;

    // Clear the previous user's state IMMEDIATELY — before any load starts.
    // `ownerId` is set to the current user in the same batch, so once this
    // commits `entries` ({}) genuinely belongs to `authUserId`. Any render
    // BEFORE this effect runs is covered by the `trusted` gate further down.
    entriesRef.current = {};
    pendingIdsRef.current = new Set();
    pendingTargetsRef.current = {};
    setEntries({});
    setPending({});
    setPendingTargets({});
    setError(null);
    setOwnerId(authUserId);

    if (!authUserId) {
      setStatus('idle');
      statusRef.current = 'idle';
      return;
    }

    setStatus('loading');
    statusRef.current = 'loading';
    loadAllPages(listGen, session);
  }, [authUserId, loadAllPages]);

  // --- manual reload (Saved pull-to-refresh / screen focus) ----------------
  // Bumps ONLY listGenRef — never sessionRef — so an in-flight add/remove is
  // never mistaken for a superseded session and always finishes its cleanup.
  const reload = useCallback(() => {
    if (!authUserIdRef.current) return Promise.resolve();
    listGenRef.current += 1;
    const listGen = listGenRef.current;
    const session = sessionRef.current;
    if (statusRef.current !== 'ready') {
      setStatus('loading');
      statusRef.current = 'loading';
    }
    return loadAllPages(listGen, session);
  }, [loadAllPages]);

  // --- one mutation (add or remove) for one recipe -------------------------
  const runMutation = useCallback(async (recipeId, target, recipeObj) => {
    if (recipeId == null) return { ok: false, error: 'This recipe can’t be saved.' };
    if (!authUserIdRef.current) {
      return { ok: false, error: 'Your session has expired. Please log in again.' };
    }
    // Per-recipe pending guard: never issue a second concurrent POST/DELETE.
    if (pendingIdsRef.current.has(recipeId)) return { ok: false, pendingIgnored: true };

    // Tied to the auth SESSION only — a list reload must not invalidate this.
    const session = sessionRef.current;
    const prevEntry = hasKey(entriesRef.current, recipeId) ? entriesRef.current[recipeId] : undefined;
    const wasFavorite = prevEntry !== undefined;

    // Target computed from the authoritative current Set — not a blind toggle.
    if (wasFavorite === target) return { ok: true, noop: true };

    pendingIdsRef.current.add(recipeId);
    pendingTargetsRef.current = { ...pendingTargetsRef.current, [recipeId]: target };
    setPending((p) => ({ ...p, [recipeId]: true }));
    setPendingTargets((t) => ({ ...t, [recipeId]: target }));

    // Optimistic apply.
    if (target) {
      const optimistic = {
        favoriteId: null,
        recipe: toRecipeSummary(recipeObj || (prevEntry && prevEntry.recipe) || { id: recipeId }),
        createdAt: new Date().toISOString(),
        optimistic: true,
      };
      setEntries((e) => ({ ...e, [recipeId]: optimistic }));
    } else {
      setEntries((e) => {
        const n = { ...e };
        delete n[recipeId];
        return n;
      });
    }

    const sessionCurrent = () => session === sessionRef.current && mountedRef.current;

    let result;
    try {
      if (target) {
        const fav = await favoriteService.addFavorite(recipeId);
        result = { ok: true };
        if (sessionCurrent()) {
          setEntries((e) => ({
            ...e,
            [recipeId]: {
              favoriteId: (fav && fav.id) || null,
              recipe: fav && fav.recipe ? fav.recipe : toRecipeSummary(recipeObj || { id: recipeId }),
              createdAt: (fav && fav.createdAt) || new Date().toISOString(),
            },
          }));
        }
      } else {
        await favoriteService.removeFavorite(recipeId);
        result = { ok: true };
      }
    } catch (err) {
      if (isIdempotentFavoriteOutcome(err, target ? 'add' : 'remove')) {
        // The backend is already in the desired state — keep the optimistic
        // result, do NOT roll back.
        result = { ok: true, idempotent: true };
      } else {
        result = { ok: false, error: getFavoriteErrorMessage(err) };
        // Roll back — but only if this response still belongs to the current
        // session. If the user logged out / switched mid-flight, local cleanup
        // already wiped everything and must win.
        if (sessionCurrent()) {
          setEntries((e) => {
            const n = { ...e };
            if (wasFavorite) n[recipeId] = prevEntry;
            else delete n[recipeId];
            return n;
          });
        }
      }
    } finally {
      pendingIdsRef.current.delete(recipeId);
      if (sessionCurrent()) {
        const nextTargets = { ...pendingTargetsRef.current };
        delete nextTargets[recipeId];
        pendingTargetsRef.current = nextTargets;
        setPending((p) => {
          const n = { ...p };
          delete n[recipeId];
          return n;
        });
        setPendingTargets((t) => {
          const n = { ...t };
          delete n[recipeId];
          return n;
        });
      }
      // If the session changed, the auth effect already reset `pending` /
      // `pendingTargets` to {} — nothing more to clean up here.
    }
    return result;
  }, []);

  // --- derived, gated on ownership -----------------------------------------
  // `entries` may briefly still hold the previous user's data on the render
  // where `authUserId` has already flipped but the clearing effect hasn't run
  // yet. `trusted` is false for that render, so nothing leaks.
  const trusted = !!authUserId && ownerId === authUserId;

  const favorites = useMemo(() => {
    if (!trusted) return EMPTY_ARRAY;
    return Object.keys(entries)
      .map((id) => entries[id])
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }, [trusted, entries]);

  const favoriteIds = useMemo(
    () => (trusted ? new Set(Object.keys(entries)) : EMPTY_SET),
    [trusted, entries]
  );

  const isFavorite = useCallback(
    (recipeId) => {
      if (recipeId == null || !trusted) return false;
      if (hasKey(pendingTargets, recipeId)) return pendingTargets[recipeId];
      return hasKey(entries, recipeId);
    },
    [trusted, entries, pendingTargets]
  );

  const isPending = useCallback((recipeId) => trusted && !!pending[recipeId], [trusted, pending]);

  // Never expose a stale 'ready' / 'error' while the data doesn't belong to the
  // current user — hearts must read as "still loading", not "unsaved".
  const effectiveStatus = !authUserId ? 'idle' : trusted ? status : 'loading';

  const value = useMemo(
    () => ({
      favorites,
      favoriteIds,
      status: effectiveStatus, // 'idle' | 'loading' | 'ready' | 'error'
      error: trusted ? error : null,
      isInitializing: effectiveStatus === 'idle' || effectiveStatus === 'loading',
      isReady: effectiveStatus === 'ready',
      isFavorite,
      isPending,
      addFavorite: (recipe) => runMutation(recipe && recipe.id, true, recipe),
      removeFavorite: (recipeId) => runMutation(recipeId, false, null),
      toggleFavorite: (recipe) =>
        runMutation(recipe && recipe.id, !isFavorite(recipe && recipe.id), recipe),
      reload,
    }),
    [
      favorites,
      favoriteIds,
      effectiveStatus,
      error,
      trusted,
      isFavorite,
      isPending,
      runMutation,
      reload,
    ]
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext);
  if (!ctx) {
    throw new Error('useFavorites() must be called from inside a <FavoritesProvider>');
  }
  return ctx;
}
