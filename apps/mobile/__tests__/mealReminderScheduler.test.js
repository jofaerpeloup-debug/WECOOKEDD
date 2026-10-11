jest.mock('../src/api/mealPlanService', () => ({ getMealPlanHorizon: jest.fn() }));
jest.mock('../src/notifications/mealReminderSessionStore', () => ({
  PREFIX: 'wecooked.meal4.v1.', validRequestId: (id) => /^wecooked\.meal4\.v1\.[A-Za-z0-9_-]{43}$/.test(id),
  loadJournal: jest.fn(), journalId: jest.fn(), incrementAttempt: jest.fn(), pruneAbsent: jest.fn(),
  randomNonce: jest.fn(async () => 'Z'.repeat(43)),
}));

const { Platform } = require('react-native');
const Notifications = require('expo-notifications');
const store = require('../src/notifications/mealReminderSessionStore');
const { getMealPlanHorizon } = require('../src/api/mealPlanService');
const { inspectInventory, horizonRange, permissionKind, reconcileReminders, validLocalData } = require('../src/notifications/mealReminderScheduler');
const PREFIX = 'wecooked.meal4.v1.';
const A = `${PREFIX}${'A'.repeat(43)}`;
const B = `${PREFIX}${'B'.repeat(43)}`;
const ENTRY = '507f1f77bcf86cd799439077';
const EPOCH = 'E'.repeat(43);
const fireAt = '2027-09-14T09:00:00.000Z';
const data = (overrides = {}) => ({ version: 1, kind: 'mealPlanReminder', entryId: ENTRY,
  reminderRevision: 2, fireAt, sessionEpoch: EPOCH, ...overrides });
const calendar = (instant = fireAt, components = {}) => {
  const date = new Date(instant);
  return { type: 'calendar', class: 'UNCalendarNotificationTrigger', repeats: false,
    dateComponents: { calendar: 'iso8601', timeZone: 'UTC', isLeapMonth: false,
      year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(),
      hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: date.getUTCSeconds(), ...components } };
};
const request = (id = A, overrides = {}) => ({ identifier: id,
  content: { data: data() }, trigger: calendar(), ...overrides });
const journal = (ids = [A]) => ({ version: 1, records: Object.fromEntries(ids.map((id) => [id, { attempts: 0 }])) });

beforeEach(() => {
  Platform.OS = 'ios';
  jest.resetAllMocks();
  jest.useRealTimers();
  store.randomNonce.mockResolvedValue('Z'.repeat(43));
  Notifications.getNextTriggerDateAsync.mockResolvedValue(Date.parse(fireAt));
});

it('covers UTC-derived 31 keys at the extreme horizon boundaries', () => {
  expect(horizonRange(new Date('2026-10-10T23:59:59.000Z'))).toEqual(['2026-10-09', '2026-11-08']);
});

it('requires exact payload, journal provenance, and a compatible non-null calendar trigger', async () => {
  expect(validLocalData(data())).toBe(true);
  expect(validLocalData(data({ extra: true }))).toBe(false);
  const now = new Date('2027-09-14T08:00:00.000Z');
  expect((await inspectInventory([request()], journal(), now)).valid).toHaveLength(1);
  expect((await inspectInventory([request(A, { trigger: null })], journal(), now)).invalid).toHaveLength(1);
  expect((await inspectInventory([request(A, { content: { data: { bad: true } } })], journal(), now)).invalid).toHaveLength(1);
  await expect(inspectInventory([request()], journal([]), now)).rejects.toThrow();
  await expect(inspectInventory([request(), request()], journal(), now)).rejects.toThrow();
  await expect(inspectInventory(null, journal(), now)).rejects.toThrow();
  await expect(inspectInventory([request(A, { content: null })], journal(), now)).rejects.toThrow();
  await expect(inspectInventory([request(A, { content: { data: { kind: 'notification' } } })], journal(), now)).rejects.toThrow();
});

it('preserves valid foreign null-trigger requests and rejects journal collisions', async () => {
  const foreign = { identifier: 'foreign-id', content: { data: { arbitrary: 1 } }, trigger: null };
  expect((await inspectInventory([foreign], journal())).foreign).toEqual([foreign]);
  await expect(inspectInventory([request(A, { content: { data: { kind: 'notification' } } })], journal())).rejects.toThrow();
});

