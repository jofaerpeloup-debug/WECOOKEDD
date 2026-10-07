const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
  COLLECTION_NAME,
  MIGRATION_CONNECTION_OPTIONS,
  APPROVED_DATABASES,
  MISSING_VERSION_FILTER,
  VERSION_ZERO_UPDATE,
  parseArgs,
  isValidVersionValue,
  classifyDocument,
  summarizeDocuments,
  runMigration,
  runMigrationCommand,
} = require('../scripts/migrate-shopping-list-versions');
const apiPackage = require('../package.json');

const silentLogger = { log() {} };
const TEST_DATABASE = 'wecooked-shop4-mig1-test';

function fakeCollection(seed, { onUpdate } = {}) {
  const docs = seed.map((document) => ({ ...document }));
  const calls = { finds: [], updates: [] };

  const collection = {
    docs,
    calls,
    find(filter, options) {
      calls.finds.push({ filter, options });
      return {
        async toArray() {
          return docs.map((document) => {
            const projected = { _id: document._id };
            if (Object.prototype.hasOwnProperty.call(document, '__v')) projected.__v = document.__v;
            return projected;
          });
        },
      };
    },
    async defaultUpdate(filter, update) {
      let matchedCount = 0;
      let modifiedCount = 0;
      for (const document of docs) {
        if (filter.__v?.$exists === false && !Object.prototype.hasOwnProperty.call(document, '__v')) {
          matchedCount += 1;
          document.__v = update.$set.__v;
          modifiedCount += 1;
        }
      }
      return { acknowledged: true, matchedCount, modifiedCount };
    },
    async updateMany(filter, update, options) {
      calls.updates.push({ filter, update, options });
      if (onUpdate) {
        return onUpdate({
          collection,
          docs,
          filter,
          update,
          options,
          attempt: calls.updates.length,
        });
      }
      return collection.defaultUpdate(filter, update);
    },
  };

  return collection;
}

function migrationOptions(collection, overrides = {}) {
  return {
    collection,
    environment: 'test',
    databaseName: TEST_DATABASE,
    logger: silentLogger,
    ...overrides,
  };
}

test('command is dry-run by default and requires one explicit exact environment', () => {
  assert.equal(
    apiPackage.scripts['migrate:shopping-list-versions'],
    'node scripts/migrate-shopping-list-versions.js'
  );
  assert.deepEqual(APPROVED_DATABASES, {
    development: 'wecooked-dev',
    test: 'wecooked-shop4-mig1-test',
    production: 'wecooked-production',
  });
  assert.deepEqual(parseArgs(['--environment=development']), {
    environment: 'development',
    apply: false,
  });
  assert.deepEqual(parseArgs(['--environment=test', '--apply']), {
    environment: 'test',
    apply: true,
  });
  assert.deepEqual(parseArgs(['--environment=production']), {
    environment: 'production',
    apply: false,
  });
  assert.throws(() => parseArgs([]), /Exactly one explicit/);
  assert.throws(() => parseArgs(['--apply']), /Exactly one explicit/);
  assert.throws(() => parseArgs(['--environment=staging']), /Usage/);
  assert.throws(() => parseArgs(['--environment=test', '--environment=production']), /Exactly one explicit/);
  assert.throws(() => parseArgs(['--environment=test', '--apply', '--apply']), /Usage/);
});

