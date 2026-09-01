const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AUTH_IDENTITY_INDEX_SPEC,
  AUTH_IDENTITY_INDEX_OPTIONS,
  analyzeDocuments,
  migrateCollection,
  parseApplyFlag,
  runMigrationCommand,
} = require('../scripts/migrate-auth-identities');

const LINKED_AT = new Date('2026-01-01T00:00:00.000Z');

function quietLogger() {
  return { log() {}, error() {} };
}

function fakeCollection(documents, modifiedCount = 0) {
  const calls = { find: [], updateMany: [], createIndex: [], order: [] };
  return {
    calls,
    find(filter, options) {
      calls.order.push('find');
      calls.find.push({ filter, options });
      return { toArray: async () => documents };
    },
    async updateMany(filter, update) {
      calls.order.push('updateMany');
      calls.updateMany.push({ filter, update });
      return { modifiedCount };
    },
    async createIndex(spec, options) {
      calls.order.push('createIndex');
      calls.createIndex.push({ spec, options });
      return options.name;
    },
  };
}

test('parseApplyFlag permits only dry-run or the exact --apply flag', () => {
  assert.equal(parseApplyFlag([]), false);
  assert.equal(parseApplyFlag(['--apply']), true);
  assert.throws(() => parseApplyFlag(['apply']), /Usage/);
  assert.throws(() => parseApplyFlag(['--apply', '--force']), /Usage/);
});

test('dry-run reports aggregate state without mutation or index creation', async () => {
  const collection = fakeCollection([
    { _id: 'local-1', authProviders: ['local'], passwordHash: 'bcrypt-hash' },
  ]);

  const result = await migrateCollection({ collection, logger: quietLogger() });

  assert.equal(result.applied, false);
  assert.equal(result.counts.documents, 1);
  assert.equal(result.counts.legacyFieldDocuments, 1);
  assert.equal(collection.calls.updateMany.length, 0);
  assert.equal(collection.calls.createIndex.length, 0);
  assert.deepEqual(collection.calls.order, ['find']);
  assert.deepEqual(collection.calls.find[0].options.projection, {
    _id: 1,
    authProviders: 1,
    authIdentities: 1,
    passwordHash: 1,
  });
});

test('an empty legacy provider array with a usable hash is treated as local and may migrate', async () => {
  const collection = fakeCollection(
    [{ _id: 'local-1', authProviders: [], passwordHash: 'bcrypt-hash' }],
    1
  );

  const report = analyzeDocuments(await collection.find({}, {}).toArray());
  assert.equal(report.counts.localLegacyDocuments, 1);
  assert.equal(report.counts.unknownLegacyProvider, 0);
  assert.equal(report.blockerCount, 0);

  const result = await migrateCollection({ collection, apply: true, logger: quietLogger() });
  assert.equal(result.applied, true);
  assert.equal(result.legacyFieldsRemoved, 1);
  assert.equal(collection.calls.updateMany.length, 1);
  assert.equal(collection.calls.createIndex.length, 1);
});

test('an empty legacy provider array without any usable method remains blocked', async () => {
  const collection = fakeCollection([{ _id: 'broken-1', authProviders: [] }]);

  await assert.rejects(
    () => migrateCollection({ collection, apply: true, logger: quietLogger() }),
    /preflight failed/
  );
  assert.equal(collection.calls.updateMany.length, 0);
  assert.equal(collection.calls.createIndex.length, 0);
});

test('preflight rejects unknown legacy providers before mutation', async () => {
  const collection = fakeCollection([
    { _id: 'user-1', authProviders: ['local', 'github'], passwordHash: 'bcrypt-hash' },
  ]);

  await assert.rejects(
    () => migrateCollection({ collection, apply: true, logger: quietLogger() }),
    /preflight failed/
  );
  assert.equal(collection.calls.updateMany.length, 0);
  assert.equal(collection.calls.createIndex.length, 0);
});

test('preflight rejects a legacy social provider without a durable subject', async () => {
  const collection = fakeCollection([
    { _id: 'user-1', authProviders: ['google'], passwordHash: undefined },
  ]);

  const report = analyzeDocuments(
    await collection.find({}, {}).toArray()
  );
  assert.equal(report.counts.socialLegacyWithoutSubject, 1);
  await assert.rejects(
    () => migrateCollection({ collection, apply: true, logger: quietLogger() }),
    /preflight failed/
  );
  assert.equal(collection.calls.updateMany.length, 0);
  assert.equal(collection.calls.createIndex.length, 0);
});

