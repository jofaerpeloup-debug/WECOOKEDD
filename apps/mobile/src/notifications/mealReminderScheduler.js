import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getMealPlanHorizon } from '../api/mealPlanService';
import { loadJournal, journalId, incrementAttempt, pruneAbsent, randomNonce, PREFIX, validRequestId } from './mealReminderSessionStore';

const ID = /^[0-9a-f]{24}$/i;
const HORIZON_MS = 28 * 86400000;
const CAPACITY = 32;
const CHANNEL = 'meal-reminders';
const exactKeys = (value, keys) => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const canonicalTime = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value))
  && new Date(value).toISOString() === value && Date.parse(value) % 1000 === 0;
const requestOrder = (a, b) => a.content.data.fireAt.localeCompare(b.content.data.fireAt)
  || a.content.data.entryId.localeCompare(b.content.data.entryId)
  || a.identifier.localeCompare(b.identifier);

export function validLocalData(data) {
  return exactKeys(data, ['version', 'kind', 'entryId', 'reminderRevision', 'fireAt', 'sessionEpoch'])
    && data.version === 1 && data.kind === 'mealPlanReminder' && ID.test(data.entryId)
    && Number.isSafeInteger(data.reminderRevision) && data.reminderRevision >= 0
    && canonicalTime(data.fireAt) && typeof data.sessionEpoch === 'string' && /^[A-Za-z0-9_-]{43}$/.test(data.sessionEpoch);
}

function calendarInput(fireAt) {
  if (!canonicalTime(fireAt)) throw new Error('Reminder instant is malformed.');
  const ms = Date.parse(fireAt);
  if (!Number.isSafeInteger(ms) || ms < 0 || ms % 1000 !== 0) throw new Error('Reminder instant has unsupported precision.');
  const date = new Date(ms);
  return {
    type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
    timezone: 'UTC', repeats: false,
    year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(),
    hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: date.getUTCSeconds(),
  };
}

export function calendarInstant(trigger) {
  if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger) || trigger.type !== 'calendar'
    || trigger.class !== 'UNCalendarNotificationTrigger' || trigger.repeats !== false) return null;
  const c = trigger.dateComponents;
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  // A native spelling that has not been observed on device is not proof of
  // corruption. Freeze the pass instead of spending a recovery attempt.
  if ((c.calendar != null && c.calendar !== 'iso8601')
    || (c.timeZone != null && c.timeZone !== 'UTC')) {
    throw new Error('Reminder native calendar representation unavailable.');
  }
  if (c.calendar !== 'iso8601' || c.timeZone !== 'UTC' || c.isLeapMonth !== false
    || (c.isRepeatedDay !== undefined && c.isRepeatedDay !== false)) return null;
  const allowed = new Set(['calendar', 'timeZone', 'isLeapMonth', 'isRepeatedDay',
    'year', 'month', 'day', 'hour', 'minute', 'second']);
  if (Object.keys(c).some((key) => !allowed.has(key))) return null;
  const fields = ['year', 'month', 'day', 'hour', 'minute', 'second'];
  if (fields.some((key) => !Number.isSafeInteger(c[key]))) return null;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(c.year, c.month - 1, c.day);
  date.setUTCHours(c.hour, c.minute, c.second, 0);
  if (!Number.isSafeInteger(date.getTime()) || date.getTime() < 0
    || date.getUTCFullYear() !== c.year || date.getUTCMonth() + 1 !== c.month
    || date.getUTCDate() !== c.day || date.getUTCHours() !== c.hour
    || date.getUTCMinutes() !== c.minute || date.getUTCSeconds() !== c.second) return null;
  return date.getTime();
}

export function androidInstant(trigger) {
  if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger) || trigger.type !== 'date'
    || trigger.repeats !== false) return null;
  const raw = trigger.value ?? trigger.date;
  const ms = raw instanceof Date ? raw.getTime() : typeof raw === 'number' ? raw
    : typeof raw === 'string' && canonicalTime(raw) ? Date.parse(raw) : NaN;
  return Number.isSafeInteger(ms) && ms >= 0 ? ms : null;
}

async function preview(trigger) {
  if (typeof Notifications.getNextTriggerDateAsync !== 'function') throw new Error('Reminder native preview unavailable.');
  let result;
  try { result = await Notifications.getNextTriggerDateAsync(trigger); }
  catch { throw new Error('Reminder native preview unavailable.'); }
  if (result !== null && (!Number.isSafeInteger(result) || result < 0)) {
    throw new Error('Reminder native preview unavailable.');
  }
  return result;
}

