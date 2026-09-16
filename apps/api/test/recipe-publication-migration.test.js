const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseArgs,
  assessLegacyRecipe,
  runMigration,
} = require('../scripts/migrate-recipe-publication-state');

const INGREDIENT_ID = '507f1f77bcf86cd799439011';

function legacy(id, overrides = {}) {
  return {
    _id: id,
    title: 'Chicken Adobo',
    description: 'A complete legacy Filipino recipe.',
    difficulty: 'easy',
    prepTimeMinutes: 10,
    cookTimeMinutes: 30,
    servings: 4,
    ingredients: [{ ingredientId: INGREDIENT_ID, quantity: 1, unit: 'kg', optional: false }],
    instructions: ['Cook until tender.'],
    dietaryTags: [],
    imageUrl: null,
    isActive: true,
    createdAt: new Date('2025-01-02T03:04:05.000Z'),
    ...overrides,
  };
}

function fakeCollection(initialDocs) {
  const docs = initialDocs.map((doc) => ({ ...doc }));
  const writes = [];
  return {
    docs,
    writes,
    find() {
      return { toArray: async () => docs.filter((doc) => doc.publicationStatus === undefined) };
    },
    async updateOne(filter, update) {
      writes.push({ filter, update });
      const doc = docs.find((item) => String(item._id) === String(filter._id) && item.publicationStatus === undefined);
      if (!doc) return { modifiedCount: 0 };
      Object.assign(doc, update.$set);
      return { modifiedCount: 1 };
    },
  };
}

const quietLogger = { log() {} };

test('migration CLI defaults to dry-run and requires the explicit apply flag', () => {
  assert.deepEqual(parseArgs([]), { apply: false });
  assert.deepEqual(parseArgs(['--apply']), { apply: true });
  assert.throws(() => parseArgs(['--force']), /Usage/);
});

test('legacy completeness assessment reports malformed records without fabricating data', () => {
  assert.equal(assessLegacyRecipe(legacy('valid')).valid, true);
  const malformed = assessLegacyRecipe(legacy('bad', { description: undefined, createdAt: 'not-a-date' }));
  assert.equal(malformed.valid, false);
  assert.ok(malformed.issues.some((issue) => issue.field === 'description'));
  assert.ok(malformed.issues.some((issue) => issue.field === 'createdAt'));
});

test('dry-run reports valid active/inactive and malformed legacy records without writes', async () => {
  const collection = fakeCollection([
    legacy('active'),
    legacy('inactive', { isActive: false }),
    legacy('malformed', { instructions: [] }),
  ]);
  const report = await runMigration({ collection, logger: quietLogger });
  assert.equal(report.applied, false);
  assert.equal(report.scanned, 3);
  assert.equal(report.valid, 2);
  assert.equal(report.malformed.length, 1);
  assert.equal(collection.writes.length, 0);
});

test('apply classifies valid legacy records as Published, preserves isActive, uses createdAt fallback, leaves actors null, and is idempotent', async () => {
  const active = legacy('active');
  const inactive = legacy('inactive', { isActive: false });
  const malformed = legacy('malformed', { ingredients: [] });
  const collection = fakeCollection([active, inactive, malformed]);

  const first = await runMigration({ collection, apply: true, logger: quietLogger });
  assert.equal(first.modified, 2);
  assert.equal(collection.docs[0].publicationStatus, 'published');
  assert.equal(collection.docs[1].publicationStatus, 'published');
  assert.equal(collection.docs[1].isActive, false);
  assert.equal(collection.docs[0].publishedAt, active.createdAt);
  assert.equal(collection.docs[0].createdBy, null);
  assert.equal(collection.docs[0].updatedBy, null);
  assert.equal(collection.docs[0].publishedBy, null);

  const second = await runMigration({ collection, apply: true, logger: quietLogger });
  assert.equal(second.modified, 0);
  assert.equal(second.scanned, 1);
  assert.equal(second.malformed.length, 1);
});
