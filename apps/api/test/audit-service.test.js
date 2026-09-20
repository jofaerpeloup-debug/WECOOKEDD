const test = require('node:test');
const assert = require('node:assert/strict');

const auditService = require('../src/modules/audit/audit.service');
const auditLogRepository = require('../src/modules/audit/audit-log.repository');

const ACTOR_ID = '507f1f77bcf86cd799439301';
const USER_ID = '507f1f77bcf86cd799439302';
const APPLICATION_ID = '507f1f77bcf86cd799439303';

function event(overrides = {}) {
  return {
    eventType: 'admin.user.status_changed',
    actorUserId: ACTOR_ID,
    actorRole: 'admin',
    targetType: 'user',
    targetId: USER_ID,
    outcome: 'success',
    metadata: { fromStatus: 'active', toStatus: 'suspended' },
    ...overrides,
  };
}

test('AuditService constructs exactly the four approved event shapes', async (t) => {
  const captured = [];
  t.mock.method(auditLogRepository, 'create', async (value) => {
    captured.push(value);
    return { _id: String(captured.length), ...value };
  });

  await auditService.record(event());
  await auditService.record(
    event({
      eventType: 'admin.staff.moderator_approved',
      targetId: USER_ID,
      metadata: { applicationId: APPLICATION_ID, fromRole: 'user', toRole: 'moderator' },
    })
  );
  await auditService.record(
    event({
      eventType: 'admin.staff.application_rejected',
      targetType: 'moderator_application',
      targetId: APPLICATION_ID,
      metadata: { applicationId: APPLICATION_ID },
    })
  );
  await auditService.record(
    event({
      eventType: 'admin.staff.moderator_demoted',
      targetId: USER_ID,
      metadata: { fromRole: 'moderator', toRole: 'user' },
    })
  );

  assert.equal(captured.length, 4);
  assert.deepEqual(captured.map((value) => value.eventType), [
    'admin.user.status_changed',
    'admin.staff.moderator_approved',
    'admin.staff.application_rejected',
    'admin.staff.moderator_demoted',
  ]);
  assert.deepEqual(captured[0], event());
  assert.equal('reason' in captured[2].metadata, false);
});

test('AuditService accepts the single approved partial-failure reason code', async (t) => {
  let captured;
  t.mock.method(auditLogRepository, 'create', async (value) => (captured = value));
  const result = await auditService.record(
    event({ outcome: 'partial_failure', reasonCode: 'SESSION_REVOCATION_FAILED' })
  );
  assert.equal(result, captured);
  assert.equal(captured.reasonCode, 'SESSION_REVOCATION_FAILED');
});

test('AuditService rejects unexpected metadata and arbitrary payloads before persistence', async (t) => {
  const create = t.mock.method(auditLogRepository, 'create', async () => {
    throw new Error('must not be called');
  });
  const diagnostics = [];
  t.mock.method(console, 'error', (...args) => diagnostics.push(args));

  const rejected = await Promise.all([
    auditService.record(event({ metadata: { fromStatus: 'active', toStatus: 'suspended', email: 'x@example.com' } })),
    auditService.record(event({ rawBody: { password: 'plaintext' } })),
    auditService.record({ body: { accessToken: 'secret' }, headers: { authorization: 'Bearer secret' } }),
    auditService.record(event({ targetType: 'session' })),
    auditService.record(event({ outcome: 'partial_failure', reasonCode: 'DRIVER_ERROR' })),
    auditService.record(event({ metadata: { fromStatus: undefined, toStatus: 'suspended' } })),
    auditService.record(
      event({
        eventType: 'admin.staff.moderator_demoted',
        metadata: { fromRole: 'admin', toRole: 'user' },
      })
    ),
  ]);

  assert.deepEqual(rejected, [null, null, null, null, null, null, null]);
  assert.equal(create.mock.callCount(), 0);
  assert.equal(diagnostics.length, 7);
  const diagnosticText = JSON.stringify(diagnostics);
  for (const forbidden of ['plaintext', 'secret', 'x@example.com', 'DRIVER_ERROR']) {
    assert.equal(diagnosticText.includes(forbidden), false);
  }
});

