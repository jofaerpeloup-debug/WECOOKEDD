import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useAuth } from './AuthContext';
import { getLocalSessionId } from '../api/authService';
import { getMealPlanEntry } from '../api/mealPlanService';
import { ensureBinding, loadBinding, clearBinding, validRequestId } from '../notifications/mealReminderSessionStore';
import { androidInstant, calendarInstant, cancelKnownReminders, ensureChannel, reconcileReminders, validLocalData } from '../notifications/mealReminderScheduler';
import { setBeforeReminderLogout } from '../notifications/nativePushLifecycle';
import { navigationRef } from '../navigation/navigationRef';

const Context = createContext(null);
const NATIVE = Platform.OS === 'ios' || Platform.OS === 'android';

function deliveredAt(response) {
  const raw = response?.notification?.date;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
  // Expo 57 serializes iOS Date.timeIntervalSince1970 in seconds and
  // Android Date.getTime() in milliseconds.
  const ms = Platform.OS === 'ios' ? raw * 1000 : raw;
  return Number.isFinite(ms) && ms <= Number.MAX_SAFE_INTEGER ? ms : null;
}

export function validLocalTapResponse(response, fireAt, tapNow) {
  const request = response?.notification?.request;
  const data = request?.content?.data;
  if (response?.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER
    || !validRequestId(request?.identifier) || !validLocalData(data)
    || !Number.isSafeInteger(tapNow)) return false;
  const trigger = request.trigger;
  if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) return false;
  const keys = Object.keys(trigger).sort().join('|');
  if (Platform.OS === 'ios' && keys !== 'class|dateComponents|repeats|type') return false;
  if (Platform.OS === 'android' && (keys !== 'channelId|repeats|type|value'
    || trigger.channelId !== 'meal-reminders' || !Number.isSafeInteger(trigger.value))) return false;
  const authoritativeFireAt = Date.parse(fireAt);
  const nativeFireAt = Platform.OS === 'ios' ? calendarInstant(trigger)
    : Platform.OS === 'android' ? androidInstant(trigger) : null;
  const delivery = deliveredAt(response);
  return Number.isSafeInteger(authoritativeFireAt) && data.fireAt === fireAt
    && nativeFireAt === authoritativeFireAt && delivery !== null
    && delivery >= authoritativeFireAt && delivery <= tapNow;
}