it('permission policy distinguishes iOS authorized, provisional, ephemeral, and denied', () => {
  expect(permissionKind({ ios: { status: 2 } })).toBe('granted');
  expect(permissionKind({ ios: { status: 3 } })).toBe('quiet');
  expect(permissionKind({ ios: { status: 4 } })).toBe('temporary');
  expect(permissionKind({ ios: { status: 1 } })).toBe('unavailable');
  expect(permissionKind({})).toBe('unavailable');
  Platform.OS = 'android';
  expect(permissionKind({ status: 'granted', granted: true })).toBe('granted');
  expect(permissionKind({ status: 'denied', granted: false })).toBe('unavailable');
});

it('ambiguous inventory causes zero OS mutations', async () => {
  store.loadJournal.mockResolvedValue({ kind: 'valid', value: journal([]) });
  Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([request()]);
  getMealPlanHorizon.mockResolvedValue([]);
  const statuses = [];
  await reconcileReminders({ binding: { epoch: EPOCH }, remindersEnabled: true, stillCurrent: () => true, onStatus: (next) => statuses.push(next) });
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  expect(statuses.at(-1).kind).toBe('degraded');
});

it('durably reserves an automatic recovery attempt before exact-ID cancel, then verifies absence', async () => {
  let count = 0;
  const record = journal();
  store.loadJournal.mockImplementation(async () => ({ kind: 'valid', value: record }));
  store.incrementAttempt.mockImplementation(async () => { record.records[A].attempts += 1; count = record.records[A].attempts; return count; });
  store.pruneAbsent.mockImplementation(async () => record);
  let pending = [request(A, { trigger: null })];
  Notifications.getAllScheduledNotificationsAsync.mockImplementation(async () => pending);
  Notifications.cancelScheduledNotificationAsync.mockImplementation(async (id) => { expect(id).toBe(A); expect(count).toBe(1); pending = []; });
  Notifications.getPermissionsAsync.mockResolvedValue({ ios: { status: 2 } });
  getMealPlanHorizon.mockResolvedValue([]);
  await reconcileReminders({ binding: { epoch: EPOCH }, remindersEnabled: true, stillCurrent: () => true });
  expect(record.records[A].attempts).toBe(1);
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
});

it('automatic repair pauses at three while explicit manual retry reserves count four', async () => {
  const record = journal(); record.records[A].attempts = 3;
  getMealPlanHorizon.mockResolvedValue([]);
  store.loadJournal.mockImplementation(async () => ({ kind: 'valid', value: record }));
  store.incrementAttempt.mockImplementation(async () => { record.records[A].attempts += 1; return record.records[A].attempts; });
  Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([request(A, { trigger: null })]);
  Notifications.cancelScheduledNotificationAsync.mockResolvedValue();
  const options = { binding: { epoch: EPOCH }, remindersEnabled: true, stillCurrent: () => true };
  await reconcileReminders(options);
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  await reconcileReminders({ ...options, manual: true });
  expect(record.records[A].attempts).toBe(4);
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(A);
  await reconcileReminders(options);
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
});

it('verifies all UTC calendar fields, year boundaries, and native preview input', async () => {
  const now = new Date('2027-12-30T00:00:00.000Z');
  const instant = '2028-01-01T00:01:02.000Z';
  const item = request(A, { content: { data: data({ fireAt: instant }) }, trigger: calendar(instant) });
  Notifications.getNextTriggerDateAsync.mockResolvedValue(Date.parse(instant));
  expect((await inspectInventory([item], journal(), now)).valid).toEqual([item]);
  expect(Notifications.getNextTriggerDateAsync).toHaveBeenCalledWith({
    type: 'calendar', timezone: 'UTC', repeats: false,
    year: 2028, month: 1, day: 1, hour: 0, minute: 1, second: 2,
  });
  const december = '2027-12-31T23:59:59.000Z';
  const other = request(A, { content: { data: data({ fireAt: december }) }, trigger: calendar(december) });
  Notifications.getNextTriggerDateAsync.mockResolvedValue(Date.parse(december));
  expect((await inspectInventory([other], journal(), now)).valid).toHaveLength(1);
  expect(Notifications.getNextTriggerDateAsync).toHaveBeenLastCalledWith(expect.objectContaining({ month: 12, day: 31 }));
});

