process.env.NODE_ENV = 'test';
process.env.PORT = '4031';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  listUsersSchema,
  updateUserSchema,
  updateCurrentUserSchema,
} = require('../src/modules/users/user.validation');

const VALID_ID = '507f1f77bcf86cd799439011';

function parseQuery(query) {
  return listUsersSchema.safeParse({ query });
}

function parsePatch(userId, body) {
  return updateUserSchema.safeParse({ params: { userId }, body });
}

// ---------------------------------------------------------------------------
// listUsersSchema
// ---------------------------------------------------------------------------

test('listUsersSchema applies sensible defaults for an empty query', () => {
  const result = parseQuery({});
  assert.equal(result.success, true);
  assert.deepEqual(result.data.query, { sort: 'newest', page: 1, limit: 20 });
});

test('listUsersSchema coerces and accepts a full valid query', () => {
  const result = parseQuery({
    search: '  ada  ',
    role: 'admin',
    status: 'suspended',
    sort: 'nameAsc',
    page: '3',
    limit: '50',
  });
  assert.equal(result.success, true);
  assert.equal(result.data.query.search, 'ada'); // trimmed
  assert.equal(result.data.query.page, 3);
  assert.equal(result.data.query.limit, 50);
});

test('listUsersSchema rejects an unknown query param (strict)', () => {
  const result = parseQuery({ isActive: 'true' });
  assert.equal(result.success, false);
});

test('listUsersSchema rejects a role outside the User role enum', () => {
  const result = parseQuery({ role: 'superadmin' });
  assert.equal(result.success, false);
});

test('listUsersSchema rejects a status outside the User status enum', () => {
  const result = parseQuery({ status: 'inactive' });
  assert.equal(result.success, false);
});

test('listUsersSchema rejects a sort value outside the allow-list', () => {
  const result = parseQuery({ sort: 'createdAt' });
  assert.equal(result.success, false);
});

test('listUsersSchema rejects page < 1 and non-integer page', () => {
  assert.equal(parseQuery({ page: '0' }).success, false);
  assert.equal(parseQuery({ page: '1.5' }).success, false);
  assert.equal(parseQuery({ page: 'abc' }).success, false);
});

test('listUsersSchema enforces the maximum limit of 100', () => {
  assert.equal(parseQuery({ limit: '100' }).success, true);
  assert.equal(parseQuery({ limit: '101' }).success, false);
  assert.equal(parseQuery({ limit: '0' }).success, false);
});

