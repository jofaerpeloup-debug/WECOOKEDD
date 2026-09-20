process.env.NODE_ENV = 'test';
process.env.PORT = '4091';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createApp } = require('../src/app');
const userRepository = require('../src/modules/users/user.repository');
const sessionRepository = require('../src/modules/sessions/session.repository');
const applicationRepository = require('../src/modules/moderator-applications/moderator-application.repository');
const service = require('../src/modules/moderator-applications/moderator-application.service');
const auditLogRepository = require('../src/modules/audit/audit-log.repository');
const { signAccessToken } = require('../src/shared/security/access-token');

const app = createApp();
const USER_ID = '507f1f77bcf86cd799439101';
const MODERATOR_ID = '507f1f77bcf86cd799439102';
const ADMIN_ID = '507f1f77bcf86cd799439103';
const SESSION_ID = '507f1f77bcf86cd799439104';
const APPLICATION_ID = '507f1f77bcf86cd799439105';
const HASH = '$2b$10$private-private-private-private-private';

test.beforeEach((t) => {
  t.mock.method(auditLogRepository, 'create', async (event) => event);
});

function userDoc({ id = USER_ID, role = 'user', status = 'active', emailVerified = false, password = true } = {}) {
  return {
    _id: id,
    name: 'Applicant',
    email: 'applicant@example.com',
    role,
    status,
    emailVerified,
    ...(password ? { passwordHash: HASH } : {}),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
  };
}

function applicationDoc({ status = 'pending', reason = null, user = USER_ID, reviewedAt } = {}) {
  return {
    _id: APPLICATION_ID,
    userId: user,
    status,
    reviewedAt: reviewedAt ?? (status === 'pending' ? null : new Date('2026-02-02T00:00:00Z')),
    reviewedBy: status === 'pending' ? null : ADMIN_ID,
    rejectionReason: reason,
    createdAt: new Date('2026-02-01T00:00:00Z'),
    updatedAt: new Date('2026-02-02T00:00:00Z'),
    passwordHash: 'must-never-leak',
  };
}

function tokenFor(user, claimedRole = user.role) {
  return signAccessToken({ userId: String(user._id), role: claimedRole, sessionId: SESSION_ID });
}

function mockAuth(t, caller) {
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: SESSION_ID,
    userId: String(caller._id),
  }));
  t.mock.method(userRepository, 'findById', async () => caller);
}

test('apply requires authentication', async () => {
  const response = await request(app).post('/api/v1/staff/moderator-applications').send({});
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_TOKEN_MISSING');
});

test('an active local user can apply while unverified without changing authority', async (t) => {
  const caller = userDoc();
  mockAuth(t, caller);
  t.mock.method(userRepository, 'findModeratorApplicantById', async () => caller);
  t.mock.method(applicationRepository, 'findPendingByUserId', async () => null);
  t.mock.method(applicationRepository, 'findLatestByUserId', async () => null);
  t.mock.method(applicationRepository, 'createPending', async (userId) => {
    assert.equal(userId, USER_ID);
    return applicationDoc();
  });

  const response = await request(app)
    .post('/api/v1/staff/moderator-applications')
    .set('Authorization', `Bearer ${tokenFor(caller)}`)
    .send({});

  assert.equal(response.status, 201);
  assert.equal(response.body.data.application.status, 'pending');
  assert.equal(caller.role, 'user');
  assert.equal(caller.emailVerified, false);
  assert.equal(JSON.stringify(response.body).includes(HASH), false);
});

test('apply strictly rejects all client-owned identity and decision fields', async (t) => {
  const caller = userDoc();
  mockAuth(t, caller);
  for (const body of [
    { userId: ADMIN_ID },
    { role: 'moderator' },
    { status: 'approved' },
    { reviewedBy: ADMIN_ID },
    { reviewedAt: new Date().toISOString() },
    { rejectionReason: 'client controlled' },
  ]) {
    const response = await request(app)
      .post('/api/v1/staff/moderator-applications')
      .set('Authorization', `Bearer ${tokenFor(caller)}`)
      .send(body);
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  }
});