it('rejects malformed iOS triggers without certifying or previewing them', async () => {
  const now = new Date('2027-09-14T08:00:00.000Z');
  const shapes = [
    null,
    { type: 'timeInterval', seconds: 3600, repeats: false },
    calendar(fireAt, { month: 0 }),
    calendar(fireAt, { year: 2028 }),
    calendar(fireAt, { second: undefined }),
    calendar(fireAt, { timeZone: null }),
    calendar(fireAt, { isLeapMonth: true }),
    calendar(fireAt, { isRepeatedDay: true }),
    calendar(fireAt, { nanosecond: 1 }),
    { ...calendar(), repeats: true },
    { ...calendar(), class: 'UNTimeIntervalNotificationTrigger' },
  ];
  for (const trigger of shapes) {
    expect((await inspectInventory([request(A, { trigger })], journal(), now)).invalid).toHaveLength(1);
  }
  expect(Notifications.getNextTriggerDateAsync).not.toHaveBeenCalled();
  await expect(inspectInventory([request(A, { trigger: calendar(fireAt, { timeZone: 'GMT' }) })],
    journal(), now)).rejects.toThrow('representation unavailable');
});

it('uses one captured boundary: future null freezes, expired null permits ordinary cleanup', async () => {
  const at = new Date(fireAt);
  Notifications.getNextTriggerDateAsync.mockResolvedValue(null);
  await expect(inspectInventory([request()], journal(), at)).rejects.toThrow('future native preview is null');
  expect((await inspectInventory([request()], journal(), new Date(at.getTime() + 1))).expired).toHaveLength(1);
  Notifications.getNextTriggerDateAsync.mockResolvedValue(Date.parse(fireAt));
  expect((await inspectInventory([request()], journal(), new Date(at.getTime() + 1))).expired).toHaveLength(1);
  Notifications.getNextTriggerDateAsync.mockResolvedValue(Date.parse(fireAt) + 1000);
  expect((await inspectInventory([request()], journal(), new Date(at.getTime() + 1))).invalid).toHaveLength(1);
  Notifications.getNextTriggerDateAsync.mockRejectedValue(new Error('native unavailable'));
  await expect(inspectInventory([request()], journal(), at)).rejects.toThrow('preview unavailable');
});

it('future null preview freezes the complete pass before recovery or any OS mutation', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2027-09-14T08:00:00.000Z'));
  store.loadJournal.mockResolvedValue({ kind: 'valid', value: journal([A, B]) });
  Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([
    request(A), request(B, { trigger: null }),
  ]);
  Notifications.getNextTriggerDateAsync.mockResolvedValue(null);
  getMealPlanHorizon.mockResolvedValue([]);
  await reconcileReminders({ binding: { epoch: EPOCH }, remindersEnabled: true, stillCurrent: () => true });
  expect(store.incrementAttempt).not.toHaveBeenCalled();
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

it('expired null uses ordinary exact-ID cleanup without a recovery increment', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2027-09-14T10:00:00.000Z'));
  store.loadJournal.mockResolvedValue({ kind: 'valid', value: journal() });
  let pending = [request()];
  Notifications.getAllScheduledNotificationsAsync.mockImplementation(async () => pending);
  Notifications.getNextTriggerDateAsync.mockResolvedValue(null);
  Notifications.cancelScheduledNotificationAsync.mockImplementation(async (id) => {
    expect(id).toBe(A);
    pending = [];
  });
  Notifications.getPermissionsAsync.mockResolvedValue({ ios: { status: 2 } });
  getMealPlanHorizon.mockResolvedValue([]);
  await reconcileReminders({ binding: { epoch: EPOCH }, remindersEnabled: true, stillCurrent: () => true });
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
  expect(store.incrementAttempt).not.toHaveBeenCalled();
});

it('expired finite conflict uses durable counted recovery, and a failed count write prevents cancel', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2027-09-14T10:00:00.000Z'));
  store.loadJournal.mockResolvedValue({ kind: 'valid', value: journal() });
  Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([request()]);
  Notifications.getNextTriggerDateAsync.mockResolvedValue(Date.parse(fireAt) + 1000);
  store.incrementAttempt.mockRejectedValueOnce(new Error('write failed'));
  getMealPlanHorizon.mockResolvedValue([]);
  await reconcileReminders({ binding: { epoch: EPOCH }, remindersEnabled: true, stillCurrent: () => true });
  expect(store.incrementAttempt).toHaveBeenCalledWith(A);
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
});