function previewInput(c) {
  return { type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
    timezone: c.timeZone, repeats: false,
    year: c.year, month: c.month, day: c.day,
    hour: c.hour, minute: c.minute, second: c.second };
}

function verifiedEntries(snapshot, chosen, epoch) {
  const byEntry = new Map();
  for (const request of [...snapshot.valid, ...snapshot.expired]) {
    const entryId = request.content.data.entryId;
    byEntry.set(entryId, [...(byEntry.get(entryId) || []), request]);
  }
  return new Set([...chosen].filter(([entryId, entry]) => {
    const requests = byEntry.get(entryId);
    return requests?.length === 1 && snapshot.valid.includes(requests[0])
      && requests[0].content.data.sessionEpoch === epoch
      && requests[0].content.data.reminderRevision === entry.reminderRevision
      && requests[0].content.data.fireAt === entry.reminder.fireAt;
  }).map(([entryId]) => entryId));
}

export async function inspectInventory(inventory, journal, now = new Date()) {
  if (!Array.isArray(inventory) || !journal || !journal.records) throw new Error('Reminder inventory unavailable.');
  const nowMs = now.getTime();
  if (!Number.isSafeInteger(nowMs)) throw new Error('Reminder reference time unavailable.');
  const seen = new Set();
  const foreign = []; const valid = []; const expired = []; const invalid = [];
  const owned = [];
  for (const request of inventory) {
    if (!request || typeof request !== 'object' || Array.isArray(request)
      || typeof request.identifier !== 'string' || !request.identifier
      || seen.has(request.identifier) || !request.content || typeof request.content !== 'object'
      || Array.isArray(request.content) || !Object.prototype.hasOwnProperty.call(request, 'trigger')
      || (request.content.data !== undefined && (!request.content.data || typeof request.content.data !== 'object' || Array.isArray(request.content.data)))) {
      throw new Error('Reminder inventory is ambiguous.');
    }
    seen.add(request.identifier);
    const id = request.identifier;
    const data = request.content.data;
    const namespaced = id.startsWith(PREFIX);
    const discriminator = data?.kind === 'mealPlanReminder' || data?.version === 1 && data?.kind === 'mealPlanReminder';
    const proof = Object.prototype.hasOwnProperty.call(journal.records, id);
    if (!namespaced && !discriminator && !proof) { foreign.push(request); continue; }
    if (!namespaced || !validRequestId(id) || !proof || (data?.kind && data.kind !== 'mealPlanReminder') || data?.notificationId !== undefined) {
      throw new Error('Reminder ownership is ambiguous.');
    }
    owned.push(request);
  }
  // Inspect the complete outer inventory before a preview. A future null or
  // unavailable native preview freezes the entire phase before OS mutation.
  for (const request of owned) {
    const data = request.content.data;
    if (!validLocalData(data)) { invalid.push(request); continue; }
    const expected = Date.parse(data.fireAt);
    if (Platform.OS === 'ios') {
      const actual = calendarInstant(request.trigger);
      if (actual === null || actual !== expected) { invalid.push(request); continue; }
      const result = await preview(previewInput(request.trigger.dateComponents));
      if (result === null) {
        if (expected >= nowMs) throw new Error('Reminder future native preview is null.');
        expired.push(request);
      } else if (result !== expected) invalid.push(request);
      else if (expected < nowMs) expired.push(request);
      else valid.push(request);
    } else if (Platform.OS === 'android' && androidInstant(request.trigger) === expected) {
      if (expected < nowMs) expired.push(request);
      else valid.push(request);
    } else invalid.push(request);
  }
  return { foreign, valid, expired, invalid, ids: seen };
}

export function horizonRange(now) {
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return [new Date(base - 86400000).toISOString().slice(0, 10), new Date(base + 29 * 86400000).toISOString().slice(0, 10)];
}

export function permissionKind(permission) {
  if (Platform.OS === 'android') return permission?.status === 'granted' && permission?.granted === true ? 'granted' : 'unavailable';
  if (Platform.OS === 'ios') {
    const status = permission?.ios?.status;
    const values = Notifications.IosAuthorizationStatus;
    if (!values || !Number.isInteger(status)) return 'unavailable';
    if (status === values.AUTHORIZED) return 'granted';
    if (status === values.PROVISIONAL) return 'quiet';
    if (status === values.EPHEMERAL) return 'temporary';
  }
  return 'unavailable';
}

export async function ensureChannel() {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Meal reminders', importance: Notifications.AndroidImportance.DEFAULT,
  });
}

