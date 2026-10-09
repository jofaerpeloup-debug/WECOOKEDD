const { actionDestination, validNativeNotificationData } = require('../src/navigation/notificationAction');
const React = require('react');

let mockAuth;
let mockPreferences;
const mockReload = jest.fn();
const mockNavigate = jest.fn();
let mockAppStateListener;
let mockNotificationReceivedListener;
let mockNotificationResponseListener;
let currentPush;

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: { addEventListener: jest.fn((_event, listener) => {
    mockAppStateListener = listener;
    return { remove: jest.fn() };
  }) },
  Linking: { openSettings: jest.fn() },
}));
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../src/context/NotificationsContext', () => ({
  useNotifications: () => ({
    preferences: mockPreferences,
    reload: mockReload,
  }),
}));
jest.mock('../src/api/notificationService', () => ({ markNotificationRead: jest.fn() }));
jest.mock('../src/api/pushInstallationService', () => ({
  registerPushInstallation: jest.fn(), unregisterPushInstallation: jest.fn(),
}));
jest.mock('../src/notifications/pushInstallationStore', () => ({
  createInstallationRecord: jest.fn(), incrementAndPersist: jest.fn(),
  loadInstallationRecord: jest.fn(async () => ({ kind: 'missing' })),
  saveInstallationRecord: jest.fn(),
}));
jest.mock('../src/navigation/navigationRef', () => ({
  navigationRef: { isReady: jest.fn(() => true), navigate: (...args) => mockNavigate(...args) },
}));

const Notifications = require('expo-notifications');
const { markNotificationRead } = require('../src/api/notificationService');
const pushInstallationService = require('../src/api/pushInstallationService');
const pushInstallationStore = require('../src/notifications/pushInstallationStore');
const { NativePushProvider, useNativePush } = require('../src/context/NativePushContext');
const { runBeforePushLogout } = require('../src/notifications/nativePushLifecycle');
const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

const ID = '507f1f77bcf86cd799439011';

function loggedInAuth(id = '507f1f77bcf86cd799439001', generation = 1, push = true) {
  return {
    isReady: true,
    isLoggedIn: true,
    user: { id, preferences: { notifications: { push } } },
    sessionIdentity: { ownerId: id, generation, localSessionRevision: generation },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

function PushProbe() {
  currentPush = useNativePush();
  return null;
}

it('accepts only the exact frozen native payload and maps only authoritative notification actions', () => {
  expect(validNativeNotificationData({ version: 1, kind: 'notification', notificationId: ID })).toBe(true);
  expect(validNativeNotificationData({ version: 1, kind: 'notification', notificationId: ID, route: 'Admin' })).toBe(false);
  expect(validNativeNotificationData({ version: 1, kind: 'url', notificationId: ID })).toBe(false);
  expect(actionDestination({ kind: 'recipe', recipeId: ID })).toEqual(['RecipeDetail', { recipeSource: 'api', recipeId: ID }]);
  expect(actionDestination({ kind: 'none' })).toBeNull();
  expect(actionDestination({ kind: 'recipe', recipeId: 'bad', route: 'Admin' })).toBeNull();
});

function nativeResponse(identifier = 'response-1') {
  return {
    actionIdentifier: 'default',
    notification: { request: {
      identifier,
      content: { data: { version: 1, kind: 'notification', notificationId: ID } },
    } },
  };
}

async function flushTimers(ms = 60) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockAppStateListener = null;
  mockNotificationReceivedListener = null;
  mockNotificationResponseListener = null;
  currentPush = null;
  Notifications.addNotificationReceivedListener.mockImplementation((listener) => {
    mockNotificationReceivedListener = listener;
    return { remove: jest.fn() };
  });
  Notifications.addNotificationResponseReceivedListener.mockImplementation((listener) => {
    mockNotificationResponseListener = listener;
    return { remove: jest.fn() };
  });
  Notifications.unregisterForNotificationsAsync.mockResolvedValue(undefined);
  Notifications.setNotificationHandler.mockImplementation(() => undefined);
  Notifications.getLastNotificationResponseAsync.mockResolvedValue(null);
  mockPreferences = { push: false };
  pushInstallationStore.loadInstallationRecord.mockResolvedValue({ kind: 'missing' });
  pushInstallationStore.createInstallationRecord.mockResolvedValue({
    version: 1,
    installationId: '123e4567-e89b-42d3-a456-426614174000',
    bindingCredential: 'A'.repeat(43),
    bindingGeneration: 1,
  });
  pushInstallationStore.saveInstallationRecord.mockResolvedValue(true);
  pushInstallationStore.incrementAndPersist.mockImplementation(async (record) => ({
    ...record, bindingGeneration: record.bindingGeneration + 1,
  }));
  pushInstallationService.registerPushInstallation.mockResolvedValue({ status: 'active' });
  pushInstallationService.unregisterPushInstallation.mockResolvedValue({ unregistered: true });
});

