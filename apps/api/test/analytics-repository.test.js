const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../src/modules/users/user.model');
const CommunityPost = require('../src/modules/community/community-post.model');
const repository = require('../src/modules/analytics/analytics.repository');

function capture(t, Model, rows = []) {
  const calls = [];
  t.mock.method(Model, 'aggregate', (pipeline) => ({
    option(options) {
      calls.push({ pipeline, options });
      return Promise.resolve(rows);
    },
  }));
  return calls;
}

const FROM = {
  days7: new Date('2026-09-30T16:00:00.000Z'),
  days30: new Date('2026-09-07T16:00:00.000Z'),
  days90: new Date('2026-07-09T16:00:00.000Z'),
};
const TO = new Date('2026-10-07T03:00:00.000Z');

// This fixture evaluator checks the predicates and day key sent to Mongo.
// It is not a substitute for physical Mongo execution.
function evaluateDailyFixture(pipeline, documents) {
  const [rangeStage, typeStage, groupStage] = pipeline;
  const { $gte: lower, $lt: upper } = rangeStage.$match.createdAt;
  const [typeExpression, requiredType] = typeStage.$match.$expr.$eq;
  assert.deepEqual(typeExpression, { $type: '$createdAt' });
  assert.deepEqual(groupStage.$group, {
    _id: { $dateToString: {
      format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Manila',
    } },
    count: { $sum: 1 },
  });

  function scalarType(value) {
    if (value === undefined) return 'missing';
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (value instanceof Date) return 'date';
    return typeof value;
  }

  // Mongo's query predicates may admit an array containing an in-range Date;
  // the second $match must still reject it before the $group.
  const rows = documents.filter(({ createdAt }) => {
    const candidates = Array.isArray(createdAt) ? createdAt : [createdAt];
    return candidates.some((value) => value instanceof Date
      && Number.isFinite(value.getTime()) && value >= lower && value < upper)
      && scalarType(createdAt) === requiredType;
  });
  const daily = new Map();
  for (const { createdAt } of rows) {
    // The 2026 Manila fixture dates use +08:00. The pipeline assertion above
    // independently requires the IANA timezone for actual Mongo grouping.
    const day = new Date(createdAt.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    daily.set(day, (daily.get(day) || 0) + 1);
  }
  return [...daily].map(([_id, count]) => ({ _id, count }))
    .sort((a, b) => a._id.localeCompare(b._id));
}

test('current snapshots aggregate on server with bounded non-spilling operations', async (t) => {
  const userCalls = capture(t, User, [{ total: 1 }]);
  const postCalls = capture(t, CommunityPost, [{ total: 2 }]);
  assert.deepEqual(await repository.accountSnapshot(), { total: 1 });
  assert.deepEqual(await repository.postSnapshot(), { total: 2 });
  assert.deepEqual(userCalls[0].options, { maxTimeMS: 2000, allowDiskUse: false });
  assert.deepEqual(postCalls[0].options, { maxTimeMS: 2000, allowDiskUse: false });
  const group = userCalls[0].pipeline[0].$group;
  assert.deepEqual(Object.keys(group), [
    '_id', 'total', 'user', 'moderator', 'admin', 'active', 'suspended', 'eligibleActive',
  ]);
  assert.match(JSON.stringify(group.eligibleActive), /deactivatedAt/);
});

test('daily pipelines keep the 90-day range and scalar BSON Date check before Manila grouping', async (t) => {
  const userCalls = capture(t, User);
  const postCalls = capture(t, CommunityPost);
  assert.equal(await repository.accountPeriods(FROM, TO), null);
  assert.equal(await repository.postPeriods(FROM, TO), null);
  for (const call of [userCalls[0], postCalls[0]]) {
    assert.deepEqual(call.pipeline[0], {
      $match: { createdAt: { $gte: FROM.days90, $lt: TO } },
    });
    assert.deepEqual(call.pipeline[1], {
      $match: { $expr: { $eq: [{ $type: '$createdAt' }, 'date'] } },
    });
    assert.deepEqual(call.pipeline[2].$group, {
      _id: { $dateToString: {
        format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Manila',
      } },
      count: { $sum: 1 },
    });
    assert.deepEqual(call.options, { maxTimeMS: 2000, allowDiskUse: false });
    assert.doesNotMatch(JSON.stringify(call.pipeline), /\$lookup|\$sort|\$where|\$out/);
  }
});

test('synthetic malformed timestamps and half-open boundaries preserve prior eligibility', async (t) => {
  const userCalls = capture(t, User);
  const postCalls = capture(t, CommunityPost);
  await repository.accountPeriods(FROM, TO);
  await repository.postPeriods(FROM, TO);

  const justBefore = (date) => new Date(date.getTime() - 1);
  const justAfter = (date) => new Date(date.getTime() + 1);
  const inWindow = justBefore(TO);
  const fixtures = [
    { createdAt: justBefore(FROM.days90) },
    { createdAt: FROM.days90 },
    { createdAt: justBefore(FROM.days30) },
    { createdAt: FROM.days30 },
    { createdAt: justBefore(FROM.days7) },
    { createdAt: FROM.days7 },
    { createdAt: inWindow },
    { createdAt: TO },
    { createdAt: justAfter(TO) },
    { createdAt: [inWindow] },
    { createdAt: [FROM.days90, inWindow] },
    { createdAt: inWindow.toISOString() },
    { createdAt: null },
    {},
    { createdAt: 1 },
    { createdAt: { date: inWindow } },
  ];

  for (const call of [userCalls[0], postCalls[0]]) {
    const daily = evaluateDailyFixture(call.pipeline, fixtures);
    const periodSum = (from) => daily
      .filter(({ _id }) => _id >= new Date(from.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10))
      .reduce((total, row) => total + row.count, 0);
    assert.deepEqual([periodSum(FROM.days7), periodSum(FROM.days30), periodSum(FROM.days90)],
      [2, 4, 6]);
    assert.deepEqual(evaluateDailyFixture(call.pipeline, [
      { createdAt: justBefore(FROM.days7) }, { createdAt: FROM.days7 },
    ]), [
      { _id: '2026-09-30', count: 1 }, { _id: '2026-10-01', count: 1 },
    ]);
  }
});
