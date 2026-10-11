const React = require('react');
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
  Linking: { openSettings: jest.fn() },
}));
let mockAuth;
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../src/api/authService', () => ({ getLocalSessionId: jest.fn(() => '507f1f77bcf86cd799439002') }));
jest.mock('../src/api/mealPlanService', () => ({ getMealPlanEntry: jest.fn() }));
jest.mock('../src/notifications/mealReminderSessionStore', () => ({
  ensureBinding: jest.fn(), loadBinding: jest.fn(), clearBinding: jest.fn(),
  validRequestId: (id) => /^wecooked\.meal4\.v1\.[A-Za-z0-9_-]{43}$/.test(id),
}));
jest.mock('../src/notifications/mealReminderScheduler', () => ({
  ...jest.requireActual('../src/notifications/mealReminderScheduler'),
  cancelKnownReminders: jest.fn(), ensureChannel: jest.fn(), reconcileReminders: jest.fn(),
}));
jest.mock('../src/navigation/navigationRef', () => ({ navigationRef: { isReady: jest.fn(() => true), navigate: jest.fn() } }));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;
const { MealReminderProvider, useMealReminders } = require('../src/context/MealReminderContext');
const store = require('../src/notifications/mealReminderSessionStore');
const scheduler = require('../src/notifications/mealReminderScheduler');
const { getMealPlanEntry } = require('../src/api/mealPlanService');
const { navigationRef } = require('../src/navigation/navigationRef');
const { Platform } = require('react-native');
const { validLocalTapResponse } = require('../src/context/MealReminderContext');
const { runBeforePushLogout } = require('../src/notifications/nativePushLifecycle');
const OWNER = '507f1f77bcf86cd799439001';
const SESSION = '507f1f77bcf86cd799439002';
const ENTRY = '507f1f77bcf86cd799439077';
const EPOCH = 'E'.repeat(43);
const FUTURE = '2027-09-14T09:00:00.000Z';
let current;
function Probe() { current = useMealReminders(); return null; }
const auth = (generation = 1) => ({ user: { id: OWNER, preferences: { notifications: { reminders: true } } },
  isReady: true, isLoggedIn: true, sessionIdentity: { ownerId: OWNER, generation, localSessionRevision: generation } });
const payload = (overrides = {}) => ({ version: 1, kind: 'mealPlanReminder', entryId: ENTRY,
  reminderRevision: 2, fireAt: FUTURE, sessionEpoch: EPOCH, ...overrides });
const nativeResponse = (data = payload(), overrides = {}) => {
  const date = new Date(FUTURE);
  return { actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
    notification: { date: Date.parse(FUTURE) / 1000,
      request: { identifier: `wecooked.meal4.v1.${'A'.repeat(43)}`,
        trigger: { type: 'calendar', class: 'UNCalendarNotificationTrigger', repeats: false,
          dateComponents: { calendar: 'iso8601', timeZone: 'UTC', isLeapMonth: false,
            year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(),
            hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: date.getUTCSeconds() } },
        content: { data } } }, ...overrides };
};

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'ios';
  jest.useFakeTimers().setSystemTime(new Date(FUTURE));
  mockAuth = auth();
  store.ensureBinding.mockResolvedValue({ version: 1, ownerId: OWNER, sessionId: SESSION, epoch: EPOCH });
  store.loadBinding.mockResolvedValue({ kind: 'valid', value: { version: 1, ownerId: OWNER, sessionId: SESSION, epoch: EPOCH } });
  store.clearBinding.mockResolvedValue(true);
  scheduler.reconcileReminders.mockResolvedValue();
  scheduler.cancelKnownReminders.mockResolvedValue();
  getMealPlanEntry.mockResolvedValue({ id: ENTRY, ownerId: OWNER, dateKey: '2027-09-14', reminderRevision: 2, reminder: { fireAt: FUTURE } });
});
afterEach(() => jest.useRealTimers());

