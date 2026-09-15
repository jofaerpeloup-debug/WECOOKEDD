const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../src/modules/moderator-applications/moderator-application.service');
const applicationRepository = require('../src/modules/moderator-applications/moderator-application.repository');
const userRepository = require('../src/modules/users/user.repository');

const USER_ID = '507f1f77bcf86cd799439201';
const ADMIN_ID = '507f1f77bcf86cd799439202';
const APPLICATION_ID = '507f1f77bcf86cd799439203';

function eligibleUser(overrides = {}) {
  return {
    _id: USER_ID,
    role: 'user',
    status: 'active',
    emailVerified: true,
    passwordHash: 'bcrypt-hash',
    ...overrides,
  };
}

function application(overrides = {}) {
  return {
    _id: APPLICATION_ID,
    userId: USER_ID,
    status: 'pending',
    createdAt: new Date(),
    ...overrides,
  };
}

test('a normal duplicate pending application is a controlled conflict', async (t) => {
  t.mock.method(userRepository, 'findModeratorApplicantById', async () => eligibleUser());
  t.mock.method(applicationRepository, 'findPendingByUserId', async () => application());
  let created = false;
  t.mock.method(applicationRepository, 'createPending', async () => (created = true));
  await assert.rejects(
    () => service.apply(USER_ID),
    (error) => error.code === 'MODERATOR_APPLICATION_ALREADY_PENDING' && error.statusCode === 409
  );
  assert.equal(created, false);
});

test('rejected or approved history does not block a new pending application', async (t) => {
  t.mock.method(userRepository, 'findModeratorApplicantById', async () => eligibleUser());
  t.mock.method(applicationRepository, 'findPendingByUserId', async () => null);
  t.mock.method(applicationRepository, 'createPending', async () => application());
  const created = await service.apply(USER_ID);
  assert.equal(created.status, 'pending');
});

test('a lost approval transition race returns not-pending and never promotes', async (t) => {
  t.mock.method(applicationRepository, 'findById', async () => application());
  t.mock.method(userRepository, 'findModeratorApplicantById', async () => eligibleUser());
  t.mock.method(applicationRepository, 'approvePending', async () => null);
  let promoted = false;
  t.mock.method(userRepository, 'promoteEligibleUserToModerator', async () => {
    promoted = true;
  });
  await assert.rejects(
    () => service.approve({ applicationId: APPLICATION_ID, reviewedBy: ADMIN_ID }),
    (error) => error.code === 'MODERATOR_APPLICATION_NOT_PENDING'
  );
  assert.equal(promoted, false);
});

test('terminal applications cannot be approved or rejected again', async (t) => {
  let current = application({ status: 'approved' });
  t.mock.method(applicationRepository, 'findById', async () => current);
  await assert.rejects(
    () => service.approve({ applicationId: APPLICATION_ID, reviewedBy: ADMIN_ID }),
    (error) => error.code === 'MODERATOR_APPLICATION_NOT_PENDING'
  );
  current = application({ status: 'rejected' });
  await assert.rejects(
    () => service.reject({ applicationId: APPLICATION_ID, reviewedBy: ADMIN_ID, reason: 'No' }),
    (error) => error.code === 'MODERATOR_APPLICATION_NOT_PENDING'
  );
});

test('rejection changes only the application and never invokes a user role update', async (t) => {
  t.mock.method(applicationRepository, 'findById', async () => application());
  t.mock.method(applicationRepository, 'rejectPending', async (id, decision) =>
    application({ status: 'rejected', rejectionReason: decision.rejectionReason })
  );
  let userWrite = false;
  t.mock.method(userRepository, 'promoteEligibleUserToModerator', async () => (userWrite = true));
  t.mock.method(userRepository, 'demoteModeratorToUser', async () => (userWrite = true));
  const rejected = await service.reject({
    applicationId: APPLICATION_ID,
    reviewedBy: ADMIN_ID,
    reason: 'No details',
  });
  assert.equal(rejected.status, 'rejected');
  assert.equal(userWrite, false);
});

test('demotion safely rejects a non-moderator or missing target', async (t) => {
  t.mock.method(userRepository, 'demoteModeratorToUser', async () => null);
  await assert.rejects(
    () => service.demote(USER_ID),
    (error) => error.code === 'MODERATOR_TARGET_INVALID' && error.statusCode === 409
  );
});

test('a thrown promotion failure is compensated exactly and exposes only the controlled error', async (t) => {
  const applicant = eligibleUser();
  const pending = application();
  const infrastructureFailure = new Error('driver details must not escape');
  let approvalDecision;
  let compensation;
  let alternateRoleWrite = false;

  t.mock.method(applicationRepository, 'findById', async () => pending);
  t.mock.method(userRepository, 'findModeratorApplicantById', async () => applicant);
  t.mock.method(applicationRepository, 'approvePending', async (id, decision) => {
    approvalDecision = { id, ...decision };
    return application({
      status: 'approved',
      reviewedAt: decision.reviewedAt,
      reviewedBy: decision.reviewedBy,
    });
  });
  t.mock.method(userRepository, 'promoteEligibleUserToModerator', async () => {
    throw infrastructureFailure;
  });
  t.mock.method(applicationRepository, 'rollbackApproval', async (id, decision) => {
    compensation = { id, ...decision };
    return pending;
  });
  t.mock.method(userRepository, 'demoteModeratorToUser', async () => {
    alternateRoleWrite = true;
  });

  await assert.rejects(
    () => service.approve({ applicationId: APPLICATION_ID, reviewedBy: ADMIN_ID }),
    (error) => {
      assert.equal(error.code, 'MODERATOR_APPROVAL_FAILED');
      assert.equal(error.statusCode, 500);
      assert.equal(error.message.includes(infrastructureFailure.message), false);
      return true;
    }
  );

  assert.equal(approvalDecision.id, APPLICATION_ID);
  assert.equal(compensation.id, approvalDecision.id);
  assert.equal(compensation.reviewedBy, approvalDecision.reviewedBy);
  assert.equal(compensation.reviewedAt, approvalDecision.reviewedAt);
  assert.equal(applicant.role, 'user');
  assert.equal(alternateRoleWrite, false);
});