test('raw version classification accepts only exact non-negative safe integers across BSON numeric representations', () => {
  const { Int32, Long, Double, Decimal128 } = mongoose.mongo;
  const valid = [
    0,
    Number.MAX_SAFE_INTEGER,
    0n,
    BigInt(Number.MAX_SAFE_INTEGER),
    new Int32(7),
    Long.fromString('9007199254740991'),
    new Double(12),
    Decimal128.fromString('1.000'),
    Decimal128.fromString('9E+3'),
    Decimal128.fromString('-0'),
  ];
  for (const value of valid) {
    assert.equal(isValidVersionValue(value), true, `expected valid: ${value}`);
  }

  const invalid = [
    null,
    undefined,
    '0',
    false,
    {},
    [],
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -1,
    1.25,
    Number.MAX_SAFE_INTEGER + 1,
    -1n,
    BigInt(Number.MAX_SAFE_INTEGER) + 1n,
    new Int32(-1),
    Long.fromString('-1'),
    Long.fromString('9007199254740992'),
    new Double(1.5),
    new Double(Number.POSITIVE_INFINITY),
    Decimal128.fromString('-1'),
    Decimal128.fromString('0.1'),
    Decimal128.fromString('9007199254740992'),
    Decimal128.fromString('NaN'),
    Decimal128.fromString('Infinity'),
    new mongoose.mongo.Timestamp({ t: 1, i: 1 }),
  ];
  for (const value of invalid) {
    assert.equal(isValidVersionValue(value), false, `expected invalid: ${String(value)}`);
  }
});

test('presence-sensitive classification never treats an invalid present value as missing', () => {
  assert.equal(classifyDocument({ _id: 1 }), 'missing');
  assert.equal(classifyDocument({ _id: 2, __v: 0 }), 'valid');
  assert.equal(classifyDocument({ _id: 3, __v: null }), 'invalid');
  assert.equal(classifyDocument({ _id: 4, __v: undefined }), 'invalid');

  assert.deepEqual(summarizeDocuments([
    { _id: 1 },
    { _id: 2, __v: 0 },
    { _id: 3, __v: '0' },
  ]), {
    scanned: 3,
    missing: 1,
    valid: 1,
    invalid: 1,
    invalidDocuments: [{ id: 3, type: 'string' }],
  });
});

test('dry-run performs a complete raw scan and zero writes even when invalid values are reported', async () => {
  const collection = fakeCollection([
    { _id: 1 },
    { _id: 2, __v: 4 },
    { _id: 3, __v: '4' },
  ]);
  const report = await runMigration(migrationOptions(collection));

  assert.equal(report.mode, 'dry-run');
  assert.deepEqual(report.before, {
    scanned: 3,
    missing: 1,
    valid: 1,
    invalid: 1,
    invalidDocuments: [{ id: 3, type: 'string' }],
  });
  assert.equal(report.matched, 0);
  assert.equal(report.modified, 0);
  assert.equal(report.pending, 1);
  assert.equal(report.blocked, true);
  assert.equal(collection.calls.updates.length, 0);
  assert.deepEqual(collection.calls.finds[0], {
    filter: {},
    options: {
      projection: { _id: 1, __v: 1 },
      promoteValues: false,
      promoteLongs: false,
    },
  });
});

test('invalid present versions block apply after full preflight and before every write', async () => {
  const collection = fakeCollection([
    { _id: 1 },
    { _id: 2, __v: null },
    { _id: 3, __v: 8 },
  ]);

  await assert.rejects(
    () => runMigration(migrationOptions(collection, { apply: true })),
    (error) => {
      assert.match(error.message, /blocked before writes/);
      assert.equal(error.migrationReport.before.scanned, 3);
      assert.equal(error.migrationReport.before.invalid, 1);
      assert.equal(error.migrationReport.matched, 0);
      assert.equal(error.migrationReport.modified, 0);
      return true;
    }
  );
  assert.equal(collection.calls.updates.length, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(collection.docs[0], '__v'), false);
});

