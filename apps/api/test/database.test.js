const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
  PRODUCTION_MAX_POOL_SIZE,
  databaseConnectionOptions,
  connectDatabase,
} = require('../src/config/database');

test('development keeps the existing Mongoose connection defaults', () => {
  assert.deepEqual(databaseConnectionOptions('development'), {});
  assert.deepEqual(databaseConnectionOptions('test'), {});
});

test('production uses a conservative bounded pool without changing index behavior', () => {
  const options = databaseConnectionOptions('production');

  assert.deepEqual(options, { maxPoolSize: 10 });
  assert.equal(PRODUCTION_MAX_POOL_SIZE, 10);
  assert.equal('autoIndex' in options, false);
  assert.equal('autoCreate' in options, false);
});

test('connectDatabase passes production pool options to Mongoose', async (t) => {
  let received;
  t.mock.method(mongoose, 'connect', async (uri, options) => {
    received = { uri, options };
  });
  t.mock.method(console, 'log', () => {});

  await connectDatabase('mongodb+srv://cluster.example.net/wecooked', 'production');

  assert.deepEqual(received, {
    uri: 'mongodb+srv://cluster.example.net/wecooked',
    options: { maxPoolSize: 10 },
  });
});
