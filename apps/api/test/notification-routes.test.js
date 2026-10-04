process.env.NODE_ENV = 'test';
process.env.PORT = '4051';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_notif_test';
process.env.CORS_ORIGINS = '';
process.env.JWT_ACCESS_SECRET = 'notification-route-secret-at-least-32-characters';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createApp } = require('../src/app');
const userRepository = require('../src/modules/users/user.repository');
const sessionRepository = require('../src/modules/sessions/session.repository');
const notificationRepository = require('../src/modules/notifications/notification.repository');
const { signAccessToken } = require('../src/shared/security/access-token');

const app = createApp();
const OWNER = '507f1f77bcf86cd799439001';
const OTHER = '507f1f77bcf86cd799439002';
const SESSION = '507f1f77bcf86cd799439003';
const ROW_A = '507f1f77bcf86cd799439011';
const ROW_B = '507f1f77bcf86cd799439012';
const MISSING = '507f1f77bcf86cd799439099';
const CREATED = new Date('2026-10-04T01:02:03.000Z');

function authToken() {
  return signAccessToken({ userId: OWNER, sessionId: SESSION, role: 'user' });
}

function mockAuth(t) {
  t.mock.method(sessionRepository, 'findActiveById', async () => ({ _id: SESSION, userId: OWNER }));
  t.mock.method(userRepository, 'findById', async () => ({ _id: OWNER, role: 'user', status: 'active' }));
  return `Bearer ${authToken()}`;
}

function row(id = ROW_A, overrides = {}) {
  return {
    _id: id,
    recipientId: OWNER,
    type: 'communityComment',
    eventKey: `event:${id}`,
    content: { title: 'New comment', body: 'Someone commented.' },
    action: { kind: 'communityPost', postId: ROW_B },
    readAt: null,
    archivedAt: null,
    createdAt: CREATED,
    expiresAt: new Date('2027-01-02T01:02:03.000Z'),
    private: { email: 'secret@example.com' },
    ...overrides,
  };
}

test('authentication runs before query/path/body validation and every error is no-store', async () => {
  for (const call of [
    request(app).get('/api/v1/notifications?unknown=x'),
    request(app).patch('/api/v1/notifications/not-an-id/read').send({ injected: true }),
    request(app).patch('/api/v1/notifications/read-all').send({ throughNotificationId: 'bad' }),
  ]) {
    const response = await call;
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'AUTH_TOKEN_MISSING');
    assert.equal(response.headers['cache-control'], 'no-store');
  }
});

test('GET uses only authenticated owner, strict query, exact serializer, and fresh owner-wide count', async (t) => {
  const authorization = mockAuth(t);
  let captured;
  t.mock.method(notificationRepository, 'findPage', async (input) => { captured = input; return [row()]; });
  t.mock.method(notificationRepository, 'countUnread', async (owner) => {
    assert.equal(String(owner), OWNER);
    return 8;
  });
  const response = await request(app).get('/api/v1/notifications?limit=1').set('Authorization', authorization);
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(String(captured.recipientId), OWNER);
  assert.equal(captured.limit, 1);
  assert.deepEqual(Object.keys(response.body.data).sort(), ['notifications', 'pageInfo', 'unreadCount']);
  assert.deepEqual(Object.keys(response.body.data.notifications[0]).sort(), ['action', 'content', 'createdAt', 'id', 'readAt', 'type']);
  assert.equal(response.body.data.unreadCount, 8);
  const raw = JSON.stringify(response.body);
  for (const forbidden of ['recipientId', 'eventKey', 'expiresAt', 'archivedAt', 'secret@example.com']) {
    assert.equal(raw.includes(forbidden), false);
  }

  const unknown = await request(app).get('/api/v1/notifications?ownerId=' + OTHER).set('Authorization', authorization);
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error.code, 'VALIDATION_ERROR');
  assert.equal(unknown.headers['cache-control'], 'no-store');
});

test('malformed and tampered cursors fail closed without exposing decoded internals', async (t) => {
  const authorization = mockAuth(t);
  let queried = false;
  t.mock.method(notificationRepository, 'findPage', async () => { queried = true; return []; });
  t.mock.method(notificationRepository, 'countUnread', async () => 0);
  const response = await request(app).get('/api/v1/notifications?cursor=eyJ2Ijo5OX0.bad').set('Authorization', authorization);
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.equal(JSON.stringify(response.body).includes('signature'), false);
  assert.equal(queried, false);
});