test('AuditService contains repository failures and emits only a fixed diagnostic', async (t) => {
  const internal = 'MongoServerError mongodb://user:password@private-host';
  t.mock.method(auditLogRepository, 'create', async () => {
    throw new Error(internal);
  });
  const diagnostics = [];
  t.mock.method(console, 'error', (...args) => diagnostics.push(args));

  const result = await auditService.record(event());

  assert.equal(result, null);
  assert.deepEqual(diagnostics, [['[audit] audit event was not recorded']]);
  assert.equal(JSON.stringify(diagnostics).includes(internal), false);
  assert.deepEqual(Object.keys(auditService), ['record', 'list']);
});

test('AuditService constructs the approved read filter and pagination only', async (t) => {
  const from = new Date('2026-09-01T00:00:00Z');
  const to = new Date('2026-09-20T23:59:59Z');
  let findOptions;
  let countFilter;
  t.mock.method(auditLogRepository, 'findMany', async (value) => {
    findOptions = value;
    return [{ _id: '1' }];
  });
  t.mock.method(auditLogRepository, 'countByFilter', async (value) => {
    countFilter = value;
    return 51;
  });

  const result = await auditService.list({
    eventType: 'admin.user.status_changed',
    actorUserId: ACTOR_ID,
    targetType: 'user',
    targetId: USER_ID,
    outcome: 'partial_failure',
    from,
    to,
    page: 3,
    limit: 25,
    actorRole: 'admin',
    sort: { createdAt: 1 },
  });

  assert.deepEqual(findOptions, {
    filter: {
      eventType: 'admin.user.status_changed',
      actorUserId: ACTOR_ID,
      targetType: 'user',
      targetId: USER_ID,
      outcome: 'partial_failure',
      createdAt: { $gte: from, $lte: to },
    },
    skip: 50,
    limit: 25,
  });
  assert.equal(countFilter, findOptions.filter);
  assert.deepEqual(result, { items: [{ _id: '1' }], total: 51, page: 3, limit: 25 });
});

test('AuditService supports empty and one-sided filters', async (t) => {
  const calls = [];
  t.mock.method(auditLogRepository, 'findMany', async (value) => {
    calls.push(value);
    return [];
  });
  t.mock.method(auditLogRepository, 'countByFilter', async () => 0);

  const empty = await auditService.list({ page: 1, limit: 20 });
  const from = new Date('2026-09-01T00:00:00Z');
  const bounded = await auditService.list({ from, page: 2, limit: 10 });

  assert.deepEqual(calls, [
    { filter: {}, skip: 0, limit: 20 },
    { filter: { createdAt: { $gte: from } }, skip: 10, limit: 10 },
  ]);
  assert.deepEqual(empty, { items: [], total: 0, page: 1, limit: 20 });
  assert.deepEqual(bounded, { items: [], total: 0, page: 2, limit: 10 });
});

test('AuditService invokes list and count concurrently', async (t) => {
  let findStarted = false;
  let countStarted = false;
  let releaseFind;
  const findBlocked = new Promise((resolve) => {
    releaseFind = resolve;
  });
  t.mock.method(auditLogRepository, 'findMany', async () => {
    findStarted = true;
    await findBlocked;
    return [];
  });
  t.mock.method(auditLogRepository, 'countByFilter', async () => {
    countStarted = true;
    releaseFind();
    return 0;
  });

  await auditService.list({ page: 1, limit: 20 });
  assert.equal(findStarted, true);
  assert.equal(countStarted, true);
});

test('AuditService read failures propagate instead of becoming best-effort', async (t) => {
  const failure = new Error('database read failed');
  t.mock.method(auditLogRepository, 'findMany', async () => {
    throw failure;
  });
  t.mock.method(auditLogRepository, 'countByFilter', async () => 0);

  await assert.rejects(
    () => auditService.list({ page: 1, limit: 20 }),
    (error) => error === failure
  );
});