export function MealReminderProvider({ children }) {
  const { user, isReady, isLoggedIn, sessionIdentity } = useAuth();
  const ownerId = isLoggedIn ? user?.id : null;
  const remindersEnabled = user?.preferences?.notifications?.reminders;
  const sessionId = ownerId ? getLocalSessionId() : null;
  const [state, setState] = useState({ kind: NATIVE ? 'pending' : 'unavailable' });
  const currentRef = useRef({ ownerId, sessionId, sessionIdentity, remindersEnabled, isReady });
  const operationRef = useRef(0);
  const suspendedRef = useRef(false);
  const mountedRef = useRef(false);
  const tailRef = useRef(Promise.resolve());
  currentRef.current = { ownerId, sessionId, sessionIdentity, remindersEnabled, isReady };

  const capture = useCallback(() => ({
    ownerId: currentRef.current.ownerId,
    sessionId: currentRef.current.sessionId,
    generation: currentRef.current.sessionIdentity?.generation,
    revision: currentRef.current.sessionIdentity?.localSessionRevision,
    remindersEnabled: currentRef.current.remindersEnabled,
    operation: operationRef.current,
  }), []);
  const owned = useCallback((value) => mountedRef.current && !suspendedRef.current && value.operation === operationRef.current
    && value.ownerId === currentRef.current.ownerId && value.sessionId === currentRef.current.sessionId
    && value.generation === currentRef.current.sessionIdentity?.generation
    && value.revision === currentRef.current.sessionIdentity?.localSessionRevision
    && value.remindersEnabled === currentRef.current.remindersEnabled, []);

  const enqueue = useCallback((run) => {
    const result = tailRef.current.then(run, run);
    tailRef.current = result.catch(() => {});
    return result;
  }, []);

  const reconcile = useCallback(({ manual = false } = {}) => {
    if (manual) operationRef.current += 1;
    const captured = capture();
    return enqueue(async () => {
      if (!NATIVE) return;
      if (!captured.ownerId || !captured.sessionId || !owned(captured)) return;
      const binding = await ensureBinding(captured.ownerId, captured.sessionId);
      if (!owned(captured)) return;
      const current = () => owned(captured);
      await reconcileReminders({ binding, remindersEnabled: captured.remindersEnabled,
        stillCurrent: current, manual, onStatus: (next) => { if (current()) setState(next); } });
    });
  }, [capture, enqueue, owned]);

  const logoutCleanup = useCallback(() => {
    suspendedRef.current = true;
    operationRef.current += 1;
    setState({ kind: 'pending' });
    // Clear the epoch at teardown entry. A queued reconciliation may still be
    // settling its own OS call, but its completion cannot keep old taps valid.
    const cleared = clearBinding();
    return enqueue(async () => {
      await cleared;
      try { await cancelKnownReminders(() => true); } catch { /* retained journal supports later recovery */ }
    });
  }, [enqueue]);

  useEffect(() => {
    mountedRef.current = true;
    setBeforeReminderLogout(logoutCleanup);
    return () => {
      mountedRef.current = false;
      operationRef.current += 1;
      setBeforeReminderLogout(null);
    };
  }, [logoutCleanup]);

  useEffect(() => {
    suspendedRef.current = false;
    operationRef.current += 1;
  }, [ownerId, sessionId, sessionIdentity?.generation, sessionIdentity?.localSessionRevision, remindersEnabled]);

  useEffect(() => {
    if (isReady && ownerId && sessionId && !suspendedRef.current) void reconcile();
  }, [isReady, ownerId, sessionId, sessionIdentity?.generation, remindersEnabled, reconcile]);

  useEffect(() => {
    if (!NATIVE) return undefined;
    const subscription = AppState.addEventListener('change', (next) => { if (next === 'active') void reconcile(); });
    return () => subscription.remove();
  }, [reconcile]);

  const requestPermission = useCallback(async () => {
    if (!NATIVE) return;
    const captured = capture();
    if (!captured.ownerId || !owned(captured)) return;
    await ensureChannel();
    if (!owned(captured)) return;
    await Notifications.requestPermissionsAsync();
    if (!owned(captured)) return;
    await reconcile();
  }, [capture, owned, reconcile]);

  const handleLocalTap = useCallback(async (response, sameOwner) => {
    const data = response?.notification?.request?.content?.data;
    if (!validLocalData(data) || !validRequestId(response?.notification?.request?.identifier)
      || response?.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return false;
    const captured = capture();
    if (!captured.ownerId || !captured.sessionId || !sameOwner() || !owned(captured)) return false;
    const loaded = await loadBinding();
    if (!sameOwner() || !owned(captured) || loaded.kind !== 'valid'
      || loaded.value.ownerId !== captured.ownerId || loaded.value.sessionId !== captured.sessionId
      || loaded.value.epoch !== data.sessionEpoch) return false;
    const entry = await getMealPlanEntry(data.entryId);
    const comparisonTime = Date.now();
    const fireAt = Date.parse(data.fireAt);
    if (!sameOwner() || !owned(captured) || entry.id !== data.entryId
      || entry.ownerId !== captured.ownerId || !entry.reminder
      || entry.reminderRevision !== data.reminderRevision || entry.reminder.fireAt !== data.fireAt
      || !validLocalTapResponse(response, entry.reminder.fireAt, comparisonTime)
      || !Number.isFinite(fireAt) || fireAt > comparisonTime
      || comparisonTime - fireAt > 24 * 60 * 60 * 1000) return false;
    if (!navigationRef.isReady()) return false;
    navigationRef.navigate('MealPlan', { entryId: entry.id, dateKey: entry.dateKey });
    return true;
  }, [capture, owned]);

  const mayShowLocal = useCallback(async (data) => {
    if (!validLocalData(data) || currentRef.current.remindersEnabled !== true || !currentRef.current.ownerId) return false;
    const captured = capture();
    const loaded = await loadBinding();
    return owned(captured) && loaded.kind === 'valid' && loaded.value.ownerId === captured.ownerId
      && loaded.value.sessionId === captured.sessionId && loaded.value.epoch === data.sessionEpoch;
  }, [capture, owned]);

  return <Context.Provider value={{ state, reconcile, manualRetry: () => reconcile({ manual: true }),
    requestPermission, openSettings: () => Linking.openSettings(), handleLocalTap, mayShowLocal }}>
    {children}
  </Context.Provider>;
}

export function useMealReminders() {
  const value = useContext(Context);
  if (!value) throw new Error('useMealReminders must be inside MealReminderProvider.');
  return value;
}
