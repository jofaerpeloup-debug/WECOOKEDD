const test = require('node:test');
const assert = require('node:assert/strict');

const AuditLog = require('../src/modules/audit/audit-log.model');

const ACTOR_ID = '507f1f77bcf86cd799439301';
const TARGET_ID = '507f1f77bcf86cd799439302';

function validEvent(overrides = {}) {
  return {
    eventType: 'admin.user.status_changed',
    actorUserId: ACTOR_ID,
    actorRole: 'admin',
    targetType: 'user',
    targetId: TARGET_ID,
    outcome: 'success',
    metadata: { fromStatus: 'active', toStatus: 'suspended' },
    ...overrides,
  };
}

test('AuditLog has only the approved Phase 2 fields and a createdAt timestamp', () => {
  const paths = Object.keys(AuditLog.schema.paths)
    .filter((path) => !['_id', '__v'].includes(path))
    .sort();
  assert.deepEqual(paths, [
    'actorRole',
    'actorUserId',
    'createdAt',
    'eventType',
    'metadata',
    'outcome',
    'reasonCode',
    'targetId',
    'targetType',
  ]);
  assert.deepEqual(AuditLog.schema.options.timestamps, {
    createdAt: true,
    updatedAt: false,
  });
  assert.equal(AuditLog.schema.path('updatedAt'), undefined);
  assert.equal(AuditLog.schema.path('occurredAt'), undefined);

  const document = new AuditLog(validEvent());
  document.initializeTimestamps();
  assert.ok(document.createdAt instanceof Date);
});

test('all required AuditLog fields are enforced', async () => {
  for (const field of [
    'eventType',
    'actorUserId',
    'actorRole',
    'targetType',
    'targetId',
    'outcome',
  ]) {
    const value = validEvent();
    delete value[field];
    await assert.rejects(() => new AuditLog(value).validate(), undefined, field);
  }
});

test('only approved event types, actor roles, target types, and outcomes validate', async () => {
  for (const eventType of AuditLog.EVENT_TYPES) {
    await assert.doesNotReject(() => new AuditLog(validEvent({ eventType })).validate());
  }
  for (const actorRole of ['user', 'moderator', 'admin']) {
    await assert.doesNotReject(() => new AuditLog(validEvent({ actorRole })).validate());
  }
  for (const targetType of AuditLog.TARGET_TYPES) {
    await assert.doesNotReject(() => new AuditLog(validEvent({ targetType })).validate());
  }
  for (const outcome of AuditLog.OUTCOMES) {
    await assert.doesNotReject(() =>
      new AuditLog(
        validEvent({
          outcome,
          ...(outcome === 'partial_failure'
            ? { reasonCode: 'SESSION_REVOCATION_FAILED' }
            : {}),
        })
      ).validate()
    );
  }

  await assert.rejects(() =>
    new AuditLog(validEvent({ eventType: 'admin.user.deleted' })).validate()
  );
  await assert.rejects(() => new AuditLog(validEvent({ actorRole: 'owner' })).validate());
  await assert.rejects(() => new AuditLog(validEvent({ targetType: 'session' })).validate());
  await assert.rejects(() => new AuditLog(validEvent({ outcome: 'failure' })).validate());
});

test('metadata is a strict allowlisted subdocument with bounded enum values', async () => {
  await assert.doesNotReject(() =>
    new AuditLog(
      validEvent({
        metadata: {
          applicationId: TARGET_ID,
          fromStatus: 'active',
          toStatus: 'suspended',
          fromRole: 'user',
          toRole: 'moderator',
        },
      })
    ).validate()
  );

  const stripped = new AuditLog(validEvent({ metadata: { passwordHash: 'forbidden' } }));
  assert.equal(stripped.metadata, undefined);
  assert.throws(() => new AuditLog({ ...validEvent(), rawRequestBody: {} }), /strict/i);
  await assert.rejects(() =>
    new AuditLog(validEvent({ metadata: { fromStatus: 'deleted', toStatus: 'active' } })).validate()
  );
  assert.equal(AuditLog.schema.path('metadata.email'), undefined);
  assert.equal(AuditLog.schema.path('metadata.rejectionReason'), undefined);
});

test('AuditLog adds no custom update or delete model behavior', () => {
  assert.deepEqual(Object.keys(AuditLog.schema.statics), []);
  const methods = Object.keys(AuditLog.schema.methods);
  assert.equal(methods.some((name) => /update|delete|remove/i.test(name)), false);
});

test('AuditLog has only the approved stable newest-first compound index', () => {
  const customIndexes = AuditLog.schema.indexes();
  assert.deepEqual(customIndexes, [
    [
      { createdAt: -1, _id: -1 },
      { name: 'audit_log_newest_first' },
    ],
  ]);
  assert.equal(customIndexes.some(([, options]) => options.expireAfterSeconds !== undefined), false);
});
