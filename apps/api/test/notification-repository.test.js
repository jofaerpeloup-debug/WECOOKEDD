process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_notif_test';
process.env.JWT_ACCESS_SECRET = 'notification-test-secret-at-least-32-characters';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Notification = require('../src/modules/notifications/notification.model');
const repository = require('../src/modules/notifications/notification.repository');
const service = require('../src/modules/notifications/notification.service');

const OWNER = new mongoose.Types.ObjectId('507f1f77bcf86cd799439001');
const ID_A = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
const ID_B = new mongoose.Types.ObjectId('507f1f77bcf86cd799439012');
const ID_C = new mongoose.Types.ObjectId('507f1f77bcf86cd799439013');
const CREATED = new Date('2026-10-04T01:02:03.000Z');

function publicRow(id, overrides = {}) {
  return {
    _id: id,
    recipientId: OWNER,
    type: 'savedRecipe',
    eventKey: `event:${id}`,
    content: { title: 'Title', body: 'Body' },
    action: { kind: 'none' },
    readAt: null,
    archivedAt: null,
    createdAt: CREATED,
    expiresAt: new Date('2027-01-02T01:02:03.000Z'),
    ...overrides,
  };
}

test('findPage uses owner/active filters, exact descending tuple sort, and limit + 1 without skip', (t) => {
  let filter;
  let sort;
  let limit;
  const query = {
    sort(value) { sort = value; return this; },
    limit(value) { limit = value; return this; },
  };
  t.mock.method(Notification, 'find', (value) => { filter = value; return query; });
  const cursor = { createdAt: CREATED, id: ID_B };
  assert.equal(repository.findPage({ recipientId: OWNER, now: CREATED, cursor, limit: 20 }), query);
  assert.deepEqual(sort, { createdAt: -1, _id: -1 });
  assert.equal(limit, 21);
  assert.equal(typeof query.skip, 'undefined');
  assert.equal(String(filter.recipientId), String(OWNER));
  assert.deepEqual(filter.archivedAt, null);
  assert.deepEqual(filter.expiresAt, { $gt: CREATED });
  assert.deepEqual(filter.$or, [
    { createdAt: { $lt: CREATED } },
    { createdAt: CREATED, _id: { $lt: ID_B } },
  ]);
});

test('unread count is owner-wide and excludes archived/expired rows', (t) => {
  let filter;
  t.mock.method(Notification, 'countDocuments', (value) => { filter = value; return 7; });
  assert.equal(repository.countUnread(OWNER, CREATED), 7);
  assert.deepEqual(filter, {
    recipientId: OWNER,
    archivedAt: null,
    expiresAt: { $gt: CREATED },
    readAt: null,
  });
});

test('read and anchored mutations carry owner, active, unread, and exact tuple predicates', (t) => {
  const calls = [];
  t.mock.method(Notification, 'findOneAndUpdate', (...args) => { calls.push(['one', ...args]); return {}; });
  t.mock.method(Notification, 'updateMany', (...args) => { calls.push(['many', ...args]); return {}; });
  repository.markReadIfUnread(ID_A, OWNER, CREATED);
  repository.markReadThrough(OWNER, { createdAt: CREATED, id: ID_B }, CREATED);
  repository.archiveThrough(OWNER, { createdAt: CREATED, id: ID_B }, CREATED);
  assert.equal(calls.length, 3);
  assert.equal(String(calls[0][1]._id), String(ID_A));
  assert.equal(String(calls[0][1].recipientId), String(OWNER));
  assert.equal(calls[0][1].readAt, null);
  assert.deepEqual(calls[1][1].$or, [
    { createdAt: { $lt: CREATED } },
    { createdAt: CREATED, _id: { $lte: ID_B } },
  ]);
  assert.equal(calls[1][1].readAt, null);
  assert.equal(calls[2][1].readAt, undefined);
  assert.deepEqual(calls[2][2], { $set: { archivedAt: CREATED } });
});

