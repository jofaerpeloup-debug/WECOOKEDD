const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateEmailChangeToken,
  hashEmailChangeToken,
  EMAIL_CHANGE_TOKEN_PATTERN,
} = require('../src/shared/security/email-change-token');

test('email-change tokens are random base64url values and only domain-separated digests persist', () => {
  const first = generateEmailChangeToken();
  const second = generateEmailChangeToken();
  assert.match(first, EMAIL_CHANGE_TOKEN_PATTERN);
  assert.match(second, EMAIL_CHANGE_TOKEN_PATTERN);
  assert.notEqual(first, second);
  assert.match(hashEmailChangeToken(first), /^[a-f0-9]{64}$/);
  assert.notEqual(hashEmailChangeToken(first), hashEmailChangeToken(second));
});

test('email-change digest cannot collide with ordinary verification for the same raw token', () => {
  const { hashEmailVerificationToken } = require('../src/shared/security/email-verification-token');
  const token = generateEmailChangeToken();
  assert.notEqual(hashEmailChangeToken(token), hashEmailVerificationToken(token));
});
