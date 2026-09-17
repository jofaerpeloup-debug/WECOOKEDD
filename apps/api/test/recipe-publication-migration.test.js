const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MIGRATION_CONNECTION_OPTIONS,
  MigrationBlockedError,
  MigrationConflictError,
  MigrationWriteError,
  parseArgs,
  assessLegacyRecipe,
  migrationFilter,
  migrationUpdate,
  runMigration,
  runMigrationCommand,
  formatMigrationFailure,
} = require('../scripts/migrate-recipe-publication-state');

const INGREDIENT_ID = '507f1f77bcf86cd799439011';
const OTHER_INGREDIENT_ID = '507f191e810c19729de860ea';
const USER_ID = '507f1f77bcf86cd799439012';

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
    updatedAt: new Date('2025-01-03T03:04:05.000Z'),
    ...overrides,
  };
}

function ingredient(id = INGREDIENT_ID, isActive = true) {
  return { _id: id, isActive };
}

function sameValue(left, right) {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  return String(left) === String(right);
}

function matchesFilter(doc, filter) {
  if (!sameValue(doc._id, filter._id)) return false;
  if (filter.publicationStatus?.$exists === false && Object.hasOwn(doc, 'publicationStatus')) return false;
  if (filter.$and) {
    return filter.$and.every((condition) => {
      if (condition.updatedAt?.$exists === true) return Object.hasOwn(doc, 'updatedAt');
      if (condition.updatedAt === null) return doc.updatedAt === null || !Object.hasOwn(doc, 'updatedAt');
      return true;
    });
  }
  if (filter.updatedAt?.$exists === false) return !Object.hasOwn(doc, 'updatedAt');
  if (Object.hasOwn(filter, 'updatedAt')) return sameValue(doc.updatedAt, filter.updatedAt);
  return true;
}

