const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { generateRefreshToken, hashRefreshToken } = require('../src/shared/security/refresh-token');

test('generateRefreshToken returns a high-entropy, URL-safe string', () => {
  const token = generateRefreshToken();
  assert.equal(typeof token, 'string');
  assert.ok(token.length >= 40, 'expected a long, high-entropy token');
  assert.match(token, /^[A-Za-z0-9_-]+$/);
});

test('generateRefreshToken produces a different token on each call', () => {
  const tokens = new Set(Array.from({ length: 25 }, () => generateRefreshToken()));
  assert.equal(tokens.size, 25);
});

test('hashRefreshToken returns the hex-encoded SHA-256 digest of the input', () => {
  const token = 'a-fixed-example-token';
  const expected = crypto.createHash('sha256').update(token).digest('hex');

  assert.equal(hashRefreshToken(token), expected);
  assert.equal(hashRefreshToken(token).length, 64);
});

test('hashRefreshToken never returns the raw token', () => {
  const token = generateRefreshToken();
  assert.notEqual(hashRefreshToken(token), token);
});

test('hashRefreshToken is deterministic for the same input', () => {
  const token = generateRefreshToken();
  assert.equal(hashRefreshToken(token), hashRefreshToken(token));
});
