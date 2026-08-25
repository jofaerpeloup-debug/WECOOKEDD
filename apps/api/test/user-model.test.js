const test = require('node:test');
const assert = require('node:assert/strict');

const User = require('../src/modules/users/user.model');
const { toPublicUser } = require('../src/modules/users/user.serializer');

test('email is required, trimmed, lowercased, and uniquely indexed', () => {
  const emailPath = User.schema.path('email');
  assert.equal(emailPath.options.required, true);
  assert.equal(emailPath.options.trim, true);
  assert.equal(emailPath.options.lowercase, true);
  assert.equal(emailPath.options.unique, true);

  const emailIndex = User.schema.indexes().find(([spec]) => spec.email === 1);
  assert.ok(emailIndex, 'expected a unique index on email');
  assert.equal(emailIndex[1].unique, true);
});

test('passwordHash is excluded from the default query projection', () => {
  const path = User.schema.path('passwordHash');
  assert.equal(path.options.select, false);
});

test('passwordHash is required for a local-auth user (default authProviders)', async () => {
  const user = new User({ name: 'Ada', email: 'ada@example.com' });
  await assert.rejects(() => user.validate(), (err) => {
    assert.ok(err.errors.passwordHash, 'expected a passwordHash validation error');
    return true;
  });
});

test('passwordHash is required for an explicitly local-auth user', async () => {
  const user = new User({ name: 'Ada', email: 'ada@example.com', authProviders: ['local'] });
  await assert.rejects(() => user.validate());
});

test('passwordHash may be omitted for a Google-only user', async () => {
  const user = new User({ name: 'Ada', email: 'ada@example.com', authProviders: ['google'] });
  await assert.doesNotReject(() => user.validate());
});

test('a local-auth user with a passwordHash passes validation (unchanged registration behavior)', async () => {
  const user = new User({
    name: 'Ada',
    email: 'ada@example.com',
    authProviders: ['local'],
    passwordHash: 'a-bcrypt-hash',
  });
  await assert.doesNotReject(() => user.validate());
});

test('role defaults to "user" — public registration can never self-assign admin', () => {
  const user = new User({ name: 'Ada', email: 'ada@example.com', passwordHash: 'hash' });
  assert.equal(user.role, 'user');
});

test('status defaults to "active"', () => {
  const user = new User({ name: 'Ada', email: 'ada@example.com', passwordHash: 'hash' });
  assert.equal(user.status, 'active');
});

test('authProviders defaults to ["local"]', () => {
  const user = new User({ name: 'Ada', email: 'ada@example.com', passwordHash: 'hash' });
  assert.deepEqual(user.authProviders, ['local']);
});

test('preferences default to empty arrays with notifications enabled', () => {
  const user = new User({ name: 'Ada', email: 'ada@example.com', passwordHash: 'hash' });
  assert.deepEqual(user.preferences.dietaryPreferences, []);
  assert.deepEqual(user.preferences.allergies, []);
  assert.equal(user.preferences.notifications.enabled, true);
});

test('emailVerified defaults to false', () => {
  const user = new User({ name: 'Ada', email: 'ada@example.com', passwordHash: 'hash' });
  assert.equal(user.emailVerified, false);
});

test('toPublicUser exposes id (not _id) and hides passwordHash/__v', () => {
  const user = new User({ name: 'Ada', email: 'ada@example.com', passwordHash: 'super-secret-hash' });
  const publicUser = toPublicUser(user);

  assert.equal(publicUser.id, String(user._id));
  assert.equal(publicUser.name, 'Ada');
  assert.equal(publicUser.email, 'ada@example.com');
  assert.equal('passwordHash' in publicUser, false);
  assert.equal('_id' in publicUser, false);
  assert.equal('__v' in publicUser, false);
  assert.equal(JSON.stringify(publicUser).includes('super-secret-hash'), false);
});
