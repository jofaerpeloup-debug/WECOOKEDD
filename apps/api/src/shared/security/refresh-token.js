const crypto = require('node:crypto');

// Refresh tokens are high-entropy opaque secrets, not passwords, so they are
// generated with a CSPRNG and digested with SHA-256 rather than bcrypt —
// bcrypt's salting/work-factor is designed to slow down guessing a
// low-entropy human password, which is not the threat model here.
const TOKEN_BYTES = 32;

function generateRefreshToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function hashRefreshToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

module.exports = { generateRefreshToken, hashRefreshToken };
