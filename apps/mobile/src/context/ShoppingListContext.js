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
import * as shoppingListService from '../api/shoppingListService';
import { getShoppingListErrorMessage, isItemAlreadyGone } from '../api/shoppingListErrors';

// ---------------------------------------------------------------------------
// The SINGLE authoritative Shopping List state, backed entirely by the Express
// Shopping List REST API:
//
//   ShoppingListProvider
//     -> shoppingListService -> shared api client -> /api/v1/shopping-list -> MongoDB
//
// The backend is the ONLY source of truth. This provider does NOT read from or
// write to AsyncStorage (the old `wecooked:shoppingList` key is left in place
// but is never touched again), never uploads old local data, and never merges
// local and backend state.
//
// Ownership is always the authenticated backend identity; this provider never
// sends a userId or a shoppingListId. It observes the existing AuthContext (it
// never modifies it) and is strictly user-scoped, using the same proven design
// as FavoritesProvider:
//
//   - `sessionRef` is bumped on every auth/user identity change and invalidates
//     every outstanding GET AND every outstanding mutation for the old user.
//   - `listGenRef` is bumped on every (re)load and on every mutation, and
//     decides which GET result may apply. It is DELIBERATELY separate from
//     `sessionRef` so a focus / pull reload can never strand an in-flight
//     mutation, and so a mutation's authoritative response always supersedes an
//     older GET.
//   - The loaded state is tagged with the user id it belongs to (`ownerId`).
//     `items` / `list` / `status` are exposed as empty / loading the instant
//     `ownerId !== currentAuthenticatedUserId`, so User A's items cannot render
//     for even one frame under User B (a render happens before the clearing
//     effect runs).
//
// The Shopping List is one Mongo document with embedded items, so mutations are
// SERIALIZED — a synchronous ref lock (`mutatingRef`) guarantees two taps that
// land before React re-renders still cannot issue two concurrent mutation
// requests, avoiding backend save/version-conflict risk. There is no queue: one
// mutation at a time.
//
// Mutations are PESSIMISTIC: mark pending -> call backend -> the backend returns
// the COMPLETE shopping list -> replace provider state with it -> clear pending.
// Nothing is fabricated locally before a request succeeds, so there is no
// rollback logic. The one idempotent exception is a delete of an already-gone
// item (SHOPPING_LIST_ITEM_NOT_FOUND) -> reconcile via reload rather than error.
// ---------------------------------------------------------------------------

const EMPTY_ITEMS = [];

const ShoppingListContext = createContext(null);

function normalizeList(raw) {
  const r = raw || {};
  return {
    id: r.id ?? null,
    items: Array.isArray(r.items) ? r.items : [],
    createdAt: r.createdAt ?? null,
    updatedAt: r.updatedAt ?? null,
  };
}

