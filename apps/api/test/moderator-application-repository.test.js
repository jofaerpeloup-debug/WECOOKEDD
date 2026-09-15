const test = require('node:test');
const assert = require('node:assert/strict');

const Model = require('../src/modules/moderator-applications/moderator-application.model');
const repository = require('../src/modules/moderator-applications/moderator-application.repository');
const User = require('../src/modules/users/user.model');
const userRepository = require('../src/modules/users/user.repository');

test('createPending persists only server-owned userId', async (t) => {
  let captured;
  t.mock.method(Model, 'create', async (value) => (captured = value));
  await repository.createPending('user-1');
  assert.deepEqual(captured, { userId: 'user-1' });
});

test('approval and rejection atomically match pending', async (t) => {
  const calls = [];
  t.mock.method(Model, 'findOneAndUpdate', async (...args) => {
    calls.push(args);
    return { _id: 'app-1' };
  });
  const reviewedAt = new Date();
  await repository.approvePending('app-1', { reviewedAt, reviewedBy: 'admin-1' });
  await repository.rejectPending('app-2', {
    reviewedAt,
    reviewedBy: 'admin-1',
    rejectionReason: 'No details',
  });
  assert.deepEqual(calls[0][0], { _id: 'app-1', status: 'pending' });
  assert.deepEqual(calls[1][0], { _id: 'app-2', status: 'pending' });
  assert.equal(calls[0][2].runValidators, true);
  assert.equal(calls[1][2].runValidators, true);
});

test('approval rollback matches the exact decision and clears review metadata', async (t) => {
  let captured;
  t.mock.method(Model, 'findOneAndUpdate', async (...args) => {
    captured = args;
    return {};
  });
  const reviewedAt = new Date();
  await repository.rollbackApproval('app-1', { reviewedAt, reviewedBy: 'admin-1' });
  assert.deepEqual(captured[0], {
    _id: 'app-1',
    status: 'approved',
    reviewedAt,
    reviewedBy: 'admin-1',
  });
  assert.deepEqual(captured[1].$set, {
    status: 'pending',
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
  });
});

test('promotion and demotion are hard-coded conditional transitions', async (t) => {
  const calls = [];
  t.mock.method(User, 'findOneAndUpdate', (...args) => {
    calls.push(args);
    return Promise.resolve({});
  });
  await userRepository.promoteEligibleUserToModerator('user-1');
  await userRepository.demoteModeratorToUser('user-2');

  assert.equal(calls[0][0].role, 'user');
  assert.equal(calls[0][0].status, 'active');
  assert.equal(calls[0][0].emailVerified, true);
  assert.deepEqual(calls[0][1], { $set: { role: 'moderator' } });
  assert.deepEqual(calls[1][0], { _id: 'user-2', role: 'moderator' });
  assert.deepEqual(calls[1][1], { $set: { role: 'user' } });
});

test('findLatestByUserId deterministically requests createdAt DESC then _id DESC', async (t) => {
  const userId = '507f1f77bcf86cd799439099';
  const tiedNewest = new Date('2026-01-03T00:00:00.000Z');
  // Real ModeratorApplication documents exercise schema casting while an
  // in-memory query adapter supplies the existing test suite's DB boundary.
  const history = [
    new Model({
      _id: '700000000000000000000001',
      userId,
      status: 'rejected',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }),
    new Model({
      _id: '700000000000000000000002',
      userId,
      status: 'approved',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    }),
    new Model({
      _id: '700000000000000000000003',
      userId,
      status: 'rejected',
      createdAt: tiedNewest,
    }),
    new Model({
      _id: '700000000000000000000004',
      userId,
      status: 'approved',
      createdAt: tiedNewest,
    }),
    new Model({
      _id: '700000000000000000000005',
      userId,
      status: 'rejected',
      createdAt: tiedNewest,
    }),
  ];
  let capturedFilter;
  let capturedSort;

  t.mock.method(Model, 'findOne', (filter) => {
    capturedFilter = filter;
    return {
      sort(sort) {
        capturedSort = sort;
        const matching = history.filter((item) => String(item.userId) === String(filter.userId));
        matching.sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime() ||
            String(right._id).localeCompare(String(left._id))
        );
        return Promise.resolve(matching[0] ?? null);
      },
    };
  });

  const latest = await repository.findLatestByUserId(userId);

  assert.deepEqual(capturedFilter, { userId });
  assert.deepEqual(capturedSort, { createdAt: -1, _id: -1 });
  assert.equal(String(latest._id), '700000000000000000000005');
  assert.equal(latest.status, 'rejected');
  assert.equal(latest.createdAt.toISOString(), tiedNewest.toISOString());
});
