const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../src/modules/moderator-applications/moderator-application.service');
const applicationRepository = require('../src/modules/moderator-applications/moderator-application.repository');
const userRepository = require('../src/modules/users/user.repository');
const auditService = require('../src/modules/audit/audit.service');

const USER_ID = '507f1f77bcf86cd799439201';
const ADMIN_ID = '507f1f77bcf86cd799439202';
const APPLICATION_ID = '507f1f77bcf86cd799439203';
const NOW = new Date('2026-09-16T12:00:00.000Z');

test.beforeEach((t) => {
  t.mock.method(auditService, 'record', async () => null);
});

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

test('approved history does not block a demoted current user from applying immediately', async (t) => {
  t.mock.method(userRepository, 'findModeratorApplicantById', async () => eligibleUser());
  t.mock.method(applicationRepository, 'findPendingByUserId', async () => null);
  t.mock.method(applicationRepository, 'findLatestByUserId', async () =>
    application({ status: 'approved', reviewedAt: NOW })
  );
  t.mock.method(applicationRepository, 'createPending', async () => application());
  const created = await service.apply(USER_ID, { now: NOW });
  assert.equal(created.status, 'pending');
});

for (const { label, elapsed, allowed } of [
  { label: '23h59m59s after rejection', elapsed: service.MODERATOR_REAPPLICATION_COOLDOWN_MS - 1000, allowed: false },
  { label: 'exactly 24h after rejection', elapsed: service.MODERATOR_REAPPLICATION_COOLDOWN_MS, allowed: true },
  { label: 'more than 24h after rejection', elapsed: service.MODERATOR_REAPPLICATION_COOLDOWN_MS + 1000, allowed: true },
]) {
  test(`${label} is ${allowed ? 'allowed' : 'denied'}`, async (t) => {
    t.mock.method(userRepository, 'findModeratorApplicantById', async () => eligibleUser());
    t.mock.method(applicationRepository, 'findPendingByUserId', async () => null);
    t.mock.method(applicationRepository, 'findLatestByUserId', async () =>
      application({
        status: 'rejected',
        reviewedAt: new Date(NOW.getTime() - elapsed),
      })
    );
    let createCalls = 0;
    t.mock.method(applicationRepository, 'createPending', async () => {
      createCalls += 1;
      return application();
    });

    if (allowed) {
      const created = await service.apply(USER_ID, { now: NOW });
      assert.equal(created.status, 'pending');
      assert.equal(createCalls, 1);
    } else {
      await assert.rejects(
        () => service.apply(USER_ID, { now: NOW }),
        (error) => {
          assert.equal(error.code, 'MODERATOR_APPLICATION_REAPPLY_COOLDOWN');
          assert.equal(error.statusCode, 429);
          assert.equal(
            error.message,
            'You can apply again after the reapplication cooldown ends.'
          );
          return true;
        }
      );
      assert.equal(createCalls, 0);
    }
  });
}

test('rejection after demotion blocks immediate reapply and permits it after 24 hours', async (t) => {
  t.mock.method(userRepository, 'findModeratorApplicantById', async () => eligibleUser());
  t.mock.method(applicationRepository, 'findPendingByUserId', async () => null);
  let latest = application({ status: 'approved', reviewedAt: new Date('2026-09-15T00:00:00Z') });
  t.mock.method(applicationRepository, 'findLatestByUserId', async () => latest);
  let createCalls = 0;
  t.mock.method(applicationRepository, 'createPending', async () => {
    createCalls += 1;
    return application();
  });

  await service.apply(USER_ID, { now: NOW });
  latest = application({ status: 'rejected', reviewedAt: NOW });
  await assert.rejects(
    () => service.apply(USER_ID, { now: NOW }),
    (error) => error.code === 'MODERATOR_APPLICATION_REAPPLY_COOLDOWN'
  );
  await service.apply(USER_ID, {
    now: new Date(NOW.getTime() + service.MODERATOR_REAPPLICATION_COOLDOWN_MS),
  });
  assert.equal(createCalls, 2);
});

