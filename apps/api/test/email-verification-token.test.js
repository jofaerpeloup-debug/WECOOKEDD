const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  generateEmailVerificationToken,
  hashEmailVerificationToken,
  EMAIL_VERIFICATION_TOKEN_BYTES,
  EMAIL_VERIFICATION_TOKEN_LENGTH,
  EMAIL_VERIFICATION_TOKEN_PATTERN,
} = require('../src/shared/security/email-verification-token');

test('email verification tokens contain 32 random bytes encoded as 43 base64url characters', () => {
  const first = generateEmailVerificationToken();
  const second = generateEmailVerificationToken();

  assert.equal(EMAIL_VERIFICATION_TOKEN_BYTES, 32);
  assert.equal(first.length, EMAIL_VERIFICATION_TOKEN_LENGTH);
  assert.match(first, EMAIL_VERIFICATION_TOKEN_PATTERN);
  assert.notEqual(first, second);
});

test('email verification tokens are stored as deterministic SHA-256 hex digests', () => {
  const rawToken = 'A'.repeat(43);
  const expected = crypto.createHash('sha256').update(rawToken).digest('hex');
  const digest = hashEmailVerificationToken(rawToken);

  assert.equal(digest, expected);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(digest, rawToken);
});
