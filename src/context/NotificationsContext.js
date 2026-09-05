import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { notificationFeed, notificationSettings } from '../data/mockData';
import { loadJSON, saveJSON } from '../utils/storage';

const FEED_KEY = 'wecooked:notifFeed';
const PREFS_KEY = 'wecooked:notifPrefs';

const NotificationsContext = createContext(null);

export function NotificationsProvider({ children }) {
  const [feed, setFeed] = useState(notificationFeed);
  const [prefs, setPrefs] = useState(() =>
    Object.fromEntries(notificationSettings.map((s) => [s.id, s.value]))
  );
  const hydrated = useRef(false);

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

  const unreadCount = feed.filter((n) => !n.read).length;
  const markAllRead = () => setFeed((f) => (f.some((n) => !n.read) ? f.map((n) => ({ ...n, read: true })) : f));
  const setPref = (id, value) => setPrefs((p) => ({ ...p, [id]: value }));

  const value = useMemo(
    () => ({ feed, unreadCount, markAllRead, prefs, setPref }),
    [feed, prefs]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications() must be called from inside a <NotificationsProvider>');
  return ctx;
}
