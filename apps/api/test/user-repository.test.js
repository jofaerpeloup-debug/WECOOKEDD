const test = require('node:test');
const assert = require('node:assert/strict');

const User = require('../src/modules/users/user.model');
const userRepository = require('../src/modules/users/user.repository');

test('createUser rejects a missing or empty passwordHash before persistence', async (t) => {
  const create = t.mock.method(User, 'create', async () => ({ _id: 'should-not-run' }));

  for (const passwordHash of [undefined, null, '', '   ']) {
    await assert.rejects(
      async () => userRepository.createUser({ name: 'Ada', email: 'ada@example.com', passwordHash }),
      /nonempty passwordHash/
    );
  }
  assert.equal(create.mock.callCount(), 0);
});

test('createUser persists only the local registration fields with a usable hash', async (t) => {
  let captured;
  t.mock.method(User, 'create', async (document) => {
    captured = document;
    return document;
  });

  await userRepository.createUser({
    name: 'Ada',
    email: 'ada@example.com',
    passwordHash: 'bcrypt-hash',
  });

  assert.deepEqual(captured, {
    name: 'Ada',
    email: 'ada@example.com',
    passwordHash: 'bcrypt-hash',
  });
});

test('findByAuthIdentity keeps provider and subject paired with $elemMatch', (t) => {
  let captured;
  const query = { query: true };
  t.mock.method(User, 'findOne', (filter) => {
    captured = filter;
    return query;
  });
  const result = userRepository.findByAuthIdentity('google', 'stable-subject');
  assert.equal(result, query);
  assert.deepEqual(captured, {
    authIdentities: {
      $elemMatch: { provider: 'google', subject: 'stable-subject' },
    },
  });
});

test('createSocialUser forces normal active authority and never writes passwordHash', async (t) => {
  let captured;
  t.mock.method(User, 'create', async (document) => {
    captured = document;
    return document;
  });
  const authIdentity = { provider: 'google', subject: 'stable-subject' };

  await userRepository.createSocialUser({
    name: 'Ada',
    email: 'ada@example.com',
    emailVerified: true,
    authIdentity,
    role: 'admin',
    status: 'suspended',
    passwordHash: 'caller-controlled',
  });

  assert.deepEqual(captured, {
    name: 'Ada',
    email: 'ada@example.com',
    emailVerified: true,
    authIdentities: [authIdentity],
    role: 'user',
    status: 'active',
  });
  assert.equal('passwordHash' in captured, false);
});

test('linkAuthIdentity uses one conditional normal-user update with $push and validators', async (t) => {
  let captured;
  t.mock.method(User, 'findOneAndUpdate', (filter, update, options) => {
    captured = { filter, update, options };
    return Promise.resolve({ _id: 'user-1' });
  });
  const authIdentity = { provider: 'apple', subject: 'stable-subject' };

  await userRepository.linkAuthIdentity('user-1', authIdentity);

  assert.deepEqual(captured, {
    filter: {
      _id: 'user-1',
      role: 'user',
      status: 'active',
      'authIdentities.provider': { $ne: 'apple' },
    },
    update: { $push: { authIdentities: authIdentity } },
    options: { returnDocument: 'after', runValidators: true },
  });
});

test('social repository creation does not swallow duplicate-key ownership errors', async (t) => {
  const duplicate = Object.assign(new Error('duplicate key'), { code: 11000 });
  t.mock.method(User, 'create', async () => {
    throw duplicate;
  });

  await assert.rejects(
    () =>
      userRepository.createSocialUser({
        name: 'Ada',
        email: 'ada@example.com',
        emailVerified: true,
        authIdentity: { provider: 'google', subject: 'stable-subject' },
      }),
    (error) => error === duplicate
  );
});

test('linkAuthIdentity does not swallow a duplicate-key ownership race', async (t) => {
  const duplicate = Object.assign(new Error('duplicate key'), { code: 11000 });
  t.mock.method(User, 'findOneAndUpdate', async () => {
    throw duplicate;
  });

  await assert.rejects(
    () =>
      userRepository.linkAuthIdentity('user-1', {
        provider: 'google',
        subject: 'stable-subject',
      }),
    (error) => error === duplicate
  );
});

test('replacePasswordById atomically sets the hash and invalidates reset credentials', async (t) => {
  let captured;
  t.mock.method(User, 'updateOne', (filter, update) => {
    captured = { filter, update };
    return Promise.resolve({ matchedCount: 1 });
  });

  await userRepository.replacePasswordById('user-1', 'new-password-hash');

  assert.deepEqual(captured.filter, { _id: 'user-1' });
  assert.deepEqual(captured.update, {
    $set: { passwordHash: 'new-password-hash' },
    $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 },
  });
  assert.equal(User.updateOne.mock.callCount(), 1);
});