it('native preview rejection freezes mutation even when another proven ID is malformed', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2027-09-14T08:00:00.000Z'));
  store.loadJournal.mockResolvedValue({ kind: 'valid', value: journal([A, B]) });
  Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([
    request(A), request(B, { trigger: null }),
  ]);
  Notifications.getNextTriggerDateAsync.mockRejectedValue(new Error('native failure'));
  await reconcileReminders({ binding: { epoch: EPOCH }, remindersEnabled: true, stillCurrent: () => true });
  expect(store.incrementAttempt).not.toHaveBeenCalled();
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
});

it('Android retains one-off DATE inventory interpretation without native preview', async () => {
  Platform.OS = 'android';
  const now = new Date('2027-09-14T08:00:00.000Z');
  const item = request(A, { trigger: { type: 'date', value: Date.parse(fireAt), repeats: false } });
  expect((await inspectInventory([item], journal(), now)).valid).toEqual([item]);
  expect(Notifications.getNextTriggerDateAsync).not.toHaveBeenCalled();
});

it.each([undefined, null, 'false', true])('Android rejects DATE inventory with repeats %s', async (repeats) => {
  Platform.OS = 'android';
  const item = request(A, { trigger: { type: 'date', value: Date.parse(fireAt), repeats } });
  expect((await inspectInventory([item], journal(), new Date('2027-09-14T08:00:00.000Z'))).invalid).toEqual([item]);
});

it('rejects subsecond and malformed payload instants', () => {
  expect(validLocalData(data({ fireAt: '2027-09-14T09:00:00.001Z' }))).toBe(false);
  expect(validLocalData(data({ fireAt: 'invalid' }))).toBe(false);
});

it.each(['ios', 'android'])('%s schedules the platform trigger and certifies only a fresh exact inventory', async (platform) => {
  jest.useFakeTimers().setSystemTime(new Date('2027-09-14T08:00:00.000Z'));
  Platform.OS = platform;
  const ownerId = '507f1f77bcf86cd799439001';
  const id = `${PREFIX}${'Z'.repeat(43)}`;
  const ownedJournal = journal([]);
  store.loadJournal.mockImplementation(async () => ({ kind: 'valid', value: ownedJournal }));
  store.journalId.mockImplementation(async (requested) => { ownedJournal.records[requested] = { attempts: 0 }; });
  store.pruneAbsent.mockImplementation(async () => ownedJournal);
  const entry = { id: ENTRY, ownerId, reminderRevision: 2, reminder: { fireAt } };
  getMealPlanHorizon.mockResolvedValue([entry]);
  Notifications.getPermissionsAsync.mockResolvedValue(platform === 'ios'
    ? { ios: { status: 2 } } : { status: 'granted', granted: true });
  let pending = [];
  Notifications.getAllScheduledNotificationsAsync.mockImplementation(async () => pending);
  Notifications.scheduleNotificationAsync.mockImplementation(async (input) => {
    expect(ownedJournal.records[input.identifier]).toEqual({ attempts: 0 });
    expect(input.identifier).toBe(id);
    if (platform === 'ios') {
      expect(input.trigger).toEqual({
        type: 'calendar', timezone: 'UTC', repeats: false,
        year: 2027, month: 9, day: 14, hour: 9, minute: 0, second: 0,
      });
    } else {
      expect(input.trigger.type).toBe('date');
      expect(input.trigger.date.getTime()).toBe(Date.parse(fireAt));
      expect(input.trigger.channelId).toBe('meal-reminders');
    }
    pending = [request(id, { content: input.content,
      trigger: platform === 'ios' ? calendar() : { type: 'date', value: Date.parse(fireAt), repeats: false } })];
    return id;
  });
  const statuses = [];
  await reconcileReminders({ binding: { ownerId, epoch: EPOCH }, remindersEnabled: true,
    stillCurrent: () => true, onStatus: (value) => statuses.push(value) });
  expect(statuses.at(-1).kind).toBe('scheduled');
  expect(statuses.at(-1).scheduledIds.has(ENTRY)).toBe(true);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  if (platform === 'android') expect(Notifications.getNextTriggerDateAsync).not.toHaveBeenCalled();
});

