import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { notificationSettings } from '../data/mockData';
import { loadJSON, saveJSON } from '../utils/storage';

const FEED_KEY = 'wecooked:notifFeed';
const PREFS_KEY = 'wecooked:notifPrefs';
const MAX_FEED = 40;

let seq = 0;
const genId = () => `n-${Date.now()}-${seq++}`;

const NotificationsContext = createContext(null);

// The feed only ever contains real, timestamped events this device generated
// or received (a recipe you saved, a dish you finished cooking, a cook
// reminder that actually fired) — nothing pre-seeded or fabricated. See
// pushNotification().
export function NotificationsProvider({ children }) {
  const [feed, setFeed] = useState([]);
  const [prefs, setPrefs] = useState(() =>
    Object.fromEntries(notificationSettings.map((s) => [s.id, s.value]))
  );
  const hydrated = useRef(false);
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  useEffect(() => {
    (async () => {
      const [f, p] = await Promise.all([loadJSON(FEED_KEY, null), loadJSON(PREFS_KEY, null)]);
      if (Array.isArray(f)) setFeed(f);
      if (p) setPrefs((prev) => ({ ...prev, ...p }));
      hydrated.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    saveJSON(FEED_KEY, feed);
  }, [feed]);
  useEffect(() => {
    if (!hydrated.current) return;
    saveJSON(PREFS_KEY, prefs);
  }, [prefs]);

  // Records a real event with the actual time it happened. Silently skipped
  // once the "Push Notifications" master toggle is off, so flipping it
  // genuinely stops new alerts instead of just looking like it does. Stable
  // identity (useCallback) so effects that depend on it (App.js's OS-delivery
  // mirror) don't resubscribe on every push.
  const pushNotification = useCallback(({ title, body }) => {
    if (prefsRef.current.push === false) return;
    setFeed((f) => [{ id: genId(), title, body, ts: Date.now(), read: false }, ...f].slice(0, MAX_FEED));
  }, []);

  const unreadCount = feed.filter((n) => !n.read).length;
  const markAllRead = useCallback(
    () => setFeed((f) => (f.some((n) => !n.read) ? f.map((n) => ({ ...n, read: true })) : f)),
    []
  );
  const clearFeed = useCallback(() => setFeed([]), []);
  const setPref = useCallback((id, value) => setPrefs((p) => ({ ...p, [id]: value })), []);

  const value = useMemo(
    () => ({ feed, unreadCount, markAllRead, clearFeed, pushNotification, prefs, setPref }),
    [feed, prefs]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications() must be called from inside a <NotificationsProvider>');
  return ctx;
}
