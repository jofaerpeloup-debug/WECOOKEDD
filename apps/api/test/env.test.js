const test = require('node:test');
const assert = require('node:assert/strict');

const { parseEnv } = require('../src/config/env');

const VALID_JWT_ACCESS_SECRET = 'a'.repeat(32);
const REQUIRED_EMAIL_ENV = {
  RESEND_API_KEY: 'test-resend-key',
  EMAIL_FROM: 'WeCooked <no-reply@example.com>',
  PASSWORD_RESET_URL: 'http://localhost:5173/reset-password',
  EMAIL_VERIFICATION_URL: 'http://localhost:5173/verify-email',
  GOOGLE_OAUTH_CLIENT_IDS: 'test-web-client-1.apps.googleusercontent.com',
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
  assert.deepEqual(result.googleOAuthClientIds, [
    'test-google-client-id.apps.googleusercontent.com',
  ]);
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
  assert.equal(result.emailVerificationTtlMinutes, 1440);
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
    EMAIL_VERIFICATION_TTL_MINUTES: '2880',
  });

  assert.equal(result.jwtAccessTtl, '30m');
  assert.equal(result.refreshTokenTtlDays, 7);
  assert.equal(result.bcryptRounds, 10);
  assert.equal(result.passwordResetTtlMinutes, 45);
  assert.equal(result.emailVerificationTtlMinutes, 2880);
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

test('parseEnv accepts the wecooked:// mobile deep-link scheme for PASSWORD_RESET_URL and EMAIL_VERIFICATION_URL, in development', () => {
  const result = parseEnv({
    ...REQUIRED_EMAIL_ENV,
    MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
    JWT_ACCESS_SECRET: VALID_JWT_ACCESS_SECRET,
    PASSWORD_RESET_URL: 'wecooked://reset-password',
    EMAIL_VERIFICATION_URL: 'wecooked://verify-email',
  });

  assert.equal(result.passwordResetUrl, 'wecooked://reset-password');
  assert.equal(result.emailVerificationUrl, 'wecooked://verify-email');
});

test('parseEnv still accepts plain https for PASSWORD_RESET_URL and EMAIL_VERIFICATION_URL', () => {
  const result = parseEnv({
    ...REQUIRED_EMAIL_ENV,
    MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
    JWT_ACCESS_SECRET: VALID_JWT_ACCESS_SECRET,
    PASSWORD_RESET_URL: 'https://example.com/reset-password',
    EMAIL_VERIFICATION_URL: 'https://example.com/verify-email',
  });

  assert.equal(result.passwordResetUrl, 'https://example.com/reset-password');
  assert.equal(result.emailVerificationUrl, 'https://example.com/verify-email');
});

test('parseEnv rejects an arbitrary custom scheme — only http, https, and wecooked are allowed', () => {
  for (const url of ['myapp://verify-email', 'ftp://example.com/verify-email', 'file:///etc/passwd']) {
    assert.throws(
      () =>
        parseEnv({
          ...REQUIRED_EMAIL_ENV,
          MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
          JWT_ACCESS_SECRET: VALID_JWT_ACCESS_SECRET,
          EMAIL_VERIFICATION_URL: url,
        }),
      /must use http, https, or the wecooked mobile scheme/
    );
    assert.throws(
      () =>
        parseEnv({
          ...REQUIRED_EMAIL_ENV,
          MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
          JWT_ACCESS_SECRET: VALID_JWT_ACCESS_SECRET,
          PASSWORD_RESET_URL: url,
        }),
      /must use http, https, or the wecooked mobile scheme/
    );
  }
});

test('parseEnv still rejects credentials/query/fragment on a wecooked:// base URL', () => {
  for (const url of [
    'wecooked://user:pass@verify-email',
    'wecooked://verify-email?next=evil',
    'wecooked://verify-email#token=caller',
  ]) {
    assert.throws(
      () =>
        parseEnv({
          ...REQUIRED_EMAIL_ENV,
          MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
          JWT_ACCESS_SECRET: VALID_JWT_ACCESS_SECRET,
          EMAIL_VERIFICATION_URL: url,
        }),
      /must not contain credentials, a query, or a fragment/
    );
  }
});

