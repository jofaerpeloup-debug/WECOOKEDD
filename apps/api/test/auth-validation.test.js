const test = require('node:test');
const assert = require('node:assert/strict');

const { registerSchema, loginSchema, refreshSchema } = require('../src/modules/auth/auth.validation');

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