test('the pending unique-index result remains authoritative after cooldown expiry', async (t) => {
  t.mock.method(userRepository, 'findModeratorApplicantById', async () => eligibleUser());
  t.mock.method(applicationRepository, 'findPendingByUserId', async () => null);
  t.mock.method(applicationRepository, 'findLatestByUserId', async () =>
    application({
      status: 'rejected',
      reviewedAt: new Date(NOW.getTime() - service.MODERATOR_REAPPLICATION_COOLDOWN_MS),
    })
  );
  let pendingCreated = false;
  t.mock.method(applicationRepository, 'createPending', async () => {
    if (pendingCreated) {
      throw Object.assign(new Error('database duplicate detail'), { code: 11000 });
    }
    pendingCreated = true;
    return application();
  });

  const results = await Promise.allSettled([
    service.apply(USER_ID, { now: NOW }),
    service.apply(USER_ID, { now: NOW }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'MODERATOR_APPLICATION_ALREADY_PENDING');
  assert.equal(rejected.reason.statusCode, 409);
});

for (const { label, reviewedAt } of [
  { label: 'missing (null) reviewedAt', reviewedAt: null },
  { label: 'invalid reviewedAt', reviewedAt: new Date('not-a-real-date') },
]) {
  test(`rejected history with ${label} fails closed as a controlled data-integrity error`, async (t) => {
    t.mock.method(userRepository, 'findModeratorApplicantById', async () => eligibleUser());
    t.mock.method(applicationRepository, 'findPendingByUserId', async () => null);
    t.mock.method(applicationRepository, 'findLatestByUserId', async () =>
      application({ status: 'rejected', reviewedAt, rejectionReason: 'Internal review reason' })
    );
    let created = false;
    t.mock.method(applicationRepository, 'createPending', async () => {
      created = true;
    });
    t.mock.method(console, 'error', () => {});

    await assert.rejects(
      () => service.apply(USER_ID, { now: NOW }),
      (error) => {
        assert.equal(error.code, 'MODERATOR_APPLICATION_HISTORY_INVALID');
        assert.equal(error.statusCode, 409);
        assert.equal(
          error.message,
          "We can't process another Moderator application right now. Please try again later or contact an administrator."
        );
        assert.equal(JSON.stringify(error).includes('Internal review reason'), false);
        return true;
      }
    );
    assert.equal(created, false);
  });
}

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
    () => service.demote({ userId: USER_ID, actorUserId: ADMIN_ID, actorRole: 'admin' }),
    (error) => error.code === 'MODERATOR_TARGET_INVALID' && error.statusCode === 409
  );
  assert.equal(auditService.record.mock.callCount(), 0);
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
  assert.equal(auditService.record.mock.callCount(), 0);
});

test('successful approval audits only after approval and promotion both succeed', async (t) => {
  const order = [];
  const pending = application();
  const applicant = eligibleUser();
  t.mock.method(applicationRepository, 'findById', async () => pending);
  t.mock.method(userRepository, 'findModeratorApplicantById', async () => applicant);
  t.mock.method(applicationRepository, 'approvePending', async (id, decision) => {
    order.push('approve');
    return application({ status: 'approved', ...decision });
  });
  t.mock.method(userRepository, 'promoteEligibleUserToModerator', async () => {
    order.push('promote');
    return eligibleUser({ role: 'moderator' });
  });
  let event;
  auditService.record.mock.mockImplementation(async (value) => {
    order.push('audit');
    event = value;
    return value;
  });

  const result = await service.approve({
    applicationId: APPLICATION_ID,
    reviewedBy: ADMIN_ID,
    actorRole: 'admin',
  });

  assert.equal(result.user.role, 'moderator');
  assert.deepEqual(order, ['approve', 'promote', 'audit']);
  assert.deepEqual(event, {
    eventType: 'admin.staff.moderator_approved',
    actorUserId: ADMIN_ID,
    actorRole: 'admin',
    targetType: 'user',
    targetId: USER_ID,
    outcome: 'success',
    metadata: { applicationId: APPLICATION_ID, fromRole: 'user', toRole: 'moderator' },
  });
});

test('successful rejection audits the application without its free-form reason', async (t) => {
  t.mock.method(applicationRepository, 'findById', async () => application());
  t.mock.method(applicationRepository, 'rejectPending', async (id, decision) =>
    application({ status: 'rejected', rejectionReason: decision.rejectionReason })
  );
  let event;
  auditService.record.mock.mockImplementation(async (value) => {
    event = value;
    return value;
  });

  await service.reject({
    applicationId: APPLICATION_ID,
    reviewedBy: ADMIN_ID,
    actorRole: 'admin',
    reason: 'private free-form explanation',
  });

  assert.deepEqual(event, {
    eventType: 'admin.staff.application_rejected',
    actorUserId: ADMIN_ID,
    actorRole: 'admin',
    targetType: 'moderator_application',
    targetId: APPLICATION_ID,
    outcome: 'success',
    metadata: { applicationId: APPLICATION_ID },
  });
  assert.equal(JSON.stringify(event).includes('private free-form explanation'), false);
});

test('successful demotion audits the actor, target, and hard-coded role transition', async (t) => {
  t.mock.method(userRepository, 'demoteModeratorToUser', async () =>
    eligibleUser({ role: 'user' })
  );
  let event;
  auditService.record.mock.mockImplementation(async (value) => {
    event = value;
    return value;
  });

  const demoted = await service.demote({
    userId: USER_ID,
    actorUserId: ADMIN_ID,
    actorRole: 'admin',
  });

  assert.equal(demoted.role, 'user');
  assert.deepEqual(event, {
    eventType: 'admin.staff.moderator_demoted',
    actorUserId: ADMIN_ID,
    actorRole: 'admin',
    targetType: 'user',
    targetId: USER_ID,
    outcome: 'success',
    metadata: { fromRole: 'moderator', toRole: 'user' },
  });
});

test('audit failure does not replay or fail successful staff mutations', async (t) => {
  const pending = application();
  t.mock.method(applicationRepository, 'findById', async () => pending);
  const reject = t.mock.method(applicationRepository, 'rejectPending', async (id, decision) =>
    application({ status: 'rejected', ...decision })
  );
  auditService.record.mock.mockImplementation(async () => null);

  const rejected = await service.reject({
    applicationId: APPLICATION_ID,
    reviewedBy: ADMIN_ID,
    actorRole: 'admin',
    reason: 'not stored in audit',
  });

  assert.equal(rejected.status, 'rejected');
  assert.equal(reject.mock.callCount(), 1);
  assert.equal(auditService.record.mock.callCount(), 1);
});
