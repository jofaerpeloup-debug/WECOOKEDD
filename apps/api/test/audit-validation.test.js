const test = require('node:test');
const assert = require('node:assert/strict');

const { listAuditLogsSchema } = require('../src/modules/audit/audit.validation');
const {
  EVENT_TYPES,
  TARGET_TYPES,
  OUTCOMES,
} = require('../src/modules/audit/audit-log.model');

const ACTOR_ID = '507f1f77bcf86cd799439301';
const TARGET_ID = '507f1f77bcf86cd799439302';

function parse(query) {
  return listAuditLogsSchema.safeParse({ query });
}

test('listAuditLogsSchema applies pagination defaults', () => {
  const result = parse({});
  assert.equal(result.success, true);
  assert.deepEqual(result.data.query, { page: 1, limit: 20 });
});

test('listAuditLogsSchema accepts and transforms every approved filter', () => {
  const result = parse({
    eventType: 'admin.staff.moderator_approved',
    actorUserId: ACTOR_ID,
    targetType: 'user',
    targetId: TARGET_ID,
    outcome: 'success',
    from: '2026-09-01T01:02:03.000Z',
    to: '2026-09-02T09:10:11+08:00',
    page: '3',
    limit: '100',
  });

  assert.equal(result.success, true);
  assert.equal(result.data.query.page, 3);
  assert.equal(result.data.query.limit, 100);
  assert.deepEqual(result.data.query.from, new Date('2026-09-01T01:02:03.000Z'));
  assert.deepEqual(result.data.query.to, new Date('2026-09-02T09:10:11+08:00'));
});

test('listAuditLogsSchema rejects invalid page and limit scalars', () => {
  for (const query of [
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { page: 'not-a-number' },
    { page: ['1', '2'] },
    { page: ['1'] },
    { limit: '0' },
    { limit: '101' },
    { limit: '1.5' },
    { limit: 'not-a-number' },
    { limit: ['20', '30'] },
    { limit: ['20'] },
  ]) {
    assert.equal(parse(query).success, false, `expected ${JSON.stringify(query)} rejected`);
  }
});

test('listAuditLogsSchema rejects malformed, repeated, and operator-shaped ObjectIds', () => {
  for (const query of [
    { actorUserId: 'not-an-id' },
    { targetId: 'not-an-id' },
    { actorUserId: [ACTOR_ID] },
    { targetId: [TARGET_ID, ACTOR_ID] },
    { actorUserId: { $ne: null } },
    { targetId: { $gt: TARGET_ID } },
  ]) {
    assert.equal(parse(query).success, false, `expected ${JSON.stringify(query)} rejected`);
  }
});

test('listAuditLogsSchema accepts every authoritative AuditLog enum value', () => {
  for (const eventType of EVENT_TYPES) {
    assert.equal(parse({ eventType }).success, true, `expected eventType ${eventType} accepted`);
  }
  for (const targetType of TARGET_TYPES) {
    assert.equal(parse({ targetType }).success, true, `expected targetType ${targetType} accepted`);
  }
  for (const outcome of OUTCOMES) {
    assert.equal(parse({ outcome }).success, true, `expected outcome ${outcome} accepted`);
  }
});

test('listAuditLogsSchema rejects invalid or non-scalar AuditLog enum values', () => {
  for (const query of [
    { eventType: 'admin.user.deleted' },
    { targetType: 'session' },
    { outcome: 'failure' },
    { eventType: ['admin.user.status_changed'] },
    { targetType: { $ne: 'user' } },
    { outcome: ['success', 'partial_failure'] },
  ]) {
    assert.equal(parse(query).success, false, `expected ${JSON.stringify(query)} rejected`);
  }
});

test('listAuditLogsSchema requires ISO-8601 timestamps with timezone information', () => {
  for (const value of [
    '2026-09-01',
    '2026-09-01T01:02:03',
    '09/01/2026',
    'not-a-date',
    '2026-02-30T01:02:03Z',
  ]) {
    assert.equal(parse({ from: value }).success, false, `expected ${value} rejected`);
  }
  assert.equal(parse({ from: ['2026-09-01T01:02:03Z'] }).success, false);
  assert.equal(parse({ to: { $gte: '2026-09-01T01:02:03Z' } }).success, false);
});

test('listAuditLogsSchema rejects an inverted date range', () => {
  assert.equal(
    parse({
      from: '2026-09-02T00:00:00Z',
      to: '2026-09-01T23:59:59Z',
    }).success,
    false
  );
  assert.equal(
    parse({
      from: '2026-09-02T00:00:00Z',
      to: '2026-09-02T00:00:00Z',
    }).success,
    true
  );
});

test('listAuditLogsSchema rejects unknown and deferred query keys', () => {
  for (const query of [
    { actorRole: 'admin' },
    { sort: 'newest' },
    { search: 'Ada' },
    { email: 'ada@example.com' },
    { ipAddress: '127.0.0.1' },
    { unknown: 'value' },
  ]) {
    assert.equal(parse(query).success, false, `expected ${JSON.stringify(query)} rejected`);
  }
});