it('serializes concurrent automatic recovery so one exact ID consumes one slot', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2027-09-14T08:00:00.000Z'));
  const ownedJournal = journal();
  let pending = [request(A, { trigger: null })];
  store.loadJournal.mockImplementation(async () => ({ kind: 'valid', value: ownedJournal }));
  store.incrementAttempt.mockImplementation(async () => {
    ownedJournal.records[A].attempts += 1;
    return ownedJournal.records[A].attempts;
  });
  store.pruneAbsent.mockImplementation(async () => ownedJournal);
  Notifications.getAllScheduledNotificationsAsync.mockImplementation(async () => pending);
  Notifications.cancelScheduledNotificationAsync.mockImplementation(async () => { pending = []; });
  Notifications.getPermissionsAsync.mockResolvedValue({ ios: { status: 2 } });
  getMealPlanHorizon.mockResolvedValue([]);
  const options = { binding: { epoch: EPOCH }, remindersEnabled: true, stillCurrent: () => true };
  await Promise.all([reconcileReminders(options), reconcileReminders(options)]);
  expect(ownedJournal.records[A].attempts).toBe(1);
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
});

it('compensates only its requested ID when Expo returns a different schedule ID', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2027-09-14T08:00:00.000Z'));
  const ownerId = '507f1f77bcf86cd799439001';
  const requested = `${PREFIX}${'Z'.repeat(43)}`;
  store.loadJournal.mockResolvedValue({ kind: 'valid', value: journal([]) });
  Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
  Notifications.getPermissionsAsync.mockResolvedValue({ ios: { status: 2 } });
  Notifications.scheduleNotificationAsync.mockResolvedValue('different-id');
  getMealPlanHorizon.mockResolvedValue([{ id: ENTRY, ownerId, reminderRevision: 2,
    reminder: { fireAt } }]);
  const statuses = [];
  await reconcileReminders({ binding: { ownerId, epoch: EPOCH }, remindersEnabled: true,
    stillCurrent: () => true, onStatus: (value) => statuses.push(value) });
  expect(store.journalId).toHaveBeenCalledWith(requested);
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(requested);
  expect(statuses.at(-1).kind).toBe('degraded');
});

it('an unsafe post-repair preview stops ordinary mutation and retains the counted attempt', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2027-09-14T08:00:00.000Z'));
  const record = journal([A, B]);
  store.loadJournal.mockImplementation(async () => ({ kind: 'valid', value: record }));
  store.incrementAttempt.mockImplementation(async () => ++record.records[B].attempts);
  let pending = [request(B, { trigger: null })];
  Notifications.getAllScheduledNotificationsAsync.mockImplementation(async () => pending);
  Notifications.cancelScheduledNotificationAsync.mockImplementation(async (id) => {
    expect(id).toBe(B);
    pending = [request(A)];
  });
  Notifications.getNextTriggerDateAsync.mockResolvedValue(null);
  Notifications.getPermissionsAsync.mockResolvedValue({ ios: { status: 2 } });
  getMealPlanHorizon.mockResolvedValue([]);
  await reconcileReminders({ binding: { epoch: EPOCH }, remindersEnabled: true,
    stillCurrent: () => true });
  expect(record.records[B].attempts).toBe(1);
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  expect(store.pruneAbsent).not.toHaveBeenCalled();
});

it('reserves foreign requests in the 32-slot budget and selects equal times by entry ID', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2027-09-14T08:00:00.000Z'));
  Platform.OS = 'android';
  const ownerId = '507f1f77bcf86cd799439001';
  const entries = Array.from({ length: 32 }, (_, index) => ({
    id: index.toString(16).padStart(24, '0'), ownerId, reminderRevision: 2,
    reminder: { fireAt },
  })).reverse();
  const owned = entries.map((entry, index) => request(`${PREFIX}${index.toString(16).padStart(43, '0')}`,
    { content: { data: data({ entryId: entry.id }) },
      trigger: { type: 'date', value: Date.parse(fireAt), repeats: false } }));
  const foreign = [0, 1].map((index) => ({ identifier: `foreign-${index}`,
    content: { data: { other: true } }, trigger: null }));
  store.loadJournal.mockResolvedValue({ kind: 'valid', value: journal(owned.map((item) => item.identifier)) });
  Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([...foreign, ...owned]);
  Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted', granted: true });
  getMealPlanHorizon.mockResolvedValue(entries);
  const statuses = [];
  await reconcileReminders({ binding: { ownerId, epoch: EPOCH }, remindersEnabled: true,
    stillCurrent: () => true, onStatus: (value) => statuses.push(value) });
  expect(statuses.at(-1)).toEqual(expect.objectContaining({ capacity: 30 }));
  expect([...statuses.at(-1).selectedIds]).toEqual(entries.map((entry) => entry.id).sort().slice(0, 30));
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(2);
  expect(Notifications.cancelScheduledNotificationAsync.mock.calls.map(([id]) => id)).toEqual(
    owned.filter((item) => entries.findIndex((entry) => entry.id === item.content.data.entryId) < 2)
      .sort((a, b) => a.content.data.entryId.localeCompare(b.content.data.entryId))
      .map((item) => item.identifier));
});