it('does not inspect or request OS permission from an untrusted notification-context default', async () => {
  mockPreferences = { push: true };
  mockAuth = {
    isReady: true,
    isLoggedIn: true,
    user: { id: '507f1f77bcf86cd799439001', preferences: { notifications: { push: false } } },
    sessionIdentity: {
      ownerId: '507f1f77bcf86cd799439001', generation: 1, localSessionRevision: 1,
    },
  };
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<NativePushProvider><PushProbe /></NativePushProvider>);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(currentPush.status).toBe('disabled');
  expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  renderer.unmount();
});

it('requests an undetermined permission once and registers only after the authoritative grant', async () => {
  const record = await pushInstallationStore.createInstallationRecord();
  Notifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined', granted: false, canAskAgain: true });
  Notifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted', granted: true, canAskAgain: true });
  Notifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExpoPushToken[granted]' });
  mockPreferences = { push: true };
  mockAuth = loggedInAuth();
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<NativePushProvider><React.Fragment /></NativePushProvider>);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(pushInstallationService.registerPushInstallation).toHaveBeenCalledWith(record, {
    platform: 'ios', expoPushToken: 'ExpoPushToken[granted]',
  });
  renderer.unmount();
});

it('granted permission registers the exact project token and runtime rotation advances the persisted generation', async () => {
  const record = await pushInstallationStore.createInstallationRecord();
  let tokenListener;
  Notifications.addPushTokenListener.mockImplementation((listener) => {
    tokenListener = listener;
    return { remove: jest.fn() };
  });
  Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted', granted: true, canAskAgain: true });
  Notifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExpoPushToken[first]' });
  mockPreferences = { push: true };
  mockAuth = loggedInAuth();
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<NativePushProvider><React.Fragment /></NativePushProvider>);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: '2fd3ccda-ee13-4acb-9766-7f892c50fc09' });
  expect(pushInstallationService.registerPushInstallation).toHaveBeenCalledWith(record, {
    platform: 'ios', expoPushToken: 'ExpoPushToken[first]',
  });

  pushInstallationStore.loadInstallationRecord.mockResolvedValue({ kind: 'valid', record });
  await act(async () => {
    tokenListener({ data: 'ExpoPushToken[rotated]' });
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(pushInstallationStore.incrementAndPersist).toHaveBeenCalledWith(record);
  expect(pushInstallationService.registerPushInstallation).toHaveBeenLastCalledWith(
    { ...record, bindingGeneration: 2 },
    { platform: 'ios', expoPushToken: 'ExpoPushToken[rotated]' }
  );
  renderer.unmount();
});

it('a non-requestable denial never prompts or obtains a token and unregisters the exact persisted binding', async () => {
  const record = await pushInstallationStore.createInstallationRecord();
  pushInstallationStore.loadInstallationRecord.mockResolvedValue({ kind: 'valid', record });
  Notifications.getPermissionsAsync.mockResolvedValue({ status: 'denied', granted: false, canAskAgain: false });
  mockPreferences = { push: true };
  mockAuth = loggedInAuth();
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<NativePushProvider><React.Fragment /></NativePushProvider>);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  expect(pushInstallationService.unregisterPushInstallation).toHaveBeenCalledWith({ ...record, bindingGeneration: 2 });
  expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalled();
  renderer.unmount();
});

