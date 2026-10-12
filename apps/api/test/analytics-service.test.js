process.env.NODE_ENV = 'test';
process.env.PORT = '4068';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../src/modules/analytics/analytics.service');
const repository = require('../src/modules/analytics/analytics.repository');
const sessions = require('../src/modules/sessions/session.service');
const users = require('../src/modules/users/user.service');

const AUTH = { sessionId: 'session-1', userId: 'user-1', role: 'admin' };
const END = new Date('2026-01-01T16:00:00.000Z');

function mockAuthority(t, { role = 'admin', session = true, generation = 0 } = {}) {
  t.mock.method(sessions, 'getActiveSessionById', async () => session
    ? { _id: AUTH.sessionId, userId: AUTH.userId, securityGeneration: generation } : null);
  t.mock.method(users, 'getUserById', async () => ({
    _id: AUTH.userId, role, status: 'active', sessionGeneration: generation,
  }));
}

function mockAggregates(t, overrides = {}) {
  t.mock.method(repository, 'accountSnapshot', async () => ({
    total: 5, user: 3, moderator: 1, admin: 1,
    active: 4, suspended: 1, eligibleActive: 3,
    ...overrides.account,
  }));
  t.mock.method(repository, 'postSnapshot', async () => ({ total: 8 }));
  t.mock.method(repository, 'accountPeriods', async () => ({ days7: 1, days30: 2, days90: 3 }));
  t.mock.method(repository, 'postPeriods', async () => ({ days7: 2, days30: 4, days90: 6 }));
}

test('Manila windows include current partial day across month and year edges', () => {
  const beforeMidnight = service.periodStarts(new Date('2025-12-31T15:59:59.999Z'));
  assert.equal(beforeMidnight.days7.toISOString(), '2025-12-24T16:00:00.000Z');
  const atMidnight = service.periodStarts(END);
  assert.equal(atMidnight.days7.toISOString(), '2025-12-26T16:00:00.000Z');
  assert.equal(atMidnight.days30.toISOString(), '2025-12-03T16:00:00.000Z');
  assert.equal(atMidnight.days90.toISOString(), '2025-10-04T16:00:00.000Z');
});

test('fixed response contains only approved aggregate fields and period boundaries', async (t) => {
  mockAggregates(t);
  mockAuthority(t);
  const result = await service.getOverview(AUTH, END);
  assert.deepEqual(Object.keys(result), [
    'periodEndUtc', 'generatedAtUtc', 'timeZone', 'accounts', 'communityPosts', 'periods',
  ]);
  assert.deepEqual(result.accounts, {
    total: 5, byRole: { user: 3, moderator: 1, admin: 1 },
    byStatus: { active: 4, suspended: 1 }, eligibleActive: 3,
  });
  assert.deepEqual(result.periods.days7, {
    fromUtc: '2025-12-26T16:00:00.000Z', toUtc: END.toISOString(),
    accountsRegistered: 1, postsCreated: 2,
  });
  assert.ok(Date.parse(result.generatedAtUtc) >= END.getTime());
  assert.doesNotMatch(JSON.stringify(result), /user-1|session-1|email|caption|password/i);
});

test('successful empty collections produce all keys with real zeroes', async (t) => {
  for (const name of ['accountSnapshot', 'postSnapshot', 'accountPeriods', 'postPeriods']) {
    t.mock.method(repository, name, async () => null);
  }
  mockAuthority(t);
  const result = await service.getOverview(AUTH, END);
  assert.equal(result.accounts.total, 0);
  assert.equal(result.communityPosts.retainedTotal, 0);
  for (const period of Object.values(result.periods)) {
    assert.equal(period.accountsRegistered, 0);
    assert.equal(period.postsCreated, 0);
  }
});

test('unknown role/status and malformed counts fail closed', async (t) => {
  mockAggregates(t, { account: { total: 6 } });
  mockAuthority(t);
  await assert.rejects(service.getOverview(AUTH, END), /Inconsistent analytics aggregates/);
});

test('unknown status and unsafe aggregate numbers fail closed', async (t) => {
  mockAggregates(t, { account: { suspended: 0 } });
  mockAuthority(t);
  await assert.rejects(service.getOverview(AUTH, END), /Inconsistent analytics aggregates/);
  t.mock.reset();
  mockAggregates(t, { account: { user: Number.MAX_SAFE_INTEGER + 1 } });
  mockAuthority(t);
  await assert.rejects(service.getOverview(AUTH, END), /Invalid analytics aggregate count/);
});

test('final fence denies demotion, revocation and generation mismatch', async (t) => {
  mockAggregates(t);
  let role = 'admin';
  let active = true;
  let generation = 0;
  t.mock.method(sessions, 'getActiveSessionById', async () => active
    ? { userId: AUTH.userId, securityGeneration: 0 } : null);
  t.mock.method(users, 'getUserById', async () => ({
    role, status: 'active', sessionGeneration: generation,
  }));
  role = 'moderator';
  await assert.rejects(service.getOverview(AUTH, END), { statusCode: 403 });
  role = 'admin';
  active = false;
  await assert.rejects(service.getOverview(AUTH, END), { statusCode: 401 });
  active = true;
  generation = 1;
  await assert.rejects(service.getOverview(AUTH, END), { statusCode: 401 });
});

test('final fence rejects foreign ownership and deactivated accounts', async (t) => {
  mockAggregates(t);
  let owner = 'different-user';
  let deactivatedAt = null;
  t.mock.method(sessions, 'getActiveSessionById', async () => ({
    userId: owner, securityGeneration: 0,
  }));
  t.mock.method(users, 'getUserById', async () => ({
    role: 'admin', status: 'active', sessionGeneration: 0, deactivatedAt,
  }));
  await assert.rejects(service.getOverview(AUTH, END), { statusCode: 401 });
  owner = AUTH.userId;
  deactivatedAt = new Date();
  await assert.rejects(service.getOverview(AUTH, END), { statusCode: 401 });
});

test('final-fence read error propagates without a response', async (t) => {
  mockAggregates(t);
  t.mock.method(sessions, 'getActiveSessionById', async () => { throw new Error('mongo failed'); });
  await assert.rejects(service.getOverview(AUTH, END), /mongo failed/);
});
