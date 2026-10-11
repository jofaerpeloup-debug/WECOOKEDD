const { Temporal } = require('@js-temporal/polyfill');
const { AppError } = require('../../shared/errors/app-error');

const WALL_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const NAMED_ZONE = /^(?:[A-Za-z_]+\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)*|UTC)$/;

function invalidTime() {
  return new AppError('Reminder time or time zone is invalid.', { statusCode: 400, code: 'MEAL_PLAN_REMINDER_TIME_INVALID' });
}

function resolveReminder(dateKey, localTime, timeZone, { future = true, now = new Date() } = {}) {
  const match = typeof localTime === 'string' ? WALL_TIME.exec(localTime) : null;
  if (!match || typeof timeZone !== 'string' || !NAMED_ZONE.test(timeZone)) throw invalidTime();
  let zoned;
  try {
    const [year, month, day] = dateKey.split('-').map(Number);
    zoned = Temporal.ZonedDateTime.from({ timeZone, year, month, day, hour: Number(match[1]), minute: Number(match[2]) }, { disambiguation: 'earlier' });
    if (zoned.year !== year || zoned.month !== month || zoned.day !== day || zoned.hour !== Number(match[1]) || zoned.minute !== Number(match[2])) throw invalidTime();
    if (zoned.offsetNanoseconds < -12 * 3600e9 || zoned.offsetNanoseconds > 14 * 3600e9) throw invalidTime();
    const fireAt = new Date(zoned.epochMilliseconds);
    if (!Number.isFinite(fireAt.getTime()) || (future && fireAt.getTime() <= now.getTime())) throw invalidTime();
    return { localTime, timeZone, fireAt };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw invalidTime();
  }
}

module.exports = { resolveReminder };