test('apply uses one raw updateMany with the frozen collection filter and update only', async () => {
  const collection = fakeCollection([
    { _id: 1, owner: 'a' },
    { _id: 2, owner: 'b' },
    { _id: 3, owner: 'c', __v: 6 },
  ]);
  const report = await runMigration(migrationOptions(collection, { apply: true }));

  assert.equal(collection.calls.updates.length, 1);
  assert.deepEqual(collection.calls.updates[0], {
    filter: { __v: { $exists: false } },
    update: { $set: { __v: 0 } },
    options: undefined,
  });
  assert.strictEqual(collection.calls.updates[0].filter, MISSING_VERSION_FILTER);
  assert.strictEqual(collection.calls.updates[0].update, VERSION_ZERO_UPDATE);
  assert.equal(report.matched, 2);
  assert.equal(report.modified, 2);
  assert.equal(report.applied, 2);
  assert.equal(report.pending, 0);
  assert.deepEqual(report.after, {
    scanned: 3,
    missing: 0,
    valid: 3,
    invalid: 0,
    invalidDocuments: [],
  });
});

test('migration preserves timestamps, items, owner, and every non-version field byte/value-equivalently', async () => {
  const createdAt = new Date('2026-01-02T03:04:05.678Z');
  const updatedAt = new Date('2026-02-03T04:05:06.789Z');
  const original = {
    _id: 'legacy',
    userId: '507f1f77bcf86cd799439001',
    owner: { id: 'owner', flags: [1, 2] },
    items: [{ _id: 'item', quantity: 2, unit: 'piece', isChecked: true }],
    createdAt,
    updatedAt,
    extra: Buffer.from([0, 1, 2, 255]),
  };
  const collection = fakeCollection([original]);

  await runMigration(migrationOptions(collection, { apply: true }));
  const { __v, ...preserved } = collection.docs[0];
  assert.equal(__v, 0);
  assert.deepEqual(preserved, original);
  assert.strictEqual(collection.docs[0].createdAt, createdAt);
  assert.strictEqual(collection.docs[0].updatedAt, updatedAt);
});

test('valid existing versions remain untouched while only missing versions become zero', async () => {
  const { Int32, Long, Double, Decimal128 } = mongoose.mongo;
  const versions = [
    3,
    new Int32(4),
    Long.fromString('5'),
    new Double(6),
    Decimal128.fromString('7.0'),
  ];
  const collection = fakeCollection([
    { _id: 'missing' },
    ...versions.map((__v, index) => ({ _id: `valid-${index}`, __v })),
  ]);

  await runMigration(migrationOptions(collection, { apply: true }));
  assert.equal(collection.docs[0].__v, 0);
  for (let index = 0; index < versions.length; index += 1) {
    assert.strictEqual(collection.docs[index + 1].__v, versions[index]);
  }
});

test('acknowledgement and exact result counts are enforced with a complete postcheck', async () => {
  for (const result of [
    { acknowledged: false, matchedCount: 1, modifiedCount: 1 },
    { acknowledged: true, matchedCount: 0, modifiedCount: 1 },
    { acknowledged: true, matchedCount: 1, modifiedCount: 0 },
  ]) {
    const collection = fakeCollection([{ _id: 1 }], {
      onUpdate: async ({ docs }) => {
        docs[0].__v = 0;
        return result;
      },
    });
    await assert.rejects(
      () => runMigration(migrationOptions(collection, { apply: true })),
      (error) => error.migrationReport.after.missing === 0
    );
  }

  const incomplete = fakeCollection([{ _id: 1 }, { _id: 2 }], {
    onUpdate: async ({ docs }) => {
      docs[0].__v = 0;
      return { acknowledged: true, matchedCount: 2, modifiedCount: 2 };
    },
  });
  await assert.rejects(
    () => runMigration(migrationOptions(incomplete, { apply: true })),
    (error) => {
      assert.match(error.message, /postcheck missing=1/);
      assert.equal(error.migrationReport.applied, 1);
      assert.equal(error.migrationReport.pending, 1);
      return true;
    }
  );

  const invalidAfter = fakeCollection([{ _id: 1 }], {
    onUpdate: async ({ docs }) => {
      docs[0].__v = 'invalid-after-apply';
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    },
  });
  await assert.rejects(
    () => runMigration(migrationOptions(invalidAfter, { apply: true })),
    (error) => {
      assert.match(error.message, /postcheck invalid=1/);
      assert.equal(error.migrationReport.after.missing, 0);
      assert.equal(error.migrationReport.after.invalid, 1);
      return true;
    }
  );
});

