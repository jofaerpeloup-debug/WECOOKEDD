const test = require('node:test');
const assert = require('node:assert/strict');

const {
  registerSchema,
  loginSchema,
  refreshSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  socialChallengeSchema,
  googleSocialSchema,
  emailChangeSchema,
  emailChangeCancelSchema,
  emailChangeVerifySchema,
  deactivateSchema,
} = require('../src/modules/auth/auth.validation');
const {
  PASSWORD_ALLOWED_SPECIAL_CHARS,
  EMAIL_MAX_CHARS,
  utf8ByteLength,
} = require('@wecooked/contracts');

const VALID_NEW_PASSWORD = 'WeCooked2026!';
const TOKEN = 'A'.repeat(43);

function register(password, email = 'ada@example.com') {
  return registerSchema.safeParse({ body: { name: 'Ada', email, password } });
}

function emailWithLength(length) {
  const email = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(
    length - 197
  )}.com`;
  assert.equal(email.length, length);
  return email;
}

test('registerSchema accepts a well-formed registration payload', () => {
  const result = registerSchema.safeParse({
    body: { name: 'Ada Lovelace', email: '  Ada@Example.com ', password: VALID_NEW_PASSWORD },
  });

  assert.equal(result.success, true);
  assert.equal(result.data.body.email, 'ada@example.com');
});

test('registerSchema rejects caller-supplied moderator and admin roles', () => {
  for (const role of ['moderator', 'admin']) {
    const result = registerSchema.safeParse({
      body: { name: 'Ada', email: 'ada@example.com', password: VALID_NEW_PASSWORD, role },
    });
    assert.equal(result.success, false);
  }
});

test('registerSchema rejects caller-supplied auth internals including legacy authProviders', () => {
  for (const extra of [
    { status: 'active' },
    { passwordHash: 'fake' },
    { authIdentities: [{ provider: 'google', subject: 'attacker-controlled' }] },
    { authProviders: ['local'] },
  ]) {
    const result = registerSchema.safeParse({
      body: {
        name: 'Ada',
        email: 'ada@example.com',
        password: VALID_NEW_PASSWORD,
        ...extra,
      },
    });
    assert.equal(result.success, false, `expected ${JSON.stringify(extra)} to be rejected`);
  }
});

test('new-password policy enforces the 8-character minimum', () => {
  assert.equal(register('Aa1!bbb').success, false);
  assert.equal(register('Aa1!bbbb').success, true);
});

test('new-password policy requires uppercase, lowercase, digit, and approved special characters', () => {
  for (const password of ['password1!', 'PASSWORD1!', 'Password!', 'Password123']) {
    assert.equal(register(password).success, false, `expected ${password} to be rejected`);
  }
});

test('new-password policy accepts every approved special character', () => {
  assert.equal(PASSWORD_ALLOWED_SPECIAL_CHARS, '!@#$%&*?_-.');
  for (const special of PASSWORD_ALLOWED_SPECIAL_CHARS) {
    const password = `Aa1bbbbb${special}`;
    assert.equal(register(password).success, true, `expected ${special} to be accepted`);
  }
});

test('new-password policy rejects non-breaking, invisible, and control characters', () => {
  for (const password of [
    'We\u00a0Cooked2026!',
    'We\u200bCooked2026!',
    'We\rCooked2026!',
    'We\u0000Cooked2026!',
  ]) {
    assert.equal(register(password).success, false, `expected ${JSON.stringify(password)} to fail`);
  }
});

test('new-password policy rejects whitespace, emoji, and unsupported punctuation', () => {
  for (const password of [
    'We Cooked2026!',
    'We\tCooked2026!',
    'We\nCooked2026!',
    'Cooking2026!😀',
    'Cooking2026^',
    'Cooking2026+',
    'Cooking2026/',
  ]) {
    assert.equal(register(password).success, false, `expected ${JSON.stringify(password)} to fail`);
  }
});

test('new-password policy supports Unicode uppercase and lowercase letters', () => {
  for (const password of ['José#Recipe9', 'MañanaFood2!', 'ÉclairFood7?']) {
    assert.equal(register(password).success, true, `expected ${password} to be accepted`);
  }
});

test('new-password policy does not normalize Unicode input', () => {
  const composed = 'ÉclairFood7?';
  const decomposed = composed.normalize('NFD');
  assert.notEqual(decomposed, composed);
  assert.equal(register(composed).success, true);
  assert.equal(register(decomposed).success, false);
});

test('new-password policy measures its maximum in UTF-8 bytes', () => {
  const exactly72Bytes = `Áa1!${'b'.repeat(67)}`;
  const exactly73Bytes = `Áa1!${'b'.repeat(68)}`;
  assert.equal(utf8ByteLength(exactly72Bytes), 72);
  assert.equal(utf8ByteLength(exactly73Bytes), 73);
  assert.equal(register(exactly72Bytes).success, true);
  assert.equal(register(exactly73Bytes).success, false);
});

test('new-password policy never silently trims a password', () => {
  assert.equal(register('Aa1!bbbb').success, true);
  assert.equal(register(' Aa1!bbbb').success, false);
  assert.equal(register('Aa1!bbbb ').success, false);
});

test('loginSchema normalizes email and requires a non-empty password', () => {
  const valid = loginSchema.safeParse({ body: { email: 'Ada@Example.com', password: 'x' } });
  assert.equal(valid.success, true);
  assert.equal(valid.data.body.email, 'ada@example.com');

  const invalid = loginSchema.safeParse({ body: { email: 'ada@example.com', password: '' } });
  assert.equal(invalid.success, false);
});

test('loginSchema rejects a password whose UTF-8 byte length exceeds 72 bytes', () => {
  const result = loginSchema.safeParse({
    body: { email: 'ada@example.com', password: 'a'.repeat(73) },
  });
  assert.equal(result.success, false);
});

test('loginSchema accepts a password exactly at the 72-byte boundary', () => {
  const result = loginSchema.safeParse({
    body: { email: 'ada@example.com', password: 'a'.repeat(72) },
  });
  assert.equal(result.success, true);
});

test('loginSchema does not enforce the 8-character minimum (existing accounts may predate it)', () => {
  const result = loginSchema.safeParse({ body: { email: 'ada@example.com', password: 'short' } });
  assert.equal(result.success, true);
});

test('loginSchema remains legacy-compatible and does not require new-password composition', () => {
  for (const password of ['lowercase', 'UPPERCASE', 'Password', '12345678', 'has spaces']) {
    const result = loginSchema.safeParse({ body: { email: 'ada@example.com', password } });
    assert.equal(result.success, true, `expected ${JSON.stringify(password)} to pass`);
    assert.equal(result.data.body.password, password);
  }
});

test('refreshSchema requires a non-empty refreshToken', () => {
  const valid = refreshSchema.safeParse({ body: { refreshToken: 'some-token' } });
  assert.equal(valid.success, true);

  const invalid = refreshSchema.safeParse({ body: {} });
  assert.equal(invalid.success, false);
});

// ---------------------------------------------------------------------------
// changePasswordSchema — POST /api/v1/auth/change-password
// ---------------------------------------------------------------------------

const changePassword = (body) => changePasswordSchema.safeParse({ body });

test('changePasswordSchema accepts a well-formed { currentPassword, newPassword }', () => {
  const result = changePassword({ currentPassword: 'old-password', newPassword: VALID_NEW_PASSWORD });
  assert.equal(result.success, true);
});

test('changePasswordSchema rejects a missing currentPassword', () => {
  assert.equal(changePassword({ newPassword: VALID_NEW_PASSWORD }).success, false);
});

test('changePasswordSchema rejects a missing newPassword', () => {
  assert.equal(changePassword({ currentPassword: 'old-password' }).success, false);
});

test('changePasswordSchema rejects an empty body', () => {
  assert.equal(changePassword({}).success, false);
});

test('changePasswordSchema rejects an extra confirmPassword field', () => {
  const result = changePassword({
    currentPassword: 'old-password',
    newPassword: VALID_NEW_PASSWORD,
    confirmPassword: VALID_NEW_PASSWORD,
  });
  assert.equal(result.success, false);
});

test('changePasswordSchema rejects an extra email field', () => {
  const result = changePassword({
    currentPassword: 'old-password',
    newPassword: VALID_NEW_PASSWORD,
    email: 'admin@example.com',
  });
  assert.equal(result.success, false);
});

test('changePasswordSchema rejects an extra userId field', () => {
  const result = changePassword({
    currentPassword: 'old-password',
    newPassword: VALID_NEW_PASSWORD,
    userId: '507f1f77bcf86cd799439011',
  });
  assert.equal(result.success, false);
});

test('changePasswordSchema rejects an extra role field', () => {
  const result = changePassword({
    currentPassword: 'old-password',
    newPassword: VALID_NEW_PASSWORD,
    role: 'admin',
  });
  assert.equal(result.success, false);
});

test('changePasswordSchema rejects an empty currentPassword', () => {
  assert.equal(
    changePassword({ currentPassword: '', newPassword: VALID_NEW_PASSWORD }).success,
    false
  );
});

test('changePasswordSchema rejects a currentPassword over 72 UTF-8 bytes', () => {
  assert.equal(
    changePassword({ currentPassword: 'a'.repeat(73), newPassword: VALID_NEW_PASSWORD }).success,
    false
  );
});

test('changePasswordSchema accepts a currentPassword shorter than 8 chars (existing passwords may predate the minimum)', () => {
  assert.equal(
    changePassword({ currentPassword: 'short', newPassword: VALID_NEW_PASSWORD }).success,
    true
  );
});

test('changePasswordSchema rejects a newPassword shorter than 8 characters', () => {
  assert.equal(
    changePassword({ currentPassword: 'old-password', newPassword: '1234567' }).success,
    false
  );
});

test('changePasswordSchema rejects a newPassword over 72 UTF-8 bytes', () => {
  assert.equal(
    changePassword({ currentPassword: 'old-password', newPassword: `Aa1!${'b'.repeat(69)}` })
      .success,
    false
  );
});

test('changePasswordSchema accepts a newPassword exactly at the 72-byte boundary', () => {
  assert.equal(
    changePassword({ currentPassword: 'old-password', newPassword: `Aa1!${'b'.repeat(68)}` })
      .success,
    true
  );
});

test('changePasswordSchema preserves a padded current password but rejects a padded new password', () => {
  const currentOnly = changePassword({ currentPassword: '  old  ', newPassword: VALID_NEW_PASSWORD });
  assert.equal(currentOnly.success, true);
  assert.equal(currentOnly.data.body.currentPassword, '  old  ');
  assert.equal(
    changePassword({ currentPassword: 'old', newPassword: ` ${VALID_NEW_PASSWORD}` }).success,
    false
  );
});

test('forgotPasswordSchema normalizes email and rejects malformed/extra fields', () => {
  const valid = forgotPasswordSchema.safeParse({ body: { email: '  Ada@Example.com ' } });
  assert.equal(valid.success, true);
  assert.equal(valid.data.body.email, 'ada@example.com');
  assert.equal(forgotPasswordSchema.safeParse({ body: { email: 'not-email' } }).success, false);
  assert.equal(forgotPasswordSchema.safeParse({ body: {} }).success, false);
  assert.equal(
    forgotPasswordSchema.safeParse({ body: { email: 'ada@example.com', client: 'admin' } }).success,
    false
  );
});

test('email policy accepts common suffixes, rejects internal whitespace, and enforces 254 characters', () => {
  for (const email of [
    'user@example.com',
    'student@school.edu',
    'chef@company.org',
    'user@example.com.ph',
  ]) {
    assert.equal(register(VALID_NEW_PASSWORD, email).success, true, `expected ${email} to pass`);
  }
  assert.equal(register(VALID_NEW_PASSWORD, 'user @example.com').success, false);

  const maxEmail = emailWithLength(EMAIL_MAX_CHARS);
  assert.equal(register(VALID_NEW_PASSWORD, maxEmail).success, true);
  assert.equal(register(VALID_NEW_PASSWORD, emailWithLength(EMAIL_MAX_CHARS + 1)).success, false);
});

test('resetPasswordSchema enforces token shape, shared password policy, and a strict body', () => {
  const token = TOKEN;
  const valid = resetPasswordSchema.safeParse({ body: { token, newPassword: VALID_NEW_PASSWORD } });
  assert.equal(valid.success, true);
  assert.equal(resetPasswordSchema.safeParse({ body: { token: 'short', newPassword: VALID_NEW_PASSWORD } }).success, false);
  assert.equal(resetPasswordSchema.safeParse({ body: { token, newPassword: '1234567' } }).success, false);
  assert.equal(
    resetPasswordSchema.safeParse({ body: { token, newPassword: `Aa1!${'b'.repeat(69)}` } }).success,
    false
  );
  assert.equal(
    resetPasswordSchema.safeParse({ body: { token, newPassword: ` ${VALID_NEW_PASSWORD}` } }).success,
    false
  );
  assert.equal(
    resetPasswordSchema.safeParse({
      body: { token, newPassword: VALID_NEW_PASSWORD, confirmPassword: VALID_NEW_PASSWORD },
    }).success,
    false
  );
});

test('verifyEmailSchema enforces the token shape and a strict body', () => {
  const token = 'A'.repeat(43);
  assert.equal(verifyEmailSchema.safeParse({ body: { token } }).success, true);
  assert.equal(verifyEmailSchema.safeParse({ body: { token: 'short' } }).success, false);
  assert.equal(
    verifyEmailSchema.safeParse({ body: { token, userId: 'attacker-controlled' } }).success,
    false
  );
});

test('resendVerificationSchema normalizes email and enforces a strict body', () => {
  const valid = resendVerificationSchema.safeParse({ body: { email: '  Ada@Example.com ' } });
  assert.equal(valid.success, true);
  assert.equal(valid.data.body.email, 'ada@example.com');
  assert.equal(resendVerificationSchema.safeParse({ body: { email: 'not-an-email' } }).success, false);
  assert.equal(
    resendVerificationSchema.safeParse({ body: { email: 'ada@example.com', client: 'admin' } })
      .success,
    false
  );
});

test('socialChallengeSchema accepts only the strict Google provider body', () => {
  assert.equal(socialChallengeSchema.safeParse({ body: { provider: 'google' } }).success, true);
  assert.equal(socialChallengeSchema.safeParse({ body: { provider: 'apple' } }).success, false);
  assert.equal(
    socialChallengeSchema.safeParse({ body: { provider: 'google', nonce: 'caller-value' } }).success,
    false
  );
});

test('googleSocialSchema accepts only an unmodified bounded token and valid challenge id', () => {
  const challengeId = '507f1f77bcf86cd799439011';
  const token = '  signed-token-with-spaces  ';
  const valid = googleSocialSchema.safeParse({ body: { idToken: token, challengeId } });
  assert.equal(valid.success, true);
  assert.equal(valid.data.body.idToken, token);
  assert.equal(googleSocialSchema.safeParse({ body: { idToken: '', challengeId } }).success, false);
  assert.equal(
    googleSocialSchema.safeParse({ body: { idToken: 'x'.repeat(8193), challengeId } }).success,
    false
  );
  assert.equal(
    googleSocialSchema.safeParse({ body: { idToken: 'token', challengeId: 'bad-id' } }).success,
    false
  );
});

test('googleSocialSchema rejects every caller-controlled identity and policy field', () => {
  const base = { idToken: 'token', challengeId: '507f1f77bcf86cd799439011' };
  for (const key of [
    'email',
    'name',
    'sub',
    'userId',
    'role',
    'status',
    'clientId',
    'audience',
    'nonce',
  ]) {
    assert.equal(
      googleSocialSchema.safeParse({ body: { ...base, [key]: 'attacker-controlled' } }).success,
      false,
      `expected ${key} to be rejected`
    );
  }
});

test('ACCOUNT2 auth bodies are exact and normalize new email', () => {
  const request = emailChangeSchema.safeParse({
    body: { newEmail: ' NEW@Example.com ', currentPassword: 'legacy' },
  });
  assert.equal(request.success, true);
  assert.equal(request.data.body.newEmail, 'new@example.com');
  assert.equal(emailChangeSchema.safeParse({ body: { newEmail: 'new@example.com', currentPassword: 'legacy', userId: 'x' } }).success, false);
  assert.equal(emailChangeCancelSchema.safeParse({ body: {} }).success, true);
  assert.equal(emailChangeCancelSchema.safeParse({ body: { userId: 'x' } }).success, false);
  assert.equal(emailChangeVerifySchema.safeParse({ body: { token: TOKEN } }).success, true);
  assert.equal(emailChangeVerifySchema.safeParse({ body: { token: 'bad' } }).success, true);
  assert.equal(emailChangeVerifySchema.safeParse({ body: {} }).success, true);
  assert.equal(emailChangeVerifySchema.safeParse({ body: { token: TOKEN, userId: 'x' } }).success, false);
  assert.equal(deactivateSchema.safeParse({ body: { confirmation: 'DEACTIVATE' } }).success, true);
  assert.equal(deactivateSchema.safeParse({ body: { confirmation: 'deactivate' } }).success, false);
});