export function ShoppingListProvider({ children }) {
  const { status: authStatus, user } = useAuth();
  const authUserId = authStatus === 'authenticated' && user ? user.id : null;

  // { id, items, createdAt, updatedAt } | null
  const [list, setList] = useState(null);
  // The user id `list` was loaded / cleared for. Compared against `authUserId`
  // at render time to gate exposure (cross-user leak guard).
  const [ownerId, setOwnerId] = useState(null);
  // 'idle' (no session) | 'loading' (initial load) | 'ready' | 'error' (initial load failed, nothing to show)
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  // { type: 'addItem' | 'addRecipe' | 'setChecked' | 'removeItem' | 'clear', itemId?: string } | null
  const [pendingAction, setPendingAction] = useState(null);

  // --- refs: latest values readable inside async closures --------------------
  const mountedRef = useRef(true);
  const sessionRef = useRef(0); // bumped ONLY on auth/user identity change
  const listGenRef = useRef(0); // bumped on every (re)load AND every mutation
  const loadingRef = useRef(false); // a GET is in flight
  const mutatingRef = useRef(false); // synchronous one-mutation-at-a-time lock
  const statusRef = useRef(status);
  const authUserIdRef = useRef(authUserId);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // --- GET (initial load + reload) -----------------------------------------
  const load = useCallback(async (listGen, session) => {
    const stale = () =>
      listGen !== listGenRef.current || session !== sessionRef.current || !mountedRef.current;

    loadingRef.current = true;
    try {
      const fresh = await shoppingListService.getShoppingList();
      if (stale()) return;
      setList(normalizeList(fresh));
      setError(null);
      setStatus('ready');
      statusRef.current = 'ready';
    } catch (err) {
      if (stale()) return;
      const message = getShoppingListErrorMessage(err);
      if (statusRef.current === 'ready') {
        // A failed REFRESH: keep the list we already have, surface a soft note.
        setError(message);
      } else {
        // Initial load failed with nothing to show.
        setError(message);
        setStatus('error');
        statusRef.current = 'error';
      }
    } finally {
      loadingRef.current = false;
    }
  }, []);

  // --- react to auth: wipe previous user, then load current user ------------
  useEffect(() => {
    authUserIdRef.current = authUserId;

    // An auth identity change invalidates every outstanding GET AND every
    // outstanding mutation belonging to the previous user.
    sessionRef.current += 1;
    listGenRef.current += 1;
    const session = sessionRef.current;
    const listGen = listGenRef.current;

    // Clear the previous user's state IMMEDIATELY — before any load starts.
    // `ownerId` is set to the current user in the same batch, so once this
    // commits `list` (null) genuinely belongs to `authUserId`. Any render
    // BEFORE this effect runs is covered by the `trusted` gate further down.
    mutatingRef.current = false;
    setList(null);
    setPendingAction(null);
    setError(null);
    setOwnerId(authUserId);

    if (!authUserId) {
      setStatus('idle');
      statusRef.current = 'idle';
      return;
    }

    setStatus('loading');
    statusRef.current = 'loading';
    load(listGen, session);
  }, [authUserId, load]);

  // --- manual reload (screen focus / pull-to-refresh) ----------------------
  // Bumps ONLY listGenRef — never sessionRef. Skipped while a GET or a mutation
  // is already in flight: a mutation's response is newer truth and lands
  // shortly, and overlapping GETs are wasteful.
  const reload = useCallback(() => {
    if (!authUserIdRef.current) return Promise.resolve();
    if (mutatingRef.current || loadingRef.current) return Promise.resolve();
    listGenRef.current += 1;
    const listGen = listGenRef.current;
    const session = sessionRef.current;
    if (statusRef.current !== 'ready') {
      setStatus('loading');
      statusRef.current = 'loading';
    }
    return load(listGen, session);
  }, [load]);

  // --- one mutation at a time ---------------------------------------------
  const runMutation = useCallback(
    async (action, fn) => {
      if (!authUserIdRef.current) {
        return { ok: false, error: 'Your session has expired. Please log in again.' };
      }
      // Synchronous lock: a second tap before re-render cannot start a request.
      if (mutatingRef.current) return { ok: false, busy: true };
      mutatingRef.current = true;

      const session = sessionRef.current;
      // Invalidate any GET that started before this mutation — the mutation's
      // response is authoritative and must win.
      listGenRef.current += 1;

      setPendingAction(action);

      try {
        const fresh = await fn();
        if (session !== sessionRef.current || !mountedRef.current) {
          return { ok: false, superseded: true };
        }
        setList(normalizeList(fresh));
        setError(null);
        setStatus('ready');
        statusRef.current = 'ready';
        return { ok: true };
      } catch (err) {
        if (session !== sessionRef.current || !mountedRef.current) {
          return { ok: false, superseded: true };
        }
        const message = getShoppingListErrorMessage(err);
        // If we never had a usable list (mutation raced the initial load and
        // that load was discarded), recover it rather than leaving the provider
        // stuck on 'loading'/'error'.
        if (statusRef.current !== 'ready') {
          listGenRef.current += 1;
          load(listGenRef.current, session);
        }
        return { ok: false, error: message, err };
      } finally {
        // Only this mutation's own session may release the lock. If the session
        // changed mid-flight, the auth effect already reset the lock and
        // pendingAction for the new user — and a newer session's mutation may
        // now legitimately hold the lock, so this stale one must not clear it.
        if (session === sessionRef.current) {
          mutatingRef.current = false;
          setPendingAction(null);
        }
      }
    },
    [load]
  );

  // Manual add of ONE canonical ingredient. A thin runMutation wrapper — it
  // inherits the synchronous one-at-a-time lock, session-generation guard,
  // stale-GET invalidation, and pessimistic full-list replacement unchanged.
  // The picker MUST call this (never shoppingListService.addItem directly), so
  // a manual add can never race a check/remove/clear or an in-flight reload.
  // `quantity` is already a finite number > 0 for measurable units and is
  // omitted for `toTaste` — the caller parses/validates before calling.
  const addItem = useCallback(
    ({ ingredientId, unit, quantity }) =>
      runMutation({ type: 'addItem' }, () =>
        shoppingListService.addItem({ ingredientId, unit, quantity })
      ),
    [runMutation]
  );

  const addRecipe = useCallback(
    (recipeId) =>
      runMutation({ type: 'addRecipe', recipeId }, () => shoppingListService.addRecipe(recipeId)),
    [runMutation]
  );

  const setChecked = useCallback(
    (itemId, isChecked) =>
      runMutation({ type: 'setChecked', itemId }, () =>
        shoppingListService.updateItem(itemId, { isChecked })
      ),
    [runMutation]
  );

  const removeItem = useCallback(
    async (itemId) => {
      const result = await runMutation({ type: 'removeItem', itemId }, () =>
        shoppingListService.removeItem(itemId)
      );
      if (!result.ok && result.err && isItemAlreadyGone(result.err)) {
        // The backend confirms no such item exists. Drop exactly that item from
        // the current list locally — a pure, self-guarding updater that does not
        // depend on the mutation-lock release timing — then kick a best-effort
        // full reconcile.
        setList((prev) =>
          prev && Array.isArray(prev.items) && prev.items.some((it) => it.id === itemId)
            ? { ...prev, items: prev.items.filter((it) => it.id !== itemId) }
            : prev
        );
        reload();
        return { ok: true, idempotent: true };
      }
      return result;
    },
    [runMutation, reload]
  );

  const clear = useCallback(
    () => runMutation({ type: 'clear' }, () => shoppingListService.clearItems()),
    [runMutation]
  );

  // --- derived, gated on ownership ---------------------------------------
  // `list` may briefly still hold the previous user's data on the render where
  // `authUserId` has already flipped but the clearing effect hasn't run yet.
  // `trusted` is false for that render, so nothing leaks.
  const trusted = !!authUserId && ownerId === authUserId;

  const items = useMemo(() => {
    if (!trusted || !list || !Array.isArray(list.items)) return EMPTY_ITEMS;
    return list.items;
  }, [trusted, list]);

  // Never expose a stale 'ready' / 'error' while the data doesn't belong to the
  // current user — the screen must read as "still loading", not "empty".
  const effectiveStatus = !authUserId ? 'idle' : trusted ? status : 'loading';

  const isMutating = trusted && !!pendingAction;

  const isItemPending = useCallback(
    (itemId) => trusted && !!pendingAction && pendingAction.itemId === itemId,
    [trusted, pendingAction]
  );

  const value = useMemo(
    () => ({
      list: trusted ? list : null,
      items,
      status: effectiveStatus, // 'idle' | 'loading' | 'ready' | 'error'
      error: trusted ? error : null,
      isInitializing: effectiveStatus === 'idle' || effectiveStatus === 'loading',
      isReady: effectiveStatus === 'ready',
      isMutating,
      pendingAction: trusted ? pendingAction : null,
      isItemPending,
      reload,
      addItem,
      addRecipe,
      setChecked,
      removeItem,
      clear,
    }),
    [
      trusted,
      list,
      items,
      effectiveStatus,
      error,
      isMutating,
      pendingAction,
      isItemPending,
      reload,
      addItem,
      addRecipe,
      setChecked,
      removeItem,
      clear,
    ]
  );

  return <ShoppingListContext.Provider value={value}>{children}</ShoppingListContext.Provider>;
}

export function useShoppingList() {
  const ctx = useContext(ShoppingListContext);
  if (!ctx) {
    throw new Error('useShoppingList() must be called from inside a <ShoppingListProvider>');
  }
  return ctx;
}
