const test = require('node:test');
const assert = require('node:assert/strict');

const { parseEnv } = require('../src/config/env');

const VALID_JWT_ACCESS_SECRET = 'a'.repeat(32);
const REQUIRED_EMAIL_ENV = {
  RESEND_API_KEY: 'test-resend-key',
  EMAIL_FROM: 'WeCooked <no-reply@example.com>',
  PASSWORD_RESET_URL: 'http://localhost:5173/reset-password',
};

test('parseEnv accepts a valid configuration', () => {
  const result = parseEnv({
    NODE_ENV: 'test',
    PORT: '4000',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
    CORS_ORIGINS: 'http://localhost:5173, http://localhost:19006',
    JWT_ACCESS_SECRET: VALID_JWT_ACCESS_SECRET,
  });

  assert.equal(result.nodeEnv, 'test');
  assert.equal(result.port, 4000);
  assert.equal(result.mongodbUri, 'mongodb://127.0.0.1:27017/wecooked_test');
  assert.deepEqual(result.corsOrigins, ['http://localhost:5173', 'http://localhost:19006']);
});

test('parseEnv applies defaults for NODE_ENV, PORT, and CORS_ORIGINS', () => {
  const result = parseEnv({
    ...REQUIRED_EMAIL_ENV,
    MONGODB_URI: 'mongodb+srv://cluster.example.net/wecooked',
    JWT_ACCESS_SECRET: VALID_JWT_ACCESS_SECRET,
  });

  assert.equal(result.nodeEnv, 'development');
  assert.equal(result.port, 5000);
  assert.deepEqual(result.corsOrigins, []);
});

test('parseEnv rejects a configuration missing MONGODB_URI', () => {
  assert.throws(
    () => parseEnv({ NODE_ENV: 'test', PORT: '4000', JWT_ACCESS_SECRET: VALID_JWT_ACCESS_SECRET }),
    /MONGODB_URI/
  );
});

test('parseEnv rejects a MONGODB_URI without a mongodb scheme', () => {
  assert.throws(
    () =>
      parseEnv({
        ...REQUIRED_EMAIL_ENV,
        MONGODB_URI: 'postgres://127.0.0.1:5432/wecooked',
        JWT_ACCESS_SECRET: VALID_JWT_ACCESS_SECRET,
      }),
    /MONGODB_URI/
  );
});

test('parseEnv rejects a non-numeric PORT', () => {
  assert.throws(() =>
    parseEnv({
      ...REQUIRED_EMAIL_ENV,
      MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
      PORT: 'not-a-number',
      JWT_ACCESS_SECRET: VALID_JWT_ACCESS_SECRET,
    })
  );
});

test('parseEnv rejects a PORT above the valid TCP port range', () => {
  assert.throws(() =>
    parseEnv({
      ...REQUIRED_EMAIL_ENV,
      MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
      PORT: '70000',
      JWT_ACCESS_SECRET: VALID_JWT_ACCESS_SECRET,
    })
  );
});

test('parseEnv rejects a PORT of 0', () => {
  assert.throws(() =>
    parseEnv({
      ...REQUIRED_EMAIL_ENV,
      MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
      PORT: '0',
      JWT_ACCESS_SECRET: VALID_JWT_ACCESS_SECRET,
    })
  );
});

test('parseEnv rejects a configuration missing JWT_ACCESS_SECRET', () => {
  assert.throws(
    () =>
      parseEnv({
        ...REQUIRED_EMAIL_ENV,
        MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
      }),
    /JWT_ACCESS_SECRET/
  );
});

test('parseEnv rejects a JWT_ACCESS_SECRET shorter than 32 characters', () => {
  assert.throws(
    () =>
      parseEnv({
        ...REQUIRED_EMAIL_ENV,
        MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
        JWT_ACCESS_SECRET: 'too-short',
      }),
    /JWT_ACCESS_SECRET/
  );
});

test('parseEnv applies defaults for JWT_ACCESS_TTL, REFRESH_TOKEN_TTL_DAYS, and BCRYPT_ROUNDS', () => {
  const result = parseEnv({
    ...REQUIRED_EMAIL_ENV,
    MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
    JWT_ACCESS_SECRET: VALID_JWT_ACCESS_SECRET,
  });

  assert.equal(result.jwtAccessTtl, '15m');
  assert.equal(result.refreshTokenTtlDays, 30);
  assert.equal(result.bcryptRounds, 12);
  assert.equal(result.passwordResetTtlMinutes, 30);
});

test('parseEnv accepts overrides for JWT_ACCESS_TTL, REFRESH_TOKEN_TTL_DAYS, and BCRYPT_ROUNDS', () => {
  const result = parseEnv({
    ...REQUIRED_EMAIL_ENV,
    MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
    JWT_ACCESS_SECRET: VALID_JWT_ACCESS_SECRET,
    JWT_ACCESS_TTL: '30m',
    REFRESH_TOKEN_TTL_DAYS: '7',
    BCRYPT_ROUNDS: '10',
    PASSWORD_RESET_TTL_MINUTES: '45',
  });

  assert.equal(result.jwtAccessTtl, '30m');
  assert.equal(result.refreshTokenTtlDays, 7);
  assert.equal(result.bcryptRounds, 10);
  assert.equal(result.passwordResetTtlMinutes, 45);
});

test('parseEnv rejects a BCRYPT_ROUNDS outside the allowed range', () => {
  assert.throws(() =>
    parseEnv({
      ...REQUIRED_EMAIL_ENV,
      MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
      JWT_ACCESS_SECRET: VALID_JWT_ACCESS_SECRET,
      BCRYPT_ROUNDS: '20',
    })
  );
});

test('parseEnv requires email provider configuration outside test mode', () => {
  assert.throws(
    () =>
      parseEnv({
        NODE_ENV: 'development',
        MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
        JWT_ACCESS_SECRET: VALID_JWT_ACCESS_SECRET,
      }),
    /RESEND_API_KEY|EMAIL_FROM|PASSWORD_RESET_URL/
  );
});

test('parseEnv validates reset URL safety and requires HTTPS in production', () => {
  for (const passwordResetUrl of [
    'ftp://example.com/reset',
    'https://user:pass@example.com/reset',
    'https://example.com/reset?next=evil',
    'https://example.com/reset#token=caller',
  ]) {
    assert.throws(() =>
      parseEnv({
        ...REQUIRED_EMAIL_ENV,
        PASSWORD_RESET_URL: passwordResetUrl,
        MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
        JWT_ACCESS_SECRET: VALID_JWT_ACCESS_SECRET,
      })
    );
  }

  assert.throws(() =>
    parseEnv({
      ...REQUIRED_EMAIL_ENV,
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
      JWT_ACCESS_SECRET: VALID_JWT_ACCESS_SECRET,
    })
  );
});

test('parseEnv constrains PASSWORD_RESET_TTL_MINUTES to 5..60', () => {
  for (const ttl of ['4', '61']) {
    assert.throws(() =>
      parseEnv({
        ...REQUIRED_EMAIL_ENV,
        MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
        JWT_ACCESS_SECRET: VALID_JWT_ACCESS_SECRET,
        PASSWORD_RESET_TTL_MINUTES: ttl,
      })
    );
  }
});