test('parseEnv accepts the wecooked:// scheme in production without requiring https, but still rejects plain http', () => {
  const result = parseEnv({
    ...REQUIRED_EMAIL_ENV,
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
    JWT_ACCESS_SECRET: VALID_JWT_ACCESS_SECRET,
    PASSWORD_RESET_URL: 'wecooked://reset-password',
    EMAIL_VERIFICATION_URL: 'wecooked://verify-email',
  });
  assert.equal(result.passwordResetUrl, 'wecooked://reset-password');
  assert.equal(result.emailVerificationUrl, 'wecooked://verify-email');

  // Plain http (as opposed to wecooked or https) is still rejected in production.
  assert.throws(
    () =>
      parseEnv({
        ...REQUIRED_EMAIL_ENV,
        NODE_ENV: 'production',
        MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
        JWT_ACCESS_SECRET: VALID_JWT_ACCESS_SECRET,
        PASSWORD_RESET_URL: 'https://example.com/reset-password',
        EMAIL_VERIFICATION_URL: 'http://example.com/verify-email',
      }),
    /EMAIL_VERIFICATION_URL must use https \(or the wecooked mobile scheme\) in production/
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

test('parseEnv constrains EMAIL_VERIFICATION_TTL_MINUTES to 5..10080', () => {
  for (const ttl of ['4', '10081']) {
    assert.throws(() =>
      parseEnv({
        ...REQUIRED_EMAIL_ENV,
        MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
        JWT_ACCESS_SECRET: VALID_JWT_ACCESS_SECRET,
        EMAIL_VERIFICATION_TTL_MINUTES: ttl,
      })
    );
  }
});

test('parseEnv validates verification URL safety and requires HTTPS in production', () => {
  for (const emailVerificationUrl of [
    'ftp://example.com/verify-email',
    'https://user:pass@example.com/verify-email',
    'https://example.com/verify-email?next=evil',
    'https://example.com/verify-email#token=caller',
  ]) {
    assert.throws(() =>
      parseEnv({
        ...REQUIRED_EMAIL_ENV,
        EMAIL_VERIFICATION_URL: emailVerificationUrl,
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
      PASSWORD_RESET_URL: 'https://example.com/reset-password',
    })
  );
});

test('parseEnv trims, removes empty Google client IDs, and deduplicates the server allow-list', () => {
  const result = parseEnv({
    ...REQUIRED_EMAIL_ENV,
    GOOGLE_OAUTH_CLIENT_IDS:
      ' test-web-client-1.apps.googleusercontent.com ,test-web-client-2.apps.googleusercontent.com,,test-web-client-1.apps.googleusercontent.com, ',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
    JWT_ACCESS_SECRET: VALID_JWT_ACCESS_SECRET,
  });
  assert.deepEqual(result.googleOAuthClientIds, [
    'test-web-client-1.apps.googleusercontent.com',
    'test-web-client-2.apps.googleusercontent.com',
  ]);
  assert.equal('googleClientSecret' in result, false);
});

test('parseEnv requires at least one Google OAuth client ID outside test mode', () => {
  assert.throws(
    () =>
      parseEnv({
        ...REQUIRED_EMAIL_ENV,
        GOOGLE_OAUTH_CLIENT_IDS: ' , , ',
        MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
        JWT_ACCESS_SECRET: VALID_JWT_ACCESS_SECRET,
      }),
    /GOOGLE_OAUTH_CLIENT_IDS/
  );

  const missing = { ...REQUIRED_EMAIL_ENV };
  delete missing.GOOGLE_OAUTH_CLIENT_IDS;
  assert.throws(
    () =>
      parseEnv({
        ...missing,
        MONGODB_URI: 'mongodb://127.0.0.1:27017/wecooked_test',
        JWT_ACCESS_SECRET: VALID_JWT_ACCESS_SECRET,
      }),
    /GOOGLE_OAUTH_CLIENT_IDS/
  );
});
