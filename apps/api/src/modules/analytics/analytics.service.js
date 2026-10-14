const { Temporal } = require('@js-temporal/polyfill');
const repository = require('./analytics.repository');
const sessionService = require('../sessions/session.service');
const userService = require('../users/user.service');
const { CAPABILITIES, hasCapability } = require('../../shared/security/capabilities');
const { AppError } = require('../../shared/errors/app-error');

const TIME_ZONE = 'Asia/Manila';
const PERIODS = Object.freeze([7, 30, 90]);

function periodStarts(periodEndUtc) {
  const date = Temporal.Instant.from(periodEndUtc.toISOString())
    .toZonedDateTimeISO(TIME_ZONE).toPlainDate();
  return Object.fromEntries(PERIODS.map((days) => {
    const start = date.subtract({ days: days - 1 });
    const midnight = Temporal.ZonedDateTime.from({
      timeZone: TIME_ZONE, year: start.year, month: start.month, day: start.day,
      hour: 0, minute: 0, second: 0,
    });
    return [`days${days}`, new Date(midnight.epochMilliseconds)];
  }));
}

function dailySpine(periodEndUtc) {
  const date = Temporal.Instant.from(periodEndUtc.toISOString())
    .toZonedDateTimeISO(TIME_ZONE).toPlainDate();
  const dates = Array.from({ length: 90 }, (_, index) => date.subtract({ days: 89 - index }));
  const starts = dates.map((day) => new Date(Temporal.ZonedDateTime.from({
    timeZone: TIME_ZONE, year: day.year, month: day.month, day: day.day,
    hour: 0, minute: 0, second: 0,
  }).epochMilliseconds).toISOString());
  return dates.map((day, index) => ({
    localDate: day.toString(),
    fromUtc: starts[index],
    toUtc: index === 89 ? periodEndUtc.toISOString() : starts[index + 1],
    accountsRegistered: 0,
    postsCreated: 0,
  }));
}

function count(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid analytics aggregate count.');
  }
  return value;
}

function counts(row, fields) {
  return Object.fromEntries(fields.map((field) => [field, count(row === null ? 0 : row?.[field])]));
}

function dailyCounts(rows, buckets) {
  if (rows === null) return new Map();
  if (!Array.isArray(rows)) throw new Error('Invalid analytics daily rows.');
  const dates = new Set(buckets.map((bucket) => bucket.localDate));
  const result = new Map();
  for (const row of rows) {
    if (!row || typeof row._id !== 'string' || !dates.has(row._id)
      || result.has(row._id)) {
      throw new Error('Invalid analytics daily date.');
    }
    result.set(row._id, count(row.count));
  }
  return result;
}

function sumBuckets(buckets, field) {
  return buckets.reduce((total, bucket) => count(total + bucket[field]), 0);
}

function invalidSession() {
  return new AppError('Session is no longer valid.', {
    statusCode: 401, code: 'AUTH_SESSION_INVALID',
  });
}

async function assertCurrentAdmin(auth) {
  const session = await sessionService.getActiveSessionById(auth.sessionId);
  if (!session || String(session.userId) !== auth.userId) throw invalidSession();
  const user = await userService.getUserById(session.userId);
  if (!user || user.status !== 'active' || user.deactivatedAt
    || userService.effectiveSessionGeneration(user)
      !== (Number.isInteger(session.securityGeneration) && session.securityGeneration >= 0
        ? session.securityGeneration : 0)) {
    throw invalidSession();
  }
  if (!hasCapability(user.role, CAPABILITIES.MONITORING_READ)) {
    throw new AppError('You do not have permission to perform this action.', {
      statusCode: 403, code: 'FORBIDDEN',
    });
  }
}

async function getOverview(auth, periodEndUtc) {
  const from = periodStarts(periodEndUtc);
  const [accountRow, postRow, accountDailyRows, postDailyRows] = await Promise.all([
    repository.accountSnapshot(), repository.postSnapshot(),
    repository.accountPeriods(from, periodEndUtc), repository.postPeriods(from, periodEndUtc),
  ]);
  const account = counts(accountRow, [
    'total', 'user', 'moderator', 'admin', 'active', 'suspended', 'eligibleActive',
  ]);
  const posts = counts(postRow, ['total']);
  const spine = dailySpine(periodEndUtc);
  const registrations = dailyCounts(accountDailyRows, spine);
  const postCreations = dailyCounts(postDailyRows, spine);
  const currentDay = spine[89];
  if (currentDay.fromUtc === currentDay.toUtc
    && ((registrations.get(currentDay.localDate) ?? 0) !== 0
      || (postCreations.get(currentDay.localDate) ?? 0) !== 0)) {
    throw new Error('Inconsistent analytics zero-duration bucket.');
  }
  const buckets = spine.map((bucket) => ({
    ...bucket,
    accountsRegistered: registrations.get(bucket.localDate) ?? 0,
    postsCreated: postCreations.get(bucket.localDate) ?? 0,
  }));
  if (account.total !== account.user + account.moderator + account.admin
    || account.total !== account.active + account.suspended
    || account.eligibleActive > account.active) {
    throw new Error('Inconsistent analytics aggregates.');
  }

  const toUtc = periodEndUtc.toISOString();
  const periods = Object.fromEntries(PERIODS.map((days) => {
    const key = `days${days}`;
    if (from[key].toISOString() !== buckets[90 - days].fromUtc) {
      throw new Error('Inconsistent analytics period boundary.');
    }
    const selected = buckets.slice(-days);
    return [key, {
      fromUtc: from[key].toISOString(), toUtc,
      accountsRegistered: sumBuckets(selected, 'accountsRegistered'),
      postsCreated: sumBuckets(selected, 'postsCreated'),
    }];
  }));
  const result = {
    periodEndUtc: toUtc,
    generatedAtUtc: null,
    timeZone: TIME_ZONE,
    accounts: {
      total: account.total,
      byRole: { user: account.user, moderator: account.moderator, admin: account.admin },
      byStatus: { active: account.active, suspended: account.suspended },
      eligibleActive: account.eligibleActive,
    },
    communityPosts: { retainedTotal: posts.total },
    periods,
    daily: { buckets },
  };
  await assertCurrentAdmin(auth);
  result.generatedAtUtc = new Date().toISOString();
  return result;
}

module.exports = { getOverview, periodStarts, dailySpine, assertCurrentAdmin };