test('provider-only users cannot apply and create no application', async (t) => {
  const caller = userDoc({ password: false });
  mockAuth(t, caller);
  t.mock.method(userRepository, 'findModeratorApplicantById', async () => caller);
  let created = false;
  t.mock.method(applicationRepository, 'createPending', async () => {
    created = true;
  });
  const response = await request(app)
    .post('/api/v1/staff/moderator-applications')
    .set('Authorization', `Bearer ${tokenFor(caller)}`)
    .send({});
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'MODERATOR_APPLICATION_PASSWORD_REQUIRED');
  assert.equal(created, false);
});

test('moderators and admins cannot apply', async (t) => {
  let caller = userDoc({ role: 'moderator' });
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: SESSION_ID,
    userId: String(caller._id),
  }));
  t.mock.method(userRepository, 'findById', async () => caller);
  t.mock.method(userRepository, 'findModeratorApplicantById', async () => caller);
  for (const role of ['moderator', 'admin']) {
    caller = userDoc({ role });
    const response = await request(app)
      .post('/api/v1/staff/moderator-applications')
      .set('Authorization', `Bearer ${tokenFor(caller)}`)
      .send({});
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'MODERATOR_APPLICATION_NOT_ELIGIBLE');
  }
});

test('duplicate-key apply races become a stable conflict without Mongo details', async (t) => {
  const caller = userDoc();
  mockAuth(t, caller);
  t.mock.method(userRepository, 'findModeratorApplicantById', async () => caller);
  t.mock.method(applicationRepository, 'findPendingByUserId', async () => null);
  t.mock.method(applicationRepository, 'findLatestByUserId', async () => null);
  t.mock.method(applicationRepository, 'createPending', async () => {
    throw Object.assign(new Error('E11000 uniq_pending_moderator_application_per_user'), { code: 11000 });
  });
  const response = await request(app)
    .post('/api/v1/staff/moderator-applications')
    .set('Authorization', `Bearer ${tokenFor(caller)}`)
    .send({});
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'MODERATOR_APPLICATION_ALREADY_PENDING');
  assert.equal(JSON.stringify(response.body).includes('E11000'), false);
  assert.equal(JSON.stringify(response.body).includes('uniq_pending'), false);
});

test('recent rejection returns the stable cooldown envelope without internal data', async (t) => {
  const caller = userDoc({ emailVerified: true });
  mockAuth(t, caller);
  t.mock.method(userRepository, 'findModeratorApplicantById', async () => caller);
  t.mock.method(applicationRepository, 'findPendingByUserId', async () => null);
  t.mock.method(applicationRepository, 'findLatestByUserId', async () =>
    applicationDoc({
      status: 'rejected',
      reason: 'Internal review reason',
      reviewedAt: new Date(Date.now() - 60 * 60 * 1000),
    })
  );
  let created = false;
  t.mock.method(applicationRepository, 'createPending', async () => {
    created = true;
  });

  const response = await request(app)
    .post('/api/v1/staff/moderator-applications')
    .set('Authorization', `Bearer ${tokenFor(caller)}`)
    .send({});

  assert.equal(response.status, 429);
  assert.deepEqual(response.body, {
    success: false,
    error: {
      code: 'MODERATOR_APPLICATION_REAPPLY_COOLDOWN',
      message: 'You can apply again after the reapplication cooldown ends.',
    },
  });
  assert.equal(created, false);
  const raw = JSON.stringify(response.body);
  assert.equal(raw.includes('Internal review reason'), false);
  assert.equal(raw.includes('passwordHash'), false);
  assert.equal(raw.includes('reviewedBy'), false);
});