test('an unreadable postcheck retains acknowledged result counts in the failure report', async () => {
  const collection = fakeCollection([{ _id: 1 }]);
  const find = collection.find.bind(collection);
  collection.find = (...args) => {
    if (collection.calls.finds.length === 1) throw new Error('simulated postcheck read failure');
    return find(...args);
  };

  await assert.rejects(
    () => runMigration(migrationOptions(collection, { apply: true })),
    (error) => {
      assert.match(error.message, /postcheck read failure/);
      assert.equal(error.migrationReport.matched, 1);
      assert.equal(error.migrationReport.modified, 1);
      assert.equal(error.migrationReport.after, null);
      assert.equal(error.migrationReport.applied, null);
      assert.equal(error.migrationReport.pending, null);
      assert.equal(error.migrationReport.blocked, null);
      return true;
    }
  );
  assert.equal(collection.docs[0].__v, 0);
});

test('partial thrown apply reports established versions and rerun safely handles only the remainder', async () => {
  const collection = fakeCollection([{ _id: 1 }, { _id: 2 }], {
    onUpdate: async ({ collection: current, docs, filter, update, attempt }) => {
      if (attempt === 1) {
        docs[0].__v = 0;
        throw new Error('simulated partial updateMany failure');
      }
      return current.defaultUpdate(filter, update);
    },
  });

  await assert.rejects(
    () => runMigration(migrationOptions(collection, { apply: true })),
    (error) => {
      assert.match(error.message, /simulated partial/);
      assert.equal(error.migrationReport.applied, 1);
      assert.equal(error.migrationReport.pending, 1);
      assert.equal(error.migrationReport.matched, null);
      assert.equal(error.migrationReport.modified, null);
      return true;
    }
  );

  const rerun = await runMigration(migrationOptions(collection, { apply: true }));
  assert.equal(rerun.before.missing, 1);
  assert.equal(rerun.matched, 1);
  assert.equal(rerun.modified, 1);
  assert.equal(rerun.pending, 0);
  assert.deepEqual(collection.docs.map((document) => document.__v), [0, 0]);
});

test('second apply is an acknowledged idempotent no-op', async () => {
  const collection = fakeCollection([{ _id: 1 }, { _id: 2, __v: 9 }]);
  const first = await runMigration(migrationOptions(collection, { apply: true }));
  const second = await runMigration(migrationOptions(collection, { apply: true }));

  assert.equal(first.matched, 1);
  assert.equal(first.modified, 1);
  assert.equal(second.before.missing, 0);
  assert.equal(second.matched, 0);
  assert.equal(second.modified, 0);
  assert.equal(second.pending, 0);
  assert.equal(collection.calls.updates.length, 2);
});

test('database mismatch aborts before the first collection read or write', async () => {
  const collection = fakeCollection([{ _id: 1 }]);
  await assert.rejects(
    () => runMigration({
      collection,
      apply: true,
      environment: 'test',
      databaseName: 'wecooked-dev',
      logger: silentLogger,
    }),
    /Refusing database mismatch/
  );
  assert.equal(collection.calls.finds.length, 0);
  assert.equal(collection.calls.updates.length, 0);
});

