const test = require('node:test');
const assert = require('node:assert/strict');

const {
  eligibleFilter,
  parseArgs,
  runBackfill,
  runBackfillCommand,
} = require('../scripts/backfill-email-verified');

const CUTOFF = new Date('2026-01-01T00:00:00.000Z');

function quietLogger() {
  return { log() {}, error() {} };
}

function fakeCollection({ eligibleCount = 0, modifiedCount = 0 } = {}) {
  const calls = { countDocuments: [], updateMany: [] };
  return {
    calls,
    async countDocuments(filter) {
      calls.countDocuments.push(filter);
      return eligibleCount;
    },
    async updateMany(filter, update) {
      calls.updateMany.push({ filter, update });
      return { modifiedCount };
    },
  };
}

test('eligibleFilter matches pre-cutoff password-bearing unverified users only', () => {
  const filter = eligibleFilter(CUTOFF);
  assert.deepEqual(filter, {
    createdAt: { $lt: CUTOFF },
    passwordHash: { $exists: true, $type: 'string', $ne: '' },
    emailVerified: { $ne: true },
  });
});

test('parseArgs requires an explicit --cutoff', () => {
  assert.throws(() => parseArgs([]), /--cutoff is required/);
  assert.throws(() => parseArgs(['--apply']), /--cutoff is required/);
});

test('parseArgs rejects an unparseable cutoff', () => {
  assert.throws(() => parseArgs(['--cutoff=not-a-date']), /not a parseable date/);
});

test('parseArgs rejects unknown flags', () => {
  assert.throws(() => parseArgs(['--cutoff=2026-01-01', '--force']), /Usage/);
});

test('parseArgs accepts a bare cutoff (dry-run) and cutoff + --apply', () => {
  const dryRun = parseArgs(['--cutoff=2026-01-01T00:00:00.000Z']);
  assert.equal(dryRun.apply, false);
  assert.equal(dryRun.cutoff.toISOString(), '2026-01-01T00:00:00.000Z');

  const apply = parseArgs(['--cutoff=2026-01-01T00:00:00.000Z', '--apply']);
  assert.equal(apply.apply, true);
});

test('dry-run counts eligible documents and performs no write', async () => {
  const collection = fakeCollection({ eligibleCount: 3 });

  const result = await runBackfill({ collection, cutoff: CUTOFF, logger: quietLogger() });

  assert.deepEqual(result, { applied: false, eligible: 3 });
  assert.equal(collection.calls.countDocuments.length, 1);
  assert.equal(collection.calls.updateMany.length, 0);
});

test('--apply performs exactly one updateMany scoped to the eligible filter, setting emailVerified:true only', async () => {
  const collection = fakeCollection({ eligibleCount: 2, modifiedCount: 2 });

  const result = await runBackfill({
    collection,
    cutoff: CUTOFF,
    apply: true,
    logger: quietLogger(),
  });

  assert.deepEqual(result, { applied: true, eligible: 2, modified: 2 });
  assert.equal(collection.calls.updateMany.length, 1);
  assert.deepEqual(collection.calls.updateMany[0].filter, eligibleFilter(CUTOFF));
  assert.deepEqual(collection.calls.updateMany[0].update, { $set: { emailVerified: true } });
});

test('is safe to rerun: a second apply against an already-backfilled collection modifies nothing further', async () => {
  const collection = fakeCollection({ eligibleCount: 0, modifiedCount: 0 });

  const result = await runBackfill({
    collection,
    cutoff: CUTOFF,
    apply: true,
    logger: quietLogger(),
  });

  assert.deepEqual(result, { applied: true, eligible: 0, modified: 0 });
});

test('runBackfillCommand connects, runs, and always disconnects (even on failure)', async () => {
  const calls = [];
  const collection = fakeCollection({ eligibleCount: 1, modifiedCount: 1 });

  const result = await runBackfillCommand({
    argv: ['--cutoff=2026-01-01T00:00:00.000Z', '--apply'],
    loadEnvironment: () => ({ mongodbUri: 'mongodb://fake/wecooked_test' }),
    connect: async (uri) => {
      calls.push(['connect', uri]);
    },
    disconnect: async () => {
      calls.push(['disconnect']);
    },
    getCollection: () => collection,
    logger: quietLogger(),
  });

  assert.deepEqual(result, { applied: true, eligible: 1, modified: 1 });
  assert.deepEqual(calls, [
    ['connect', 'mongodb://fake/wecooked_test'],
    ['disconnect'],
  ]);
});

test('runBackfillCommand disconnects even when the backfill itself throws', async () => {
  const calls = [];

  await assert.rejects(
    () =>
      runBackfillCommand({
        argv: ['--cutoff=2026-01-01T00:00:00.000Z'],
        loadEnvironment: () => ({ mongodbUri: 'mongodb://fake/wecooked_test' }),
        connect: async () => {
          calls.push('connect');
        },
        disconnect: async () => {
          calls.push('disconnect');
        },
        getCollection: () => ({
          countDocuments: async () => {
            throw new Error('db exploded');
          },
        }),
        logger: quietLogger(),
      }),
    /db exploded/
  );

  assert.deepEqual(calls, ['connect', 'disconnect']);
});

test('never modifies post-cutoff users: the filter excludes createdAt >= cutoff by construction', () => {
  const filter = eligibleFilter(CUTOFF);
  const postCutoffDoc = { createdAt: new Date(CUTOFF.getTime() + 1) };
  // The filter's createdAt clause is exclusive-at-and-after cutoff — a
  // post-cutoff document's createdAt would never satisfy `$lt: CUTOFF`.
  assert.equal(postCutoffDoc.createdAt < filter.createdAt.$lt, false);
});