it('does not certify a cancellation that resolves while a duplicate remains in fresh inventory', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2027-09-14T08:00:00.000Z'));
  const ownerId = '507f1f77bcf86cd799439001';
  store.loadJournal.mockResolvedValue({ kind: 'valid', value: journal([A, B]) });
  Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([request(A), request(B)]);
  Notifications.cancelScheduledNotificationAsync.mockResolvedValue();
  Notifications.getPermissionsAsync.mockResolvedValue({ ios: { status: 2 } });
  getMealPlanHorizon.mockResolvedValue([{ id: ENTRY, ownerId, reminderRevision: 2,
    reminder: { fireAt } }]);
  const statuses = [];
  await reconcileReminders({ binding: { ownerId, epoch: EPOCH }, remindersEnabled: true,
    stillCurrent: () => true, onStatus: (value) => statuses.push(value) });
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(B);
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  expect(statuses.at(-1).kind).toBe('pending');
  expect(statuses.at(-1).scheduledIds.size).toBe(0);
});

it('a malformed later inventory item blocks recovery of an earlier proven ID', async () => {
  store.loadJournal.mockResolvedValue({ kind: 'valid', value: journal() });
  Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([
    request(A, { trigger: null }),
    { identifier: 'foreign', content: null, trigger: null },
  ]);
  await reconcileReminders({ binding: { epoch: EPOCH }, remindersEnabled: true,
    stillCurrent: () => true });
  expect(store.incrementAttempt).not.toHaveBeenCalled();
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

it('a null preflight for a future server instant writes no journal and schedules nothing', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2027-09-14T08:00:00.000Z'));
  const ownerId = '507f1f77bcf86cd799439001';
  store.loadJournal.mockResolvedValue({ kind: 'valid', value: journal([]) });
  Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
  Notifications.getPermissionsAsync.mockResolvedValue({ ios: { status: 2 } });
  Notifications.getNextTriggerDateAsync.mockResolvedValue(null);
  getMealPlanHorizon.mockResolvedValue([{ id: ENTRY, ownerId, reminderRevision: 2,
    reminder: { fireAt } }]);
  await reconcileReminders({ binding: { ownerId, epoch: EPOCH }, remindersEnabled: true,
    stillCurrent: () => true });
  expect(store.journalId).not.toHaveBeenCalled();
  expect(store.incrementAttempt).not.toHaveBeenCalled();
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

it('settles an in-flight schedule across an auth transition and compensates its own exact ID', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2027-09-14T08:00:00.000Z'));
  const ownerId = '507f1f77bcf86cd799439001';
  const requested = `${PREFIX}${'Z'.repeat(43)}`;
  let current = true;
  store.loadJournal.mockResolvedValue({ kind: 'valid', value: journal([]) });
  Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
  Notifications.getPermissionsAsync.mockResolvedValue({ ios: { status: 2 } });
  Notifications.scheduleNotificationAsync.mockImplementation(async () => {
    current = false;
    return requested;
  });
  getMealPlanHorizon.mockResolvedValue([{ id: ENTRY, ownerId, reminderRevision: 2,
    reminder: { fireAt } }]);
  await reconcileReminders({ binding: { ownerId, epoch: EPOCH }, remindersEnabled: true,
    stillCurrent: () => current });
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(requested);
  expect(Notifications.getAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
});

it('a preference disable during inventory prevents all OS mutations', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2027-09-14T08:00:00.000Z'));
  let release;
  let current = true;
  store.loadJournal.mockResolvedValue({ kind: 'valid', value: journal([]) });
  Notifications.getAllScheduledNotificationsAsync.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  const run = reconcileReminders({ binding: { ownerId: '507f1f77bcf86cd799439001', epoch: EPOCH },
    remindersEnabled: true, stillCurrent: () => current });
  await Promise.resolve(); await Promise.resolve();
  current = false;
  release([]);
  await run;
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

it('a malformed successful horizon read leaves existing exact-ID requests untouched', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2027-09-14T08:00:00.000Z'));
  store.loadJournal.mockResolvedValue({ kind: 'valid', value: journal() });
  Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([request()]);
  getMealPlanHorizon.mockRejectedValue(new Error('Meal plan horizon is malformed.'));
  await reconcileReminders({ binding: { ownerId: '507f1f77bcf86cd799439001', epoch: EPOCH },
    remindersEnabled: true, stillCurrent: () => true });
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  expect(store.pruneAbsent).not.toHaveBeenCalled();
});

it('a subsecond horizon blocks simultaneous proven malformed inventory before recovery, then a valid horizon permits bounded repair', async () => {
  const ownerId = '507f1f77bcf86cd799439001';
  const record = journal();
  let pending = [request(A, { trigger: null })];
  store.loadJournal.mockImplementation(async () => ({ kind: 'valid', value: record }));
  store.incrementAttempt.mockImplementation(async () => { record.records[A].attempts += 1; return record.records[A].attempts; });
  store.pruneAbsent.mockImplementation(async () => record);
  Notifications.getAllScheduledNotificationsAsync.mockImplementation(async () => pending);
  Notifications.cancelScheduledNotificationAsync.mockImplementation(async () => { pending = []; });
  Notifications.getPermissionsAsync.mockResolvedValue({ ios: { status: 2 } });
  getMealPlanHorizon.mockResolvedValueOnce([{ id: ENTRY, ownerId, reminderRevision: 2,
    reminder: { fireAt: '2027-09-14T09:00:00.001Z' } }]).mockResolvedValue([]);
  const args = { binding: { ownerId, epoch: EPOCH }, remindersEnabled: true, stillCurrent: () => true };
  await reconcileReminders(args);
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  expect(store.incrementAttempt).not.toHaveBeenCalled();
  expect(store.pruneAbsent).not.toHaveBeenCalled();
  expect(record.records[A].attempts).toBe(0);
  await reconcileReminders(args);
  expect(store.incrementAttempt).toHaveBeenCalledTimes(1);
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(A);
  expect(record.records[A].attempts).toBe(1);
});

it('a preference disable immediately before scheduling leaves no retained request', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2027-09-14T08:00:00.000Z'));
  let current = true;
  const ownerId = '507f1f77bcf86cd799439001';
  store.loadJournal.mockResolvedValue({ kind: 'valid', value: journal([]) });
  Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
  Notifications.getPermissionsAsync.mockResolvedValue({ ios: { status: 2 } });
  getMealPlanHorizon.mockResolvedValue([{ id: ENTRY, ownerId, reminderRevision: 2, reminder: { fireAt } }]);
  store.journalId.mockImplementation(async () => { current = false; });
  await reconcileReminders({ binding: { ownerId, epoch: EPOCH }, remindersEnabled: true,
    stillCurrent: () => current });
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

it('a preference disable while native scheduling is in flight compensates its exact ID', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2027-09-14T08:00:00.000Z'));
  const ownerId = '507f1f77bcf86cd799439001';
  const requested = `${PREFIX}${'Z'.repeat(43)}`;
  let current = true;
  let settle;
  let pending = false;
  store.loadJournal.mockResolvedValue({ kind: 'valid', value: journal([]) });
  Notifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
  Notifications.getPermissionsAsync.mockResolvedValue({ ios: { status: 2 } });
  getMealPlanHorizon.mockResolvedValue([{ id: ENTRY, ownerId, reminderRevision: 2, reminder: { fireAt } }]);
  Notifications.scheduleNotificationAsync.mockImplementation(() => new Promise((resolve) => { settle = () => {
    pending = true; resolve(requested);
  }; }));
  Notifications.cancelScheduledNotificationAsync.mockImplementation(async (id) => {
    expect(id).toBe(requested);
    pending = false;
  });
  const run = reconcileReminders({ binding: { ownerId, epoch: EPOCH }, remindersEnabled: true,
    stillCurrent: () => current });
  for (let n = 0; n < 30 && !settle; n += 1) await Promise.resolve();
  expect(settle).toBeDefined();
  current = false;
  settle();
  await run;
  expect(pending).toBe(false);
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(requested);
});
