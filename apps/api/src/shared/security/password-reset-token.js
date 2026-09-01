const crypto = require('node:crypto');

const PASSWORD_RESET_TOKEN_BYTES = 32;
const PASSWORD_RESET_TOKEN_LENGTH = 43;
const PASSWORD_RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function generatePasswordResetToken() {
  return crypto.randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString('base64url');
}

function hashPasswordResetToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

module.exports = {
  generatePasswordResetToken,
  hashPasswordResetToken,
  PASSWORD_RESET_TOKEN_BYTES,
  PASSWORD_RESET_TOKEN_LENGTH,
  PASSWORD_RESET_TOKEN_PATTERN,
};
