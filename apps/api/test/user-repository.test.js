const test = require('node:test');
const assert = require('node:assert/strict');

const User = require('../src/modules/users/user.model');
const userRepository = require('../src/modules/users/user.repository');

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

test('setPasswordResetTokenForEligibleUser re-checks active local-password eligibility', async (t) => {
  let captured;
  t.mock.method(User, 'updateOne', (filter, update) => {
    captured = { filter, update };
    return Promise.resolve({ matchedCount: 1 });
  });
  const expiresAt = new Date();

  await userRepository.setPasswordResetTokenForEligibleUser('user-1', 'digest', expiresAt);

  assert.equal(captured.filter.status, 'active');
  assert.equal(captured.filter.authProviders, 'local');
  assert.deepEqual(captured.filter.passwordHash, { $exists: true, $type: 'string' });
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
  assert.equal(captured.filter.authProviders, 'local');
  assert.deepEqual(captured.update, {
    $set: { passwordHash: 'new-password-hash' },
    $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 },
  });
  assert.deepEqual(captured.options, { new: true, projection: { _id: 1 } });
  assert.equal(User.findOneAndUpdate.mock.callCount(), 1);
});
