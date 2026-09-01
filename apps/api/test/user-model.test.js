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

test('password reset credentials are hidden and the digest has a unique sparse index without TTL', () => {
  assert.equal(User.schema.path('passwordResetTokenHash').options.select, false);
  assert.equal(User.schema.path('passwordResetExpiresAt').options.select, false);

  const indexes = User.schema.indexes();
  const digestIndex = indexes.find(([spec]) => spec.passwordResetTokenHash === 1);
  assert.ok(digestIndex);
  assert.equal(digestIndex[1].unique, true);
  assert.equal(digestIndex[1].sparse, true);

  const expiryIndex = indexes.find(([spec]) => spec.passwordResetExpiresAt === 1);
  assert.equal(expiryIndex, undefined, 'reset expiry must never be a TTL index on User');
});

test('authProviders is removed and authIdentities defaults to an empty array', () => {
  const user = new User({ name: 'Ada', email: 'ada@example.com', passwordHash: 'hash' });

  assert.equal(User.schema.path('authProviders'), undefined);
  assert.equal(User.AUTH_PROVIDERS, undefined);
  assert.deepEqual(user.authIdentities, []);
});

test('a new user with neither a usable passwordHash nor an authIdentity is rejected', async () => {
  const user = new User({ name: 'Ada', email: 'ada@example.com' });
  await assert.rejects(() => user.validate(), (err) => {
    assert.ok(err.errors.passwordHash, 'expected a passwordHash validation error');
    return true;
  });
});

test('a new user with null authIdentities fails validation without throwing a TypeError', async () => {
  const user = new User({
    name: 'Ada',
    email: 'ada@example.com',
    authIdentities: null,
  });

  await assert.rejects(() => user.validate(), (err) => {
    assert.equal(err.name, 'ValidationError');
    assert.equal(err instanceof TypeError, false);
    assert.ok(err.errors.passwordHash, 'expected the missing authentication method to be rejected');
    return true;
  });
});

test('a local passwordHash-bearing user passes validation', async () => {
  const user = new User({
    name: 'Ada',
    email: 'ada@example.com',
    passwordHash: 'a-bcrypt-hash',
  });
  await assert.doesNotReject(() => user.validate());
});

test('a social-only user may omit passwordHash and no password is synthesized', async () => {
  const user = new User({
    name: 'Ada',
    email: 'ada@example.com',
    authIdentities: [{ provider: 'google', subject: 'google-subject' }],
  });

  await assert.doesNotReject(() => user.validate());
  assert.equal(user.passwordHash, undefined);
  assert.equal(user.authIdentities[0].linkedAt instanceof Date, true);
});

test('a whitespace-only passwordHash is not a usable local capability', async () => {
  const user = new User({
    name: 'Ada',
    email: 'ada@example.com',
    passwordHash: '   ',
  });

  await assert.rejects(() => user.validate(), (err) => {
    assert.ok(err.errors.passwordHash);
    return true;
  });
});

test('auth identity provider is restricted to google, apple, and facebook', async () => {
  for (const provider of ['local', 'github']) {
    const user = new User({
      name: 'Ada',
      email: `${provider}@example.com`,
      authIdentities: [{ provider, subject: 'subject' }],
    });
    await assert.rejects(() => user.validate(), (err) => {
      assert.ok(err.errors['authIdentities.0.provider']);
      return true;
    });
  }
});

test('auth identity subject is required, trimmed, nonempty, and capped at 255 characters', async () => {
  for (const subject of [undefined, '', '   ', 'x'.repeat(256)]) {
    const user = new User({
      name: 'Ada',
      email: 'ada@example.com',
      authIdentities: [{ provider: 'google', subject }],
    });
    await assert.rejects(() => user.validate());
  }

  const valid = new User({
    name: 'Ada',
    email: 'ada@example.com',
    authIdentities: [{ provider: 'google', subject: '  stable-subject  ' }],
  });
  await valid.validate();
  assert.equal(valid.authIdentities[0].subject, 'stable-subject');
});

test('one User cannot contain the same provider twice, even with different subjects', async () => {
  for (const subjects of [
    ['same', 'same'],
    ['first', 'second'],
  ]) {
    const user = new User({
      name: 'Ada',
      email: 'ada@example.com',
      authIdentities: subjects.map((subject) => ({ provider: 'google', subject })),
    });
    await assert.rejects(() => user.validate(), (err) => {
      assert.ok(err.errors.authIdentities);
      return true;
    });
  }
});

test('one User may contain identities from different providers', async () => {
  const user = new User({
    name: 'Ada',
    email: 'ada@example.com',
    authIdentities: [
      { provider: 'google', subject: 'google-subject' },
      { provider: 'apple', subject: 'apple-subject' },
    ],
  });
  await assert.doesNotReject(() => user.validate());
});

test('the User schema does not declare the migration-owned auth identity index', () => {
  const indexes = User.schema.indexes();
  const namedIdentityIndex = indexes.find(
    ([, options]) => options.name === 'uniq_auth_identity_provider_subject'
  );
  const compoundIdentityIndex = indexes.find(([spec]) => {
    return spec['authIdentities.provider'] === 1 && spec['authIdentities.subject'] === 1;
  });

  assert.equal(namedIdentityIndex, undefined);
  assert.equal(compoundIdentityIndex, undefined);
});

test('a hydrated legacy local user is not invalid merely because passwordHash was not selected', async () => {
  const user = User.hydrate({
    _id: new User()._id,
    name: 'Ada',
    email: 'ada@example.com',
    authProviders: ['local'],
  });

  assert.equal(user.isNew, false);
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

test('toPublicUser exposes id and hides passwordHash/authIdentities/__v', () => {
  const user = new User({
    name: 'Ada',
    email: 'ada@example.com',
    passwordHash: 'super-secret-hash',
    authIdentities: [{ provider: 'google', subject: 'private-subject' }],
  });
  const publicUser = toPublicUser(user);

  assert.equal(publicUser.id, String(user._id));
  assert.equal(publicUser.name, 'Ada');
  assert.equal(publicUser.email, 'ada@example.com');
  assert.equal('passwordHash' in publicUser, false);
  assert.equal('authIdentities' in publicUser, false);
  assert.equal('_id' in publicUser, false);
  assert.equal('__v' in publicUser, false);
  assert.equal(JSON.stringify(publicUser).includes('super-secret-hash'), false);
});
