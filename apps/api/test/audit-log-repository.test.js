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

test('repository applies the fixed stable newest-first sort, skip, and limit', async (t) => {
  const calls = [];
  const expected = [{ _id: '507f1f77bcf86cd799439399' }];
  const query = {
    sort(value) {
      calls.push(['sort', value]);
      return this;
    },
    skip(value) {
      calls.push(['skip', value]);
      return this;
    },
    limit(value) {
      calls.push(['limit', value]);
      return Promise.resolve(expected);
    },
  };
  const filter = { eventType: 'admin.user.status_changed' };
  const find = t.mock.method(AuditLog, 'find', (value) => {
    calls.push(['find', value]);
    return query;
  });

  const result = await repository.findMany({ filter, skip: 40, limit: 20 });

  assert.equal(find.mock.callCount(), 1);
  assert.deepEqual(calls, [
    ['find', filter],
    ['sort', { createdAt: -1, _id: -1 }],
    ['skip', 40],
    ['limit', 20],
  ]);
  assert.equal(result, expected);
});

test('repository counts by the already-constructed filter', async (t) => {
  const filter = { outcome: 'partial_failure' };
  let captured;
  t.mock.method(AuditLog, 'countDocuments', async (value) => {
    captured = value;
    return 7;
  });
  assert.equal(await repository.countByFilter(filter), 7);
  assert.equal(captured, filter);
});

test('repository exposes create and read operations only, never mutations', () => {
  assert.deepEqual(Object.keys(repository).sort(), ['countByFilter', 'create', 'findMany']);
  assert.equal(repository.update, undefined);
  assert.equal(repository.delete, undefined);
  assert.equal(repository.updateById, undefined);
  assert.equal(repository.deleteById, undefined);
  assert.equal(repository.replace, undefined);
  assert.equal(repository.upsert, undefined);
  assert.equal(repository.updateMany, undefined);
  assert.equal(repository.deleteMany, undefined);
});