function fakeCollections(initialRecipes, initialIngredients = [ingredient()]) {
  const docs = initialRecipes.map((doc) => ({ ...doc }));
  const ingredients = initialIngredients.map((doc) => ({ ...doc }));
  const writes = [];
  const recipeCollection = {
    docs,
    writes,
    find(filter) {
      assert.deepEqual(filter, {});
      return { toArray: async () => docs };
    },
    async updateOne(filter, update) {
      writes.push({ filter, update });
      const doc = docs.find((item) => matchesFilter(item, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(doc, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
  const ingredientCollection = {
    find(filter) {
      const wanted = new Set(filter._id.$in.map(String));
      return { toArray: async () => ingredients.filter((item) => wanted.has(String(item._id))) };
    },
  };
  return { recipeCollection, ingredientCollection };
}

function captureLogger() {
  const lines = [];
  return { lines, log(message) { lines.push(message); } };
}

const quietLogger = { log() {} };

test('migration CLI defaults to dry-run and requires the explicit apply flag', () => {
  assert.deepEqual(parseArgs([]), { apply: false });
  assert.deepEqual(parseArgs(['--apply']), { apply: true });
  assert.throws(() => parseArgs(['--force']), /Usage/);
});

test('migration connection options explicitly disable autoIndex and autoCreate', async () => {
  assert.deepEqual(MIGRATION_CONNECTION_OPTIONS, { autoIndex: false, autoCreate: false });
  const calls = [];
  const collections = fakeCollections([]);
  const report = await runMigrationCommand({
    argv: [],
    loadEnvironment: () => ({ mongodbUri: 'mongodb://example.invalid/unit-test' }),
    connect: async (uri, options) => {
      calls.push({ type: 'connect', uri, options });
      return { connection: { name: 'unit-test-db' } };
    },
    disconnect: async () => calls.push({ type: 'disconnect' }),
    getCollections: () => collections,
    logger: quietLogger,
  });
  assert.deepEqual(calls[0], {
    type: 'connect',
    uri: 'mongodb://example.invalid/unit-test',
    options: { autoIndex: false, autoCreate: false },
  });
  assert.equal(calls[1].type, 'disconnect');
  assert.equal(report.databaseName, 'unit-test-db');
});

test('malformed ingredient containers and entries become structured blockers without throwing', () => {
  const badContainer = assessLegacyRecipe(legacy('container', { ingredients: { nope: true } }));
  const nullEntry = assessLegacyRecipe(legacy('null', { ingredients: [null] }));
  const badEntry = assessLegacyRecipe(legacy('entry', { ingredients: ['bad'] }));
  for (const result of [badContainer, nullEntry, badEntry]) {
    assert.equal(result.valid, false);
    assert.ok(result.blockers.some((item) => item.code === 'STRUCTURE_INVALID'));
  }
});

test('malformed instructions and createdAt are separately reported without crashing', () => {
  const result = assessLegacyRecipe(legacy('bad', { instructions: { text: 'no' }, createdAt: 'not-a-date' }));
  assert.equal(result.valid, false);
  assert.ok(result.blockers.some((item) => item.code === 'STRUCTURE_INVALID'));
  assert.ok(result.blockers.some((item) => item.code === 'CREATED_AT_INVALID'));
});

test('dry-run scans all lifecycle states, reports counts, and makes zero writes', async () => {
  const collections = fakeCollections([
    legacy('active'),
    legacy('archived', { isActive: false }),
    { ...legacy('draft'), publicationStatus: 'draft' },
    { ...legacy('published'), publicationStatus: 'published' },
  ]);
  const report = await runMigration({ ...collections, databaseName: 'recipes-test', logger: quietLogger });
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.totalRecipeCount, 4);
  assert.equal(report.legacyMissingStatusCount, 2);
  assert.equal(report.legacyActiveCount, 1);
  assert.equal(report.legacyArchivedCount, 1);
  assert.equal(report.explicitDraftCount, 1);
  assert.equal(report.explicitPublishedCount, 1);
  assert.equal(report.eligibleCount, 2);
  assert.equal(report.wouldModifyCount, 2);
  assert.equal(report.modifiedCount, 0);
  assert.equal(collections.recipeCollection.writes.length, 0);
});

test('complete preflight assesses later records before the first apply write', async () => {
  let laterRecordAssessed = false;
  const first = legacy('first');
  const later = legacy('later');
  Object.defineProperty(later, 'ingredients', {
    enumerable: true,
    get() {
      laterRecordAssessed = true;
      return [{ ingredientId: INGREDIENT_ID, quantity: 1, unit: 'kg', optional: false }];
    },
  });
  const collections = fakeCollections([]);
  collections.recipeCollection.find = () => ({ toArray: async () => [first, later] });
  collections.recipeCollection.updateOne = async (filter, update) => {
    assert.equal(laterRecordAssessed, true);
    collections.recipeCollection.writes.push({ filter, update });
    return { matchedCount: 1, modifiedCount: 1 };
  };
  const report = await runMigration({ ...collections, apply: true, logger: quietLogger });
  assert.equal(report.modifiedCount, 2);
});

test('one blocker aborts apply before any write and output clearly says zero writes', async () => {
  const collections = fakeCollections([legacy('good'), legacy('blocked', { ingredients: [null] })]);
  const logger = captureLogger();
  await assert.rejects(
    runMigration({ ...collections, apply: true, logger }),
    (error) => error instanceof MigrationBlockedError && error.code === 'MIGRATION_PREFLIGHT_BLOCKED'
  );
  assert.equal(collections.recipeCollection.writes.length, 0);
  assert.ok(logger.lines.some((line) => line.includes('zero recipe writes performed')));
});

test('active required missing ingredient blocks', async () => {
  const collections = fakeCollections([legacy('missing')], []);
  const report = await runMigration({ ...collections, logger: quietLogger });
  assert.equal(report.blockedCount, 1);
  assert.ok(report.blockers[0].reasons.includes('REQUIRED_INGREDIENT_MISSING'));
});

test('active required inactive ingredient blocks', async () => {
  const collections = fakeCollections([legacy('inactive-ref')], [ingredient(INGREDIENT_ID, false)]);
  const report = await runMigration({ ...collections, logger: quietLogger });
  assert.equal(report.blockedCount, 1);
  assert.ok(report.blockers[0].reasons.includes('REQUIRED_INGREDIENT_INACTIVE'));
});

test('active optional unavailable ingredient warns without blocking', async () => {
  const collections = fakeCollections([
    legacy('optional', {
      ingredients: [
        { ingredientId: INGREDIENT_ID, quantity: 1, unit: 'kg', optional: false },
        { ingredientId: OTHER_INGREDIENT_ID, unit: 'toTaste', optional: true },
      ],
    }),
  ]);
  const report = await runMigration({ ...collections, logger: quietLogger });
  assert.equal(report.blockedCount, 0);
  assert.equal(report.eligibleCount, 1);
  assert.ok(report.warnings[0].reasons.includes('OPTIONAL_INGREDIENT_UNAVAILABLE'));
});

test('archived unavailable ingredients are anomalies but not blockers solely for availability', async () => {
  const collections = fakeCollections([legacy('archived', { isActive: false })], []);
  const report = await runMigration({ ...collections, logger: quietLogger });
  assert.equal(report.blockedCount, 0);
  assert.equal(report.eligibleCount, 1);
  assert.ok(report.warnings[0].reasons.includes('ARCHIVED_INGREDIENT_UNAVAILABLE'));
});

test('existing valid attribution is reported, preserved, and missing attribution is set null', async () => {
  const doc = legacy('actors', { createdBy: USER_ID, updatedBy: null });
  const assessment = assessLegacyRecipe(doc);
  assert.ok(assessment.warnings.some((item) => item.code === 'EXISTING_ATTRIBUTION'));
  assert.deepEqual(migrationUpdate(doc).$set, {
    publicationStatus: 'published',
    publishedAt: doc.createdAt,
    updatedBy: null,
    publishedBy: null,
  });
  const collections = fakeCollections([doc]);
  await runMigration({ ...collections, apply: true, logger: quietLogger });
  assert.equal(collections.recipeCollection.docs[0].createdBy, USER_ID);
});

test('malformed non-null attribution blocks instead of being erased', async () => {
  const collections = fakeCollections([legacy('bad-actor', { publishedBy: 'not-an-object-id' })]);
  const report = await runMigration({ ...collections, logger: quietLogger });
  assert.ok(report.blockers[0].reasons.includes('ATTRIBUTION_INVALID'));
});

test('missing publishedAt derives from createdAt and equivalent existing publishedAt remains eligible and preserved', async () => {
  const missing = legacy('missing-at');
  assert.equal(migrationUpdate(missing).$set.publishedAt, missing.createdAt);
  const equivalent = legacy('equivalent', { publishedAt: new Date('2025-01-02T03:04:05.000Z') });
  const assessment = assessLegacyRecipe(equivalent);
  assert.equal(assessment.valid, true);
  assert.ok(assessment.warnings.some((item) => item.code === 'EXISTING_PUBLISHED_AT_EQUIVALENT'));
  assert.equal(Object.hasOwn(migrationUpdate(equivalent).$set, 'publishedAt'), false);
  const report = await runMigration({ ...fakeCollections([equivalent]), logger: quietLogger });
  assert.equal(report.eligibleCount, 1);
  assert.equal(report.blockedCount, 0);
});

test('invalid existing publishedAt type or value blocks with PUBLISHED_AT_INVALID', async () => {
  for (const publishedAt of ['not-a-date', new Date('not-a-date')]) {
    const collections = fakeCollections([legacy('invalid-published-at', { publishedAt })]);
    const report = await runMigration({ ...collections, logger: quietLogger });
    assert.ok(report.blockers[0].reasons.includes('PUBLISHED_AT_INVALID'));
    assert.equal(report.blockers[0].reasons.includes('PUBLISHED_AT_CONFLICT'), false);
  }
});

test('conflicting existing publishedAt blocks migration', async () => {
  const collections = fakeCollections([
    legacy('conflict', { publishedAt: new Date('2025-02-02T03:04:05.000Z') }),
  ]);
  const report = await runMigration({ ...collections, logger: quietLogger });
  assert.ok(report.blockers[0].reasons.includes('PUBLISHED_AT_CONFLICT'));
  assert.equal(report.blockers[0].reasons.includes('PUBLISHED_AT_INVALID'), false);
});

test('invalid explicit publicationStatus is a rollout blocker and explicit states remain untouched', async () => {
  const draft = { ...legacy('draft'), publicationStatus: 'draft' };
  const published = { ...legacy('published'), publicationStatus: 'published' };
  const invalid = { ...legacy('invalid'), publicationStatus: 'retired' };
  const collections = fakeCollections([draft, published, invalid]);
  const report = await runMigration({ ...collections, logger: quietLogger });
  assert.equal(report.invalidExplicitStatusCount, 1);
  assert.equal(report.blockedCount, 1);
  assert.ok(report.blockers[0].reasons.includes('INVALID_EXPLICIT_PUBLICATION_STATUS'));
  assert.equal(report.wouldModifyCount, 0);
  assert.equal(collections.recipeCollection.writes.length, 0);
});

test('conditional filter guards missing publicationStatus and exact assessed updatedAt', () => {
  const updatedAt = new Date('2025-01-03T03:04:05.000Z');
  assert.deepEqual(migrationFilter(legacy('guarded', { updatedAt })), {
    _id: 'guarded',
    publicationStatus: { $exists: false },
    updatedAt,
  });
  const noTimestamp = legacy('no-timestamp');
  delete noTimestamp.updatedAt;
  assert.deepEqual(migrationFilter(noTimestamp), {
    _id: 'no-timestamp',
    publicationStatus: { $exists: false },
    updatedAt: { $exists: false },
  });
});

test('stale updatedAt precondition stops apply and reports conflict', async () => {
  const collections = fakeCollections([legacy('stale')]);
  collections.recipeCollection.updateOne = async (filter, update) => {
    collections.recipeCollection.writes.push({ filter, update });
    return { matchedCount: 0, modifiedCount: 0 };
  };
  await assert.rejects(
    runMigration({ ...collections, apply: true, logger: quietLogger }),
    (error) => error instanceof MigrationConflictError && error.code === 'MIGRATION_STALE_SNAPSHOT'
  );
  assert.equal(collections.recipeCollection.docs[0].publicationStatus, undefined);
});

test('sequential apply failure stops immediately and reports partial completion', async () => {
  const collections = fakeCollections([legacy('first'), legacy('second'), legacy('third')]);
  let callCount = 0;
  collections.recipeCollection.updateOne = async (filter, update) => {
    callCount += 1;
    collections.recipeCollection.writes.push({ filter, update });
    if (callCount === 2) return { matchedCount: 0, modifiedCount: 0 };
    return { matchedCount: 1, modifiedCount: 1 };
  };
  await assert.rejects(
    runMigration({ ...collections, apply: true, logger: quietLogger }),
    (error) => {
      assert.ok(error instanceof MigrationConflictError);
      assert.equal(error.report.modifiedCount, 1);
      assert.equal(error.report.partialApply, true);
      assert.equal(error.report.conflictRecipeId, 'second');
      return true;
    }
  );
  assert.equal(collections.recipeCollection.writes.length, 2);
});

test('driver exception after one write reports partial progress, stops, and reruns idempotently', async () => {
  const collections = fakeCollections([legacy('first'), legacy('second'), legacy('third')]);
  const originalUpdate = collections.recipeCollection.updateOne;
  const driverError = new Error('simulated driver failure');
  const attempts = [];
  collections.recipeCollection.updateOne = async (filter, update) => {
    attempts.push(String(filter._id));
    if (filter._id === 'second') throw driverError;
    return originalUpdate(filter, update);
  };

  await assert.rejects(
    runMigration({ ...collections, apply: true, logger: quietLogger }),
    (error) => {
      assert.ok(error instanceof MigrationWriteError);
      assert.equal(error.code, 'MIGRATION_WRITE_FAILED');
      assert.equal(error.cause, driverError);
      assert.equal(error.report.modifiedCount, 1);
      assert.equal(error.report.partialApply, true);
      assert.equal(error.report.failureRecipeId, 'second');
      assert.equal(error.recipeId, 'second');
      assert.match(
        formatMigrationFailure(error),
        /failed code=MIGRATION_WRITE_FAILED modified=1 partialApply=true recipeId=second/
      );
      return true;
    }
  );

  assert.deepEqual(attempts, ['first', 'second']);
  assert.equal(collections.recipeCollection.docs[0].publicationStatus, 'published');
  assert.equal(collections.recipeCollection.docs[1].publicationStatus, undefined);
  assert.equal(collections.recipeCollection.docs[2].publicationStatus, undefined);

  collections.recipeCollection.updateOne = originalUpdate;
  const rerun = await runMigration({ ...collections, apply: true, logger: quietLogger });
  assert.equal(rerun.modifiedCount, 2);
  assert.ok(collections.recipeCollection.docs.every((doc) => doc.publicationStatus === 'published'));
});

test('driver exception on first write reports zero progress and no partial apply', async () => {
  const collections = fakeCollections([legacy('first'), legacy('second')]);
  const attempts = [];
  collections.recipeCollection.updateOne = async (filter) => {
    attempts.push(String(filter._id));
    throw new Error('simulated first-write failure');
  };

  await assert.rejects(
    runMigration({ ...collections, apply: true, logger: quietLogger }),
    (error) => {
      assert.ok(error instanceof MigrationWriteError);
      assert.equal(error.code, 'MIGRATION_WRITE_FAILED');
      assert.equal(error.report.modifiedCount, 0);
      assert.equal(error.report.partialApply, false);
      assert.equal(error.report.failureRecipeId, 'first');
      assert.match(
        formatMigrationFailure(error),
        /failed code=MIGRATION_WRITE_FAILED modified=0 partialApply=false recipeId=first/
      );
      return true;
    }
  );
  assert.deepEqual(attempts, ['first']);
});

test('successful apply changes only lifecycle backfill fields, preserves isActive and timestamps, and is idempotent', async () => {
  const source = legacy('apply', { isActive: false, createdBy: USER_ID });
  const collections = fakeCollections([source]);
  const first = await runMigration({ ...collections, apply: true, logger: quietLogger });
  assert.equal(first.modifiedCount, 1);
  assert.deepEqual(collections.recipeCollection.writes[0].update.$set, {
    publicationStatus: 'published',
    publishedAt: source.createdAt,
    updatedBy: null,
    publishedBy: null,
  });
  const migrated = collections.recipeCollection.docs[0];
  assert.equal(migrated.isActive, false);
  assert.equal(migrated.createdBy, USER_ID);
  assert.equal(migrated.createdAt, source.createdAt);
  assert.equal(migrated.updatedAt, source.updatedAt);

  const second = await runMigration({ ...collections, apply: true, logger: quietLogger });
  assert.equal(second.eligibleCount, 0);
  assert.equal(second.wouldModifyCount, 0);
  assert.equal(second.modifiedCount, 0);
  assert.equal(collections.recipeCollection.writes.length, 1);
});

test('blocked dry-run output includes usable reason codes and record identity', async () => {
  const collections = fakeCollections([legacy('broken-record', { ingredients: [null], createdAt: 'bad' })]);
  const logger = captureLogger();
  await runMigration({ ...collections, logger });
  const output = logger.lines.join('\n');
  assert.match(output, /BLOCKED id=broken-record lifecycle=active/);
  assert.match(output, /STRUCTURE_INVALID/);
  assert.match(output, /CREATED_AT_INVALID/);
});