test('command enforces configured environment, exact connected database, raw collection, and disabled auto-creation', async () => {
  const collection = fakeCollection([{ _id: 1, __v: 0 }]);
  let connectCall;
  let selectedCollection;
  let disconnects = 0;
  const report = await runMigrationCommand({
    argv: ['--environment=test'],
    loadEnvironment: () => ({
      nodeEnv: 'test',
      mongodbUri: `mongodb://127.0.0.1:27017/${TEST_DATABASE}`,
    }),
    connect: async (uri, options) => {
      connectCall = { uri, options };
      return {
        connection: {
          name: TEST_DATABASE,
          collection(name) {
            selectedCollection = name;
            return collection;
          },
        },
      };
    },
    disconnect: async () => { disconnects += 1; },
    logger: silentLogger,
  });

  assert.equal(report.mode, 'dry-run');
  assert.deepEqual(connectCall, {
    uri: `mongodb://127.0.0.1:27017/${TEST_DATABASE}`,
    options: { autoIndex: false, autoCreate: false },
  });
  assert.strictEqual(connectCall.options, MIGRATION_CONNECTION_OPTIONS);
  assert.equal(selectedCollection, 'shoppinglists');
  assert.equal(COLLECTION_NAME, 'shoppinglists');
  assert.equal(disconnects, 1);

  let connected = false;
  await assert.rejects(() => runMigrationCommand({
    argv: ['--environment=production'],
    loadEnvironment: () => ({
      nodeEnv: 'test',
      mongodbUri: `mongodb://127.0.0.1:27017/${TEST_DATABASE}`,
    }),
    connect: async () => { connected = true; },
  }), /environment mismatch/);
  assert.equal(connected, false);

  const wrongDatabaseCollection = fakeCollection([{ _id: 1 }]);
  await assert.rejects(() => runMigrationCommand({
    argv: ['--environment=test'],
    loadEnvironment: () => ({
      nodeEnv: 'test',
      mongodbUri: `mongodb://127.0.0.1:27017/${TEST_DATABASE}`,
    }),
    connect: async () => ({
      connection: {
        name: 'wecooked-dev',
        collection: () => wrongDatabaseCollection,
      },
    }),
    disconnect: async () => {},
    logger: silentLogger,
  }), /database mismatch/);
  assert.equal(wrongDatabaseCollection.calls.finds.length, 0);
  assert.equal(wrongDatabaseCollection.calls.updates.length, 0);
});

const isolatedMongoUri = process.env.SHOPPING_LIST_MIG1_MONGO_URI;

