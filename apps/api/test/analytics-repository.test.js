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

// This deliberately small fixture evaluator checks the predicates and group
// thresholds we send to Mongo. It is not a substitute for Mongo execution.
function evaluatePeriodFixture(pipeline, documents) {
  const [rangeStage, typeStage, groupStage] = pipeline;
  const { $gte: lower, $lt: upper } = rangeStage.$match.createdAt;
  const [typeExpression, requiredType] = typeStage.$match.$expr.$eq;
  assert.deepEqual(typeExpression, { $type: '$createdAt' });

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
  const threshold = (field) => {
    const expression = groupStage.$group[field].$sum.$cond[0].$gte;
    assert.equal(expression[0], '$createdAt');
    return expression[1];
  };
  assert.deepEqual(groupStage.$group.days90, { $sum: 1 });
  return {
    days7: rows.filter(({ createdAt }) => createdAt >= threshold('days7')).length,
    days30: rows.filter(({ createdAt }) => createdAt >= threshold('days30')).length,
    days90: rows.length,
  };
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

test('period pipelines keep the 90-day range first and require a scalar BSON Date before grouping', async (t) => {
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
    assert.deepEqual(Object.keys(call.pipeline[2].$group), ['_id', 'days7', 'days30', 'days90']);
    assert.deepEqual(call.options, { maxTimeMS: 2000, allowDiskUse: false });
    assert.doesNotMatch(JSON.stringify(call.pipeline), /\$lookup|\$sort|\$where|\$out/);
  }
});

test('synthetic adversarial timestamps and half-open boundaries use only scalar Dates', async (t) => {
  const userCalls = capture(t, User);
  const postCalls = capture(t, CommunityPost);
  await repository.accountPeriods(FROM, TO);
  await repository.postPeriods(FROM, TO);

  const justBefore = (date) => new Date(date.getTime() - 1);
  const justAfter = (date) => new Date(date.getTime() + 1);
  const inWindow = justBefore(TO);
  const fixtures = [
    [{ createdAt: justBefore(FROM.days90) }, [0, 0, 0]],
    [{ createdAt: FROM.days90 }, [0, 0, 1]],
    [{ createdAt: justBefore(FROM.days30) }, [0, 0, 1]],
    [{ createdAt: FROM.days30 }, [0, 1, 1]],
    [{ createdAt: justBefore(FROM.days7) }, [0, 1, 1]],
    [{ createdAt: FROM.days7 }, [1, 1, 1]],
    [{ createdAt: inWindow }, [1, 1, 1]],
    [{ createdAt: TO }, [0, 0, 0]],
    [{ createdAt: justAfter(TO) }, [0, 0, 0]],
    [{ createdAt: [inWindow] }, [0, 0, 0]],
    [{ createdAt: [FROM.days90, inWindow] }, [0, 0, 0]],
    [{ createdAt: inWindow.toISOString() }, [0, 0, 0]],
    [{ createdAt: null }, [0, 0, 0]],
    [{}, [0, 0, 0]],
    [{ createdAt: 1 }, [0, 0, 0]],
    [{ createdAt: { date: inWindow } }, [0, 0, 0]],
  ];

  for (const call of [userCalls[0], postCalls[0]]) {
    for (const [document, [days7, days30, days90]] of fixtures) {
      assert.deepEqual(evaluatePeriodFixture(call.pipeline, [document]), {
        days7, days30, days90,
      }, JSON.stringify(document));
    }
    assert.deepEqual(evaluatePeriodFixture(call.pipeline, fixtures.map(([document]) => document)), {
      days7: 2, days30: 4, days90: 6,
    });
  }
});
