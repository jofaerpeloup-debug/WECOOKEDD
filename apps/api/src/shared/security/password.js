const bcrypt = require('bcryptjs');
const { loadEnv } = require('../../config/env');
const { PASSWORD_MAX_UTF8_BYTES, utf8ByteLength } = require('@wecooked/contracts');

// bcrypt only considers the first 72 bytes of its input; anything beyond
// that is silently ignored, which would let two different passwords hash
// identically. Reject before hashing rather than truncate silently.
const MAX_PASSWORD_BYTES = PASSWORD_MAX_UTF8_BYTES;
const getPasswordByteLength = utf8ByteLength;

async function hashPassword(password) {
  const { bcryptRounds } = loadEnv();
  return bcrypt.hash(password, bcryptRounds);
}

async function comparePassword(password, hash) {
  // bcrypt only reads a hash's first 72 bytes, so a longer input would be
  // silently truncated to the same effective password as one exactly at
  // the limit — comparing it "successfully" against a hash for the
  // truncated version. Reject up front instead of relying on bcrypt's
  // truncation as an implicit (and non-obvious) comparison behavior.
  if (getPasswordByteLength(password) > MAX_PASSWORD_BYTES) {
    return false;
  }
  return bcrypt.compare(password, hash);
}

module.exports = {
  hashPassword,
  comparePassword,
  getPasswordByteLength,
  MAX_PASSWORD_BYTES,
};