async function readInventory(now) {
  const loaded = await loadJournal();
  if (loaded.kind !== 'valid' && loaded.kind !== 'missing') throw new Error('Reminder ownership journal unavailable.');
  const journal = loaded.kind === 'valid' ? loaded.value : { version: 1, records: {} };
  return { snapshot: await inspectInventory(await Notifications.getAllScheduledNotificationsAsync(), journal, now), journal };
}

let schedulerTail = Promise.resolve();
function serialized(run) {
  const result = schedulerTail.then(run, run);
  schedulerTail = result.catch(() => {});
  return result;
}

export function reconcileReminders(args) {
  return serialized(() => reconcileLocked(args));
}

async function reconcileLocked({ binding, remindersEnabled, stillCurrent, manual = false, onStatus = () => {} }) {
  if (!binding || !stillCurrent()) return;
  const now = new Date();
  const nowMs = now.getTime();
  const [startDate, endDate] = horizonRange(now);
  let snapshot;
  let journal;
  let chosen;
  let eligible;
  let mutationStarted = false;
  try {
    ({ snapshot, journal } = await readInventory(now));
    if (!stillCurrent()) return;
    // The complete server horizon is an independent pre-mutation gate. Even
    // journal-proven recovery cannot run against a failed or malformed read.
    const entries = await getMealPlanHorizon(startDate, endDate);
    if (!stillCurrent()) return;
    if (!Array.isArray(entries) || typeof remindersEnabled !== 'boolean'
      || entries.some((entry) => entry.ownerId !== binding.ownerId
        || (entry.reminder && !canonicalTime(entry.reminder.fireAt)))) {
      throw new Error('Reminder server data unavailable.');
    }
    let readError;
    try {
      const permission = await Notifications.getPermissionsAsync();
      if (!stillCurrent()) return;
      eligible = permissionKind(permission);
    } catch (error) { readError = error; }
    const candidateEntries = !readError && remindersEnabled && eligible !== 'unavailable'
      ? entries.filter((entry) => entry.reminder && Date.parse(entry.reminder.fireAt) >= nowMs
        && Date.parse(entry.reminder.fireAt) < nowMs + HORIZON_MS) : [];
    const sorted = candidateEntries.sort((a, b) =>
      a.reminder.fireAt.localeCompare(b.reminder.fireAt) || a.id.localeCompare(b.id));
    const proposed = sorted.slice(0, Math.max(0, CAPACITY - snapshot.foreign.length));
    if (Platform.OS === 'ios') {
      for (const entry of proposed) {
        const expected = Date.parse(entry.reminder.fireAt);
        const result = await preview(calendarInput(entry.reminder.fireAt));
        if (!stillCurrent()) return;
        if (result === null) throw new Error('Reminder future native preview is null.');
        if (result !== expected) throw new Error('Reminder native preview conflicts with server instant.');
      }
    }
    if (snapshot.invalid.length) {
      for (const request of [...snapshot.invalid].sort((a, b) => a.identifier.localeCompare(b.identifier))) {
        if (!stillCurrent()) return;
        const loaded = await loadJournal();
        if (!stillCurrent()) return;
        if (loaded.kind !== 'valid' || !loaded.value.records[request.identifier]) throw new Error('Reminder recovery journal unavailable.');
        if (!manual && loaded.value.records[request.identifier].attempts >= 3) throw new Error('Reminder recovery paused.');
        await incrementAttempt(request.identifier);
        if (!stillCurrent()) return;
        mutationStarted = true;
        await Notifications.cancelScheduledNotificationAsync(request.identifier);
        if (!stillCurrent()) return;
      }
      ({ snapshot, journal } = await readInventory(now));
      if (!stillCurrent()) return;
      if (snapshot.invalid.length) throw new Error('Reminder recovery could not be verified.');
    }
    if (readError) throw readError;
    journal = await pruneAbsent(snapshot.ids);
    if (!stillCurrent()) return;
    const selected = sorted.slice(0, Math.max(0, CAPACITY - snapshot.foreign.length));
    // Recovery can change the validated foreign count. Preview the final
    // selection before ordinary cleanup, including any newly selected entry.
    if (Platform.OS === 'ios') {
      for (const entry of selected) {
        const result = await preview(calendarInput(entry.reminder.fireAt));
        if (!stillCurrent()) return;
        if (result === null || result !== Date.parse(entry.reminder.fireAt)) {
          throw new Error('Reminder native preview conflicts with server instant.');
        }
      }
    }
    chosen = new Map(selected.map((entry) => [entry.id, entry]));
    const keep = new Set();
    const cancel = [];
    for (const request of [...snapshot.valid, ...snapshot.expired].sort(requestOrder)) {
      const data = request.content.data;
      const entry = chosen.get(data.entryId);
      if (!snapshot.expired.includes(request) && entry && !keep.has(entry.id) && data.sessionEpoch === binding.epoch
        && data.reminderRevision === entry.reminderRevision && data.fireAt === entry.reminder.fireAt) keep.add(entry.id);
      else cancel.push(request);
    }
    for (const request of cancel) {
      if (!stillCurrent()) return;
      mutationStarted = true;
      await Notifications.cancelScheduledNotificationAsync(request.identifier);
      if (!stillCurrent()) return;
    }
    if (!stillCurrent()) return;
    if (selected.some((entry) => !keep.has(entry.id))) await ensureChannel();
    if (!stillCurrent()) return;
    for (const entry of selected) {
      if (keep.has(entry.id)) continue;
      if (!stillCurrent()) return;
      const id = `${PREFIX}${await randomNonce()}`;
      if (!stillCurrent()) return;
      if (snapshot.ids.has(id)) throw new Error('Reminder request ID collision.');
      await journalId(id);
      if (!stillCurrent()) return;
      let returned;
      try {
        if (!stillCurrent()) return;
        mutationStarted = true;
        returned = await Notifications.scheduleNotificationAsync({
          identifier: id,
          content: { title: 'Meal plan reminder', body: 'You have a planned meal.', data: {
            version: 1, kind: 'mealPlanReminder', entryId: entry.id,
            reminderRevision: entry.reminderRevision, fireAt: entry.reminder.fireAt, sessionEpoch: binding.epoch,
          } },
          trigger: Platform.OS === 'ios' ? calendarInput(entry.reminder.fireAt)
            : { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(entry.reminder.fireAt), channelId: CHANNEL },
        });
      } catch (error) {
        try { await Notifications.cancelScheduledNotificationAsync(id); } catch { /* retained journal; next pass */ }
        throw error;
      }
      if (returned !== id || !stillCurrent()) {
        try { await Notifications.cancelScheduledNotificationAsync(id); } catch { /* next pass */ }
        if (!stillCurrent()) return;
        throw new Error('Reminder schedule identity mismatch.');
      }
    }
    const verified = await readInventory(now);
    if (!stillCurrent()) return;
    if (verified.snapshot.invalid.length) throw new Error('Reminder inventory verification failed.');
    await pruneAbsent(verified.snapshot.ids);
    if (!stillCurrent()) return;
    const scheduledIds = verifiedEntries(verified.snapshot, chosen, binding.epoch);
    const projectionClean = verified.snapshot.expired.length === 0
      && verified.snapshot.valid.length === selected.length;
    onStatus({ kind: eligible === 'unavailable' ? 'unavailable'
      : projectionClean && selected.every((entry) => scheduledIds.has(entry.id)) ? 'scheduled' : 'pending',
    permission: eligible, capacity: Math.max(0, CAPACITY - snapshot.foreign.length),
    scheduledIds, selectedIds: new Set(selected.map((entry) => entry.id)) });
  } catch (error) {
    if (!stillCurrent()) return;
    let scheduledIds;
    if (mutationStarted && chosen) {
      try {
        const fresh = await readInventory(now);
        if (!stillCurrent()) return;
        if (!fresh.snapshot.invalid.length) {
          scheduledIds = verifiedEntries(fresh.snapshot, chosen, binding.epoch);
        }
      } catch { /* an incomplete reread cannot verify any schedule */ }
    }
    if (stillCurrent()) onStatus({ kind: 'degraded', message: error.message,
      ...(scheduledIds ? { scheduledIds, permission: eligible } : {}) });
  }
}

export function cancelKnownReminders(stillCurrent) {
  return serialized(() => cancelKnownLocked(stillCurrent));
}

async function cancelKnownLocked(stillCurrent) {
  const now = new Date();
  const { snapshot } = await readInventory(now);
  if (snapshot.invalid.length) throw new Error('Reminder recovery needed before cleanup.');
  for (const request of [...snapshot.valid, ...snapshot.expired].sort(requestOrder)) {
    if (!stillCurrent()) return;
    await Notifications.cancelScheduledNotificationAsync(request.identifier);
  }
  if (stillCurrent()) {
    const fresh = await readInventory(now);
    if (!fresh.snapshot.invalid.length) await pruneAbsent(fresh.snapshot.ids);
  }
}

export { CHANNEL };