test('cursor is signed, canonical, versioned, and contains only ordering identity', () => {
  const secret = 'x'.repeat(40);
  const cursor = service.encodeCursor(publicRow(ID_A), secret);
  const decoded = service.decodeCursor(cursor, secret);
  assert.equal(decoded.createdAt.toISOString(), CREATED.toISOString());
  assert.equal(String(decoded.id), String(ID_A));
  const [payload] = cursor.split('.');
  assert.deepEqual(Object.keys(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))), ['v', 'c', 'i']);
  for (const invalid of [
    'not-a-cursor',
    `${payload}.bad`,
    `${cursor}=`,
    service.encodeCursor(publicRow(ID_A), 'y'.repeat(40)),
  ]) assert.throws(() => service.decodeCursor(invalid, secret), (error) => error.code === 'VALIDATION_ERROR');
});

test('list is deterministic at equal timestamps, drops the sentinel, and returns a fresh count', async (t) => {
  t.mock.method(repository, 'findPage', async () => [publicRow(ID_C), publicRow(ID_B), publicRow(ID_A)]);
  t.mock.method(repository, 'countUnread', async () => 19);
  const result = await service.listNotifications({ recipientId: OWNER, limit: 2 });
  assert.deepEqual(result.notifications.map((row) => row.id), [String(ID_C), String(ID_B)]);
  assert.equal(result.unreadCount, 19);
  assert.equal(result.pageInfo.hasMore, true);
  const tuple = service.decodeCursor(result.pageInfo.nextCursor);
  assert.equal(String(tuple.id), String(ID_B));
  assert.equal(tuple.createdAt.toISOString(), CREATED.toISOString());
});

test('anchored read-all leaves newer inserts to the exact post-write unread count', async (t) => {
  let receivedAnchor;
  t.mock.method(repository, 'findOwnedActiveById', async () => publicRow(ID_B));
  t.mock.method(repository, 'markReadThrough', async (_owner, anchor) => { receivedAnchor = anchor; return { modifiedCount: 2 }; });
  t.mock.method(repository, 'countUnread', async () => 1);
  const result = await service.markAllRead({ recipientId: OWNER, throughNotificationId: ID_B });
  assert.equal(String(receivedAnchor.id), String(ID_B));
  assert.equal(result.unreadCount, 1, 'newer concurrent row remains unread');
});

test('anchored archive-all leaves newer inserts visible and countable', async (t) => {
  let receivedAnchor;
  t.mock.method(repository, 'findOwnedActiveById', async () => publicRow(ID_B));
  t.mock.method(repository, 'archiveThrough', async (_owner, anchor) => { receivedAnchor = anchor; return { modifiedCount: 2 }; });
  t.mock.method(repository, 'countUnread', async () => 1);
  const result = await service.archiveAll({ recipientId: OWNER, throughNotificationId: ID_B });
  assert.equal(String(receivedAnchor.id), String(ID_B));
  assert.equal(result.unreadCount, 1);
});

test('single read is idempotent and preserves the first readAt', async (t) => {
  const firstReadAt = new Date('2026-10-04T02:00:00.000Z');
  let attempts = 0;
  t.mock.method(repository, 'markReadIfUnread', async () => {
    attempts += 1;
    return attempts === 1 ? publicRow(ID_A, { readAt: firstReadAt }) : null;
  });
  t.mock.method(repository, 'findOwnedActiveById', async () => publicRow(ID_A, { readAt: firstReadAt }));
  t.mock.method(repository, 'countUnread', async () => 0);
  const first = await service.markRead({ recipientId: OWNER, notificationId: ID_A });
  const repeated = await service.markRead({ recipientId: OWNER, notificationId: ID_A });
  assert.deepEqual(first.notification.readAt, firstReadAt);
  assert.deepEqual(repeated.notification.readAt, firstReadAt);
});

test('missing, foreign, archived, and expired anchors are one opaque not-found result', async (t) => {
  t.mock.method(repository, 'findOwnedActiveById', async () => null);
  for (const operation of [service.markAllRead, service.archiveAll]) {
    await assert.rejects(
      () => operation({ recipientId: OWNER, throughNotificationId: ID_A }),
      (error) => error.statusCode === 404 && error.code === 'NOTIFICATION_NOT_FOUND'
    );
  }
});