it('foreground return rechecks permission and unregisters when a previous grant was revoked', async () => {
  const record = await pushInstallationStore.createInstallationRecord();
  pushInstallationStore.loadInstallationRecord.mockResolvedValue({ kind: 'valid', record });
  Notifications.getPermissionsAsync
    .mockResolvedValueOnce({ status: 'granted', granted: true, canAskAgain: true })
    .mockResolvedValue({ status: 'denied', granted: false, canAskAgain: false });
  Notifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExpoPushToken[first]' });
  mockPreferences = { push: true };
  mockAuth = loggedInAuth();
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<NativePushProvider><React.Fragment /></NativePushProvider>);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(pushInstallationService.registerPushInstallation).toHaveBeenCalledTimes(1);
  pushInstallationService.unregisterPushInstallation.mockClear();
  await act(async () => {
    mockAppStateListener('active');
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(Notifications.getPermissionsAsync).toHaveBeenCalledTimes(2);
  expect(pushInstallationService.unregisterPushInstallation).toHaveBeenCalledTimes(1);
  expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalled();
  renderer.unmount();
});

it('lost-continuity recovery unregisters the provider before obtaining and registering a fresh token', async () => {
  const providerCleanup = deferred();
  pushInstallationStore.loadInstallationRecord.mockResolvedValue({ kind: 'malformed' });
  Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted', granted: true, canAskAgain: true });
  Notifications.unregisterForNotificationsAsync.mockReturnValue(providerCleanup.promise);
  Notifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExpoPushToken[fresh]' });
  mockPreferences = { push: true };
  mockAuth = loggedInAuth();
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<NativePushProvider><PushProbe /></NativePushProvider>);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  expect(pushInstallationService.registerPushInstallation).not.toHaveBeenCalled();
  await act(async () => {
    providerCleanup.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: '2fd3ccda-ee13-4acb-9766-7f892c50fc09' });
  expect(pushInstallationService.registerPushInstallation).toHaveBeenCalledWith(
    expect.objectContaining({ bindingGeneration: 1 }),
    { platform: 'ios', expoPushToken: 'ExpoPushToken[fresh]' }
  );
  renderer.unmount();
});

