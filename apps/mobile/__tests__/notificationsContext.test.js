const React = require('react');

let mockAuth;
jest.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (spec) => spec?.ios ?? spec?.native ?? spec?.default },
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
  Linking: { openSettings: jest.fn() },
}));
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../src/context/MealReminderContext', () => ({
  useMealReminders: () => ({ handleLocalTap: jest.fn(), mayShowLocal: jest.fn(async () => false) }),
}));
jest.mock('../src/notifications/mealReminderSessionStore', () => ({ PREFIX: 'wecooked.meal4.v1.' }));
jest.mock('../src/api/notificationService', () => ({
  listNotifications: jest.fn(),
  markNotificationRead: jest.fn(),
  markAllNotificationsRead: jest.fn(),
  archiveAllNotifications: jest.fn(),
  updateNotificationPreference: jest.fn(),
}));
jest.mock('../src/api/pushInstallationService', () => ({
  registerPushInstallation: jest.fn(), unregisterPushInstallation: jest.fn(),
}));
jest.mock('../src/notifications/pushInstallationStore', () => ({
  createInstallationRecord: jest.fn(), incrementAndPersist: jest.fn(),
  loadInstallationRecord: jest.fn(async () => ({ kind: 'missing' })),
  saveInstallationRecord: jest.fn(),
}));
jest.mock('../src/navigation/navigationRef', () => ({
  navigationRef: { isReady: jest.fn(() => true), navigate: jest.fn() },
}));

const service = require('../src/api/notificationService');
const { act, cleanup, render, waitFor } = require('@testing-library/react-native');
const { NotificationsProvider, useNotifications } = require('../src/context/NotificationsContext');
const { NativePushProvider } = require('../src/context/NativePushContext');
const NativeNotifications = require('expo-notifications');

const A = '507f1f77bcf86cd799439001';
const B = '507f1f77bcf86cd799439002';
const N1 = '507f1f77bcf86cd799439011';
const N2 = '507f1f77bcf86cd799439012';
const ISO = '2026-10-04T01:02:03.000Z';

function user(id, notificationOverrides = {}) {
  const push = notificationOverrides.push ?? true;
  return {
    id,
    preferences: {
      notifications: {
        enabled: push, push, email: true, suggestions: true, digest: false, reminders: true,
        ...notificationOverrides,
      },
    },
  };
}

function row(id = N1, overrides = {}) {
  return {
    id, type: 'savedRecipe', content: { title: `Title ${id}`, body: 'Body' },
    action: { kind: 'none' }, createdAt: ISO, readAt: null, ...overrides,
  };
}