for (const { label, reviewedAt } of [
  { label: 'missing (null) reviewedAt', reviewedAt: null },
  { label: 'invalid reviewedAt', reviewedAt: new Date('not-a-real-date') },
]) {
  test(`rejected history with ${label} returns a controlled data-integrity 409, never a bare 500`, async (t) => {
    const caller = userDoc({ emailVerified: true });
    mockAuth(t, caller);
    t.mock.method(userRepository, 'findModeratorApplicantById', async () => caller);
    t.mock.method(applicationRepository, 'findPendingByUserId', async () => null);
    t.mock.method(applicationRepository, 'findLatestByUserId', async () => ({
      ...applicationDoc({ status: 'rejected', reason: 'Internal review reason' }),
      reviewedAt,
    }));
    let created = false;
    t.mock.method(applicationRepository, 'createPending', async () => {
      created = true;
    });
    t.mock.method(console, 'error', () => {});

    const response = await request(app)
      .post('/api/v1/staff/moderator-applications')
      .set('Authorization', `Bearer ${tokenFor(caller)}`)
      .send({});

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, {
      success: false,
      error: {
        code: 'MODERATOR_APPLICATION_HISTORY_INVALID',
        message:
          "We can't process another Moderator application right now. Please try again later or contact an administrator.",
      },
    });
    assert.equal(created, false);
    const raw = JSON.stringify(response.body);
    assert.equal(raw.includes('Internal review reason'), false);
    assert.equal(raw.includes('passwordHash'), false);
    assert.equal(raw.includes('reviewedBy'), false);
    assert.equal(raw.includes(USER_ID), false);
  });
}

test('/staff/me resolves consumer, verify_email, pending, rejected, moderator, and admin', async (t) => {
  const cases = [
    { role: 'user', verified: false, pending: null, rejected: null, mode: 'consumer' },
    { role: 'user', verified: false, pending: applicationDoc(), rejected: null, mode: 'verify_email' },
    { role: 'user', verified: true, pending: applicationDoc(), rejected: null, mode: 'pending' },
    { role: 'user', verified: true, pending: null, rejected: applicationDoc({ status: 'rejected', reason: 'Needs experience' }), mode: 'rejected' },
    { role: 'moderator', verified: true, pending: null, rejected: null, mode: 'moderator' },
    { role: 'admin', verified: true, pending: null, rejected: null, mode: 'admin' },
  ];

  let item = cases[0];
  let caller = userDoc();
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: SESSION_ID,
    userId: String(caller._id),
  }));
  t.mock.method(userRepository, 'findById', async () => caller);
  t.mock.method(applicationRepository, 'findPendingByUserId', async () => item.pending);
  t.mock.method(applicationRepository, 'findLatestByUserId', async () => item.rejected);

  for (const current of cases) {
    item = current;
    caller = userDoc({ role: item.role, emailVerified: item.verified });
    const response = await request(app)
      .get('/api/v1/staff/me')
      .set('Authorization', `Bearer ${tokenFor(caller)}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.mode, item.mode);
    assert.equal(response.headers['cache-control'], 'no-store');
    if (item.mode === 'rejected') {
      assert.equal(response.body.data.application.rejectionReason, 'Needs experience');
      assert.equal('reviewedBy' in response.body.data.application, false);
    }
  }
});

test('historical approval never grants staff mode to a current user', async (t) => {
  const caller = userDoc({ role: 'user', emailVerified: true });
  mockAuth(t, caller);
  t.mock.method(applicationRepository, 'findPendingByUserId', async () => null);
  t.mock.method(applicationRepository, 'findLatestByUserId', async () =>
    applicationDoc({ status: 'approved' })
  );
  const response = await request(app)
    .get('/api/v1/staff/me')
    .set('Authorization', `Bearer ${tokenFor(caller, 'moderator')}`);
  assert.equal(response.body.data.mode, 'consumer');
});

test('only admin staff.manage can list applications, with safe pagination and serialization', async (t) => {
  let caller = userDoc({ role: 'user' });
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: SESSION_ID,
    userId: String(caller._id),
  }));
  t.mock.method(userRepository, 'findById', async () => caller);
  for (const role of ['user', 'moderator']) {
    caller = userDoc({ role });
    const denied = await request(app)
      .get('/api/v1/staff/moderator-applications')
      .set('Authorization', `Bearer ${tokenFor(caller)}`);
    assert.equal(denied.status, 403);
  }

  const admin = userDoc({ id: ADMIN_ID, role: 'admin', emailVerified: true });
  const applicant = userDoc({ emailVerified: true });
  caller = admin;
  t.mock.method(applicationRepository, 'findManyForAdmin', async (options) => {
    assert.deepEqual(options, { status: 'rejected', skip: 5, limit: 5 });
    return [applicationDoc({ status: 'rejected', reason: 'No', user: applicant })];
  });
  t.mock.method(applicationRepository, 'countByStatus', async () => 6);
  const response = await request(app)
    .get('/api/v1/staff/moderator-applications?status=rejected&page=2&limit=5')
    .set('Authorization', `Bearer ${tokenFor(admin)}`);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.pagination, { page: 2, limit: 5, total: 6, totalPages: 2 });
  const raw = JSON.stringify(response.body);
  assert.equal(raw.includes('passwordHash'), false);
  assert.equal(raw.includes(HASH), false);
});

test('list validates status, bounds, and unknown query keys', async (t) => {
  const admin = userDoc({ id: ADMIN_ID, role: 'admin' });
  mockAuth(t, admin);
  for (const query of ['status=draft', 'page=0', 'limit=101', 'role=admin']) {
    const response = await request(app)
      .get(`/api/v1/staff/moderator-applications?${query}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    assert.equal(response.status, 400);
  }
});

