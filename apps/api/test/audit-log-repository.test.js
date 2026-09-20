const test = require('node:test');
const assert = require('node:assert/strict');

const AuditLog = require('../src/modules/audit/audit-log.model');
const repository = require('../src/modules/audit/audit-log.repository');

test('repository creates and returns an allowlisted audit event', async (t) => {
  const event = {
    eventType: 'admin.staff.moderator_demoted',
    actorUserId: '507f1f77bcf86cd799439301',
    actorRole: 'admin',
    targetType: 'user',
    targetId: '507f1f77bcf86cd799439302',
    outcome: 'success',
    metadata: { fromRole: 'moderator', toRole: 'user' },
  };
  const created = { _id: '507f1f77bcf86cd799439303', ...event };
  let captured;
  t.mock.method(AuditLog, 'create', async (value) => {
    captured = value;
    return created;
  });

  const result = await repository.create(event);

  assert.equal(captured, event);
  assert.equal(result, created);
});

test('repository exposes creation only, never update or delete operations', () => {
  assert.deepEqual(Object.keys(repository).sort(), ['create']);
  assert.equal(repository.update, undefined);
  assert.equal(repository.delete, undefined);
  assert.equal(repository.updateById, undefined);
  assert.equal(repository.deleteById, undefined);
});
