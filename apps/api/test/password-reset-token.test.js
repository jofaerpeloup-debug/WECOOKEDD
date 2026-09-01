const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  generatePasswordResetToken,
  hashPasswordResetToken,
  PASSWORD_RESET_TOKEN_BYTES,
  PASSWORD_RESET_TOKEN_LENGTH,
  PASSWORD_RESET_TOKEN_PATTERN,
} = require('../src/shared/security/password-reset-token');

test('password reset tokens contain 32 random bytes encoded as 43 base64url characters', () => {
  const first = generatePasswordResetToken();
  const second = generatePasswordResetToken();

  assert.equal(PASSWORD_RESET_TOKEN_BYTES, 32);
  assert.equal(first.length, PASSWORD_RESET_TOKEN_LENGTH);
  assert.match(first, PASSWORD_RESET_TOKEN_PATTERN);
  assert.notEqual(first, second);
});

test('password reset tokens are stored as deterministic SHA-256 hex digests', () => {
  const rawToken = 'A'.repeat(43);
  const expected = crypto.createHash('sha256').update(rawToken).digest('hex');
  const digest = hashPasswordResetToken(rawToken);

  assert.equal(digest, expected);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(digest, rawToken);
});