test('admin approval promotes a verified eligible applicant and records the reviewer', async (t) => {
  const admin = userDoc({ id: ADMIN_ID, role: 'admin' });
  const applicant = userDoc({ emailVerified: true });
  const pending = applicationDoc();
  mockAuth(t, admin);
  t.mock.method(applicationRepository, 'findById', async () => pending);
  t.mock.method(userRepository, 'findModeratorApplicantById', async () => applicant);
  t.mock.method(applicationRepository, 'approvePending', async (id, decision) => {
    assert.equal(id, APPLICATION_ID);
    assert.equal(decision.reviewedBy, ADMIN_ID);
    return { ...pending, status: 'approved', ...decision };
  });
  t.mock.method(userRepository, 'promoteEligibleUserToModerator', async () => ({
    ...applicant,
    role: 'moderator',
  }));
  let auditEvent;
  auditLogRepository.create.mock.mockImplementation(async (event) => {
    auditEvent = event;
    return event;
  });
  const response = await request(app)
    .post(`/api/v1/staff/moderator-applications/${APPLICATION_ID}/approve`)
    .set('Authorization', `Bearer ${tokenFor(admin)}`)
    .send({});
  assert.equal(response.status, 200);
  assert.equal(response.body.data.application.status, 'approved');
  assert.equal(response.body.data.user.role, 'moderator');
  assert.deepEqual(auditEvent, {
    eventType: 'admin.staff.moderator_approved',
    actorUserId: ADMIN_ID,
    actorRole: 'admin',
    targetType: 'user',
    targetId: USER_ID,
    outcome: 'success',
    metadata: { applicationId: APPLICATION_ID, fromRole: 'user', toRole: 'moderator' },
  });
});

test('approval rejects unverified users and never transitions the application', async (t) => {
  const admin = userDoc({ id: ADMIN_ID, role: 'admin' });
  mockAuth(t, admin);
  t.mock.method(applicationRepository, 'findById', async () => applicationDoc());
  t.mock.method(userRepository, 'findModeratorApplicantById', async () => userDoc());
  let transitioned = false;
  t.mock.method(applicationRepository, 'approvePending', async () => (transitioned = true));
  const response = await request(app)
    .post(`/api/v1/staff/moderator-applications/${APPLICATION_ID}/approve`)
    .set('Authorization', `Bearer ${tokenFor(admin)}`)
    .send({});
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'MODERATOR_APPLICATION_EMAIL_UNVERIFIED');
  assert.equal(transitioned, false);
});