function page(notifications = [], overrides = {}) {
  return { notifications, unreadCount: notifications.filter((item) => !item.readAt).length, pageInfo: { nextCursor: null, hasMore: false }, ...overrides };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

let current;
function Probe() {
  current = useNotifications();
  return null;
}

function mount() {
  return render(<NotificationsProvider><Probe /></NotificationsProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  current = null;
  mockAuth = { user: user(A), isLoggedIn: true, syncUser: jest.fn() };
  NativeNotifications.unregisterForNotificationsAsync.mockResolvedValue(undefined);
  NativeNotifications.getLastNotificationResponseAsync.mockResolvedValue(null);
});
afterEach(() => cleanup());

it('malformed-success/service failure is unavailable, never an empty-success inbox', async () => {
  service.listNotifications.mockRejectedValue(Object.assign(new Error('malformed'), { code: 'INVALID_RESPONSE' }));
  mount();
  await waitFor(() => expect(current.status).toBe('error'));
  expect(current.notifications).toEqual([]);
  expect(current.error).toMatch(/unavailable/i);
});

it('real NotificationsProvider ownership never lets the default push=true value prompt a push=false user', async () => {
  service.listNotifications.mockResolvedValue(page([]));
  mockAuth = {
    user: user(A, { push: false }),
    isLoggedIn: true,
    isReady: true,
    sessionIdentity: { ownerId: A, generation: 1, localSessionRevision: 1 },
    syncUser: jest.fn(),
  };
  render(
    <NotificationsProvider>
      <NativePushProvider><Probe /></NativePushProvider>
    </NotificationsProvider>
  );
  await waitFor(() => expect(current.status).toBe('ready'));
  expect(current.preferences.push).toBe(false);
  expect(NativeNotifications.getPermissionsAsync).not.toHaveBeenCalled();
  expect(NativeNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(NativeNotifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
});

it('a same-user new auth session cannot reuse the prior session preference while ownership resets', async () => {
  service.listNotifications.mockResolvedValue(page([]));
  NativeNotifications.getPermissionsAsync.mockResolvedValue({ status: 'denied', granted: false, canAskAgain: false });
  mockAuth = {
    user: user(A, { push: true }),
    isLoggedIn: true,
    isReady: true,
    sessionIdentity: { ownerId: A, generation: 1, localSessionRevision: 1 },
    syncUser: jest.fn(),
  };
  const view = render(
    <NotificationsProvider>
      <NativePushProvider><Probe /></NativePushProvider>
    </NotificationsProvider>
  );
  await waitFor(() => expect(current.status).toBe('ready'));
  await waitFor(() => expect(NativeNotifications.getPermissionsAsync).toHaveBeenCalledTimes(1));

  mockAuth = {
    ...mockAuth,
    user: user(A, { push: false }),
    sessionIdentity: { ownerId: A, generation: 2, localSessionRevision: 2 },
  };
  view.rerender(
    <NotificationsProvider>
      <NativePushProvider><Probe /></NativePushProvider>
    </NotificationsProvider>
  );
  await waitFor(() => expect(current.preferences.push).toBe(false));
  expect(NativeNotifications.getPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(NativeNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
});

it('an older list cannot overwrite a confirmed read mutation and triggers an owned page-one reload', async () => {
  const stale = deferred();
  const readAt = '2026-10-04T02:00:00.000Z';
  service.listNotifications
    .mockResolvedValueOnce(page([row()]))
    .mockReturnValueOnce(stale.promise)
    .mockResolvedValueOnce(page([row(N1, { readAt })], { unreadCount: 0 }));
  service.markNotificationRead.mockResolvedValue({ notification: row(N1, { readAt }), unreadCount: 0 });
  mount();
  await waitFor(() => expect(current.status).toBe('ready'));
  let reloadPromise;
  act(() => { reloadPromise = current.reload(); });
  await waitFor(() => expect(service.listNotifications).toHaveBeenCalledTimes(2));
  await act(async () => { await current.markRead(N1); });
  expect(current.notifications[0].readAt).toBe(readAt);
  await act(async () => stale.resolve(page([row()], { unreadCount: 1 })));
  await reloadPromise;
  await waitFor(() => expect(service.listNotifications).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(current.notifications[0].readAt).toBe(readAt));
  expect(current.unreadCount).toBe(0);
});

it('User A completion after User B login is inert even when notification IDs match', async () => {
  const lateA = deferred();
  service.listNotifications
    .mockReturnValueOnce(lateA.promise)
    .mockResolvedValueOnce(page([row(N1, { content: { title: 'B row', body: 'B body' } })]));
  const view = mount();
  await waitFor(() => expect(service.listNotifications).toHaveBeenCalledTimes(1));
  mockAuth = { user: user(B), isLoggedIn: true, syncUser: jest.fn() };
  view.rerender(<NotificationsProvider><Probe /></NotificationsProvider>);
  await waitFor(() => expect(service.listNotifications).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(current.notifications[0].content.title).toBe('B row'));
  await act(async () => lateA.resolve(page([row(N1, { content: { title: 'A stale', body: 'A body' } })], { unreadCount: 99 })));
  expect(current.ownerId).toBe(B);
  expect(current.notifications[0].content.title).toBe('B row');
  expect(current.unreadCount).toBe(1);
  expect(current.status).toBe('ready');
});

it('stale read and clear responses after account switch cannot alter the new inbox', async () => {
  const lateRead = deferred();
  const lateClear = deferred();
  service.listNotifications.mockResolvedValueOnce(page([row()])).mockResolvedValueOnce(page([row(N1, { content: { title: 'B', body: 'B' } })]));
  service.markNotificationRead.mockReturnValue(lateRead.promise);
  service.archiveAllNotifications.mockReturnValue(lateClear.promise);
  const view = mount();
  await waitFor(() => expect(current.status).toBe('ready'));
  let readPromise;
  let clearPromise;
  act(() => {
    readPromise = current.markRead(N1);
    clearPromise = current.archiveAll(N1);
  });
  mockAuth = { user: user(B), isLoggedIn: true, syncUser: jest.fn() };
  view.rerender(<NotificationsProvider><Probe /></NotificationsProvider>);
  await waitFor(() => expect(current.ownerId).toBe(B));
  await act(async () => {
    lateRead.resolve({ notification: row(N1, { readAt: ISO }), unreadCount: 0 });
    lateClear.resolve({ unreadCount: 0 });
    await Promise.all([readPromise, clearPromise]);
  });
  expect(current.ownerId).toBe(B);
  expect(current.notifications[0].content.title).toBe('B');
  expect(current.unreadCount).toBe(1);
  expect(current.inboxPending).toBe(false);
});

it('rapid preference A -> B applies only the latest intent and older completion is inert', async () => {
  const first = deferred();
  const second = deferred();
  service.listNotifications.mockResolvedValue(page([]));
  service.updateNotificationPreference.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  mount();
  await waitFor(() => expect(current.status).toBe('ready'));
  let firstPromise;
  act(() => { firstPromise = current.setPreference('push', false); });
  await waitFor(() => expect(service.updateNotificationPreference).toHaveBeenCalledTimes(1));
  let secondPromise;
  act(() => { secondPromise = current.setPreference('push', true); });
  await act(async () => first.resolve(user(A, { push: false })));
  await waitFor(() => expect(service.updateNotificationPreference).toHaveBeenCalledTimes(2));
  expect(current.preferences.push).toBe(true);
  await act(async () => second.resolve(user(A, { push: true })));
  await Promise.all([firstPromise, secondPromise]);
  expect(current.preferences.push).toBe(true);
  expect(mockAuth.syncUser).toHaveBeenCalledTimes(1);
  expect(mockAuth.syncUser).toHaveBeenLastCalledWith(expect.objectContaining({ id: A }));
});

it('continuation appends only to its exact cursor chain and duplicate IDs fail closed', async () => {
  service.listNotifications
    .mockResolvedValueOnce(page([row(N1)], { pageInfo: { nextCursor: 'cursor-1', hasMore: true } }))
    .mockResolvedValueOnce(page([row(N1)], { pageInfo: { nextCursor: null, hasMore: false } }));
  mount();
  await waitFor(() => expect(current.status).toBe('ready'));
  await act(async () => { await current.loadMore(); });
  expect(current.notifications).toHaveLength(1);
  expect(current.error).toMatch(/unavailable/i);
  expect(service.listNotifications).toHaveBeenLastCalledWith({ limit: 20, cursor: 'cursor-1' });
});

it('a late continuation cannot append to a replaced page-one chain', async () => {
  const lateContinuation = deferred();
  service.listNotifications
    .mockResolvedValueOnce(page([row(N1)], { pageInfo: { nextCursor: 'cursor-1', hasMore: true } }))
    .mockReturnValueOnce(lateContinuation.promise)
    .mockResolvedValueOnce(page([row(N2, { content: { title: 'Fresh page', body: 'Fresh' } })]));
  mount();
  await waitFor(() => expect(current.status).toBe('ready'));
  let continuationPromise;
  act(() => { continuationPromise = current.loadMore(); });
  await waitFor(() => expect(service.listNotifications).toHaveBeenCalledTimes(2));
  await act(async () => { await current.reload(); });
  expect(current.notifications.map((item) => item.id)).toEqual([N2]);
  await act(async () => lateContinuation.resolve(page([row()], { unreadCount: 99 })));
  await continuationPromise;
  expect(current.notifications.map((item) => item.id)).toEqual([N2]);
  expect(current.unreadCount).toBe(1);
  expect(current.loadingMore).toBe(false);
});

it('failed refresh preserves the confirmed inbox and exposes retryable error state', async () => {
  service.listNotifications
    .mockResolvedValueOnce(page([row()]))
    .mockRejectedValueOnce(Object.assign(new Error('offline'), { isNetworkError: true }));
  mount();
  await waitFor(() => expect(current.status).toBe('ready'));
  await act(async () => { await current.reload(); });
  expect(current.notifications.map((item) => item.id)).toEqual([N1]);
  expect(current.unreadCount).toBe(1);
  expect(current.status).toBe('ready');
  expect(current.refreshing).toBe(false);
  expect(current.error).toMatch(/unavailable/i);
});

it('read-one is single-flight per row, globally serialized, and pessimistic on failure', async () => {
  const readOne = deferred();
  const readTwo = deferred();
  service.listNotifications.mockResolvedValue(page([row(N1), row(N2)], { unreadCount: 2 }));
  service.markNotificationRead
    .mockReturnValueOnce(readOne.promise)
    .mockReturnValueOnce(readTwo.promise);
  mount();
  await waitFor(() => expect(current.status).toBe('ready'));
  let first;
  let duplicate;
  let second;
  act(() => {
    first = current.markRead(N1);
    duplicate = current.markRead(N1);
    second = current.markRead(N2);
  });
  await expect(duplicate).resolves.toBe(false);
  expect(service.markNotificationRead.mock.calls.map(([id]) => id)).toEqual([N1]);
  expect(current.notifications.every((item) => item.readAt === null)).toBe(true);
  await act(async () => readOne.resolve({ notification: row(N1, { readAt: ISO }), unreadCount: 1 }));
  await expect(first).resolves.toBe(true);
  await waitFor(() => expect(service.markNotificationRead.mock.calls.map(([id]) => id)).toEqual([N1, N2]));
  await act(async () => readTwo.reject(Object.assign(new Error('offline'), { isNetworkError: true })));
  await expect(second).resolves.toBe(false);
  expect(current.notifications.find((item) => item.id === N1).readAt).toBe(ISO);
  expect(current.notifications.find((item) => item.id === N2).readAt).toBeNull();
});

it('serializes successful row reads so a later authoritative count cannot be rolled back', async () => {
  const firstRead = deferred();
  service.listNotifications.mockResolvedValue(page([row(N1), row(N2)], { unreadCount: 2 }));
  service.markNotificationRead
    .mockReturnValueOnce(firstRead.promise)
    .mockResolvedValueOnce({ notification: row(N2, { readAt: ISO }), unreadCount: 0 });
  mount();
  await waitFor(() => expect(current.status).toBe('ready'));
  let first;
  let second;
  act(() => {
    first = current.markRead(N1);
    second = current.markRead(N2);
  });
  await waitFor(() => expect(service.markNotificationRead).toHaveBeenCalledTimes(1));
  expect(service.markNotificationRead.mock.calls.map(([id]) => id)).toEqual([N1]);
  await act(async () => firstRead.resolve({ notification: row(N1, { readAt: ISO }), unreadCount: 1 }));
  await expect(first).resolves.toBe(true);
  await expect(second).resolves.toBe(true);
  expect(service.markNotificationRead.mock.calls.map(([id]) => id)).toEqual([N1, N2]);
  expect(current.notifications.every((item) => item.readAt === ISO)).toBe(true);
  expect(current.unreadCount).toBe(0);
});

it('serializes a newer Clear behind a row read so the row cannot restore archived state', async () => {
  const rowRead = deferred();
  service.listNotifications
    .mockResolvedValueOnce(page([row(N1), row(N2)], { unreadCount: 2 }))
    .mockResolvedValueOnce(page([], { unreadCount: 0 }));
  service.markNotificationRead.mockReturnValue(rowRead.promise);
  service.archiveAllNotifications.mockResolvedValue({ unreadCount: 0 });
  mount();
  await waitFor(() => expect(current.status).toBe('ready'));
  let readPromise;
  let clearPromise;
  act(() => { readPromise = current.markRead(N1); });
  await waitFor(() => expect(service.markNotificationRead).toHaveBeenCalledWith(N1));
  act(() => { clearPromise = current.archiveAll(N1); });
  expect(service.archiveAllNotifications).not.toHaveBeenCalled();
  await act(async () => rowRead.resolve({ notification: row(N1, { readAt: ISO }), unreadCount: 1 }));
  await expect(readPromise).resolves.toBe(true);
  await expect(clearPromise).resolves.toBe(true);
  expect(service.archiveAllNotifications).toHaveBeenCalledWith(N1);
  expect(current.notifications).toEqual([]);
  expect(current.unreadCount).toBe(0);
  expect(current.inboxPending).toBe(false);
});

it('serializes a newer read-all behind a row read so the row cannot roll back reconciliation', async () => {
  const rowRead = deferred();
  const readAt = '2026-10-04T03:00:00.000Z';
  service.listNotifications
    .mockResolvedValueOnce(page([row(N1), row(N2)], { unreadCount: 2 }))
    .mockResolvedValueOnce(page([
      row(N1, { readAt }),
      row(N2, { readAt }),
    ], { unreadCount: 0 }));
  service.markNotificationRead.mockReturnValue(rowRead.promise);
  service.markAllNotificationsRead.mockResolvedValue({ unreadCount: 0 });
  mount();
  await waitFor(() => expect(current.status).toBe('ready'));
  let rowPromise;
  let allPromise;
  act(() => { rowPromise = current.markRead(N1); });
  await waitFor(() => expect(service.markNotificationRead).toHaveBeenCalledWith(N1));
  act(() => { allPromise = current.markAllRead(N1); });
  expect(service.markAllNotificationsRead).not.toHaveBeenCalled();
  await act(async () => rowRead.resolve({ notification: row(N1, { readAt: ISO }), unreadCount: 1 }));
  await expect(rowPromise).resolves.toBe(true);
  await expect(allPromise).resolves.toBe(true);
  expect(service.markAllNotificationsRead).toHaveBeenCalledWith(N1);
  expect(current.notifications.every((item) => item.readAt === readAt)).toBe(true);
  expect(current.unreadCount).toBe(0);
  expect(current.inboxPending).toBe(false);
});

it('read-all and archive-all are mutually exclusive inbox-wide', async () => {
  const readAll = deferred();
  service.listNotifications.mockResolvedValue(page([row()]));
  service.markAllNotificationsRead.mockReturnValue(readAll.promise);
  mount();
  await waitFor(() => expect(current.status).toBe('ready'));
  let first;
  let blocked;
  act(() => {
    first = current.markAllRead(N1);
    blocked = current.archiveAll(N1);
  });
  await expect(blocked).resolves.toBe(false);
  expect(service.archiveAllNotifications).not.toHaveBeenCalled();
  await act(async () => readAll.resolve({ unreadCount: 0 }));
  await expect(first).resolves.toBe(true);
  expect(current.inboxPending).toBe(false);
});

it('an old-owner retry completion is inert after account switch', async () => {
  const lateRetry = deferred();
  service.listNotifications
    .mockRejectedValueOnce(new Error('initial failure'))
    .mockReturnValueOnce(lateRetry.promise)
    .mockResolvedValueOnce(page([row(N1, { content: { title: 'B inbox', body: 'B' } })]));
  const view = mount();
  await waitFor(() => expect(current.status).toBe('error'));
  let retryPromise;
  act(() => { retryPromise = current.retry(); });
  await waitFor(() => expect(service.listNotifications).toHaveBeenCalledTimes(2));
  mockAuth = { user: user(B), isLoggedIn: true, syncUser: jest.fn() };
  view.rerender(<NotificationsProvider><Probe /></NotificationsProvider>);
  await waitFor(() => expect(current.ownerId).toBe(B));
  await waitFor(() => expect(current.notifications[0].content.title).toBe('B inbox'));
  await act(async () => lateRetry.resolve(page([row(N1, { content: { title: 'A retry', body: 'A' } })], { unreadCount: 99 })));
  await retryPromise;
  expect(current.ownerId).toBe(B);
  expect(current.notifications[0].content.title).toBe('B inbox');
  expect(current.unreadCount).toBe(1);
});

it('post-unmount success and failure perform no state reconciliation or sync', async () => {
  const lateList = deferred();
  service.listNotifications.mockReturnValue(lateList.promise);
  const view = mount();
  view.unmount();
  await act(async () => lateList.resolve(page([row()])));
  expect(mockAuth.syncUser).not.toHaveBeenCalled();
});