it('a timed-out logout cleanup cannot unregister the provider after a newer account registers', async () => {
  const cleanup = deferred();
  let stored = await pushInstallationStore.createInstallationRecord();
  pushInstallationStore.loadInstallationRecord.mockImplementation(async () => ({ kind: 'valid', record: stored }));
  pushInstallationStore.incrementAndPersist.mockImplementation(async (record) => {
    stored = { ...record, bindingGeneration: record.bindingGeneration + 1 };
    return stored;
  });
  Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted', granted: true, canAskAgain: true });
  Notifications.getExpoPushTokenAsync
    .mockResolvedValueOnce({ data: 'ExpoPushToken[accountA]' })
    .mockResolvedValueOnce({ data: 'ExpoPushToken[accountB]' });
  mockPreferences = { push: true };
  mockAuth = loggedInAuth();
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<NativePushProvider><PushProbe /></NativePushProvider>);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  pushInstallationService.unregisterPushInstallation.mockReturnValue(cleanup.promise);
  const oldCleanup = runBeforePushLogout();
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(pushInstallationService.unregisterPushInstallation).toHaveBeenCalledTimes(1);
  const logoutWait = Promise.race([
    oldCleanup,
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
  await act(async () => { jest.advanceTimersByTime(1500); await logoutWait; });
  Notifications.unregisterForNotificationsAsync.mockClear();

  mockAuth = loggedInAuth('507f1f77bcf86cd799439002', 2);
  await act(async () => {
    renderer.update(<NativePushProvider><PushProbe /></NativePushProvider>);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(pushInstallationService.registerPushInstallation).toHaveBeenCalledTimes(2);
  await act(async () => { cleanup.resolve({ unregistered: true }); await oldCleanup; });
  expect(Notifications.unregisterForNotificationsAsync).not.toHaveBeenCalled();
  expect(pushInstallationService.registerPushInstallation).toHaveBeenLastCalledWith(
    expect.objectContaining({ bindingGeneration: 4 }),
    { platform: 'ios', expoPushToken: 'ExpoPushToken[accountB]' }
  );
  renderer.unmount();
});

it('rapid push off then on makes the late disable cleanup inert and preserves the newer registration', async () => {
  const cleanup = deferred();
  let stored = await pushInstallationStore.createInstallationRecord();
  pushInstallationStore.loadInstallationRecord.mockImplementation(async () => ({ kind: 'valid', record: stored }));
  pushInstallationStore.incrementAndPersist.mockImplementation(async (record) => {
    stored = { ...record, bindingGeneration: record.bindingGeneration + 1 };
    return stored;
  });
  Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted', granted: true, canAskAgain: true });
  Notifications.getExpoPushTokenAsync
    .mockResolvedValueOnce({ data: 'ExpoPushToken[first]' })
    .mockResolvedValueOnce({ data: 'ExpoPushToken[reenabled]' });
  mockPreferences = { push: true };
  mockAuth = loggedInAuth();
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<NativePushProvider><PushProbe /></NativePushProvider>);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
  pushInstallationService.unregisterPushInstallation.mockReturnValue(cleanup.promise);
  mockPreferences = { push: false };
  mockAuth = loggedInAuth('507f1f77bcf86cd799439001', 1, false);
  await act(async () => {
    renderer.update(<NativePushProvider><PushProbe /></NativePushProvider>);
    await Promise.resolve(); await Promise.resolve();
  });
  expect(pushInstallationService.unregisterPushInstallation).toHaveBeenCalledTimes(1);
  Notifications.unregisterForNotificationsAsync.mockClear();
  mockPreferences = { push: true };
  mockAuth = loggedInAuth();
  await act(async () => {
    renderer.update(<NativePushProvider><PushProbe /></NativePushProvider>);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
  expect(pushInstallationService.registerPushInstallation).toHaveBeenCalledTimes(2);
  await act(async () => { cleanup.resolve({ unregistered: true }); await Promise.resolve(); });
  expect(Notifications.unregisterForNotificationsAsync).not.toHaveBeenCalled();
  renderer.unmount();
});

it('failed server cleanup remains recoverable by a later owned registration', async () => {
  let stored = await pushInstallationStore.createInstallationRecord();
  pushInstallationStore.loadInstallationRecord.mockImplementation(async () => ({ kind: 'valid', record: stored }));
  pushInstallationStore.incrementAndPersist.mockImplementation(async (record) => {
    stored = { ...record, bindingGeneration: record.bindingGeneration + 1 };
    return stored;
  });
  Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted', granted: true, canAskAgain: true });
  Notifications.getExpoPushTokenAsync
    .mockResolvedValueOnce({ data: 'ExpoPushToken[first]' })
    .mockResolvedValueOnce({ data: 'ExpoPushToken[retry]' });
  mockPreferences = { push: true };
  mockAuth = loggedInAuth();
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<NativePushProvider><PushProbe /></NativePushProvider>);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
  pushInstallationService.unregisterPushInstallation.mockRejectedValueOnce(new Error('offline'));
  mockPreferences = { push: false };
  mockAuth = loggedInAuth('507f1f77bcf86cd799439001', 1, false);
  await act(async () => {
    renderer.update(<NativePushProvider><PushProbe /></NativePushProvider>);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
  expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalledTimes(1);
  mockPreferences = { push: true };
  mockAuth = loggedInAuth();
  await act(async () => {
    renderer.update(<NativePushProvider><PushProbe /></NativePushProvider>);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
  expect(pushInstallationService.registerPushInstallation).toHaveBeenLastCalledWith(
    expect.objectContaining({ bindingGeneration: 4 }),
    { platform: 'ios', expoPushToken: 'ExpoPushToken[retry]' }
  );
  renderer.unmount();
});

it('an owned registration failure exits checking and exposes a retryable error', async () => {
  Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted', granted: true, canAskAgain: true });
  Notifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExpoPushToken[failure]' });
  pushInstallationService.registerPushInstallation.mockRejectedValueOnce(new Error('offline'));
  mockPreferences = { push: true };
  mockAuth = loggedInAuth();
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<NativePushProvider><PushProbe /></NativePushProvider>);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
  expect(currentPush.status).toBe('error');
  expect(currentPush.error).toMatch(/retry/i);
  renderer.unmount();
});

afterEach(() => {
  jest.useRealTimers();
});

it('holds a cold response through auth restoration, then reads authoritatively before navigating and clears only that response', async () => {
  const response = nativeResponse();
  Notifications.getLastNotificationResponseAsync.mockResolvedValue(response);
  markNotificationRead.mockResolvedValue({ notification: { action: { kind: 'recipe', recipeId: ID } } });
  mockAuth = {
    isReady: false,
    isLoggedIn: false,
    user: null,
    sessionIdentity: { ownerId: null, generation: 0, localSessionRevision: 0 },
  };
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<NativePushProvider><React.Fragment /></NativePushProvider>);
    await Promise.resolve();
  });
  expect(markNotificationRead).not.toHaveBeenCalled();
  mockAuth = loggedInAuth();
  await act(async () => {
    renderer.update(<NativePushProvider><React.Fragment /></NativePushProvider>);
  });
  await flushTimers();
  expect(markNotificationRead).toHaveBeenCalledWith(ID);
  expect(mockNavigate).toHaveBeenCalledWith('RecipeDetail', { recipeSource: 'api', recipeId: ID });
  expect(Notifications.clearLastNotificationResponseAsync).toHaveBeenCalledTimes(1);
  renderer.unmount();
});

it('an account change during authoritative read blocks navigation but clears the exact old response so it cannot replay', async () => {
  const response = nativeResponse('old-account-response');
  Notifications.getLastNotificationResponseAsync.mockResolvedValue(response);
  let resolveRead;
  markNotificationRead.mockImplementation(() => new Promise((resolve) => { resolveRead = resolve; }));
  mockAuth = loggedInAuth();
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<NativePushProvider><React.Fragment /></NativePushProvider>);
    await Promise.resolve();
  });
  expect(markNotificationRead).toHaveBeenCalledWith(ID);
  mockAuth = loggedInAuth('507f1f77bcf86cd799439002', 2);
  await act(async () => {
    renderer.update(<NativePushProvider><React.Fragment /></NativePushProvider>);
    await Promise.resolve();
  });
  await act(async () => {
    resolveRead({ notification: { action: { kind: 'recipe', recipeId: ID } } });
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(Notifications.clearLastNotificationResponseAsync).toHaveBeenCalledTimes(1);
  renderer.unmount();
});

it('handles a warm notification response through the same authoritative read and navigation path', async () => {
  const response = nativeResponse('warm-response');
  markNotificationRead.mockResolvedValue({ notification: { action: { kind: 'recipe', recipeId: ID } } });
  mockAuth = loggedInAuth();
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<NativePushProvider><React.Fragment /></NativePushProvider>);
    await Promise.resolve();
  });
  expect(mockNotificationResponseListener).toEqual(expect.any(Function));
  await act(async () => {
    mockNotificationResponseListener(response);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(markNotificationRead).toHaveBeenCalledTimes(1);
  expect(markNotificationRead).toHaveBeenCalledWith(ID);
  expect(mockNavigate).toHaveBeenCalledWith('RecipeDetail', { recipeSource: 'api', recipeId: ID });
  renderer.unmount();
});

it('deduplicates concurrent cold and warm delivery of the same response before authoritative read', async () => {
  const response = nativeResponse('cold-warm-duplicate');
  const read = deferred();
  Notifications.getLastNotificationResponseAsync.mockResolvedValue(response);
  markNotificationRead.mockReturnValue(read.promise);
  mockAuth = loggedInAuth();
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<NativePushProvider><React.Fragment /></NativePushProvider>);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(mockNotificationResponseListener).toEqual(expect.any(Function));
  await act(async () => {
    mockNotificationResponseListener(response);
    await Promise.resolve();
  });
  expect(markNotificationRead).toHaveBeenCalledTimes(1);
  await act(async () => {
    read.resolve({ notification: { action: { kind: 'recipe', recipeId: ID } } });
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(mockNavigate).toHaveBeenCalledTimes(1);
  expect(Notifications.clearLastNotificationResponseAsync).toHaveBeenCalledTimes(1);
  renderer.unmount();
});

it('preserves a newer pending response while an older authoritative reconciliation finishes', async () => {
  const older = nativeResponse('older-response');
  const newer = nativeResponse('newer-response');
  const read = deferred();
  Notifications.getLastNotificationResponseAsync.mockResolvedValueOnce(older);
  markNotificationRead.mockReturnValue(read.promise);
  mockAuth = loggedInAuth();
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<NativePushProvider><React.Fragment /></NativePushProvider>);
    await Promise.resolve();
  });
  expect(markNotificationRead).toHaveBeenCalledWith(ID);
  Notifications.getLastNotificationResponseAsync.mockResolvedValue(newer);
  await act(async () => {
    read.resolve({ notification: { action: { kind: 'none' } } });
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(Notifications.clearLastNotificationResponseAsync).not.toHaveBeenCalled();
  renderer.unmount();
});

it('a valid foreground receipt causes exactly one guarded page-one reload', async () => {
  mockPreferences = { push: true };
  mockAuth = loggedInAuth();
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<NativePushProvider><React.Fragment /></NativePushProvider>);
    await Promise.resolve();
  });
  expect(mockNotificationReceivedListener).toEqual(expect.any(Function));
  mockReload.mockClear();
  await act(async () => {
    mockNotificationReceivedListener(nativeResponse('receipt').notification);
    mockNotificationReceivedListener({ request: { content: { data: { version: 1, kind: 'notification', notificationId: 'bad' } } } });
    await Promise.resolve();
  });
  expect(mockReload).toHaveBeenCalledTimes(1);
  expect(mockReload).toHaveBeenCalledWith();

  mockAuth = loggedInAuth('507f1f77bcf86cd799439001', 1, false);
  await act(async () => {
    renderer.update(<NativePushProvider><React.Fragment /></NativePushProvider>);
    await Promise.resolve();
  });
  await act(async () => {
    mockNotificationReceivedListener(nativeResponse('disabled-receipt').notification);
    await Promise.resolve();
  });
  expect(mockReload).toHaveBeenCalledTimes(1);
  renderer.unmount();
});

