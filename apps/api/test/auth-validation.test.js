const test = require('node:test');
const assert = require('node:assert/strict');

const {
  registerSchema,
  loginSchema,
  refreshSchema,
  changePasswordSchema,
} = require('../src/modules/auth/auth.validation');

test('registerSchema accepts a well-formed registration payload', () => {
  const result = registerSchema.safeParse({
    body: { name: 'Ada Lovelace', email: '  Ada@Example.com ', password: 'a-good-password' },
  });

  assert.equal(result.success, true);
  assert.equal(result.data.body.email, 'ada@example.com');
});

test('registerSchema rejects a caller-supplied role field', () => {
  const result = registerSchema.safeParse({
    body: { name: 'Ada', email: 'ada@example.com', password: 'a-good-password', role: 'admin' },
  });
  assert.equal(result.success, false);
});

test('registerSchema rejects caller-supplied status/passwordHash/authProviders fields', () => {
  const result = registerSchema.safeParse({
    body: {
      name: 'Ada',
      email: 'ada@example.com',
      password: 'a-good-password',
      status: 'active',
      passwordHash: 'fake',
      authProviders: ['local'],
    },
  });
  assert.equal(result.success, false);
});

test('registerSchema rejects a password shorter than 8 characters', () => {
  const result = registerSchema.safeParse({
    body: { name: 'Ada', email: 'ada@example.com', password: 'short' },
  });
  assert.equal(result.success, false);
});

test('registerSchema rejects a password whose UTF-8 byte length exceeds 72 bytes', () => {
  const result = registerSchema.safeParse({
    body: { name: 'Ada', email: 'ada@example.com', password: 'a'.repeat(73) },
  });
  assert.equal(result.success, false);
});

test('registerSchema accepts a password exactly at the 72-byte boundary', () => {
  const result = registerSchema.safeParse({
    body: { name: 'Ada', email: 'ada@example.com', password: 'a'.repeat(72) },
  });
  assert.equal(result.success, true);
});

test('registerSchema does not trim the password', () => {
  const result = registerSchema.safeParse({
    body: { name: 'Ada', email: 'ada@example.com', password: '  padded  ' },
  });
  assert.equal(result.success, true);
  assert.equal(result.data.body.password, '  padded  ');
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
  const result = changePassword({ currentPassword: 'old-password', newPassword: 'a-new-password' });
  assert.equal(result.success, true);
});

test('changePasswordSchema rejects a missing currentPassword', () => {
  assert.equal(changePassword({ newPassword: 'a-new-password' }).success, false);
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
    newPassword: 'a-new-password',
    confirmPassword: 'a-new-password',
  });
  assert.equal(result.success, false);
});

test('changePasswordSchema rejects an extra email field', () => {
  const result = changePassword({
    currentPassword: 'old-password',
    newPassword: 'a-new-password',
    email: 'admin@example.com',
  });
  assert.equal(result.success, false);
});

test('changePasswordSchema rejects an extra userId field', () => {
  const result = changePassword({
    currentPassword: 'old-password',
    newPassword: 'a-new-password',
    userId: '507f1f77bcf86cd799439011',
  });
  assert.equal(result.success, false);
});

test('changePasswordSchema rejects an extra role field', () => {
  const result = changePassword({
    currentPassword: 'old-password',
    newPassword: 'a-new-password',
    role: 'admin',
  });
  assert.equal(result.success, false);
});

test('changePasswordSchema rejects an empty currentPassword', () => {
  assert.equal(
    changePassword({ currentPassword: '', newPassword: 'a-new-password' }).success,
    false
  );
});

test('changePasswordSchema rejects a currentPassword over 72 UTF-8 bytes', () => {
  assert.equal(
    changePassword({ currentPassword: 'a'.repeat(73), newPassword: 'a-new-password' }).success,
    false
  );
});

test('changePasswordSchema accepts a currentPassword shorter than 8 chars (existing passwords may predate the minimum)', () => {
  assert.equal(
    changePassword({ currentPassword: 'short', newPassword: 'a-new-password' }).success,
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
    changePassword({ currentPassword: 'old-password', newPassword: 'a'.repeat(73) }).success,
    false
  );
});

test('changePasswordSchema accepts a newPassword exactly at the 72-byte boundary', () => {
  assert.equal(
    changePassword({ currentPassword: 'old-password', newPassword: 'a'.repeat(72) }).success,
    true
  );
});

test('changePasswordSchema does not trim either password and preserves a padded value', () => {
  const result = changePassword({ currentPassword: '  old  ', newPassword: '  padded value  ' });
  assert.equal(result.success, true);
  assert.equal(result.data.body.currentPassword, '  old  ');
  assert.equal(result.data.body.newPassword, '  padded value  ');
});