test('setPasswordResetTokenForEligibleUser re-checks active usable-hash eligibility', async (t) => {
  let captured;
  t.mock.method(User, 'updateOne', (filter, update) => {
    captured = { filter, update };
    return Promise.resolve({ matchedCount: 1 });
  });
  const expiresAt = new Date();

  await userRepository.setPasswordResetTokenForEligibleUser('user-1', 'digest', expiresAt);

  assert.equal(captured.filter.status, 'active');
  assert.equal('authProviders' in captured.filter, false);
  assert.deepEqual(captured.filter.passwordHash, {
    $exists: true,
    $type: 'string',
    $ne: '',
  });
  assert.deepEqual(captured.update.$set, {
    passwordResetTokenHash: 'digest',
    passwordResetExpiresAt: expiresAt,
  });
});

test('resetPasswordByTokenHash atomically matches, replaces password, and consumes token', async (t) => {
  let captured;
  t.mock.method(User, 'findOneAndUpdate', (filter, update, options) => {
    captured = { filter, update, options };
    return Promise.resolve({ _id: 'user-1' });
  });
  const now = new Date();

  await userRepository.resetPasswordByTokenHash({
    tokenHash: 'digest',
    passwordHash: 'new-password-hash',
    now,
  });

  assert.equal(captured.filter.passwordResetTokenHash, 'digest');
  assert.deepEqual(captured.filter.passwordResetExpiresAt, { $gt: now });
  assert.equal(captured.filter.status, 'active');
  assert.equal('authProviders' in captured.filter, false);
  assert.deepEqual(captured.filter.passwordHash, {
    $exists: true,
    $type: 'string',
    $ne: '',
  });
  assert.deepEqual(captured.update, {
    $set: { passwordHash: 'new-password-hash' },
    $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 },
  });
  assert.deepEqual(captured.options, { returnDocument: 'after', projection: { _id: 1 } });
  assert.equal(User.findOneAndUpdate.mock.callCount(), 1);
});

test('setEmailVerificationTokenForUser re-checks active, usable-hash, unverified eligibility', async (t) => {
  let captured;
  t.mock.method(User, 'updateOne', (filter, update) => {
    captured = { filter, update };
    return Promise.resolve({ matchedCount: 1 });
  });
  const expiresAt = new Date();

  await userRepository.setEmailVerificationTokenForUser('user-1', 'digest', expiresAt);

  assert.equal(captured.filter._id, 'user-1');
  assert.equal(captured.filter.status, 'active');
  assert.deepEqual(captured.filter.passwordHash, {
    $exists: true,
    $type: 'string',
    $ne: '',
  });
  assert.deepEqual(captured.filter.emailVerified, { $ne: true });
  assert.deepEqual(captured.update.$set, {
    emailVerificationTokenHash: 'digest',
    emailVerificationExpiresAt: expiresAt,
  });
});

test('verifyEmailByTokenHash atomically matches, flips emailVerified, and clears the credential', async (t) => {
  let captured;
  t.mock.method(User, 'findOneAndUpdate', (filter, update, options) => {
    captured = { filter, update, options };
    return Promise.resolve({ _id: 'user-1' });
  });
  const now = new Date();

  await userRepository.verifyEmailByTokenHash({ tokenHash: 'digest', now });

  assert.equal(captured.filter.emailVerificationTokenHash, 'digest');
  assert.deepEqual(captured.filter.emailVerificationExpiresAt, { $gt: now });
  assert.equal(captured.filter.status, 'active');
  assert.deepEqual(captured.update, {
    $set: { emailVerified: true },
    $unset: { emailVerificationTokenHash: 1, emailVerificationExpiresAt: 1 },
  });
  assert.deepEqual(captured.options, { returnDocument: 'after', projection: { _id: 1 } });
  assert.equal(User.findOneAndUpdate.mock.callCount(), 1);
});

test('updateStatusIfCurrent atomically matches id and expected status', async (t) => {
  let captured;
  const updated = { _id: 'user-1', status: 'active' };
  t.mock.method(User, 'findOneAndUpdate', (filter, update, options) => {
    captured = { filter, update, options };
    return Promise.resolve(updated);
  });

  const result = await userRepository.updateStatusIfCurrent(
    'user-1',
    'suspended',
    'active'
  );

  assert.equal(result, updated);
  assert.deepEqual(captured, {
    filter: { _id: 'user-1', status: 'suspended' },
    update: { $set: { status: 'active' } },
    options: { returnDocument: 'after', runValidators: true },
  });
});

test('updateStatusIfCurrent clears reset credentials in the winning suspension write', async (t) => {
  let captured;
  t.mock.method(User, 'findOneAndUpdate', (filter, update, options) => {
    captured = { filter, update, options };
    return Promise.resolve(null);
  });

  const result = await userRepository.updateStatusIfCurrent(
    'user-1',
    'active',
    'suspended'
  );

  assert.equal(result, null);
  assert.deepEqual(captured.filter, { _id: 'user-1', status: 'active' });
  assert.deepEqual(captured.update, {
    $set: { status: 'suspended' },
    $unset: {
      passwordResetTokenHash: 1,
      passwordResetExpiresAt: 1,
    },
  });
  assert.deepEqual(captured.options, { returnDocument: 'after', runValidators: true });
});
