const test = require('node:test');
const assert = require('node:assert/strict');

const ModeratorApplication = require('../src/modules/moderator-applications/moderator-application.model');

const USER_ID = '507f1f77bcf86cd799439001';

test('ModeratorApplication has the exact workflow fields and timestamps', () => {
  const paths = Object.keys(ModeratorApplication.schema.paths).filter(
    (path) => path !== '_id' && path !== '__v'
  );
  assert.deepEqual(paths.sort(), [
    'createdAt',
    'rejectionReason',
    'reviewedAt',
    'reviewedBy',
    'status',
    'updatedAt',
    'userId',
  ]);
  assert.equal(ModeratorApplication.schema.options.timestamps, true);
  assert.equal(ModeratorApplication.schema.path('userId').options.ref, 'User');
});

test('pending is the default and review fields are nullable', async () => {
  const application = new ModeratorApplication({ userId: USER_ID });
  await assert.doesNotReject(() => application.validate());
  assert.equal(application.status, 'pending');
  assert.equal(application.reviewedAt, null);
  assert.equal(application.reviewedBy, null);
  assert.equal(application.rejectionReason, null);
});

test('only pending, approved, and rejected statuses validate', async () => {
  for (const status of ModeratorApplication.APPLICATION_STATUSES) {
    await assert.doesNotReject(() => new ModeratorApplication({ userId: USER_ID, status }).validate());
  }
  await assert.rejects(() =>
    new ModeratorApplication({ userId: USER_ID, status: 'withdrawn' }).validate()
  );
});

test('rejection reason is trimmed and capped at 500 characters', async () => {
  const valid = new ModeratorApplication({
    userId: USER_ID,
    status: 'rejected',
    rejectionReason: '  incomplete details  ',
  });
  await valid.validate();
  assert.equal(valid.rejectionReason, 'incomplete details');
  await assert.rejects(() =>
    new ModeratorApplication({
      userId: USER_ID,
      status: 'rejected',
      rejectionReason: 'x'.repeat(501),
    }).validate()
  );
});

test('schema declares the unique partial pending index and queue index', () => {
  const indexes = ModeratorApplication.schema.indexes();
  const pending = indexes.find(([, options]) =>
    options.name === 'uniq_pending_moderator_application_per_user'
  );
  assert.deepEqual(pending[0], { userId: 1 });
  assert.equal(pending[1].unique, true);
  assert.deepEqual(pending[1].partialFilterExpression, { status: 'pending' });

  const queue = indexes.find(([, options]) => options.name === 'moderator_application_queue');
  assert.deepEqual(queue[0], { status: 1, createdAt: -1, _id: -1 });
});
