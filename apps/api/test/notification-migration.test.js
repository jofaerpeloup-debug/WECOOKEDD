process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_notif_test';
process.env.JWT_ACCESS_SECRET = 'notification-migration-secret-at-least-32-chars';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analyzePreference,
  observedPredicate,
  migrateCollections,
  parseApplyFlag,
  assertApplyTarget,
  runMigrationCommand,
} = require('../scripts/migrate-notifications-v1');
const { NOTIFICATION_REQUIRED_INDEXES } = require('../src/config/required-indexes');

const ID_A = '507f1f77bcf86cd799439001';
const ID_B = '507f1f77bcf86cd799439002';
const silentLogger = { log() {} };

function canonical(push = true) {
  return { enabled: push, push, email: true, suggestions: true, digest: false, reminders: true };
}

function exactIndexes() {
  return NOTIFICATION_REQUIRED_INDEXES.map((required) => ({
    name: required.name,
    key: Object.fromEntries(required.key),
    ...(required.unique ? { unique: true } : {}),
    ...(required.expireAfterSeconds !== null ? { expireAfterSeconds: required.expireAfterSeconds } : {}),
  }));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function userCollection(documents, { conflictAt = -1, canonicalOnConflict = false } = {}) {
  const state = clone(documents);
  const calls = { updates: [], finds: 0 };
  return {
    state,
    calls,
    find() {
      calls.finds += 1;
      return { toArray: async () => clone(state) };
    },
    async updateOne(predicate, update) {
      calls.updates.push({ predicate, update });
      if (calls.updates.length - 1 === conflictAt) {
        if (canonicalOnConflict) {
          const document = state.find((item) => item._id === predicate.$and[0]._id);
          document.preferences = { ...(document.preferences || {}), notifications: canonical(false) };
        }
        return { matchedCount: 0, modifiedCount: 0 };
      }
      const id = predicate.$and[0]._id;
      const document = state.find((item) => item._id === id);
      if (!document) return { matchedCount: 0, modifiedCount: 0 };
      document.preferences = document.preferences || {};
      document.preferences.notifications = document.preferences.notifications || {};
      for (const [path, value] of Object.entries(update.$set)) {
        document.preferences.notifications[path.split('.').pop()] = value;
      }
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async findOne({ _id }) {
      return clone(state.find((item) => item._id === _id) || null);
    },
  };
}

function notificationCollection(indexes = []) {
  const state = clone(indexes);
  const calls = { creates: [] };
  return {
    calls,
    listIndexes() { return { toArray: async () => clone(state) }; },
    async createIndex(key, options) {
      calls.creates.push({ key, options });
      state.push({ key, ...options });
      return options.name;
    },
  };
}

test('preference mapping preserves valid canonical leaves and backfills exact defaults/alias', () => {
  assert.deepEqual(analyzePreference(undefined, false).target, canonical(true));
  assert.deepEqual(analyzePreference({ enabled: false }, true).target, canonical(false));
  assert.deepEqual(analyzePreference({ push: false }, true).target, canonical(false));
  const custom = canonical(false);
  custom.email = false;
  custom.digest = true;
  assert.deepEqual(analyzePreference(custom, true), {
    malformed: false,
    present: true,
    source: custom,
    target: custom,
    canonical: true,
  });
});

test('malformed/non-Boolean/contradictory/unknown preference states are blockers', () => {
  for (const value of [null, true, [], { enabled: 'yes' }, { push: 1 }, { enabled: true, push: false }, { enabled: true, sms: true }]) {
    assert.equal(analyzePreference(value, true).malformed, true);
  }
});

test('observed predicate records exact presence/value for every audited leaf', () => {
  const analysis = analyzePreference({ enabled: false, email: true }, true);
  assert.deepEqual(observedPredicate(ID_A, analysis), {
    $and: [
      { _id: ID_A },
      { 'preferences.notifications.enabled': false },
      { 'preferences.notifications.push': { $exists: false } },
      { 'preferences.notifications.email': true },
      { 'preferences.notifications.suggestions': { $exists: false } },
      { 'preferences.notifications.digest': { $exists: false } },
      { 'preferences.notifications.reminders': { $exists: false } },
    ],
  });
});

test('dry-run scans all users/indexes and performs zero writes', async () => {
  const users = userCollection([{ _id: ID_A }, { _id: ID_B, preferences: { notifications: canonical() } }]);
  const notifications = notificationCollection([]);
  const report = await migrateCollections({ userCollection: users, notificationCollection: notifications, logger: silentLogger });
  assert.deepEqual({ scanned: report.scanned, canonical: report.canonical, candidates: report.candidates, pending: report.pending }, {
    scanned: 2, canonical: 1, candidates: 1, pending: 5,
  });
  assert.equal(users.calls.updates.length, 0);
  assert.equal(notifications.calls.creates.length, 0);
});

test('complete malformed preflight stops before every write and index creation', async () => {
  const users = userCollection([
    { _id: ID_A, preferences: { notifications: { enabled: 'bad' } } },
    { _id: ID_B, preferences: { notifications: null } },
  ]);
  const notifications = notificationCollection([]);
  await assert.rejects(
    () => migrateCollections({ userCollection: users, notificationCollection: notifications, apply: true, logger: silentLogger }),
    (error) => error.report.malformed === 2 && error.report.blockers === 2
  );
  assert.equal(users.calls.updates.length, 0);
  assert.equal(notifications.calls.creates.length, 0);
});

test('apply normalizes users, creates exact indexes, and second apply has zero pending work', async () => {
  const users = userCollection([
    { _id: ID_A, preferences: { notifications: { enabled: false, email: false } } },
    { _id: ID_B },
  ]);
  const notifications = notificationCollection([]);
  const applied = await migrateCollections({ userCollection: users, notificationCollection: notifications, apply: true, logger: silentLogger });
  assert.equal(applied.changed, 2);
  assert.equal(applied.indexesCreated, 4);
  assert.equal(applied.pending, 0);
  assert.deepEqual(users.state[0].preferences.notifications, { ...canonical(false), email: false });
  assert.deepEqual(notifications.calls.creates.map((call) => call.options.name), NOTIFICATION_REQUIRED_INDEXES.map((index) => index.name));
  assert.deepEqual(notifications.calls.creates[3].options, { name: 'notification_expiry_ttl', expireAfterSeconds: 0 });

  const updatesBefore = users.calls.updates.length;
  const createsBefore = notifications.calls.creates.length;
  const repeated = await migrateCollections({ userCollection: users, notificationCollection: notifications, apply: true, logger: silentLogger });
  assert.equal(repeated.pending, 0);
  assert.equal(repeated.changed, 0);
  assert.equal(repeated.indexesCreated, 0);
  assert.equal(users.calls.updates.length, updatesBefore);
  assert.equal(notifications.calls.creates.length, createsBefore);
});

test('drifted same-name or same-key indexes block before writes and are never dropped', async () => {
  const users = userCollection([{ _id: ID_A }]);
  const drifted = exactIndexes();
  drifted[3].expireAfterSeconds = 60;
  const notifications = notificationCollection(drifted);
  await assert.rejects(
    () => migrateCollections({ userCollection: users, notificationCollection: notifications, apply: true, logger: silentLogger }),
    (error) => error.report.indexes.drifted === 1
  );
  assert.equal(users.calls.updates.length, 0);
  assert.equal(notifications.calls.creates.length, 0);
});

test('observed-state conflict fails with partial-state reporting before index creation', async () => {
  const users = userCollection([{ _id: ID_A }, { _id: ID_B }], { conflictAt: 1 });
  const notifications = notificationCollection([]);
  await assert.rejects(
    () => migrateCollections({ userCollection: users, notificationCollection: notifications, apply: true, logger: silentLogger }),
    (error) => error.report.changed === 1 && error.report.conflicts === 1
  );
  assert.equal(notifications.calls.creates.length, 0);
});

test('lost predicate is accepted only when reread proves exact canonical target state', async () => {
  const users = userCollection([{ _id: ID_A, preferences: { notifications: { enabled: false } } }], {
    conflictAt: 0,
    canonicalOnConflict: true,
  });
  const notifications = notificationCollection(exactIndexes());
  const report = await migrateCollections({ userCollection: users, notificationCollection: notifications, apply: true, logger: silentLogger });
  assert.equal(report.conflicts, 0);
  assert.equal(report.pending, 0);
});

test('CLI is dry-run by default, exact about --apply, and refuses production/shared-dev apply', async () => {
  assert.equal(parseApplyFlag([]), false);
  assert.equal(parseApplyFlag(['--apply']), true);
  assert.throws(() => parseApplyFlag(['--force']));
  for (const env of [
    { nodeEnv: 'production', mongodbUri: 'mongodb://x/wecooked-notif-test' },
    { nodeEnv: 'test', mongodbUri: 'mongodb://x/wecooked-production' },
    { nodeEnv: 'test', mongodbUri: 'mongodb://x/wecooked-production-notif-test' },
    { nodeEnv: 'development', mongodbUri: 'mongodb://x/wecooked-dev' },
    { nodeEnv: 'test', mongodbUri: 'mongodb://x/wecooked-dev-isolated' },
    { nodeEnv: 'test', mongodbUri: 'mongodb://x/wecooked' },
    { nodeEnv: 'test', mongodbUri: 'mongodb://x/other-notif1-test' },
  ]) assert.throws(() => assertApplyTarget(env), /Refusing/);
  assert.doesNotThrow(() => assertApplyTarget({ nodeEnv: 'test', mongodbUri: 'mongodb://x/wecooked-notif1-test' }));
  assert.doesNotThrow(() => assertApplyTarget({ nodeEnv: 'test', mongodbUri: 'mongodb://x/wecooked_notif1_isolated_local' }));

  let connected = false;
  await assert.rejects(() => runMigrationCommand({
    argv: ['--apply'],
    loadEnvironment: () => ({ nodeEnv: 'production', mongodbUri: 'mongodb://x/wecooked-production' }),
    connect: async () => { connected = true; },
  }), /Refusing/);
  assert.equal(connected, false);
});
