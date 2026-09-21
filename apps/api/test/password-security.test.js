process.env.NODE_ENV = 'test';
process.env.PORT = '4010';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  hashPassword,
  comparePassword,
  getPasswordByteLength,
  MAX_PASSWORD_BYTES,
} = require('../src/shared/security/password');
const { utf8ByteLength, PASSWORD_MAX_UTF8_BYTES } = require('@wecooked/contracts');

test('hashPassword produces a bcrypt hash, never the plaintext', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.notEqual(hash, 'correct horse battery staple');
  assert.match(hash, /^\$2[aby]\$\d{2}\$/);
});

test('comparePassword succeeds for the correct password', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.equal(await comparePassword('correct horse battery staple', hash), true);
});

test('comparePassword fails for an incorrect password', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.equal(await comparePassword('wrong password', hash), false);
});

test('hashing the same password twice produces different hashes (unique bcrypt salts)', async () => {
  const [hashA, hashB] = await Promise.all([
    hashPassword('same-password'),
    hashPassword('same-password'),
  ]);
  assert.notEqual(hashA, hashB);
  assert.equal(await comparePassword('same-password', hashA), true);
  assert.equal(await comparePassword('same-password', hashB), true);
});

test('getPasswordByteLength counts UTF-8 bytes, not characters', () => {
  assert.equal(getPasswordByteLength('abc'), 3);
  assert.equal(getPasswordByteLength('€'), 3); // one 3-byte UTF-8 character
});

test('MAX_PASSWORD_BYTES matches bcrypt\'s 72-byte input limit', () => {
  assert.equal(MAX_PASSWORD_BYTES, 72);
  assert.equal(MAX_PASSWORD_BYTES, PASSWORD_MAX_UTF8_BYTES);
  assert.equal(getPasswordByteLength, utf8ByteLength);
});

test('comparePassword rejects a password over the 72-byte limit rather than letting bcrypt silently truncate it into a match', async () => {
  const password72 = 'a'.repeat(72);
  const hash = await hashPassword(password72);
  // bcrypt only reads the first 72 bytes, so without the defensive check
  // this 73-byte password would truncate to password72 and incorrectly
  // compare as a match against its hash.
  const password73 = `${password72}b`;

  assert.equal(await comparePassword(password73, hash), false);
});

test('comparePassword still succeeds for a password exactly at the 72-byte boundary', async () => {
  const password72 = 'a'.repeat(72);
  const hash = await hashPassword(password72);

  assert.equal(await comparePassword(password72, hash), true);
});
