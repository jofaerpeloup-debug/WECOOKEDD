const test = require('node:test');
const assert = require('node:assert/strict');

const { parseEnv } = require('../src/config/env');

test('parseEnv accepts a valid configuration', () => {
  const result = parseEnv({
    NODE_ENV: 'test',
    PORT: '4000',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
    CORS_ORIGINS: 'http://localhost:5173, http://localhost:19006',
  });

  assert.equal(result.nodeEnv, 'test');
  assert.equal(result.port, 4000);
  assert.equal(result.mongodbUri, 'mongodb://127.0.0.1:27017/wecooked_test');
  assert.deepEqual(result.corsOrigins, ['http://localhost:5173', 'http://localhost:19006']);
});

test('parseEnv applies defaults for NODE_ENV, PORT, and CORS_ORIGINS', () => {
  const result = parseEnv({
    MONGODB_URI: 'mongodb+srv://cluster.example.net/wecooked',
  });

  assert.equal(result.nodeEnv, 'development');
  assert.equal(result.port, 5000);
  assert.deepEqual(result.corsOrigins, []);
});

test('parseEnv rejects a configuration missing MONGODB_URI', () => {
  assert.throws(
    () => parseEnv({ NODE_ENV: 'test', PORT: '4000' }),
    /MONGODB_URI/
  );
});

test('parseEnv rejects a MONGODB_URI without a mongodb scheme', () => {
  assert.throws(
    () => parseEnv({ MONGODB_URI: 'postgres://127.0.0.1:5432/wecooked' }),
    /MONGODB_URI/
  );
});

test('parseEnv rejects a non-numeric PORT', () => {
  assert.throws(() =>
    parseEnv({
      MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
      PORT: 'not-a-number',
    })
  );
});

test('parseEnv rejects a PORT above the valid TCP port range', () => {
  assert.throws(() =>
    parseEnv({
      MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
      PORT: '70000',
    })
  );
});

test('parseEnv rejects a PORT of 0', () => {
  assert.throws(() =>
    parseEnv({
      MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
      PORT: '0',
    })
  );
});
