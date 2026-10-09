process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const migration = require('../scripts/migrate-notifications-v2');
const PushInstallation = require('../src/modules/push-installations/push-installation.model');

const uri = process.env.MOBILE_NOTIF2_MONGO_URI;

test('isolated non-production Mongo applies and reruns exact indexes', { skip: !uri }, async () => {
  migration.assertCommandTarget({ nodeEnv: 'test', mongodbUri: uri }, { apply: true });
  await mongoose.connect(uri, { autoIndex: false });
  try {
    const first = await migration.migrateCollection({ collection: PushInstallation.collection, apply: true, logger: { log() {} } });
    const second = await migration.migrateCollection({ collection: PushInstallation.collection, apply: true, logger: { log() {} } });
    assert.equal(first.indexesCreated, 3);
    assert.equal(first.pending, 0);
    assert.equal(second.indexesCreated, 0);
  } finally {
    await mongoose.disconnect();
  }
});
