const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveReminder } = require('../src/modules/meal-plan/meal-plan-time');

test('named zones resolve UTC instant and earlier overlap occurrence', () => {
  const resolved = resolveReminder('2026-11-01', '01:30', 'America/New_York', { now: new Date('2026-01-01T00:00:00.000Z') });
  assert.equal(resolved.fireAt.toISOString(), '2026-11-01T05:30:00.000Z');
});

test('DST gap, offset IDs, unknown zones, and past time fail closed', () => {
  for (const [dateKey, localTime, timeZone] of [
    ['2026-03-08', '02:30', 'America/New_York'],
    ['2026-06-01', '09:00', '+08:00'],
    ['2026-06-01', '09:00', 'Mars/Olympus'],
    ['2026-06-01', '25:00', 'UTC'],
  ]) assert.throws(() => resolveReminder(dateKey, localTime, timeZone, { now: new Date('2026-01-01T00:00:00.000Z') }), (error) => error.code === 'MEAL_PLAN_REMINDER_TIME_INVALID');
  assert.throws(() => resolveReminder('2026-06-01', '09:00', 'UTC', { now: new Date('2026-06-01T09:00:00.000Z') }));
});

test('accepted zone offsets are bounded to minus twelve and plus fourteen hours', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(resolveReminder('2026-06-01', '09:00', 'Pacific/Kiritimati', { now }).fireAt.toISOString(), '2026-05-31T19:00:00.000Z');
  assert.equal(resolveReminder('2026-06-01', '09:00', 'Etc/GMT+12', { now }).fireAt.toISOString(), '2026-06-01T21:00:00.000Z');
});