test('single read is owner-scoped, idempotent, strict, and returns an exact count', async (t) => {
  const authorization = mockAuth(t);
  const readAt = new Date('2026-10-04T02:00:00.000Z');
  let ownerSeen;
  t.mock.method(notificationRepository, 'markReadIfUnread', async (_id, owner) => {
    ownerSeen = String(owner);
    return row(ROW_A, { readAt });
  });
  t.mock.method(notificationRepository, 'countUnread', async () => 3);
  const response = await request(app)
    .patch(`/api/v1/notifications/${ROW_A}/read`)
    .set('Authorization', authorization)
    .send({});
  assert.equal(response.status, 200);
  assert.equal(ownerSeen, OWNER);
  assert.equal(response.body.data.unreadCount, 3);
  assert.equal(response.body.data.notification.readAt, readAt.toISOString());

  const extra = await request(app)
    .patch(`/api/v1/notifications/${ROW_A}/read`)
    .set('Authorization', authorization)
    .send({ read: true });
  assert.equal(extra.status, 400);
});

test('foreign, missing, archived, and expired IDs share opaque 404 semantics', async (t) => {
  const authorization = mockAuth(t);
  t.mock.method(notificationRepository, 'markReadIfUnread', async () => null);
  t.mock.method(notificationRepository, 'findOwnedActiveById', async () => null);
  for (const id of [ROW_A, MISSING]) {
    const response = await request(app)
      .patch(`/api/v1/notifications/${id}/read`)
      .set('Authorization', authorization)
      .send({});
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'NOTIFICATION_NOT_FOUND');
    assert.equal(response.headers['cache-control'], 'no-store');
  }
});

test('read-all and archive-all resolve owner-scoped anchors and send no client timestamps or ID lists', async (t) => {
  const authorization = mockAuth(t);
  const operations = [];
  t.mock.method(notificationRepository, 'findOwnedActiveById', async (id, owner) => {
    assert.equal(String(owner), OWNER);
    return row(String(id));
  });
  t.mock.method(notificationRepository, 'markReadThrough', async (owner, anchor) => {
    operations.push(['read', String(owner), String(anchor.id)]);
    return { modifiedCount: 1 };
  });
  t.mock.method(notificationRepository, 'archiveThrough', async (owner, anchor) => {
    operations.push(['archive', String(owner), String(anchor.id)]);
    return { modifiedCount: 1 };
  });
  t.mock.method(notificationRepository, 'countUnread', async () => 1);

  const readAll = await request(app).patch('/api/v1/notifications/read-all')
    .set('Authorization', authorization).send({ throughNotificationId: ROW_A });
  const archiveAll = await request(app).post('/api/v1/notifications/archive-all')
    .set('Authorization', authorization).send({ throughNotificationId: ROW_A });
  assert.equal(readAll.status, 200);
  assert.equal(archiveAll.status, 200);
  assert.deepEqual(operations, [['read', OWNER, ROW_A], ['archive', OWNER, ROW_A]]);
  assert.deepEqual(readAll.body.data, { unreadCount: 1 });
  assert.deepEqual(archiveAll.body.data, { unreadCount: 1 });

  for (const body of [
    {},
    { throughNotificationId: ROW_A, recipientId: OTHER },
    { throughNotificationId: ROW_A, timestamp: CREATED.toISOString() },
    { throughNotificationId: [ROW_A] },
  ]) {
    const invalid = await request(app).patch('/api/v1/notifications/read-all')
      .set('Authorization', authorization).send(body);
    assert.equal(invalid.status, 400);
  }
});

test('no notification create or arbitrary mutation endpoint exists', async (t) => {
  const authorization = mockAuth(t);
  for (const response of [
    await request(app).post('/api/v1/notifications').set('Authorization', authorization).send({ type: 'savedRecipe' }),
    await request(app).delete(`/api/v1/notifications/${ROW_A}`).set('Authorization', authorization),
  ]) {
    assert.equal(response.status, 404);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
});