test('isolated Mongo proves legacy risk, exact backfill, repository versioning, OCC, and idempotency', {
  skip: isolatedMongoUri
    ? false
    : 'SHOPPING_LIST_MIG1_MONGO_URI is not configured for the isolated live-Mongo gate.',
  timeout: 60_000,
}, async () => {
  const unsafeId = new mongoose.Types.ObjectId();
  const migrationId = new mongoose.Types.ObjectId();
  const validId = new mongoose.Types.ObjectId();
  const blockedMissingId = new mongoose.Types.ObjectId();
  const invalidId = new mongoose.Types.ObjectId();
  const now = new Date('2026-10-05T00:00:00.000Z');
  let connected = false;
  let targetVerified = false;

  try {
    await mongoose.connect(isolatedMongoUri, MIGRATION_CONNECTION_OPTIONS);
    connected = true;
    assert.equal(mongoose.connection.name, TEST_DATABASE);
    targetVerified = true;

    const collection = mongoose.connection.collection(COLLECTION_NAME);
    await collection.deleteMany({});

    const occSchema = new mongoose.Schema({
      userId: { type: mongoose.Schema.Types.ObjectId, required: true },
      state: { type: String, required: true },
      items: { type: [mongoose.Schema.Types.Mixed], default: [] },
    }, {
      collection: COLLECTION_NAME,
      timestamps: true,
      optimisticConcurrency: true,
    });
    const OccShoppingList = mongoose.model('Mig1OccShoppingList', occSchema);

    await collection.insertMany([
      {
        _id: unsafeId,
        userId: new mongoose.Types.ObjectId(),
        state: 'legacy',
        items: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: migrationId,
        userId: new mongoose.Types.ObjectId(),
        state: 'migrate-me',
        items: [{ ingredientId: new mongoose.Types.ObjectId(), isChecked: true }],
        createdAt: now,
        updatedAt: now,
        preserved: { nested: ['exact', 7] },
      },
      {
        _id: validId,
        userId: new mongoose.Types.ObjectId(),
        state: 'valid',
        items: [],
        createdAt: now,
        updatedAt: now,
        __v: 7,
      },
    ]);

    const unsafeA = await OccShoppingList.findById(unsafeId);
    const unsafeB = await OccShoppingList.findById(unsafeId);
    unsafeA.state = 'unsafe-a';
    unsafeB.state = 'unsafe-b';
    const unsafeResults = await Promise.allSettled([unsafeA.save(), unsafeB.save()]);
    assert.equal(unsafeResults.filter((result) => result.status === 'fulfilled').length, 2);

    await collection.insertMany([
      {
        _id: blockedMissingId,
        userId: new mongoose.Types.ObjectId(),
        state: 'must-remain-missing',
        items: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: invalidId,
        userId: new mongoose.Types.ObjectId(),
        state: 'invalid',
        items: [],
        createdAt: now,
        updatedAt: now,
        __v: '0',
      },
    ]);
    await assert.rejects(
      () => runMigration(migrationOptions(collection, { apply: true })),
      /blocked before writes/
    );
    const blockedMissing = await collection.findOne({ _id: blockedMissingId });
    assert.equal(Object.prototype.hasOwnProperty.call(blockedMissing, '__v'), false);
    await collection.deleteMany({ _id: { $in: [blockedMissingId, invalidId] } });

    const beforeMigration = await collection.findOne({ _id: migrationId });
    const validBefore = await collection.findOne({ _id: validId });
    const dryRun = await runMigration(migrationOptions(collection));
    assert.equal(dryRun.before.missing, 1);
    assert.deepEqual(await collection.findOne({ _id: migrationId }), beforeMigration);

    const applied = await runMigration(migrationOptions(collection, { apply: true }));
    assert.equal(applied.matched, 1);
    assert.equal(applied.modified, 1);
    assert.equal(applied.after.missing, 0);
    assert.equal(applied.after.invalid, 0);

    const afterMigration = await collection.findOne({ _id: migrationId });
    const { __v: migratedVersion, ...afterWithoutVersion } = afterMigration;
    assert.equal(migratedVersion, 0);
    assert.deepEqual(afterWithoutVersion, beforeMigration);
    assert.deepEqual(await collection.findOne({ _id: validId }), validBefore);

    const occA = await OccShoppingList.findById(migrationId);
    const occB = await OccShoppingList.findById(migrationId);
    occA.state = 'winner-a';
    occB.state = 'winner-b';
    const occResults = await Promise.allSettled([occA.save(), occB.save()]);
    assert.equal(occResults.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(occResults.filter((result) => result.status === 'rejected').length, 1);
    const rejected = occResults.find((result) => result.status === 'rejected');
    assert.ok(rejected.reason instanceof mongoose.Error.VersionError);
    const fulfilled = occResults.find((result) => result.status === 'fulfilled');
    const winner = await collection.findOne({ _id: migrationId });
    assert.equal(winner.state, fulfilled.value.state);

    const shoppingListRepository = require('../src/modules/shopping-lists/shopping-list.repository');
    const repositoryUserId = new mongoose.Types.ObjectId();
    await shoppingListRepository.findOrCreateByUserId(repositoryUserId);
    const repositoryCreated = await collection.findOne({ userId: repositoryUserId });
    assert.equal(repositoryCreated.__v, 0);

    const repeated = await runMigration(migrationOptions(collection, { apply: true }));
    assert.equal(repeated.matched, 0);
    assert.equal(repeated.modified, 0);
    assert.equal(repeated.after.missing, 0);
    assert.equal(repeated.after.invalid, 0);
  } finally {
    if (connected) {
      if (targetVerified) {
        await mongoose.connection.collection(COLLECTION_NAME).deleteMany({});
      }
      await mongoose.disconnect();
    }
    if (mongoose.models.Mig1OccShoppingList) mongoose.deleteModel('Mig1OccShoppingList');
  }
});
