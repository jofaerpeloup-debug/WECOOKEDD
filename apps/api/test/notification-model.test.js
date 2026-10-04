const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Notification = require('../src/modules/notifications/notification.model');
const { NOTIFICATION_TYPES, RETENTION_MS } = Notification;
const { toPublicNotification } = require('../src/modules/notifications/notification.serializer');

const RECIPIENT = new mongoose.Types.ObjectId();
const TARGET = new mongoose.Types.ObjectId();
const CREATED_AT = new Date('2026-10-04T00:00:00.000Z');

function row(overrides = {}) {
  return new Notification({
    recipientId: RECIPIENT,
    type: 'savedRecipe',
    eventKey: 'favorite:one',
    content: { title: 'Saved recipe', body: 'Adobo was saved.' },
    action: { kind: 'recipe', recipeId: TARGET },
    createdAt: CREATED_AT,
    ...overrides,
  });
}

test('Notification has the exact frozen fields, enums, defaults, and no schema-owned indexes', async () => {
  const notification = row();
  await notification.validate();
  assert.deepEqual(NOTIFICATION_TYPES, [
    'savedRecipe', 'cookCompleted', 'collectionCreated', 'cookReminder',
    'communityLike', 'communityComment', 'communityFollow',
  ]);
  assert.equal(notification.readAt, null);
  assert.equal(notification.archivedAt, null);
  assert.equal(notification.expiresAt.getTime(), CREATED_AT.getTime() + RETENTION_MS);
  assert.equal(Notification.schema.path('updatedAt'), undefined);
  assert.equal(Notification.schema.path('recipientId').options.immutable, true);
  assert.equal(Notification.schema.path('eventKey').options.maxlength, 200);
  assert.deepEqual(Notification.schema.indexes(), []);
  const fields = Object.keys(notification.toObject()).filter((key) => !['_id', '__v'].includes(key)).sort();
  assert.deepEqual(fields, [
    'action', 'archivedAt', 'content', 'createdAt', 'eventKey', 'expiresAt',
    'readAt', 'recipientId', 'type',
  ]);
});

test('Notification enforces type/content/eventKey limits and exact 90-day expiry', async () => {
  for (const overrides of [
    { type: 'arbitrary' },
    { eventKey: '' },
    { eventKey: 'x'.repeat(201) },
    { content: { title: '', body: 'body' } },
    { content: { title: 'x'.repeat(121), body: 'body' } },
    { content: { title: 'title', body: 'x'.repeat(501) } },
    { expiresAt: new Date(CREATED_AT.getTime() + RETENTION_MS + 1) },
  ]) await assert.rejects(() => row(overrides).validate());
});

test('Notification action is a strict discriminated union', async () => {
  const valid = [
    { kind: 'none' },
    { kind: 'recipe', recipeId: TARGET },
    { kind: 'communityPost', postId: TARGET },
    { kind: 'mealPlan', entryId: TARGET },
  ];
  for (const action of valid) await assert.doesNotReject(() => row({ action }).validate());
  for (const action of [
    { kind: 'none', recipeId: TARGET },
    { kind: 'recipe' },
    { kind: 'recipe', recipeId: TARGET, postId: TARGET },
    { kind: 'communityPost', recipeId: TARGET },
    { kind: 'screen', route: 'Admin' },
  ]) await assert.rejects(() => row({ action }).validate());
  assert.equal(Notification.schema.options.strict, 'throw');
  assert.equal(Notification.schema.path('content').schema.options.strict, 'throw');
  assert.equal(Notification.schema.path('action').schema.options.strict, 'throw');
  await assert.rejects(
    () => row({ content: { title: 'title', body: 'body', html: '<b>x</b>' } }).validate(),
    { name: 'ValidationError' }
  );
  await assert.rejects(
    () => row({ action: { kind: 'none', url: 'https://evil.test' } }).validate(),
    { name: 'ValidationError' }
  );
  assert.throws(() => row({ metadata: { secret: true } }), { name: 'StrictModeError' });
});

test('serializer exposes only the exact allowlist for every action', () => {
  for (const action of [
    { kind: 'none' },
    { kind: 'recipe', recipeId: TARGET },
    { kind: 'communityPost', postId: TARGET },
    { kind: 'mealPlan', entryId: TARGET },
  ]) {
    const notification = row({ action });
    notification.privateUser = { email: 'private@example.com', role: 'admin' };
    const serialized = toPublicNotification(notification);
    assert.deepEqual(Object.keys(serialized).sort(), ['action', 'content', 'createdAt', 'id', 'readAt', 'type']);
    assert.deepEqual(Object.keys(serialized.content).sort(), ['body', 'title']);
    const raw = JSON.stringify(serialized);
    for (const forbidden of ['recipientId', 'eventKey', 'archivedAt', 'expiresAt', 'private@example.com', 'role']) {
      assert.equal(raw.includes(forbidden), false);
    }
  }
});
