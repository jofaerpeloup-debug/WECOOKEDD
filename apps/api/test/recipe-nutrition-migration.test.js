const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseArgs, parseArtifact, runMigration,
} = require('../scripts/migrate-recipe-nutrition-v1');

const IDS = Array.from({ length: 8 }, (_, index) => `507f1f77bcf86cd7994390${index + 10}`);
const ACTOR_ID = '507f1f77bcf86cd799439001';
const UPDATED_AT = new Date('2026-10-05T00:00:00.000Z');
const APPLY_AT = new Date('2026-10-06T00:00:00.000Z');

function nutrition(overrides = {}) {
  return {
    schemaVersion: 1, basis: 'perServing', caloriesKcal: 320, proteinGrams: 28,
    carbohydrateGrams: 12, fatGrams: 18, sugarGrams: 3, fiberGrams: 2,
    ...overrides,
  };
}

function source(overrides = {}) {
  return { kind: 'manual', label: 'Reviewed laboratory panel', ...overrides };
}

function record(recipeId, overrides = {}) {
  return {
    recipeId,
    expectedUpdatedAt: UPDATED_AT.toISOString(),
    nutrition: nutrition(),
    source: source(),
    ...overrides,
  };
}

function artifact(records) {
  return { schemaVersion: 1, records };
}

function same(left, right) {
  if (left instanceof Date || right instanceof Date) return new Date(left).getTime() === new Date(right).getTime();
  return String(left) === String(right);
}

function matches(doc, filter) {
  return doc && Object.entries(filter).every(([key, value]) => same(doc[key], value));
}