test('promotion failure compensates the exact approval and remains fail-closed', async (t) => {
  const reviewedBy = ADMIN_ID;
  const pending = applicationDoc();
  const applicant = userDoc({ emailVerified: true });
  t.mock.method(applicationRepository, 'findById', async () => pending);
  t.mock.method(userRepository, 'findModeratorApplicantById', async () => applicant);
  t.mock.method(applicationRepository, 'approvePending', async (id, decision) => ({
    ...pending,
    status: 'approved',
    ...decision,
  }));
  t.mock.method(userRepository, 'promoteEligibleUserToModerator', async () => null);
  let rollback;
  t.mock.method(applicationRepository, 'rollbackApproval', async (id, decision) => {
    rollback = { id, decision };
    return pending;
  });
  await assert.rejects(
    () =>
      service.approve({
        applicationId: APPLICATION_ID,
        reviewedBy,
        actorRole: 'admin',
      }),
    (error) => error.code === 'MODERATOR_APPLICATION_NOT_ELIGIBLE'
  );
  assert.equal(rollback.id, APPLICATION_ID);
  assert.equal(rollback.decision.reviewedBy, ADMIN_ID);
  assert.equal(applicant.role, 'user');
  assert.equal(auditLogRepository.create.mock.callCount(), 0);
});

test('admin can reject an unverified pending application with a trimmed reason', async (t) => {
  const admin = userDoc({ id: ADMIN_ID, role: 'admin' });
  mockAuth(t, admin);
  t.mock.method(applicationRepository, 'findById', async () => applicationDoc());
  t.mock.method(applicationRepository, 'rejectPending', async (id, decision) => ({
    ...applicationDoc(),
    status: 'rejected',
    reviewedAt: decision.reviewedAt,
    reviewedBy: decision.reviewedBy,
    rejectionReason: decision.rejectionReason,
  }));
  const response = await request(app)
    .post(`/api/v1/staff/moderator-applications/${APPLICATION_ID}/reject`)
    .set('Authorization', `Bearer ${tokenFor(admin)}`)
    .send({ reason: '  insufficient detail  ' });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.application.rejectionReason, 'insufficient detail');
  const auditEvent = auditLogRepository.create.mock.calls[0].arguments[0];
  assert.deepEqual(auditEvent.metadata, { applicationId: APPLICATION_ID });
  assert.equal(JSON.stringify(auditEvent).includes('insufficient detail'), false);
});

