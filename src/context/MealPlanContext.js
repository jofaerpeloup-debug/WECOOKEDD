import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { loadJSON, saveJSON } from '../utils/storage';
import { recipes } from '../data/mockData';
import {
  ensureNotificationPermission,
  scheduleMealReminder,
  cancelMealReminder,
} from '../utils/notifications';

const STORAGE_KEY = 'wecooked:mealPlan';

export const PLAN_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const MealPlanContext = createContext(null);

const emptyPlan = () => Object.fromEntries(PLAN_DAYS.map((d) => [d, []]));

// Each planned meal is { recipeId, time: 'HH:MM' | null, notifId: string | null }.
// Older stored data was a flat array of recipe ids — migrate it on load.
const normalizeDay = (list) =>
  Array.isArray(list)
    ? list.map((item) =>
        typeof item === 'string'
          ? { recipeId: item, time: null, notifId: null }
          : { recipeId: item.recipeId, time: item.time ?? null, notifId: item.notifId ?? null }
      )
    : [];

const hhmm = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

export function MealPlanProvider({ children }) {
  const [plan, setPlan] = useState(emptyPlan);
  const hydrated = useRef(false);

  useEffect(() => {
    (async () => {
      const stored = await loadJSON(STORAGE_KEY, null);
      if (stored && typeof stored === 'object') {
        const migrated = emptyPlan();
        for (const d of PLAN_DAYS) migrated[d] = normalizeDay(stored[d]);
        setPlan(migrated);
      }
      hydrated.current = true;
    })();
  }, []);

  useEffect(() => {
    if (hydrated.current) saveJSON(STORAGE_KEY, plan);
  }, [plan]);

  const addToPlan = (day, recipeId) =>
    setPlan((p) =>
      p[day].some((it) => it.recipeId === recipeId)
        ? p
        : { ...p, [day]: [...p[day], { recipeId, time: null, notifId: null }] }
    );

  const removeFromPlan = (day, recipeId) =>
    setPlan((p) => {
      const it = p[day].find((x) => x.recipeId === recipeId);
      if (it?.notifId) cancelMealReminder(it.notifId);
      return { ...p, [day]: p[day].filter((x) => x.recipeId !== recipeId) };
    });

  const clearDay = (day) =>
    setPlan((p) => {
      p[day].forEach((it) => it.notifId && cancelMealReminder(it.notifId));
      return { ...p, [day]: [] };
    });

  const clearAll = () =>
    setPlan((p) => {
      PLAN_DAYS.forEach((d) => p[d].forEach((it) => it.notifId && cancelMealReminder(it.notifId)));
      return emptyPlan();
    });

  // Sets (or clears, when `time` is null) the cook reminder for one planned
  // meal. `time` is { hour, minute }. Returns { ok, reason }.
  const setMealTime = async (day, recipeId, time) => {
    const entry = plan[day]?.find((it) => it.recipeId === recipeId);
    if (!entry) return { ok: false, reason: 'missing' };

    if (entry.notifId) await cancelMealReminder(entry.notifId);

    const write = (patch) =>
      setPlan((p) => ({
        ...p,
        [day]: p[day].map((it) => (it.recipeId === recipeId ? { ...it, ...patch } : it)),
      }));

    if (!time) {
      write({ time: null, notifId: null });
      return { ok: true };
    }

    const granted = await ensureNotificationPermission();
    if (!granted) {
      write({ time: null, notifId: null });
      return { ok: false, reason: 'permission' };
    }

    const recipe = recipes.find((r) => r.id === recipeId);
    try {
      const { id, nextDate } = await scheduleMealReminder({
        day,
        hour: time.hour,
        minute: time.minute,
        title: recipe?.title || 'your meal',
      });
      write({ time: hhmm(time.hour, time.minute), notifId: id ?? null });
      return { ok: true, nextDate };
    } catch (e) {
      write({ time: null, notifId: null });
      return { ok: false, reason: 'error', message: String(e?.message || e) };
    }
  };

  const plannedCount = PLAN_DAYS.reduce((n, d) => n + plan[d].length, 0);

  const value = useMemo(
    () => ({ plan, addToPlan, removeFromPlan, clearDay, clearAll, setMealTime, plannedCount }),
    [plan]
  );

  return <MealPlanContext.Provider value={value}>{children}</MealPlanContext.Provider>;
}

export function useMealPlan() {
  const ctx = useContext(MealPlanContext);
  if (!ctx) throw new Error('useMealPlan() must be called from inside a <MealPlanProvider>');
  return ctx;
}
