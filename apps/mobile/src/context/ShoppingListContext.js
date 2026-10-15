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
import {
  getShoppingListErrorMessage,
  isAmbiguousShoppingMutationOutcome,
  isItemAlreadyGone,
  isShoppingListStale,
} from '../api/shoppingListErrors';

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
//   - `sessionRef` is bumped on every auth session identity change and invalidates
//     every outstanding GET AND every outstanding mutation for the old session.
//   - `listGenRef` is bumped on every (re)load and on every mutation, and
//     decides which GET result may apply. It is DELIBERATELY separate from
//     `sessionRef` so a focus / pull reload can never strand an in-flight
//     mutation, and so a mutation's authoritative response always supersedes an
//     older GET.
//   - The loaded state is tagged with its auth session (`ownerSessionKey`).
//     `items` / `list` / `status` are exposed as empty / loading on an account
//     or session change, including a new session for the same user.
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
  const { status: authStatus, user, sessionIdentity } = useAuth();
  const authUserId = authStatus === 'authenticated' && user
    && sessionIdentity?.ownerId === user.id ? user.id : null;
  const authSessionKey = authUserId
    ? JSON.stringify([
      authUserId,
      sessionIdentity.generation,
      sessionIdentity.localSessionRevision,
    ])
    : null;

  // { id, items, createdAt, updatedAt } | null
  const [list, setList] = useState(null);
  // The auth session `list` was loaded / cleared for. Gate at render time so
  // a previous session's rows cannot appear during a same-user session change.
  const [ownerSessionKey, setOwnerSessionKey] = useState(null);
  // 'idle' (no session) | 'loading' (initial load) | 'ready' | 'error' (initial load failed, nothing to show)
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  // { type: 'addItem' | 'addCustomItem' | 'addRecipe' | 'updateItem' | 'setChecked' | 'removeItem' | 'clearChecked' | 'clear', itemId?: string } | null
  const [pendingAction, setPendingAction] = useState(null);
  const [reconciliationRequired, setReconciliationRequired] = useState(false);

  // --- refs: latest values readable inside async closures --------------------
  const mountedRef = useRef(true);
  const sessionRef = useRef(0); // bumped ONLY on auth session identity change
  const listGenRef = useRef(0); // bumped on every (re)load AND every mutation
  const loadingRef = useRef(null); // identity of the active GET
  const mutatingRef = useRef(false); // synchronous one-mutation-at-a-time lock
  const statusRef = useRef(status);
  const authUserIdRef = useRef(authUserId);
  const reconciliationRequiredRef = useRef(false);
  const capabilityRef = useRef(false);

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
    const request = { listGen, session };
    loadingRef.current = request;
    const stale = () =>
      loadingRef.current !== request || listGen !== listGenRef.current
      || session !== sessionRef.current || !mountedRef.current;

    try {
      const fresh = await shoppingListService.getShoppingList();
      if (stale()) return;
      capabilityRef.current = true;
      setList(normalizeList(fresh));
      reconciliationRequiredRef.current = false;
      setReconciliationRequired(false);
      setError(null);
      setStatus('ready');
      statusRef.current = 'ready';
    } catch (err) {
      if (session === sessionRef.current && mountedRef.current) capabilityRef.current = false;
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
      if (loadingRef.current === request) loadingRef.current = null;
    }
  }, []);

  // --- react to auth: wipe previous session, then load current session ------
  useEffect(() => {
    authUserIdRef.current = authUserId;

    // An auth identity change invalidates every outstanding GET AND every
    // outstanding mutation belonging to the previous user.
    sessionRef.current += 1;
    listGenRef.current += 1;
    loadingRef.current = null;
    const session = sessionRef.current;
    const listGen = listGenRef.current;

    // Clear the previous session's state before any load starts. The render
    // before this effect runs is covered by the `trusted` gate further down.
    mutatingRef.current = false;
    capabilityRef.current = false;
    reconciliationRequiredRef.current = false;
    setList(null);
    setPendingAction(null);
    setReconciliationRequired(false);
    setError(null);
    setOwnerSessionKey(authSessionKey);

    if (!authUserId) {
      setStatus('idle');
      statusRef.current = 'idle';
      return;
    }

    setStatus('loading');
    statusRef.current = 'loading';
    load(listGen, session);
  }, [authSessionKey, authUserId, load]);

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

  const reconcileAfterMutation = useCallback(async (session) => {
    listGenRef.current += 1;
    const listGen = listGenRef.current;
    const request = { listGen, session };
    loadingRef.current = request;
    const stale = () =>
      loadingRef.current !== request || listGen !== listGenRef.current
      || session !== sessionRef.current || !mountedRef.current;

    try {
      const fresh = await shoppingListService.getShoppingList();
      if (stale()) return { ok: false, superseded: true };
      capabilityRef.current = true;
      setList(normalizeList(fresh));
      reconciliationRequiredRef.current = false;
      setReconciliationRequired(false);
      setError(null);
      setStatus('ready');
      statusRef.current = 'ready';
      return { ok: true };
    } catch (err) {
      if (session === sessionRef.current && mountedRef.current) capabilityRef.current = false;
      if (stale()) return { ok: false, superseded: true };
      const message = getShoppingListErrorMessage(err);
      reconciliationRequiredRef.current = true;
      setReconciliationRequired(true);
      setError(message);
      return { ok: false, error: message, err };
    } finally {
      if (loadingRef.current === request) loadingRef.current = null;
    }
  }, []);

  // --- one mutation at a time ---------------------------------------------
  const runMutation = useCallback(
    async (action, fn, { destructive = false, idempotentDelete = false } = {}) => {
      if (!authUserIdRef.current) {
        return { ok: false, error: 'Your session has expired. Please log in again.' };
      }
      if (!capabilityRef.current) {
        return { ok: false, error: 'Refresh your shopping list before making another change.' };
      }
      if (reconciliationRequiredRef.current) {
        return { ok: false, error: 'Refresh your shopping list before making another change.' };
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
        const alreadyGone = idempotentDelete && isItemAlreadyGone(err);
        const mustReconcile = alreadyGone
          || isShoppingListStale(err)
          || (destructive && isAmbiguousShoppingMutationOutcome(err));

        if (mustReconcile) {
          const reconciled = await reconcileAfterMutation(session);
          if (reconciled.superseded) return reconciled;
          if (alreadyGone && reconciled.ok) {
            return { ok: true, idempotent: true };
          }
          if (!reconciled.ok) {
            return { ok: false, error: reconciled.error || message, err };
          }
        }
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
    [load, reconcileAfterMutation]
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

  const addCustomItem = useCallback(
    (label) => runMutation({ type: 'addCustomItem' }, () => shoppingListService.addCustomItem(label)),
    [runMutation]
  );

  const addRecipe = useCallback(
    (recipeId) =>
      runMutation({ type: 'addRecipe', recipeId }, () => shoppingListService.addRecipe(recipeId)),
    [runMutation]
  );

  const setChecked = useCallback(
    (itemId, isChecked, type = 'ingredient') =>
      runMutation({ type: 'setChecked', itemId }, () =>
        shoppingListService.updateItem(itemId, { type, isChecked })
      ),
    [runMutation]
  );

  const updateItem = useCallback(
    (itemId, { quantity, unit }) =>
      runMutation({ type: 'updateItem', itemId }, () =>
        shoppingListService.updateItem(itemId, { type: 'ingredient', quantity, unit })
      ),
    [runMutation]
  );

  const removeItem = useCallback(
    (itemId) => runMutation(
      { type: 'removeItem', itemId },
      () => shoppingListService.removeItem(itemId),
      { destructive: true, idempotentDelete: true }
    ),
    [runMutation]
  );

  const clearChecked = useCallback(
    () => runMutation(
      { type: 'clearChecked' },
      () => shoppingListService.clearCheckedItems(),
      { destructive: true }
    ),
    [runMutation]
  );

  const clear = useCallback(
    () => runMutation(
      { type: 'clear' },
      () => shoppingListService.clearItems(),
      { destructive: true }
    ),
    [runMutation]
  );

  // --- derived, gated on ownership ---------------------------------------
  // `list` may briefly still hold the previous user's data on the render where
  // `authUserId` has already flipped but the clearing effect hasn't run yet.
  // `trusted` is false for that render, so nothing leaks.
  const trusted = !!authSessionKey && ownerSessionKey === authSessionKey;

  const items = useMemo(() => {
    if (!trusted || !list || !Array.isArray(list.items)) return EMPTY_ITEMS;
    return list.items;
  }, [trusted, list]);

  // Never expose a stale 'ready' / 'error' while the data doesn't belong to the
  // current user — the screen must read as "still loading", not "empty".
  const effectiveStatus = !authUserId ? 'idle' : trusted ? status : 'loading';

  const isMutating = trusted && (!!pendingAction || reconciliationRequired);

  const isItemPending = useCallback(
    (itemId) => trusted && !!pendingAction && pendingAction.itemId === itemId,
    [trusted, pendingAction]
  );

  const value = useMemo(
    () => ({
      list: trusted ? list : null,
      sessionKey: trusted ? authSessionKey : null,
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
      addCustomItem,
      addRecipe,
      updateItem,
      setChecked,
      removeItem,
      clearChecked,
      clear,
    }),
    [
      trusted,
      list,
      authSessionKey,
      items,
      effectiveStatus,
      error,
      isMutating,
      pendingAction,
      isItemPending,
      reload,
      addItem,
      addCustomItem,
      addRecipe,
      updateItem,
      setChecked,
      removeItem,
      clearChecked,
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