test('listUsersSchema rejects an empty (whitespace-only) search', () => {
  const result = parseQuery({ search: '   ' });
  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// updateUserSchema
// ---------------------------------------------------------------------------

test('updateUserSchema accepts a status-only active body', () => {
  const result = parsePatch(VALID_ID, { status: 'active' });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.body, { status: 'active' });
});

test('updateUserSchema accepts a status-only suspended body and parses to status only', () => {
  const result = parsePatch(VALID_ID, { status: 'suspended' });
  assert.equal(result.success, true);
  assert.deepEqual(Object.keys(result.data.body), ['status']);
  assert.deepEqual(result.data.body, { status: 'suspended' });
});

test('updateUserSchema rejects a role-only body (role is not a writable field)', () => {
  assert.equal(parsePatch(VALID_ID, { role: 'admin' }).success, false);
  assert.equal(parsePatch(VALID_ID, { role: 'user' }).success, false);
});

test('updateUserSchema rejects a combined role + status body (role key fails .strict())', () => {
  const result = parsePatch(VALID_ID, { role: 'admin', status: 'suspended' });
  assert.equal(result.success, false);
});

test('updateUserSchema rejects an empty body (status is required)', () => {
  const result = parsePatch(VALID_ID, {});
  assert.equal(result.success, false);
});

test('updateUserSchema rejects a malformed ObjectId path param', () => {
  const result = parsePatch('not-an-object-id', { status: 'active' });
  assert.equal(result.success, false);
});

test('updateUserSchema rejects every non-allowed body field', () => {
  for (const body of [
    { role: 'admin' },
    { role: 'user' },
    { name: 'Mallory' },
    { email: 'mallory@example.com' },
    { password: 'hunter2hunter2' },
    { passwordHash: '$2b$10$abc' },
    { emailVerified: true },
    { preferences: { allergies: [] } },
    { allergies: ['peanuts'] },
    { authIdentities: [{ provider: 'google', subject: 'attacker-controlled' }] },
    { authProviders: ['google'] },
    { createdAt: '2020-01-01' },
    { updatedAt: '2020-01-01' },
    { _id: VALID_ID },
    { id: VALID_ID },
    { status: 'active', extra: 1 },
    { status: 'suspended', role: 'admin' },
  ]) {
    const result = parsePatch(VALID_ID, body);
    assert.equal(result.success, false, `expected ${JSON.stringify(body)} to be rejected`);
  }
});

test('updateUserSchema rejects a status value outside the enum', () => {
  assert.equal(parsePatch(VALID_ID, { status: 'deleted' }).success, false);
  assert.equal(parsePatch(VALID_ID, { status: 'inactive' }).success, false);
});
// ---------------------------------------------------------------------------
// updateCurrentUserSchema  (PATCH /api/v1/users/me — self-profile)
// ---------------------------------------------------------------------------

function parseSelf(body) {
  // The validate middleware always hands the schema { body, params, query }.
  return updateCurrentUserSchema.safeParse({ body, params: {}, query: {} });
}

test('updateCurrentUserSchema accepts a name-only body and trims it', () => {
  const result = parseSelf({ name: '  Ada Lovelace  ' });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.body, { name: 'Ada Lovelace' });
});

test('updateCurrentUserSchema preserves internal whitespace in name', () => {
  const result = parseSelf({ name: 'Mary  Jane' });
  assert.equal(result.success, true);
  assert.equal(result.data.body.name, 'Mary  Jane');
});

test('updateCurrentUserSchema rejects empty / whitespace / oversized / non-string name', () => {
  assert.equal(parseSelf({ name: '' }).success, false);
  assert.equal(parseSelf({ name: '   ' }).success, false);
  assert.equal(parseSelf({ name: 'x'.repeat(101) }).success, false);
  assert.equal(parseSelf({ name: 123 }).success, false);
  assert.equal(parseSelf({ name: ['Ada'] }).success, false);
  assert.equal(parseSelf({ name: null }).success, false);
});

test('updateCurrentUserSchema accepts a name of exactly 100 characters', () => {
  assert.equal(parseSelf({ name: 'x'.repeat(100) }).success, true);
});

test('updateCurrentUserSchema accepts each preferences field individually', () => {
  assert.equal(parseSelf({ preferences: { dietaryPreferences: ['Vegan'] } }).success, true);
  assert.equal(parseSelf({ preferences: { allergies: ['Peanuts'] } }).success, true);
  assert.equal(parseSelf({ preferences: { notifications: { enabled: true } } }).success, true);
  assert.equal(parseSelf({ preferences: { notifications: { enabled: false } } }).success, true);
});

test('updateCurrentUserSchema accepts a combined name + full preferences body', () => {
  const result = parseSelf({
    name: 'Ada',
    preferences: {
      dietaryPreferences: ['Vegetarian'],
      allergies: ['Shellfish'],
      notifications: { enabled: false },
    },
  });
  assert.equal(result.success, true);
});

test('updateCurrentUserSchema trims preference entries', () => {
  const result = parseSelf({ preferences: { allergies: ['  Peanuts  '] } });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.body.preferences.allergies, ['Peanuts']);
});

test('updateCurrentUserSchema keeps duplicate preference entries as-is (no dedupe)', () => {
  const result = parseSelf({ preferences: { dietaryPreferences: ['Vegan', 'Vegan', 'vegan'] } });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.body.preferences.dietaryPreferences, ['Vegan', 'Vegan', 'vegan']);
});

