const crypto = require('node:crypto');

const EMAIL_CHANGE_TOKEN_BYTES = 32;
const EMAIL_CHANGE_TOKEN_LENGTH = 43;
const EMAIL_CHANGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function generateEmailChangeToken() {
  return crypto.randomBytes(EMAIL_CHANGE_TOKEN_BYTES).toString('base64url');
}

function hashEmailChangeToken(rawToken) {
  return crypto
    .createHash('sha256')
    .update('wecooked:email-change:v1\0')
    .update(rawToken)
    .digest('hex');
}

module.exports = {
  generateEmailChangeToken,
  hashEmailChangeToken,
  EMAIL_CHANGE_TOKEN_BYTES,
  EMAIL_CHANGE_TOKEN_LENGTH,
  EMAIL_CHANGE_TOKEN_PATTERN,
};
