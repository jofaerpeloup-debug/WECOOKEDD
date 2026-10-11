import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useAuth } from './AuthContext';
import { useNotifications } from './NotificationsContext';
import { useMealReminders } from './MealReminderContext';
import { markNotificationRead } from '../api/notificationService';
import { registerPushInstallation, unregisterPushInstallation } from '../api/pushInstallationService';
import {
  createInstallationRecord, incrementAndPersist, loadInstallationRecord, saveInstallationRecord,
} from '../notifications/pushInstallationStore';
import { permissionState, responseKey, setBeforePushLogout } from '../notifications/nativePushLifecycle';
import { actionDestination, isLocalReminderDiscriminator, validNativeNotificationData } from '../navigation/notificationAction';
import { navigationRef } from '../navigation/navigationRef';
import { PREFIX as MEAL4_PREFIX } from '../notifications/mealReminderSessionStore';

const NativePushContext = createContext(null);
const IS_NATIVE = Platform.OS === 'ios' || Platform.OS === 'android';
const PROJECT_ID = '2fd3ccda-ee13-4acb-9766-7f892c50fc09';
const CHANNEL_ID = 'general';

async function rotateLostContinuity(stillCurrent = () => true) {
  if (!stillCurrent()) return null;
  try { await Notifications.unregisterForNotificationsAsync(); } catch { /* best effort */ }
  if (!stillCurrent()) return null;
  const record = await createInstallationRecord();
  if (!stillCurrent()) return null;
  if (!(await saveInstallationRecord(record))) throw new Error('Push installation state could not be persisted.');
  return stillCurrent() ? record : null;
}

async function currentRecord({ increment = false } = {}) {
  const loaded = await loadInstallationRecord();
  let record;
  if (loaded.kind === 'valid') record = loaded.record;
  else if (loaded.kind === 'missing') {
    record = await createInstallationRecord();
    if (!(await saveInstallationRecord(record))) throw new Error('Push installation state could not be persisted.');
    return record;
  } else if (loaded.kind === 'malformed' || loaded.kind === 'unavailable') {
    return rotateLostContinuity();
  } else {
    throw new Error('Native push is unsupported.');
  }
  return increment ? incrementAndPersist(record) : record;
}

function tokenValue(result) {
  const value = result?.data;
  return typeof value === 'string' && /^(?:Expo|Exponent)PushToken\[[A-Za-z0-9_-]{1,200}\]$/.test(value)
    ? value : null;
}

async function waitForNavigation(stillCurrent) {
  while (stillCurrent() && !navigationRef.isReady()) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return stillCurrent() && navigationRef.isReady();
}