it('requires native default-action delivery, request identity, and matching one-off trigger on both platforms', () => {
  const atFire = Date.parse(FUTURE);
  const ios = nativeResponse();
  expect(validLocalTapResponse(ios, FUTURE, atFire)).toBe(true);
  expect(validLocalTapResponse({ ...ios, notification: { ...ios.notification, date: atFire } }, FUTURE, atFire)).toBe(false);
  const early = { ...ios, notification: { ...ios.notification, date: (atFire - 1000) / 1000 } };
  expect(validLocalTapResponse(early, FUTURE, atFire + 1000)).toBe(false);
  expect(validLocalTapResponse({ ...ios, notification: { ...ios.notification,
    date: (atFire - 0.5) / 1000 } }, FUTURE, atFire + 1000)).toBe(false);
  expect(validLocalTapResponse({ ...ios, notification: { ...ios.notification, date: undefined } }, FUTURE, atFire)).toBe(false);
  expect(validLocalTapResponse({ ...ios, notification: { ...ios.notification, date: NaN } }, FUTURE, atFire)).toBe(false);
  expect(validLocalTapResponse({ ...ios, notification: { ...ios.notification, date: (atFire + 1) / 1000 } }, FUTURE, atFire)).toBe(false);
  expect(validLocalTapResponse({ ...ios, actionIdentifier: 'custom' }, FUTURE, atFire)).toBe(false);
  expect(validLocalTapResponse({ ...ios, notification: { ...ios.notification,
    request: { ...ios.notification.request, identifier: 'foreign' } } }, FUTURE, atFire)).toBe(false);
  expect(validLocalTapResponse({ ...ios, notification: { ...ios.notification,
    request: { ...ios.notification.request, trigger: null } } }, FUTURE, atFire)).toBe(false);
  expect(validLocalTapResponse({ ...ios, notification: { ...ios.notification,
    request: { ...ios.notification.request, trigger: { ...ios.notification.request.trigger,
      dateComponents: { ...ios.notification.request.trigger.dateComponents, second: 1 } } } } }, FUTURE, atFire)).toBe(false);
  expect(validLocalTapResponse(payload(), FUTURE, atFire)).toBe(false);

  Platform.OS = 'android';
  const android = { ...ios, notification: { date: atFire, request: { ...ios.notification.request,
    trigger: { type: 'date', repeats: false, value: atFire, channelId: 'meal-reminders' } } } };
  expect(validLocalTapResponse(android, FUTURE, atFire)).toBe(true);
  expect(validLocalTapResponse({ ...android, notification: { ...android.notification, date: atFire / 1000 } }, FUTURE, atFire)).toBe(false);
  expect(validLocalTapResponse({ ...android, notification: { ...android.notification,
    request: { ...android.notification.request, trigger: { type: 'push' } } } }, FUTURE, atFire)).toBe(false);
});

it('local tap validates persisted epoch and current server entry before navigating current week', async () => {
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(MealReminderProvider, null, React.createElement(Probe))); });
  await act(async () => { expect(await current.handleLocalTap(nativeResponse(payload()), () => true)).toBe(true); });
  expect(navigationRef.navigate).toHaveBeenCalledWith('MealPlan', { entryId: ENTRY, dateKey: '2027-09-14' });
  await act(async () => { renderer.unmount(); });
});

it('never navigates from payload alone or an early-delivered alert tapped after fireAt', async () => {
  jest.setSystemTime(new Date(Date.parse(FUTURE) + 1000));
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(MealReminderProvider, null, React.createElement(Probe))); });
  expect(await current.handleLocalTap(payload(), () => true)).toBe(false);
  const early = nativeResponse();
  early.notification.date = (Date.parse(FUTURE) - 1000) / 1000;
  expect(await current.handleLocalTap(early, () => true)).toBe(false);
  expect(navigationRef.navigate).not.toHaveBeenCalled();
  await act(async () => { renderer.unmount(); });
});

it('old epoch, changed revision, offline GET, and foreign owner never navigate', async () => {
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(MealReminderProvider, null, React.createElement(Probe))); });
  expect(await current.handleLocalTap(nativeResponse(payload({ sessionEpoch: 'O'.repeat(43) })), () => true)).toBe(false);
  expect(await current.handleLocalTap(nativeResponse(payload({ reminderRevision: 1 })), () => true)).toBe(false);
  getMealPlanEntry.mockResolvedValueOnce({ id: ENTRY, ownerId: '507f1f77bcf86cd799439099', dateKey: '2027-09-14', reminderRevision: 2, reminder: { fireAt: FUTURE } });
  expect(await current.handleLocalTap(nativeResponse(payload()), () => true)).toBe(false);
  getMealPlanEntry.mockRejectedValueOnce(new Error('offline'));
  await expect(current.handleLocalTap(nativeResponse(payload()), () => true)).rejects.toThrow('offline');
  expect(navigationRef.navigate).not.toHaveBeenCalled();
  await act(async () => { renderer.unmount(); });
});

it.each([
  [0, true], [1, true], [24 * 60 * 60 * 1000, true],
  [24 * 60 * 60 * 1000 + 1, false], [-1, false],
])('tap at fireAt plus %i milliseconds has bounded delivery eligibility', async (offset, allowed) => {
  jest.setSystemTime(new Date(Date.parse(FUTURE) + offset));
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(MealReminderProvider, null, React.createElement(Probe))); });
  expect(await current.handleLocalTap(nativeResponse(payload()), () => true)).toBe(allowed);
  expect(navigationRef.navigate).toHaveBeenCalledTimes(allowed ? 1 : 0);
  await act(async () => { renderer.unmount(); });
});

