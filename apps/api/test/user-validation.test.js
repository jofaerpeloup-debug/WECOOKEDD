process.env.NODE_ENV = 'test';
process.env.PORT = '4031';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');

const { listUsersSchema, updateUserSchema } = require('../src/modules/users/user.validation');

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

test('updateUserSchema accepts a role-only body', () => {
  const result = parsePatch(VALID_ID, { role: 'admin' });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.body, { role: 'admin' });
});

test('updateUserSchema accepts a status-only body', () => {
  const result = parsePatch(VALID_ID, { status: 'suspended' });
  assert.equal(result.success, true);
});

test('updateUserSchema accepts a combined role + status body', () => {
  const result = parsePatch(VALID_ID, { role: 'user', status: 'active' });
  assert.equal(result.success, true);
});

test('updateUserSchema rejects an empty body', () => {
  const result = parsePatch(VALID_ID, {});
  assert.equal(result.success, false);
});

test('updateUserSchema rejects a malformed ObjectId path param', () => {
  const result = parsePatch('not-an-object-id', { role: 'admin' });
  assert.equal(result.success, false);
});

test('updateUserSchema rejects every non-allowed body field', () => {
  for (const body of [
    { name: 'Mallory' },
    { email: 'mallory@example.com' },
    { password: 'hunter2hunter2' },
    { passwordHash: '$2b$10$abc' },
    { emailVerified: true },
    { preferences: { allergies: [] } },
    { allergies: ['peanuts'] },
    { authProviders: ['google'] },
    { createdAt: '2020-01-01' },
    { updatedAt: '2020-01-01' },
    { _id: VALID_ID },
    { id: VALID_ID },
    { role: 'admin', extra: 1 },
  ]) {
    const result = parsePatch(VALID_ID, body);
    assert.equal(result.success, false, `expected ${JSON.stringify(body)} to be rejected`);
  }
});

test('updateUserSchema rejects a role/status value outside the enum', () => {
  assert.equal(parsePatch(VALID_ID, { role: 'root' }).success, false);
  assert.equal(parsePatch(VALID_ID, { status: 'deleted' }).success, false);
});
