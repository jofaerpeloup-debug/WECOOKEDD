process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REQUIRED_INDEXES,
  MODERATOR_APPLICATION_REQUIRED_INDEXES,
  verifyRequiredIndexes,
} = require('../src/config/required-indexes');
const {
  AUTH_IDENTITY_INDEX_SPEC,
  AUTH_IDENTITY_INDEX_OPTIONS,
} = require('../scripts/migrate-auth-identities');

const silentLogger = { log() {} };

// The exact shape MongoDB reports for the index the migration creates.
function validIndex() {
  return {
    v: 2,
    name: 'uniq_auth_identity_provider_subject',
    key: { 'authIdentities.provider': 1, 'authIdentities.subject': 1 },
    unique: true,
    partialFilterExpression: {
      'authIdentities.provider': { $exists: true },
      'authIdentities.subject': { $exists: true },
    },
  };
}

// A read-only stub: every write entry point throws, so a verifier that tried to
// create or repair an index would fail the test rather than pass it silently.
function fakeCollection(indexes, { onListIndexes } = {}) {
  const forbidden = (name) => () => {
    throw new Error(`verifier must never call ${name}`);
  };
  return {
    collectionName: 'users',
    listIndexes() {
      if (onListIndexes) onListIndexes();
      return { toArray: async () => indexes };
    },
    createIndex: forbidden('createIndex'),
    createIndexes: forbidden('createIndexes'),
    dropIndex: forbidden('dropIndex'),
    dropIndexes: forbidden('dropIndexes'),
    ensureIndex: forbidden('ensureIndex'),
  };
}

function verify(indexes, options) {
  return verifyRequiredIndexes({
    collection: fakeCollection(indexes, options),
    logger: silentLogger,
  });
}

test('the verifier accepts the exact required index', async () => {
  await verify([{ name: '_id_', key: { _id: 1 } }, validIndex()]);
});

test('the required shape matches the index the migration actually creates', () => {
  const [required] = REQUIRED_INDEXES;
  assert.equal(required.name, AUTH_IDENTITY_INDEX_OPTIONS.name);
  assert.equal(required.unique, AUTH_IDENTITY_INDEX_OPTIONS.unique);
  assert.deepEqual(required.key.map(([field]) => field), Object.keys(AUTH_IDENTITY_INDEX_SPEC));
  assert.deepEqual(
    required.key.map(([, direction]) => direction),
    Object.values(AUTH_IDENTITY_INDEX_SPEC)
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(required.partialFilterExpression)),
    AUTH_IDENTITY_INDEX_OPTIONS.partialFilterExpression
  );
});

test('the verifier rejects a missing index', async () => {
  await assert.rejects(
    () => verify([{ name: '_id_', key: { _id: 1 } }]),
    /Required index "uniq_auth_identity_provider_subject".*is missing/s
  );
});

test('the verifier rejects a wrong key specification', async () => {
  const wrongField = { ...validIndex(), key: { 'authIdentities.provider': 1, email: 1 } };
  const wrongDirection = {
    ...validIndex(),
    key: { 'authIdentities.provider': 1, 'authIdentities.subject': -1 },
  };
  const extraKey = {
    ...validIndex(),
    key: { 'authIdentities.provider': 1, 'authIdentities.subject': 1, email: 1 },
  };

  for (const index of [wrongField, wrongDirection, extraKey]) {
    await assert.rejects(() => verify([index]), /must be keyed exactly/);
  }
});

test('the verifier rejects a reversed key order even though the fields match', async () => {
  const reversed = {
    ...validIndex(),
    key: { 'authIdentities.subject': 1, 'authIdentities.provider': 1 },
  };
  await assert.rejects(() => verify([reversed]), /must be keyed exactly/);
});

test('the verifier rejects a non-unique index', async () => {
  const notUnique = { ...validIndex() };
  delete notUnique.unique;
  await assert.rejects(() => verify([notUnique]), /must be unique: true, found unique: false/);
  await assert.rejects(
    () => verify([{ ...validIndex(), unique: false }]),
    /must be unique: true, found unique: false/
  );
});

test('the verifier rejects a missing or wrong partial filter', async () => {
  const noFilter = { ...validIndex() };
  delete noFilter.partialFilterExpression;
  const wrongFilter = {
    ...validIndex(),
    partialFilterExpression: { 'authIdentities.provider': { $exists: true } },
  };
  const wrongOperator = {
    ...validIndex(),
    partialFilterExpression: {
      'authIdentities.provider': { $exists: true },
      'authIdentities.subject': { $type: 'string' },
    },
  };

  for (const index of [noFilter, wrongFilter, wrongOperator]) {
    await assert.rejects(() => verify([index]), /must carry the partial filter/);
  }
});

test('the partial filter comparison ignores only key order, not content', async () => {
  const reorderedFilter = {
    ...validIndex(),
    partialFilterExpression: {
      'authIdentities.subject': { $exists: true },
      'authIdentities.provider': { $exists: true },
    },
  };
  await verify([reorderedFilter]);
});

test('the verifier reads the catalogue exactly once and never writes', async () => {
  let listCalls = 0;
  await verify([validIndex()], { onListIndexes: () => (listCalls += 1) });
  assert.equal(listCalls, 1);

  // The stub throws on every index-mutating method, so reaching here proves
  // none was called on the accepting path. Prove it for a rejecting path too:
  // a malformed index must fail startup, not trigger a repair.
  await assert.rejects(() => verify([{ ...validIndex(), unique: false }]), /must be unique/);
});

test('an unreadable index catalogue fails startup rather than being assumed safe', async () => {
  const collection = {
    collectionName: 'users',
    listIndexes() {
      return {
        toArray: async () => {
          throw Object.assign(new Error('ns does not exist: wecooked.users'), { code: 26 });
        },
      };
    },
  };

  await assert.rejects(
    () => verifyRequiredIndexes({ collection, logger: silentLogger }),
    /Could not read indexes on collection "users".*ns does not exist/s
  );
});

test('a successful verification logs one non-sensitive summary line', async () => {
  const lines = [];
  await verifyRequiredIndexes({
    collection: fakeCollection([validIndex()]),
    logger: { log: (line) => lines.push(line) },
  });
  assert.deepEqual(lines, ['[database] verified 1 required index(es) on "users"']);
});

test('startup registration verifies both ModeratorApplication indexes read-only', async () => {
  const writes = [];
  const moderatorApplicationCollection = {
    collectionName: 'moderatorapplications',
    listIndexes() {
      return {
        toArray: async () => [
          {
            name: 'uniq_pending_moderator_application_per_user',
            key: { userId: 1 },
            unique: true,
            partialFilterExpression: { status: 'pending' },
          },
          {
            name: 'moderator_application_queue',
            key: { status: 1, createdAt: -1, _id: -1 },
          },
        ],
      };
    },
    createIndex: (...args) => writes.push(args),
    dropIndex: (...args) => writes.push(args),
  };
  const lines = [];
  await verifyRequiredIndexes({
    collection: fakeCollection([validIndex()]),
    moderatorApplicationCollection,
    logger: { log: (line) => lines.push(line) },
  });
  assert.equal(MODERATOR_APPLICATION_REQUIRED_INDEXES.length, 2);
  assert.deepEqual(writes, []);
  assert.deepEqual(lines, [
    '[database] verified 3 required index(es) across security-critical collections',
  ]);
});