it('settings return registers a newly granted token and session expiry tears down provider state', async () => {
  Notifications.getPermissionsAsync
    .mockResolvedValueOnce({ status: 'denied', granted: false, canAskAgain: false })
    .mockResolvedValueOnce({ status: 'granted', granted: true, canAskAgain: true });
  Notifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExpoPushToken[settings]' });
  mockPreferences = { push: true };
  mockAuth = loggedInAuth();
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<NativePushProvider><PushProbe /></NativePushProvider>);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(currentPush.status).toBe('denied');
  await act(async () => { await currentPush.openSettings(); });
  const { Linking } = require('react-native');
  expect(Linking.openSettings).toHaveBeenCalledTimes(1);
  await act(async () => {
    mockAppStateListener('active');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(pushInstallationService.registerPushInstallation).toHaveBeenCalledWith(
    expect.objectContaining({ bindingGeneration: 1 }),
    { platform: 'ios', expoPushToken: 'ExpoPushToken[settings]' }
  );
  Notifications.unregisterForNotificationsAsync.mockClear();
  mockAuth = {
    isReady: true,
    isLoggedIn: false,
    user: null,
    sessionIdentity: { ownerId: null, generation: 2, localSessionRevision: 2 },
  };
  await act(async () => {
    renderer.update(<NativePushProvider><PushProbe /></NativePushProvider>);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalledTimes(1);
  expect(currentPush.status).toBe('idle');
  renderer.unmount();
});

it('mounted web remains unsupported without native listeners, permission, token, API, storage, or provider cleanup effects', async () => {
  mockAuth = loggedInAuth();
  await jest.isolateModulesAsync(async () => {
    const webReact = require('react');
    const webRenderer = require('react-test-renderer');
    const webNotifications = require('expo-notifications');
    const webReactNative = require('react-native');
    const webPushApi = require('../src/api/pushInstallationService');
    const webPushStore = require('../src/notifications/pushInstallationStore');
    webReactNative.Platform.OS = 'web';

    const { NativePushProvider: WebNativePushProvider, useNativePush: useWebNativePush } = require('../src/context/NativePushContext');
    const { runBeforePushLogout: runBeforeWebPushLogout } = require('../src/notifications/nativePushLifecycle');
    let webStatus;
    function WebProbe() {
      webStatus = useWebNativePush().status;
      return null;
    }

    let renderer;
    await webRenderer.act(async () => {
      renderer = webRenderer.create(
        <WebNativePushProvider><WebProbe /></WebNativePushProvider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await runBeforeWebPushLogout();

    expect(webStatus).toBe('unsupported');
    expect(webNotifications.addPushTokenListener).not.toHaveBeenCalled();
    expect(webNotifications.addNotificationReceivedListener).not.toHaveBeenCalled();
    expect(webNotifications.addNotificationResponseReceivedListener).not.toHaveBeenCalled();
    expect(webReactNative.AppState.addEventListener).not.toHaveBeenCalled();
    expect(webNotifications.getPermissionsAsync).not.toHaveBeenCalled();
    expect(webNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(webNotifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(webPushApi.registerPushInstallation).not.toHaveBeenCalled();
    expect(webPushApi.unregisterPushInstallation).not.toHaveBeenCalled();
    expect(webPushStore.loadInstallationRecord).not.toHaveBeenCalled();
    expect(webPushStore.createInstallationRecord).not.toHaveBeenCalled();
    expect(webPushStore.incrementAndPersist).not.toHaveBeenCalled();
    expect(webPushStore.saveInstallationRecord).not.toHaveBeenCalled();
    expect(webNotifications.unregisterForNotificationsAsync).not.toHaveBeenCalled();
    expect(webNotifications.setNotificationHandler).not.toHaveBeenCalled();
    expect(webNotifications.getLastNotificationResponseAsync).not.toHaveBeenCalled();
    renderer.unmount();
  });
});