test('preflight rejects a legacy local account without a usable hash', async () => {
  for (const passwordHash of [undefined, null, '', '   ']) {
    const collection = fakeCollection([{ _id: 'user-1', authProviders: ['local'], passwordHash }]);
    await assert.rejects(
      () => migrateCollection({ collection, apply: true, logger: quietLogger() }),
      /preflight failed/
    );
    assert.equal(collection.calls.updateMany.length, 0);
    assert.equal(collection.calls.createIndex.length, 0);
  }
});

test('preflight rejects invalid same-document identities and cross-document ownership collisions', async () => {
  const duplicateProvider = fakeCollection([
    {
      _id: 'user-1',
      authIdentities: [
        { provider: 'google', subject: 'one', linkedAt: LINKED_AT },
        { provider: 'google', subject: 'two', linkedAt: LINKED_AT },
      ],
    },
  ]);
  await assert.rejects(
    () => migrateCollection({ collection: duplicateProvider, apply: true, logger: quietLogger() }),
    /preflight failed/
  );
  assert.equal(duplicateProvider.calls.updateMany.length, 0);
  assert.equal(duplicateProvider.calls.createIndex.length, 0);

  const duplicateOwner = fakeCollection([
    {
      _id: 'user-1',
      authIdentities: [{ provider: 'apple', subject: 'same', linkedAt: LINKED_AT }],
    },
    {
      _id: 'user-2',
      authIdentities: [{ provider: 'apple', subject: 'same', linkedAt: LINKED_AT }],
    },
  ]);
  await assert.rejects(
    () => migrateCollection({ collection: duplicateOwner, apply: true, logger: quietLogger() }),
    /preflight failed/
  );
  assert.equal(duplicateOwner.calls.updateMany.length, 0);
  assert.equal(duplicateOwner.calls.createIndex.length, 0);
});

test('--apply only unsets authProviders and ensures the exact identity index', async () => {
  const collection = fakeCollection(
    [{ _id: 'local-1', authProviders: ['local'], passwordHash: 'bcrypt-hash' }],
    1
  );

  const result = await migrateCollection({
    collection,
    apply: true,
    logger: quietLogger(),
  });

  assert.equal(result.applied, true);
  assert.equal(result.legacyFieldsRemoved, 1);
  assert.deepEqual(collection.calls.updateMany, [
    {
      filter: { authProviders: { $exists: true } },
      update: { $unset: { authProviders: '' } },
    },
  ]);
  assert.equal(JSON.stringify(collection.calls.updateMany).includes('passwordHash'), false);
  assert.equal(JSON.stringify(collection.calls.updateMany).includes('email'), false);
  assert.equal(JSON.stringify(collection.calls.updateMany).includes('authIdentities'), false);
  assert.deepEqual(collection.calls.createIndex, [
    { spec: AUTH_IDENTITY_INDEX_SPEC, options: AUTH_IDENTITY_INDEX_OPTIONS },
  ]);
  assert.deepEqual(collection.calls.order, ['find', 'updateMany', 'createIndex']);
});

test('repeated apply is safe when the legacy field is already absent', async () => {
  const collection = fakeCollection([{ _id: 'local-1', passwordHash: 'bcrypt-hash' }], 0);

  const result = await migrateCollection({
    collection,
    apply: true,
    logger: quietLogger(),
  });

  assert.equal(result.applied, true);
  assert.equal(result.legacyFieldsRemoved, 0);
  assert.equal(collection.calls.createIndex.length, 1);
});

test('runMigrationCommand disconnects after success and after a post-connect failure', async () => {
  for (const documents of [
    [{ _id: 'local-1', passwordHash: 'bcrypt-hash' }],
    [{ _id: 'broken-1', authProviders: ['google'] }],
  ]) {
    const events = [];
    const collection = fakeCollection(documents);
    const promise = runMigrationCommand({
      argv: [],
      loadEnvironment: () => ({ mongodbUri: 'mongodb://test' }),
      connect: async () => events.push('connect'),
      disconnect: async () => events.push('disconnect'),
      getCollection: () => collection,
      logger: quietLogger(),
    });

    if (documents[0].authProviders?.includes('google')) {
      await assert.rejects(() => promise, /preflight failed/);
    } else {
      await promise;
    }
    assert.deepEqual(events, ['connect', 'disconnect']);
  }
});
