const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseArgs, dispositionFor, summarize, runMigration,
} = require('../scripts/migrate-recipe-metadata-v1');

function matches(doc, filter) {
  return doc && Object.entries(filter).every(([key, value]) => doc[key] === value);
}

function applyUpdate(doc, update) {
  if (update.$set) Object.assign(doc, update.$set);
  for (const field of Object.keys(update.$unset || {})) delete doc[field];
}

function fakeCollection(seed, { onUpdate } = {}) {
  const docs = seed.map((doc) => ({ ...doc }));
  let attempts = 0;
  let reads = 0;
  const collection = {
    docs,
    get attempts() { return attempts; },
    get reads() { return reads; },
    find() {
      reads += 1;
      return { toArray: async () => docs.map((doc) => ({ ...doc })) };
    },
    async findOne(filter) {
      reads += 1;
      const doc = docs.find((item) => matches(item, filter));
      return doc ? { ...doc } : null;
    },
    async defaultUpdate(filter, update) {
      const doc = docs.find((item) => matches(item, filter));
      if (!doc) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
      applyUpdate(doc, update);
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    },
    async updateOne(filter, update) {
      attempts += 1;
      if (onUpdate) return onUpdate({ collection, docs, filter, update, attempt: attempts });
      return collection.defaultUpdate(filter, update);
    },
  };
  return collection;
}

const devLegacy = () => [
  { _id: 1, region: 'tondo' },
  { _id: 2, region: 'central-luzon', category: 'dinner' },
  { _id: 3 },
];

const productionLegacy = () => [
  { _id: 4, region: 'bicol', category: 'fine-dining-restaurant' },
  { _id: 5, region: 'mangaldan', category: 'medium' },
];

test('arguments are dry-run by default and refuse ambiguous/unsupported invocation', () => {
  assert.deepEqual(parseArgs(['--environment=development']), { environment: 'development', apply: false });
  assert.deepEqual(parseArgs(['--environment=production', '--apply']), { environment: 'production', apply: true });
  assert.throws(() => parseArgs([]));
  assert.throws(() => parseArgs(['--apply']));
  assert.throws(() => parseArgs(['--environment=test']));
});

test('the exact five frozen dispositions are the only changes', () => {
  assert.deepEqual(dispositionFor({ region: 'tondo' }).set, { region: 'national-capital-region' });
  assert.deepEqual(dispositionFor({ region: 'bicol' }).set, { region: 'bicol-region' });
  assert.deepEqual(dispositionFor({ region: 'mangaldan' }).set, { region: 'ilocos-region' });
  assert.deepEqual(dispositionFor({ category: 'fine-dining-restaurant' }).unset, { category: '' });
  assert.deepEqual(dispositionFor({ category: 'medium' }).unset, { category: '' });
  assert.deepEqual(dispositionFor({ region: 'cebu', category: 'dessert' }), { set: {}, unset: {} });
});

test('dry-run reports candidates and performs zero writes', async () => {
  const collection = fakeCollection(devLegacy());
  const report = await runMigration({ collection, environment: 'development', databaseName: 'wecooked-dev', logger: { log() {} } });
  assert.equal(collection.attempts, 0);
  assert.equal(report.matched, 1);
  assert.equal(report.changed, 0);
  assert.equal(report.pending, 1);
  assert.deepEqual(report.after, report.before);
});

test('database/environment binding aborts before reads or writes', async () => {
  const collection = fakeCollection(devLegacy());
  await assert.rejects(
    () => runMigration({ collection, apply: true, environment: 'development', databaseName: 'wecooked-production', logger: { log() {} } }),
    /Refusing database mismatch/,
  );
  assert.equal(collection.reads, 0);
  assert.equal(collection.attempts, 0);
});

test('apply maps and unsets the frozen values with exact predicates', async () => {
  const seenFilters = [];
  const collection = fakeCollection(productionLegacy(), {
    onUpdate: async ({ collection: current, filter, update }) => {
      seenFilters.push({ ...filter });
      return current.defaultUpdate(filter, update);
    },
  });
  const report = await runMigration({ collection, apply: true, environment: 'production', databaseName: 'wecooked-production', logger: { log() {} } });
  assert.equal(report.changed, 2);
  assert.equal(report.pending, 0);
  assert.deepEqual(seenFilters, [
    { _id: 4, region: 'bicol', category: 'fine-dining-restaurant' },
    { _id: 5, region: 'mangaldan', category: 'medium' },
  ]);
  assert.deepEqual(collection.docs, [
    { _id: 4, region: 'bicol-region' },
    { _id: 5, region: 'ilocos-region' },
  ]);
});

test('stale update conflict fails when the legacy value remains', async () => {
  const collection = fakeCollection(devLegacy(), {
    onUpdate: async () => ({ acknowledged: true, matchedCount: 0, modifiedCount: 0 }),
  });
  await assert.rejects(
    () => runMigration({ collection, apply: true, environment: 'development', databaseName: 'wecooked-dev', logger: { log() {} } }),
    (error) => {
      assert.match(error.message, /Targeted write failed/);
      assert.equal(error.migrationReport.applied, 0);
      assert.equal(error.migrationReport.pending, 1);
      return true;
    },
  );
  assert.equal(collection.docs[0].region, 'tondo');
});

