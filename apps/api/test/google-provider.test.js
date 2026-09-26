process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createGoogleProvider } = require('../src/modules/auth/providers/google.provider');
const User = require('../src/modules/users/user.model');
const { EMAIL_MAX_CHARS } = require('@wecooked/contracts');

const VALID_NONCE = Buffer.alloc(32, 3).toString('base64url');
const VALID_PAYLOAD = {
  sub: 'google-subject-1',
  exp: 2_000_000_000,
  iat: 1_700_000_000,
  nonce: VALID_NONCE,
  email: '  ADA@Example.com ',
  email_verified: true,
  name: '  Ada\u0000   Lovelace  ',
};

function emailWithLength(length) {
  const email = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(
    length - 197
  )}.com`;
  assert.equal(email.length, length);
  return email;
}

function buildProvider({ payload = VALID_PAYLOAD, verifyError } = {}) {
  const captured = {};
  const fakeJwks = () => {};
  const jose = {
    createRemoteJWKSet(url, options) {
      captured.jwksCreateCount = (captured.jwksCreateCount || 0) + 1;
      captured.url = String(url);
      captured.jwksOptions = options;
      return fakeJwks;
    },
    async jwtVerify(token, jwks, options) {
      captured.token = token;
      captured.jwks = jwks;
      captured.verifyOptions = options;
      if (verifyError) throw verifyError;
      return { payload };
    },
  };
  return {
    captured,
    provider: createGoogleProvider({
      importJose: async () => jose,
      getConfig: () => ({ googleOAuthClientIds: ['android-client', 'ios-client'] }),
      now: () => 1_700_000_000_000,
    }),
  };
}

test('valid Google token is normalized and verifier uses fixed security configuration', async () => {
  const { provider, captured } = buildProvider();
  const identity = await provider.verifyGoogleIdToken({ idToken: 'signed.jwt.value' });

  assert.deepEqual(identity, {
    provider: 'google',
    subject: 'google-subject-1',
    email: 'ada@example.com',
    emailVerified: true,
    suggestedName: 'Ada Lovelace',
    verifiedNonce: VALID_NONCE,
  });
  assert.equal(captured.url, 'https://www.googleapis.com/oauth2/v3/certs');
  assert.deepEqual(captured.jwksOptions, {
    timeoutDuration: 3000,
    cooldownDuration: 30000,
    cacheMaxAge: 600000,
  });
  assert.equal(captured.token, 'signed.jwt.value');
  assert.deepEqual(captured.verifyOptions, {
    algorithms: ['RS256'],
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: ['android-client', 'ios-client'],
    clockTolerance: 60,
    requiredClaims: ['sub', 'exp', 'iat', 'nonce'],
  });
});

test('Google provider creates one remote JWKS resolver per provider instance', async () => {
  const { provider, captured } = buildProvider();
  await provider.verifyGoogleIdToken({ idToken: 'first' });
  const firstOptions = captured.jwksOptions;
  await provider.verifyGoogleIdToken({ idToken: 'second' });
  assert.equal(captured.jwksOptions, firstOptions);
  assert.equal(captured.jwksCreateCount, 1);
});

test('credential verification failures collapse to sanitized AUTH_SOCIAL_CREDENTIAL_INVALID', async () => {
  const scenarios = [
    ['wrong issuer', 'ERR_JWT_CLAIM_VALIDATION_FAILED'],
    ['wrong audience', 'ERR_JWT_CLAIM_VALIDATION_FAILED'],
    ['bad signature', 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED'],
    ['expired', 'ERR_JWT_EXPIRED'],
    ['nbf in the future', 'ERR_JWT_CLAIM_VALIDATION_FAILED'],
    ['missing exp', 'ERR_JWT_CLAIM_VALIDATION_FAILED'],
    ['missing iat', 'ERR_JWT_CLAIM_VALIDATION_FAILED'],
    ['unknown key', 'ERR_JWKS_NO_MATCHING_KEY'],
  ];
  for (const [scenario, code] of scenarios) {
    const raw = new Error(`sensitive ${scenario}`);
    raw.code = code;
    const { provider } = buildProvider({ verifyError: raw });
    await assert.rejects(() => provider.verifyGoogleIdToken({ idToken: 'secret-token' }), (error) => {
      assert.equal(error.statusCode, 401);
      assert.equal(error.code, 'AUTH_SOCIAL_CREDENTIAL_INVALID');
      assert.equal(error.message, 'Google credential is invalid or expired.');
      assert.equal(error.message.includes('sensitive'), false);
      assert.equal(error.message.includes('secret-token'), false);
      return true;
    });
  }
});

test('explicit subject, issued-at, and nonce checks reject malformed verified claims', async () => {
  const invalidPayloads = [
    { ...VALID_PAYLOAD, sub: undefined },
    { ...VALID_PAYLOAD, sub: '' },
    { ...VALID_PAYLOAD, sub: ' padded ' },
    { ...VALID_PAYLOAD, sub: 's'.repeat(256) },
    { ...VALID_PAYLOAD, iat: '1700000000' },
    { ...VALID_PAYLOAD, iat: 1_700_000_061 },
    { ...VALID_PAYLOAD, nonce: undefined },
    { ...VALID_PAYLOAD, nonce: 'not-a-wecooked-nonce' },
  ];
  for (const payload of invalidPayloads) {
    const { provider } = buildProvider({ payload });
    await assert.rejects(() => provider.verifyGoogleIdToken({ idToken: 'token' }), {
      code: 'AUTH_SOCIAL_CREDENTIAL_INVALID',
    });
  }
});

test('email verification requires literal true and a usable email without invalidating identity', async () => {
  for (const payload of [
    { ...VALID_PAYLOAD, email_verified: false },
    { ...VALID_PAYLOAD, email_verified: 'true' },
    { ...VALID_PAYLOAD, email: undefined },
    { ...VALID_PAYLOAD, email: 'not-an-email' },
  ]) {
    const { provider } = buildProvider({ payload });
    const identity = await provider.verifyGoogleIdToken({ idToken: 'token' });
    assert.equal(identity.email, null);
    assert.equal(identity.emailVerified, false);
  }
});

test('Google provider accepts and normalizes a valid email at the 254-character maximum', async () => {
  assert.equal(EMAIL_MAX_CHARS, 254);
  const email254 = emailWithLength(254);
  const { provider } = buildProvider({
    payload: { ...VALID_PAYLOAD, email: `  ${email254.toUpperCase()}  ` },
  });

  const identity = await provider.verifyGoogleIdToken({ idToken: 'token' });

  assert.equal(identity.email, email254);
  assert.equal(identity.email.length, 254);
  assert.equal(identity.emailVerified, true);
});

test('Google provider rejects a valid 255-character email before social provisioning', async () => {
  const email255 = emailWithLength(EMAIL_MAX_CHARS + 1);
  assert.equal(email255.length, 255);
  const { provider } = buildProvider({ payload: { ...VALID_PAYLOAD, email: email255 } });

  const identity = await provider.verifyGoogleIdToken({ idToken: 'token' });

  assert.equal(identity.email, null);
  assert.equal(identity.emailVerified, false);
});

test('Google-provider email acceptance matches the User model 254-character contract', async () => {
  const modelMaximum = User.schema.path('email').options.maxlength;
  assert.equal(modelMaximum, 254);
  assert.equal(modelMaximum, EMAIL_MAX_CHARS);

  const email254 = emailWithLength(254);
  const { provider } = buildProvider({ payload: { ...VALID_PAYLOAD, email: email254 } });
  const identity = await provider.verifyGoogleIdToken({ idToken: 'token' });
  const user = new User({ name: 'Ada', email: identity.email, passwordHash: 'hash' });

  await assert.doesNotReject(() => user.validate());
  assert.ok(identity.email.length <= modelMaximum);
});

test('suggested names are capped and fall back when sanitization leaves no name', async () => {
  const long = await buildProvider({ payload: { ...VALID_PAYLOAD, name: 'x'.repeat(101) } }).provider.verifyGoogleIdToken({ idToken: 'token' });
  assert.equal(long.suggestedName.length, 100);

  const fallback = await buildProvider({ payload: { ...VALID_PAYLOAD, name: '\u0000 \n' } }).provider.verifyGoogleIdToken({ idToken: 'token' });
  assert.equal(fallback.suggestedName, 'WeCooked User');
});

test('clear JWKS and network failures map to sanitized AUTH_PROVIDER_UNAVAILABLE', async () => {
  for (const raw of [Object.assign(new Error('timeout detail'), { code: 'ERR_JWKS_TIMEOUT' }), new TypeError('fetch failed')]) {
    const { provider } = buildProvider({ verifyError: raw });
    await assert.rejects(() => provider.verifyGoogleIdToken({ idToken: 'secret-token' }), (error) => {
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, 'AUTH_PROVIDER_UNAVAILABLE');
      assert.equal(error.message, 'Google authentication is temporarily unavailable.');
      assert.equal(error.message.includes('timeout detail'), false);
      return true;
    });
  }
});