export function NativePushProvider({ children }) {
  const { user, isReady, isLoggedIn, sessionIdentity } = useAuth();
  const { reload } = useNotifications();
  const { handleLocalTap, mayShowLocal } = useMealReminders();
  const ownerId = isLoggedIn ? user?.id || null : null;
  const pushEnabled = isLoggedIn && user?.preferences?.notifications?.push === true;
  const [status, setStatus] = useState(IS_NATIVE ? 'checking' : 'unsupported');
  const [error, setError] = useState(null);
  const mountedRef = useRef(false);
  const stateRef = useRef({ ownerId, sessionIdentity, pushEnabled, authReady: isReady });
  const lifecycleOperationRef = useRef(0);
  const responseOperationRef = useRef(0);
  const consumedRef = useRef(new Set());
  stateRef.current = { ownerId, sessionIdentity, pushEnabled, authReady: isReady };

  const captureLifecycle = useCallback(() => ({
    ownerId: stateRef.current.ownerId,
    generation: stateRef.current.sessionIdentity?.generation,
    localSessionRevision: stateRef.current.sessionIdentity?.localSessionRevision,
    pushEnabled: stateRef.current.pushEnabled,
  }), []);

  const owned = useCallback((captured, operation) => mountedRef.current
    && lifecycleOperationRef.current === operation
    && stateRef.current.ownerId === captured.ownerId
    && stateRef.current.sessionIdentity?.generation === captured.generation
    && stateRef.current.sessionIdentity?.localSessionRevision === captured.localSessionRevision
    && stateRef.current.pushEnabled === captured.pushEnabled,
  []);

  const unregister = useCallback(async ({ server = true, captured, operation } = {}) => {
    const stillCurrent = () => !captured || owned(captured, operation);
    if (!stillCurrent()) return false;
    const loaded = await loadInstallationRecord();
    if (!stillCurrent()) return false;
    if (loaded.kind === 'valid') {
      const next = await incrementAndPersist(loaded.record);
      if (!stillCurrent()) return false;
      if (server) {
        try { await unregisterPushInstallation(next); } catch { /* auth logout and local cleanup must continue */ }
      }
      if (!stillCurrent()) return false;
    } else if (loaded.kind === 'malformed' || loaded.kind === 'unavailable') {
      return !!(await rotateLostContinuity(stillCurrent));
    }
    if (!stillCurrent()) return false;
    try { await Notifications.unregisterForNotificationsAsync(); } catch { /* best effort */ }
    return stillCurrent();
  }, [owned]);

  const registerCurrentToken = useCallback(async (providedToken, request = null) => {
    const captured = request?.captured || captureLifecycle();
    const operation = request?.operation ?? ++lifecycleOperationRef.current;
    if (!captured.ownerId || !stateRef.current.pushEnabled) return;
    setError(null);
    setStatus('checking');
    let permission = await Notifications.getPermissionsAsync();
    if (permissionState(permission) === 'requestable') permission = await Notifications.requestPermissionsAsync();
    if (!owned(captured, operation)) return;
    if (permissionState(permission) !== 'granted') {
      await unregister({ server: true, captured, operation });
      if (owned(captured, operation)) setStatus('denied');
      return;
    }
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'General notifications',
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: null,
        enableVibrate: true,
      });
    }
    if (Constants.expoConfig?.extra?.eas?.projectId !== PROJECT_ID) {
      throw new Error('Expo project identity is unavailable.');
    }
    let loaded = await loadInstallationRecord();
    let recoveredRecord = null;
    if (loaded.kind === 'malformed' || loaded.kind === 'unavailable') {
      recoveredRecord = await rotateLostContinuity(() => owned(captured, operation));
      if (!recoveredRecord) return;
      loaded = { kind: 'valid', record: recoveredRecord };
    } else if (loaded.kind === 'unsupported') {
      throw new Error('Native push is unsupported.');
    }
    if (!owned(captured, operation)) return;
    const token = (!recoveredRecord && providedToken) || tokenValue(await Notifications.getExpoPushTokenAsync({
      projectId: PROJECT_ID,
    }));
    if (!token) throw new Error('Expo push token was unavailable.');
    if (!owned(captured, operation)) return;
    let record = recoveredRecord;
    if (!record && loaded.kind === 'valid') record = await incrementAndPersist(loaded.record);
    if (!record && loaded.kind === 'missing') {
      record = await createInstallationRecord();
      if (!owned(captured, operation)) return;
      if (!(await saveInstallationRecord(record))) throw new Error('Push installation state could not be persisted.');
    }
    if (!record) throw new Error('Push installation state is unavailable.');
    if (!owned(captured, operation)) return;
    await registerPushInstallation(record, { platform: Platform.OS, expoPushToken: token });
    if (owned(captured, operation)) setStatus('registered');
  }, [captureLifecycle, owned, unregister]);

  const reconcile = useCallback(async () => {
    if (!IS_NATIVE) { setStatus('unsupported'); return; }
    const captured = captureLifecycle();
    const operation = ++lifecycleOperationRef.current;
    try {
      if (!captured.ownerId || !captured.pushEnabled) {
        if (captured.ownerId) await unregister({ server: true, captured, operation });
        else {
          if (owned(captured, operation)) {
            try { await Notifications.unregisterForNotificationsAsync(); } catch { /* best effort */ }
          }
        }
        if (owned(captured, operation)) setStatus(captured.ownerId ? 'disabled' : 'idle');
        return;
      }
      await registerCurrentToken(undefined, { captured, operation });
    } catch {
      if (owned(captured, operation)) {
        setStatus('error');
        setError('Push notifications are unavailable. Please retry.');
      }
    }
  }, [captureLifecycle, owned, registerCurrentToken, unregister]);

  const consumeResponse = useCallback(async (response) => {
    const key = responseKey(response);
    if (!key) return;
    while (mountedRef.current && !stateRef.current.authReady) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!mountedRef.current || consumedRef.current.has(key)) return;
    consumedRef.current.add(key);
    const data = response?.notification?.request?.content?.data;
    const captured = {
      ownerId: stateRef.current.ownerId,
      generation: stateRef.current.sessionIdentity?.generation,
      localSessionRevision: stateRef.current.sessionIdentity?.localSessionRevision,
    };
    const operation = ++responseOperationRef.current;
    const sameOwner = () => mountedRef.current && responseOperationRef.current === operation
      && stateRef.current.ownerId === captured.ownerId
      && stateRef.current.sessionIdentity?.generation === captured.generation
      && stateRef.current.sessionIdentity?.localSessionRevision === captured.localSessionRevision;
    try {
      if (!captured.ownerId) return;
      if (response?.notification?.request?.identifier?.startsWith(MEAL4_PREFIX)) {
        if (!isLocalReminderDiscriminator(data)) return;
        if (await waitForNavigation(sameOwner)) await handleLocalTap(response, sameOwner);
        return;
      }
      if (!validNativeNotificationData(data)) return;
      if (!(await waitForNavigation(sameOwner))) return;
      const result = await markNotificationRead(data.notificationId);
      if (!sameOwner()) return;
      const destination = actionDestination(result.notification.action);
      if (destination) navigationRef.navigate(...destination);
    } catch {
      // Missing, archived, expired, foreign, malformed, and network-failed responses never navigate.
    } finally {
      try {
        const last = await Notifications.getLastNotificationResponseAsync();
        if (responseKey(last) === key) await Notifications.clearLastNotificationResponseAsync();
      } catch {
        // Best effort only; never clear without proving the exact response is still current.
      }
    }
  }, [handleLocalTap]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      lifecycleOperationRef.current += 1;
      responseOperationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!IS_NATIVE) return undefined;
    setBeforePushLogout(async ({ localOnly = false } = {}) => {
      const captured = captureLifecycle();
      const operation = ++lifecycleOperationRef.current;
      responseOperationRef.current += 1;
      await unregister({ server: !localOnly, captured, operation });
    });
    return () => setBeforePushLogout(null);
  }, [captureLifecycle, unregister]);

  useEffect(() => {
    if (!isReady) return;
    void reconcile();
  }, [isReady, ownerId, sessionIdentity, pushEnabled, reconcile]);

  useEffect(() => {
    if (!IS_NATIVE) return undefined;
    const tokenSubscription = Notifications.addPushTokenListener((token) => {
      if (stateRef.current.ownerId && stateRef.current.pushEnabled) {
        const captured = captureLifecycle();
        const operation = ++lifecycleOperationRef.current;
        void registerCurrentToken(tokenValue(token), { captured, operation }).catch(() => {
          if (owned(captured, operation)) {
            setStatus('error');
            setError('Push notifications are unavailable. Please retry.');
          }
        });
      }
    });
    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification?.request?.content?.data;
      if (stateRef.current.ownerId && stateRef.current.pushEnabled && validNativeNotificationData(data)) void reload();
    });
    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => void consumeResponse(response));
    const appStateSubscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void reconcile();
    });
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => ({
        shouldShowBanner: notification?.request?.identifier?.startsWith(MEAL4_PREFIX)
          ? await mayShowLocal(notification.request.content.data) : !!stateRef.current.ownerId && stateRef.current.pushEnabled,
        shouldShowList: notification?.request?.identifier?.startsWith(MEAL4_PREFIX)
          ? await mayShowLocal(notification.request.content.data) : !!stateRef.current.ownerId && stateRef.current.pushEnabled,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) void consumeResponse(response);
    });
    return () => {
      tokenSubscription.remove();
      receivedSubscription.remove();
      responseSubscription.remove();
      appStateSubscription.remove();
      Notifications.setNotificationHandler({
        handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }),
      });
    };
  }, [captureLifecycle, consumeResponse, owned, reconcile, registerCurrentToken, reload, mayShowLocal]);

  const openSettings = useCallback(() => Linking.openSettings(), []);
  return (
    <NativePushContext.Provider value={{ status, error, retry: reconcile, openSettings }}>
      {children}
    </NativePushContext.Provider>
  );
}

export function useNativePush() {
  const value = useContext(NativePushContext);
  if (!value) throw new Error('useNativePush() must be used inside NativePushProvider.');
  return value;
}

export { CHANNEL_ID, PROJECT_ID, tokenValue, currentRecord };