it('rejects a mismatched entry ID, stale revision, and a relogin during the server read', async () => {
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(MealReminderProvider, null, React.createElement(Probe))); });
  getMealPlanEntry.mockResolvedValueOnce({ id: '507f1f77bcf86cd799439088', ownerId: OWNER,
    dateKey: '2027-09-14', reminderRevision: 2, reminder: { fireAt: FUTURE } });
  expect(await current.handleLocalTap(nativeResponse(payload()), () => true)).toBe(false);
  expect(await current.handleLocalTap(nativeResponse(payload({ reminderRevision: 3 })), () => true)).toBe(false);
  let finish;
  getMealPlanEntry.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = current.handleLocalTap(nativeResponse(payload()), () => true);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  mockAuth = auth(2);
  await act(async () => { renderer.update(React.createElement(MealReminderProvider, null, React.createElement(Probe))); });
  finish({ id: ENTRY, ownerId: OWNER, dateKey: '2027-09-14', reminderRevision: 2, reminder: { fireAt: FUTURE } });
  expect(await pending).toBe(false);
  expect(navigationRef.navigate).not.toHaveBeenCalled();
  await act(async () => { renderer.unmount(); });
});

it('logout hook invalidates current operations and clears epoch before best-effort cancellation', async () => {
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(MealReminderProvider, null, React.createElement(Probe))); });
  await act(async () => { await runBeforePushLogout({ localOnly: true }); });
  expect(store.clearBinding).toHaveBeenCalled();
  expect(scheduler.cancelKnownReminders).toHaveBeenCalled();
  expect(await current.handleLocalTap(nativeResponse(payload()), () => true)).toBe(false);
  await act(async () => { renderer.unmount(); });
});

it('clears the persisted tap epoch immediately even when reconciliation is still settling', async () => {
  let settle;
  scheduler.reconcileReminders.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(MealReminderProvider, null, React.createElement(Probe))); });
  expect(scheduler.reconcileReminders).toHaveBeenCalled();
  let cleanup;
  act(() => { cleanup = runBeforePushLogout({ localOnly: true }); });
  expect(store.clearBinding).toHaveBeenCalledTimes(1);
  expect(scheduler.cancelKnownReminders).not.toHaveBeenCalled();
  await act(async () => { settle(); await cleanup; });
  expect(scheduler.cancelKnownReminders).toHaveBeenCalledTimes(1);
  await act(async () => { renderer.unmount(); });
});

it('discards queued manual retries after relogin or account switch', async () => {
  for (const nextOwner of [OWNER, '507f1f77bcf86cd799439099']) {
    scheduler.reconcileReminders.mockClear();
    let settle;
    scheduler.reconcileReminders.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
    let renderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(MealReminderProvider, null, React.createElement(Probe))); });
    const retry = current.manualRetry();
    mockAuth = { ...auth(2), user: { ...auth(2).user, id: nextOwner },
      sessionIdentity: { ownerId: nextOwner, generation: 2, localSessionRevision: 2 } };
    await act(async () => { renderer.update(React.createElement(MealReminderProvider, null, React.createElement(Probe))); });
    await act(async () => { settle(); await retry; });
    expect(scheduler.reconcileReminders.mock.calls.filter(([args]) => args.manual)).toHaveLength(0);
    await act(async () => { renderer.unmount(); });
    mockAuth = auth();
  }
});

it('only the latest concurrent manual press retains user-action authority', async () => {
  let settle;
  scheduler.reconcileReminders.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(MealReminderProvider, null, React.createElement(Probe))); });
  const first = current.manualRetry();
  const second = current.manualRetry();
  await act(async () => { settle(); await Promise.all([first, second]); });
  expect(scheduler.reconcileReminders.mock.calls.filter(([args]) => args.manual)).toHaveLength(1);
  await act(async () => { renderer.unmount(); });
});

it('invalidates an active reconciliation when reminders are disabled or re-enabled', async () => {
  let observed;
  scheduler.reconcileReminders.mockImplementationOnce(async (args) => { observed = args; });
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(MealReminderProvider, null, React.createElement(Probe))); });
  expect(observed.stillCurrent()).toBe(true);
  mockAuth = { ...auth(), user: { ...auth().user, preferences: { notifications: { reminders: false } } } };
  await act(async () => { renderer.update(React.createElement(MealReminderProvider, null, React.createElement(Probe))); });
  expect(observed.stillCurrent()).toBe(false);
  expect(scheduler.reconcileReminders.mock.calls.at(-1)[0].remindersEnabled).toBe(false);
  mockAuth = auth();
  await act(async () => { renderer.update(React.createElement(MealReminderProvider, null, React.createElement(Probe))); });
  expect(observed.stillCurrent()).toBe(false);
  expect(scheduler.reconcileReminders.mock.calls.at(-1)[0].remindersEnabled).toBe(true);
  await act(async () => { renderer.unmount(); });
});
