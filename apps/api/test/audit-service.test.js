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
  assert.deepEqual(Object.keys(auditService), ['record']);
});