test('rejection requires exactly one nonblank reason of at most 500 characters', async (t) => {
  const admin = userDoc({ id: ADMIN_ID, role: 'admin' });
  mockAuth(t, admin);
  for (const body of [{}, { reason: '   ' }, { reason: 'x'.repeat(501) }, { reason: 'ok', role: 'admin' }]) {
    const response = await request(app)
      .post(`/api/v1/staff/moderator-applications/${APPLICATION_ID}/reject`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send(body);
    assert.equal(response.status, 400);
  }
});

test('demotion is admin-only, hard-coded, preserves sessions, and stale moderator access is lost', async (t) => {
  let current = userDoc({ id: MODERATOR_ID, role: 'moderator', emailVerified: true });
  const admin = userDoc({ id: ADMIN_ID, role: 'admin' });
  t.mock.method(sessionRepository, 'findActiveById', async () => ({ _id: SESSION_ID, userId: ADMIN_ID }));
  t.mock.method(userRepository, 'findById', async () => admin);
  t.mock.method(userRepository, 'demoteModeratorToUser', async (id) => {
    assert.equal(id, MODERATOR_ID);
    current = { ...current, role: 'user' };
    return current;
  });
  const response = await request(app)
    .post(`/api/v1/staff/moderators/${MODERATOR_ID}/demote`)
    .set('Authorization', `Bearer ${tokenFor(admin)}`)
    .send({});
  assert.equal(response.status, 200);
  assert.equal(response.body.data.user.role, 'user');
  const auditEvent = auditLogRepository.create.mock.calls[0].arguments[0];
  assert.equal(auditEvent.actorUserId, ADMIN_ID);
  assert.equal(auditEvent.actorRole, 'admin');
  assert.equal(auditEvent.targetId, MODERATOR_ID);
  assert.deepEqual(auditEvent.metadata, { fromRole: 'moderator', toRole: 'user' });

  userRepository.findById.mock.mockImplementation(async () => current);
  sessionRepository.findActiveById.mock.mockImplementation(async () => ({
    _id: SESSION_ID,
    userId: MODERATOR_ID,
  }));
  const stale = await request(app)
    .get('/api/v1/staff/moderator-applications')
    .set('Authorization', `Bearer ${tokenFor(userDoc({ id: MODERATOR_ID, role: 'moderator' }))}`);
  assert.equal(stale.status, 403);
  assert.equal(stale.body.error.code, 'FORBIDDEN');
});

test('staff mutation success is preserved and not replayed when audit persistence fails', async (t) => {
  const admin = userDoc({ id: ADMIN_ID, role: 'admin' });
  mockAuth(t, admin);
  t.mock.method(applicationRepository, 'findById', async () => applicationDoc());
  const reject = t.mock.method(applicationRepository, 'rejectPending', async (id, decision) => ({
    ...applicationDoc(),
    status: 'rejected',
    ...decision,
    rejectionReason: decision.rejectionReason,
  }));
  const internal = 'MongoServerError credentials=private';
  auditLogRepository.create.mock.mockImplementation(async () => {
    throw new Error(internal);
  });
  const diagnostics = [];
  t.mock.method(console, 'error', (...args) => diagnostics.push(args));

  const response = await request(app)
    .post(`/api/v1/staff/moderator-applications/${APPLICATION_ID}/reject`)
    .set('Authorization', `Bearer ${tokenFor(admin)}`)
    .send({ reason: 'valid private reason' });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.application.status, 'rejected');
  assert.equal(reject.mock.callCount(), 1);
  assert.deepEqual(diagnostics, [['[audit] audit event was not recorded']]);
  assert.equal(JSON.stringify(diagnostics).includes(internal), false);
});

test('invalid application and target ids are controlled validation errors', async (t) => {
  const admin = userDoc({ id: ADMIN_ID, role: 'admin' });
  mockAuth(t, admin);
  const approve = await request(app)
    .post('/api/v1/staff/moderator-applications/not-an-id/approve')
    .set('Authorization', `Bearer ${tokenFor(admin)}`)
    .send({});
  const demote = await request(app)
    .post('/api/v1/staff/moderators/not-an-id/demote')
    .set('Authorization', `Bearer ${tokenFor(admin)}`)
    .send({});
  assert.equal(approve.status, 400);
  assert.equal(demote.status, 400);
});

test('user and moderator cannot approve, reject, or demote through staff routes', async (t) => {
  let caller = userDoc({ role: 'user' });
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: SESSION_ID,
    userId: String(caller._id),
  }));
  t.mock.method(userRepository, 'findById', async () => caller);
  const paths = [
    `/api/v1/staff/moderator-applications/${APPLICATION_ID}/approve`,
    `/api/v1/staff/moderator-applications/${APPLICATION_ID}/reject`,
    `/api/v1/staff/moderators/${MODERATOR_ID}/demote`,
  ];
  for (const role of ['user', 'moderator']) {
    caller = userDoc({ role });
    for (const path of paths) {
      const body = path.endsWith('/reject') ? { reason: 'No' } : {};
      const response = await request(app)
        .post(path)
        .set('Authorization', `Bearer ${tokenFor(caller)}`)
        .send(body);
      assert.equal(response.status, 403);
      assert.equal(response.body.error.code, 'FORBIDDEN');
    }
  }
});
