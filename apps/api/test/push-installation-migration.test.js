process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_notif2_test';
process.env.JWT_ACCESS_SECRET = 'push-migration-secret-at-least-32-characters';

const test = require('node:test');
const assert = require('node:assert/strict');
const migration = require('../scripts/migrate-notifications-v2');
const { PUSH_INSTALLATION_REQUIRED_INDEXES } = require('../src/config/required-indexes');

function collection(initial = [{ name: '_id_', key: { _id: 1 } }]) {
  const indexes = structuredClone(initial);
  let writes = 0;
  return {
    collectionName: 'pushinstallations',
    listIndexes: () => ({ toArray: async () => structuredClone(indexes) }),
    createIndex: async (key, options) => {
      writes += 1;
      indexes.push({ key, ...options });
    },
    get writes() { return writes; },
  };
}

test('dry-run writes nothing; apply creates exact indexes; rerun is idempotent', async () => {
  const target = collection();
  const dry = await migration.migrateCollection({ collection: target, logger: { log() {} } });
  assert.equal(dry.pending, 3);
  assert.equal(target.writes, 0);
  const applied = await migration.migrateCollection({ collection: target, apply: true, logger: { log() {} } });
  assert.equal(applied.indexesCreated, 3);
  assert.equal(applied.pending, 0);
  const rerun = await migration.migrateCollection({ collection: target, apply: true, logger: { log() {} } });
  assert.equal(rerun.indexesCreated, 0);
});

test('same-name and same-key drift block without writes and production apply is forbidden', async () => {
  const required = PUSH_INSTALLATION_REQUIRED_INDEXES[0];
  const target = collection([{ name: required.name, key: Object.fromEntries(required.key), unique: false }]);
  await assert.rejects(() => migration.migrateCollection({ collection: target, apply: true, logger: { log() {} } }), /preflight/);
  assert.equal(target.writes, 0);
  assert.throws(() => migration.assertCommandTarget({ nodeEnv: 'production', mongodbUri: 'mongodb://x/wecooked-notif2-test' }, { apply: true }), /production/);
});