test('updateCurrentUserSchema accepts empty preference arrays (clear semantics)', () => {
  assert.equal(parseSelf({ preferences: { allergies: [] } }).success, true);
  assert.equal(parseSelf({ preferences: { dietaryPreferences: [] } }).success, true);
});

test('updateCurrentUserSchema enforces the 20-entry array cap', () => {
  assert.equal(parseSelf({ preferences: { allergies: Array(20).fill('x') } }).success, true);
  assert.equal(parseSelf({ preferences: { allergies: Array(21).fill('x') } }).success, false);
  assert.equal(parseSelf({ preferences: { dietaryPreferences: Array(21).fill('x') } }).success, false);
});

test('updateCurrentUserSchema enforces the 50-character entry cap', () => {
  assert.equal(parseSelf({ preferences: { allergies: ['x'.repeat(50)] } }).success, true);
  assert.equal(parseSelf({ preferences: { allergies: ['x'.repeat(51)] } }).success, false);
});

test('updateCurrentUserSchema rejects empty / whitespace-only preference entries', () => {
  assert.equal(parseSelf({ preferences: { allergies: [''] } }).success, false);
  assert.equal(parseSelf({ preferences: { allergies: ['   '] } }).success, false);
  assert.equal(parseSelf({ preferences: { allergies: ['ok', ''] } }).success, false);
});

test('updateCurrentUserSchema rejects non-string preference entries', () => {
  assert.equal(parseSelf({ preferences: { allergies: [1, 2] } }).success, false);
  assert.equal(parseSelf({ preferences: { dietaryPreferences: [{}] } }).success, false);
});

test('updateCurrentUserSchema rejects structural no-op bodies', () => {
  assert.equal(parseSelf({}).success, false);
  assert.equal(parseSelf({ preferences: {} }).success, false);
  assert.equal(parseSelf({ preferences: { notifications: {} } }).success, false);
});

test('updateCurrentUserSchema requires notifications.enabled to be a boolean when present', () => {
  assert.equal(parseSelf({ preferences: { notifications: {} } }).success, false);
  assert.equal(parseSelf({ preferences: { notifications: { enabled: 'yes' } } }).success, false);
  assert.equal(parseSelf({ preferences: { notifications: { enabled: 1 } } }).success, false);
});

test('updateCurrentUserSchema rejects every non-allowed / admin-managed field', () => {
  for (const body of [
    { role: 'admin' },
    { status: 'active' },
    { email: 'x@example.com' },
    { emailVerified: true },
    { passwordHash: '$2b$10$x' },
    { password: 'hunter2hunter2' },
    { authIdentities: [{ provider: 'google', subject: 'attacker-controlled' }] },
    { authProviders: ['google'] },
    { _id: VALID_ID },
    { id: VALID_ID },
    { createdAt: '2020-01-01' },
    { updatedAt: '2020-01-01' },
    { name: 'Ada', extra: 1 },
  ]) {
    assert.equal(parseSelf(body).success, false, `expected ${JSON.stringify(body)} rejected`);
  }
});

test('updateCurrentUserSchema rejects unknown nested preference / notifications keys', () => {
  assert.equal(parseSelf({ preferences: { theme: 'dark' } }).success, false);
  assert.equal(parseSelf({ preferences: { dietaryPreferences: ['x'], foo: 1 } }).success, false);
  assert.equal(parseSelf({ preferences: { notifications: { enabled: true, push: true } } }).success, false);
});

test('updateCurrentUserSchema rejects Mongo-operator and prototype-pollution shapes', () => {
  assert.equal(parseSelf({ $set: { role: 'admin' } }).success, false);
  assert.equal(parseSelf({ preferences: { $set: {} } }).success, false);
  assert.equal(parseSelf({ preferences: { notifications: { $set: true } } }).success, false);
  assert.equal(parseSelf({ name: { $ne: null } }).success, false);
  assert.equal(parseSelf(JSON.parse('{"__proto__":{"role":"admin"}}')).success, false);
});