function fakeCollection(seed, { onUpdate } = {}) {
  const docs = seed.map((doc) => ({ ...doc }));
  let attempts = 0;
  const collection = {
    docs,
    get attempts() { return attempts; },
    async findOne(filter) {
      const doc = docs.find((item) => matches(item, filter));
      return doc ? { ...doc } : null;
    },
    async defaultUpdate(filter, update) {
      const doc = docs.find((item) => matches(item, filter));
      if (!doc) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
      Object.assign(doc, update.$set || {});
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

test('CLI is dry-run by default and requires one approved artifact path', () => {
  assert.deepEqual(parseArgs(['--artifact=approved.json']), { artifactPath: 'approved.json', apply: false });
  assert.deepEqual(parseArgs(['--artifact=approved.json', '--apply']), { artifactPath: 'approved.json', apply: true });
  assert.throws(() => parseArgs([]));
  assert.throws(() => parseArgs(['--apply']));
  assert.throws(() => parseArgs(['--artifact=a.json', '--artifact=b.json']));
  assert.throws(() => parseArgs(['--artifact=a.json', '--title-match']));
});

test('artifact validation permits only canonical Recipe ids and strict complete nutrition records', () => {
  const parsed = parseArtifact(artifact([
    record(IDS[0]),
    record(IDS[1], { title: 'Never an identity' }),
    record('ABC'),
    record(IDS[2], { nutrition: { ...nutrition(), fiberGrams: undefined } }),
    record(IDS[0]),
  ]));
  assert.equal(parsed.total, 5);
  assert.equal(parsed.valid.length, 1);
  assert.equal(parsed.invalid, 4);
  assert.equal(parsed.valid[0].recipeId, IDS[0]);
});

test('dry-run reports every disposition and performs zero writes', async () => {
  const target = nutrition();
  const collection = fakeCollection([
    { _id: IDS[0], updatedAt: UPDATED_AT, title: 'Missing nutrition' },
    { _id: IDS[1], updatedAt: UPDATED_AT, nutrition: null },
    { _id: IDS[2], updatedAt: UPDATED_AT, nutrition: target, nutritionProvenance: {
      sourceKind: 'manual', sourceLabel: 'Reviewed laboratory panel', acceptedBy: ACTOR_ID, acceptedAt: UPDATED_AT,
    } },
    { _id: IDS[3], updatedAt: UPDATED_AT, nutrition: { schemaVersion: 1, caloriesKcal: 1 } },
    { _id: IDS[4], updatedAt: new Date('2026-10-05T01:00:00.000Z') },
  ]);
  const report = await runMigration({
    collection,
    artifact: artifact([
      record(IDS[0]), record(IDS[1]), record(IDS[2]), record(IDS[3]), record(IDS[4]), record(IDS[5]),
      { ...record(IDS[6]), title: 'Forbidden fallback' },
    ]),
    logger: { log() {} },
  });
  assert.deepEqual(report, {
    mode: 'dry-run', artifactRecords: 7, matched: 5, eligible: 3, unchanged: 1,
    invalid: 1, missing: 1, stale: 1, conflicts: 0, malformedExisting: 1,
    wouldChange: 3, changed: 0,
  });
  assert.equal(collection.attempts, 0);
});

test('apply fails closed before writes when artifact, missing-id, or stale blockers exist', async () => {
  const collection = fakeCollection([{ _id: IDS[0], updatedAt: new Date('2026-10-05T01:00:00.000Z') }]);
  await assert.rejects(() => runMigration({
    collection,
    artifact: artifact([record(IDS[0]), record(IDS[1]), record('invalid')]),
    apply: true,
    actorId: ACTOR_ID,
    logger: { log() {} },
  }), /blocked before writes/);
  assert.equal(collection.attempts, 0);
});

test('apply matches only canonical id plus updatedAt, preserves unrelated fields, derives provenance, and is idempotent', async () => {
  const filters = [];
  const collection = fakeCollection([{ _id: IDS[0], updatedAt: UPDATED_AT, title: 'Chicken Adobo', unrelated: { keep: true } }], {
    onUpdate: async ({ collection: current, filter, update }) => {
      filters.push(filter);
      return current.defaultUpdate(filter, update);
    },
  });
  const approved = artifact([record(IDS[0], { source: source({ url: 'https://example.com/panel' }) })]);
  const report = await runMigration({
    collection, artifact: approved, apply: true, actorId: ACTOR_ID, now: APPLY_AT, logger: { log() {} },
  });
  assert.equal(report.changed, 1);
  assert.equal(report.conflicts, 0);
  assert.equal(filters.length, 1);
  assert.deepEqual(Object.keys(filters[0]).sort(), ['_id', 'updatedAt']);
  assert.equal(collection.docs[0].title, 'Chicken Adobo');
  assert.deepEqual(collection.docs[0].unrelated, { keep: true });
  assert.deepEqual(collection.docs[0].nutrition, nutrition());
  assert.equal(String(collection.docs[0].nutritionProvenance.acceptedBy), ACTOR_ID);
  assert.equal(collection.docs[0].nutritionProvenance.acceptedAt, APPLY_AT);

  const rerun = await runMigration({
    collection, artifact: approved, apply: true, actorId: ACTOR_ID, now: APPLY_AT, logger: { log() {} },
  });
  assert.equal(rerun.unchanged, 1);
  assert.equal(rerun.changed, 0);
  assert.equal(collection.attempts, 1);
  assert.deepEqual(Object.keys(collection.docs[0].nutritionProvenance).sort(), [
    'acceptedAt', 'acceptedBy', 'sourceKind', 'sourceLabel', 'sourceUrl',
  ]);
});

test('unexpected keys and invalid present optional provenance fields are repaired, never unchanged', async () => {
  const target = nutrition();
  const validBase = {
    sourceKind: 'manual', sourceLabel: 'Reviewed laboratory panel',
    acceptedBy: ACTOR_ID, acceptedAt: UPDATED_AT,
  };
  const collection = fakeCollection([
    { _id: IDS[0], updatedAt: UPDATED_AT, nutrition: target, nutritionProvenance: {
      ...validBase, staffEmail: 'must-not-survive@example.com',
    } },
    { _id: IDS[1], updatedAt: UPDATED_AT, nutrition: target, nutritionProvenance: {
      ...validBase, sourceUrl: '',
    } },
    { _id: IDS[2], updatedAt: UPDATED_AT, nutrition: target, nutritionProvenance: {
      ...validBase, sourceUrl: false,
    } },
  ]);
  const approved = artifact([record(IDS[0]), record(IDS[1]), record(IDS[2])]);

  const dryRun = await runMigration({ collection, artifact: approved, logger: { log() {} } });
  assert.equal(dryRun.unchanged, 0);
  assert.equal(dryRun.malformedExisting, 3);
  assert.equal(dryRun.wouldChange, 3);

  const applied = await runMigration({
    collection, artifact: approved, apply: true, actorId: ACTOR_ID, now: APPLY_AT,
    logger: { log() {} },
  });
  assert.equal(applied.changed, 3);
  for (const doc of collection.docs) {
    assert.deepEqual(Object.keys(doc.nutritionProvenance).sort(), [
      'acceptedAt', 'acceptedBy', 'sourceKind', 'sourceLabel',
    ]);
    assert.equal(Object.hasOwn(doc.nutritionProvenance, 'sourceUrl'), false);
  }
});

test('matching nutrition with incomplete actor or timestamp provenance is repaired, never reported unchanged', async () => {
  const target = nutrition();
  const collection = fakeCollection([
    { _id: IDS[0], updatedAt: UPDATED_AT, nutrition: target, nutritionProvenance: {
      sourceKind: 'manual', sourceLabel: 'Reviewed laboratory panel', acceptedAt: UPDATED_AT,
    } },
    { _id: IDS[1], updatedAt: UPDATED_AT, nutrition: target, nutritionProvenance: {
      sourceKind: 'manual', sourceLabel: 'Reviewed laboratory panel', acceptedBy: ACTOR_ID,
    } },
  ]);
  const approved = artifact([record(IDS[0]), record(IDS[1])]);

  const dryRun = await runMigration({ collection, artifact: approved, logger: { log() {} } });
  assert.equal(dryRun.unchanged, 0);
  assert.equal(dryRun.malformedExisting, 2);
  assert.equal(dryRun.eligible, 2);
  assert.equal(dryRun.wouldChange, 2);
  assert.equal(collection.attempts, 0);

  const applied = await runMigration({
    collection, artifact: approved, apply: true, actorId: ACTOR_ID, now: APPLY_AT, logger: { log() {} },
  });
  assert.equal(applied.changed, 2);
  for (const doc of collection.docs) {
    assert.equal(String(doc.nutritionProvenance.acceptedBy), ACTOR_ID);
    assert.equal(doc.nutritionProvenance.acceptedAt, APPLY_AT);
  }
});

test('apply final postcondition rejects every malformed resulting provenance shape', async () => {
  const corruptions = [
    (provenance) => { delete provenance.acceptedAt; },
    (provenance) => { provenance.staffEmail = 'unexpected@example.com'; },
    (provenance) => { provenance.sourceUrl = ''; },
  ];
  for (const [index, corrupt] of corruptions.entries()) {
    const collection = fakeCollection([{ _id: IDS[index], updatedAt: UPDATED_AT }], {
      onUpdate: async ({ collection: current, docs, filter, update }) => {
        const result = await current.defaultUpdate(filter, update);
        corrupt(docs[0].nutritionProvenance);
        return result;
      },
    });

    await assert.rejects(() => runMigration({
      collection, artifact: artifact([record(IDS[index])]), apply: true,
      actorId: ACTOR_ID, now: APPLY_AT, logger: { log() {} },
    }), /final postcondition failed/);
  }
});

test('a concurrent non-target change fails instead of matching by title or overwriting', async () => {
  const collection = fakeCollection([{ _id: IDS[0], updatedAt: UPDATED_AT, title: 'Shared title' }], {
    onUpdate: async ({ docs }) => {
      docs[0].updatedAt = new Date('2026-10-06T01:00:00.000Z');
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
    },
  });
  await assert.rejects(() => runMigration({
    collection, artifact: artifact([record(IDS[0])]), apply: true, actorId: ACTOR_ID,
    logger: { log() {} },
  }), /Concurrent Recipe change/);
  assert.equal(collection.docs[0].nutrition, undefined);
});