test('already-applied concurrent target state is accepted only after immediate re-read', async () => {
  const collection = fakeCollection(devLegacy(), {
    onUpdate: async ({ docs }) => {
      docs[0].region = 'national-capital-region';
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
    },
  });
  const report = await runMigration({ collection, apply: true, environment: 'development', databaseName: 'wecooked-dev', logger: { log() {} } });
  assert.equal(report.changed, 0);
  assert.equal(report.conflicts, 1);
  assert.equal(report.applied, 1);
  assert.equal(report.pending, 0);
});

for (const [name, result] of [
  ['modifiedCount failure', { acknowledged: true, matchedCount: 1, modifiedCount: 0 }],
  ['matchedCount failure', { acknowledged: true, matchedCount: 0, modifiedCount: 1 }],
]) {
  test(`${name} cannot report migration success while legacy state remains`, async () => {
    const collection = fakeCollection(devLegacy(), { onUpdate: async () => result });
    await assert.rejects(
      () => runMigration({ collection, apply: true, environment: 'development', databaseName: 'wecooked-dev', logger: { log() {} } }),
      /Targeted write failed/,
    );
    assert.equal(collection.docs[0].region, 'tondo');
  });
}

test('thrown second write reports partial state and rerun processes only the remainder', async () => {
  const collection = fakeCollection(productionLegacy(), {
    onUpdate: async ({ collection: current, filter, update, attempt }) => {
      if (attempt === 2) throw new Error('simulated second-write failure');
      return current.defaultUpdate(filter, update);
    },
  });
  await assert.rejects(
    () => runMigration({ collection, apply: true, environment: 'production', databaseName: 'wecooked-production', logger: { log() {} } }),
    (error) => {
      assert.match(error.message, /simulated second-write failure/);
      assert.equal(error.migrationReport.applied, 1);
      assert.equal(error.migrationReport.pending, 1);
      return true;
    },
  );

  const resumed = fakeCollection(collection.docs);
  const report = await runMigration({ collection: resumed, apply: true, environment: 'production', databaseName: 'wecooked-production', logger: { log() {} } });
  assert.equal(report.matched, 1);
  assert.equal(report.changed, 1);
  assert.equal(report.pending, 0);
  assert.deepEqual(resumed.docs, [
    { _id: 4, region: 'bicol-region' },
    { _id: 5, region: 'ilocos-region' },
  ]);
});

test('successful zero-change rerun is a valid idempotent apply', async () => {
  const collection = fakeCollection([
    { _id: 1, region: 'national-capital-region' },
    { _id: 2, region: 'bicol-region' },
    { _id: 3, region: 'ilocos-region' },
  ]);
  const report = await runMigration({ collection, apply: true, environment: 'production', databaseName: 'wecooked-production', logger: { log() {} } });
  assert.equal(report.matched, 0);
  assert.equal(report.changed, 0);
  assert.equal(report.applied, 0);
  assert.equal(report.pending, 0);
  assert.equal(collection.attempts, 0);
});

test('final postcondition scan prevents success after unrelated metadata becomes unsupported', async () => {
  const collection = fakeCollection([
    { _id: 1, region: 'tondo' },
    { _id: 2, region: 'central-luzon', category: 'dinner' },
  ], {
    onUpdate: async ({ collection: current, docs, filter, update }) => {
      const result = await current.defaultUpdate(filter, update);
      docs[1].category = 'dessert';
      return result;
    },
  });
  await assert.rejects(
    () => runMigration({ collection, apply: true, environment: 'development', databaseName: 'wecooked-dev', logger: { log() {} } }),
    /final postcondition failed: unsupported category values=1/,
  );
});

test('unsupported metadata blocks apply before all writes', async () => {
  const collection = fakeCollection([
    { _id: 1, region: 'tondo' },
    { _id: 2, region: 'cebu', category: 'dessert' },
  ]);
  await assert.rejects(
    () => runMigration({ collection, apply: true, environment: 'development', databaseName: 'wecooked-dev', logger: { log() {} } }),
    /preflight blocked before writes/,
  );
  assert.equal(collection.attempts, 0);
  assert.equal(collection.docs[0].region, 'tondo');
});

test('a frozen legacy value in the wrong environment or above its frozen maximum blocks before writes', async () => {
  for (const docs of [
    [{ _id: 1, region: 'bicol' }],
    [{ _id: 1, region: 'tondo' }, { _id: 2, region: 'tondo' }],
  ]) {
    const collection = fakeCollection(docs);
    await assert.rejects(
      () => runMigration({ collection, apply: true, environment: 'development', databaseName: 'wecooked-dev', logger: { log() {} } }),
      /preflight blocked before writes: unexpected region/,
    );
    assert.equal(collection.attempts, 0);
  }
});

test('summaries distinguish missing, canonical, legacy, and unsupported metadata', () => {
  const summary = summarize([
    ...productionLegacy(),
    { _id: 6, region: 'central-luzon', category: 'dinner' },
    { _id: 7 },
    { _id: 8, region: 'cebu', category: 'dessert' },
  ]);
  assert.equal(summary.regionLegacy, 2);
  assert.equal(summary.categoryLegacy, 2);
  assert.equal(summary.regionUnsupported, 1);
  assert.equal(summary.categoryUnsupported, 1);
  assert.equal(summary.missingRegion, 1);
});
