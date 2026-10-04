import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useAuth } from './AuthContext';
import {
  archiveAllNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  updateNotificationPreference,
} from '../api/notificationService';

const NotificationsContext = createContext(null);
const DEFAULT_PREFERENCES = Object.freeze({
  push: true,
  email: true,
  suggestions: true,
  digest: false,
  reminders: true,
});

function canonicalPreferences(user) {
  const source = user?.preferences?.notifications;
  if (!source) return DEFAULT_PREFERENCES;
  return {
    push: source.push === true,
    email: source.email === true,
    suggestions: source.suggestions === true,
    digest: source.digest === true,
    reminders: source.reminders === true,
  };
}

function messageFor(error) {
  if (error?.code === 'AUTH_SESSION_CHANGED') return 'Your account changed. Try again.';
  if (error?.isNetworkError || error?.kind === 'network') return 'Notifications are unavailable. Check your connection and retry.';
  return 'Notifications are unavailable. Please retry.';
}

export function NotificationsProvider({ children }) {
  const { user, isLoggedIn, syncUser } = useAuth();
  const authUserId = isLoggedIn ? user?.id || null : null;

  const mountedRef = useRef(false);
  const ownerRef = useRef(null);
  const generationRef = useRef(0);
  const listGenerationRef = useRef(0);
  const listTokenRef = useRef(0);
  const continuationTokenRef = useRef(0);
  const mutationVersionRef = useRef(0);
  const rowsRef = useRef([]);
  const pageInfoRef = useRef({ nextCursor: null, hasMore: false });
  const readTokensRef = useRef(new Map());
  const inboxTokenRef = useRef(null);
  const inboxMutationQueueRef = useRef(Promise.resolve());
  const preferenceTokensRef = useRef(new Map());
  const preferenceQueueRef = useRef(Promise.resolve());
  const loadFirstRef = useRef(null);

  const [ownerId, setOwnerId] = useState(null);
  const [status, setStatus] = useState('idle');
  const [rows, setRows] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pageInfo, setPageInfo] = useState({ nextCursor: null, hasMore: false });
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pendingReads, setPendingReads] = useState({});
  const [inboxPending, setInboxPending] = useState(false);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [preferencePending, setPreferencePending] = useState({});
  const [preferenceError, setPreferenceError] = useState(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      listGenerationRef.current += 1;
      listTokenRef.current += 1;
      continuationTokenRef.current += 1;
      readTokensRef.current.clear();
      inboxTokenRef.current = null;
      inboxMutationQueueRef.current = Promise.resolve();
      preferenceTokensRef.current.clear();
    };
  }, []);

  const owned = useCallback((owner, generation) => (
    mountedRef.current
    && ownerRef.current === owner
    && generationRef.current === generation
  ), []);

  const loadFirst = useCallback(async ({ soft = false } = {}) => {
    const owner = ownerRef.current;
    if (!owner) return false;
    const generation = generationRef.current;
    const listGeneration = ++listGenerationRef.current;
    const token = ++listTokenRef.current;
    const mutationVersion = mutationVersionRef.current;
    continuationTokenRef.current += 1;
    setLoadingMore(false);
    if (soft && rowsRef.current.length > 0) setRefreshing(true);
    else setStatus('loading');
    setError(null);
    try {
      const result = await listNotifications({ limit: 20 });
      if (!owned(owner, generation) || token !== listTokenRef.current
        || listGeneration !== listGenerationRef.current) return false;
      if (mutationVersion !== mutationVersionRef.current) {
        setRefreshing(false);
        Promise.resolve().then(() => loadFirstRef.current?.({ soft: rowsRef.current.length > 0 }));
        return false;
      }
      rowsRef.current = result.notifications;
      pageInfoRef.current = result.pageInfo;
      setRows(result.notifications);
      setUnreadCount(result.unreadCount);
      setPageInfo(result.pageInfo);
      setStatus('ready');
      setRefreshing(false);
      return true;
    } catch (requestError) {
      if (!owned(owner, generation) || token !== listTokenRef.current
        || listGeneration !== listGenerationRef.current) return false;
      setError(messageFor(requestError));
      setRefreshing(false);
      if (rowsRef.current.length === 0) setStatus('error');
      return false;
    }
  }, [owned]);
  loadFirstRef.current = loadFirst;

  useEffect(() => {
    ownerRef.current = authUserId;
    generationRef.current += 1;
    listGenerationRef.current += 1;
    listTokenRef.current += 1;
    continuationTokenRef.current += 1;
    mutationVersionRef.current = 0;
    rowsRef.current = [];
    pageInfoRef.current = { nextCursor: null, hasMore: false };
    readTokensRef.current.clear();
    inboxTokenRef.current = null;
    inboxMutationQueueRef.current = Promise.resolve();
    preferenceTokensRef.current.clear();
    preferenceQueueRef.current = Promise.resolve();
    setOwnerId(authUserId);
    setRows([]);
    setUnreadCount(0);
    setPageInfo({ nextCursor: null, hasMore: false });
    setError(null);
    setRefreshing(false);
    setLoadingMore(false);
    setPendingReads({});
    setInboxPending(false);
    setPreferences(canonicalPreferences(user));
    setPreferencePending({});
    setPreferenceError(null);
    if (!authUserId) {
      setStatus('idle');
      return;
    }
    setStatus('loading');
    Promise.resolve().then(() => loadFirstRef.current?.());
  }, [authUserId]);

  useEffect(() => {
    if (ownerId === authUserId && authUserId) setPreferences(canonicalPreferences(user));
  }, [authUserId, ownerId, user]);

  const loadMore = useCallback(async () => {
    const owner = ownerRef.current;
    const cursor = pageInfoRef.current.nextCursor;
    if (!owner || !pageInfoRef.current.hasMore || !cursor || loadingMore) return false;
    const generation = generationRef.current;
    const listGeneration = listGenerationRef.current;
    const token = ++continuationTokenRef.current;
    const mutationVersion = mutationVersionRef.current;
    setLoadingMore(true);
    setError(null);
    try {
      const result = await listNotifications({ limit: 20, cursor });
      if (!owned(owner, generation) || token !== continuationTokenRef.current
        || listGeneration !== listGenerationRef.current
        || pageInfoRef.current.nextCursor !== cursor
        || mutationVersion !== mutationVersionRef.current) return false;
      const ids = new Set(rowsRef.current.map((row) => row.id));
      if (result.notifications.some((row) => ids.has(row.id))) {
        setError('Notifications are unavailable. Please retry.');
        return false;
      }
      const nextRows = [...rowsRef.current, ...result.notifications];
      rowsRef.current = nextRows;
      pageInfoRef.current = result.pageInfo;
      setRows(nextRows);
      setUnreadCount(result.unreadCount);
      setPageInfo(result.pageInfo);
      return true;
    } catch (requestError) {
      if (owned(owner, generation) && token === continuationTokenRef.current
        && listGeneration === listGenerationRef.current) setError(messageFor(requestError));
      return false;
    } finally {
      if (owned(owner, generation) && token === continuationTokenRef.current) setLoadingMore(false);
    }
  }, [loadingMore, owned]);

  const enqueueInboxMutation = useCallback((operation) => {
    const task = inboxMutationQueueRef.current.then(operation);
    inboxMutationQueueRef.current = task.catch(() => false);
    return task;
  }, []);

  const markRead = useCallback((notificationId) => {
    const owner = ownerRef.current;
    if (!owner || readTokensRef.current.has(notificationId)) return Promise.resolve(false);
    const generation = generationRef.current;
    const token = Symbol(notificationId);
    readTokensRef.current.set(notificationId, token);
    setPendingReads((current) => ({ ...current, [notificationId]: true }));
    setError(null);

    return enqueueInboxMutation(async () => {
      try {
        if (!owned(owner, generation) || readTokensRef.current.get(notificationId) !== token) return false;
        const result = await markNotificationRead(notificationId);
        if (!owned(owner, generation) || readTokensRef.current.get(notificationId) !== token) return false;
        mutationVersionRef.current += 1;
        const nextRows = rowsRef.current.map((row) => (
          row.id === notificationId ? result.notification : row
        ));
        rowsRef.current = nextRows;
        setRows(nextRows);
        setUnreadCount(result.unreadCount);
        return true;
      } catch (requestError) {
        if (owned(owner, generation) && readTokensRef.current.get(notificationId) === token) {
          setError(messageFor(requestError));
        }
        return false;
      } finally {
        if (readTokensRef.current.get(notificationId) === token) {
          readTokensRef.current.delete(notificationId);
          if (owned(owner, generation)) {
            setPendingReads((current) => {
              const next = { ...current };
              delete next[notificationId];
              return next;
            });
          }
        }
      }
    });
  }, [enqueueInboxMutation, owned]);

  const runInboxMutation = useCallback((kind, throughNotificationId) => {
    const owner = ownerRef.current;
    if (!owner || !throughNotificationId || inboxTokenRef.current) return Promise.resolve(false);
    const generation = generationRef.current;
    const token = Symbol(kind);
    inboxTokenRef.current = token;
    setInboxPending(true);
    setError(null);

    return enqueueInboxMutation(async () => {
      try {
        if (!owned(owner, generation) || inboxTokenRef.current !== token) return false;
        const result = kind === 'read'
          ? await markAllNotificationsRead(throughNotificationId)
          : await archiveAllNotifications(throughNotificationId);
        if (!owned(owner, generation) || inboxTokenRef.current !== token) return false;
        mutationVersionRef.current += 1;
        setUnreadCount(result.unreadCount);
        await loadFirstRef.current?.({ soft: kind === 'read' });
        return owned(owner, generation) && inboxTokenRef.current === token;
      } catch (requestError) {
        if (owned(owner, generation) && inboxTokenRef.current === token) setError(messageFor(requestError));
        return false;
      } finally {
        if (inboxTokenRef.current === token) {
          inboxTokenRef.current = null;
          if (owned(owner, generation)) setInboxPending(false);
        }
      }
    });
  }, [enqueueInboxMutation, owned]);

  const setPreference = useCallback((key, value) => {
    const owner = ownerRef.current;
    if (!owner || !(key in DEFAULT_PREFERENCES) || typeof value !== 'boolean') {
      return Promise.resolve(false);
    }
    const generation = generationRef.current;
    const token = Symbol(key);
    preferenceTokensRef.current.set(key, token);
    setPreferencePending((current) => ({ ...current, [key]: true }));
    setPreferenceError(null);

    const task = preferenceQueueRef.current.then(async () => {
      if (!owned(owner, generation) || preferenceTokensRef.current.get(key) !== token) return false;
      try {
        const updatedUser = await updateNotificationPreference(key, value);
        if (!owned(owner, generation) || preferenceTokensRef.current.get(key) !== token
          || updatedUser.id !== owner) return false;
        setPreferences(canonicalPreferences(updatedUser));
        syncUser(updatedUser);
        return true;
      } catch (requestError) {
        if (owned(owner, generation) && preferenceTokensRef.current.get(key) === token) {
          setPreferenceError(messageFor(requestError));
        }
        return false;
      } finally {
        if (preferenceTokensRef.current.get(key) === token) {
          preferenceTokensRef.current.delete(key);
          if (owned(owner, generation)) {
            setPreferencePending((current) => {
              const next = { ...current };
              delete next[key];
              return next;
            });
          }
        }
      }
    });
    preferenceQueueRef.current = task.catch(() => false);
    return task;
  }, [owned, syncUser]);

  const trusted = !!authUserId && ownerId === authUserId;
  const effectiveStatus = !authUserId ? 'idle' : trusted ? status : 'loading';
  const value = useMemo(() => ({
    ownerId: trusted ? ownerId : authUserId,
    generation: generationRef.current,
    notifications: trusted ? rows : [],
    unreadCount: trusted ? unreadCount : 0,
    status: effectiveStatus,
    error: trusted ? error : null,
    refreshing: trusted && refreshing,
    loadingMore: trusted && loadingMore,
    hasMore: trusted && pageInfo.hasMore,
    pendingReads: trusted ? pendingReads : {},
    inboxPending: trusted && inboxPending,
    preferences: trusted ? preferences : DEFAULT_PREFERENCES,
    preferencePending: trusted ? preferencePending : {},
    preferenceError: trusted ? preferenceError : null,
    reload: () => loadFirst({ soft: rowsRef.current.length > 0 }),
    retry: () => loadFirst({ soft: false }),
    loadMore,
    markRead,
    markAllRead: (throughNotificationId) => runInboxMutation('read', throughNotificationId),
    archiveAll: (throughNotificationId) => runInboxMutation('archive', throughNotificationId),
    setPreference,
  }), [
    authUserId, ownerId, trusted, rows, unreadCount, effectiveStatus, error, refreshing,
    loadingMore, pageInfo.hasMore, pendingReads, inboxPending, preferences,
    preferencePending, preferenceError, loadFirst, loadMore, markRead, runInboxMutation, setPreference,
  ]);

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error('useNotifications() must be called inside <NotificationsProvider>.');
  return context;
}

export { DEFAULT_PREFERENCES };
