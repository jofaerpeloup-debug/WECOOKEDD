const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const repo = require('../src/modules/assistant/assistant-history.repository');
const Conversation = require('../src/modules/assistant/assistant-conversation.model');
const Message = require('../src/modules/assistant/assistant-message.model');
const Request = require('../src/modules/assistant/assistant-request.model');
const userId = '507f1f77bcf86cd799439011';
const conversationId = '507f1f77bcf86cd799439021';
const now = new Date('2026-10-15T00:00:00.000Z');
const expiresAt = new Date(+now + 2592000000);
const parent = { _id: conversationId, userId, createdAt: now, updatedAt: now, expiresAt, version: 2 };
function query(row, observed = {}) {
  return { sort(value) { observed.sort = value; return this; },
    limit(value) { observed.limit = value; return this; },
    session(value) { observed.session = value; return this; }, lean: async () => row };
}

test('every page/child read carries owner, live expiry, bounded stable cursor predicates', async (t) => {
  const observed = {};
  t.mock.method(Conversation, 'find', (filter) => { observed.filter = filter; return query([], observed); });
  const boundary = { createdAt: now, id: conversationId };
  await repo.findConversations({ userId, now, cursor: boundary, limit: 20 });
  assert.deepEqual(observed, { filter: { userId, expiresAt: { $gt: now }, $or: [
    { createdAt: { $lt: now } }, { createdAt: now, _id: { $lt: conversationId } },
  ] }, sort: { createdAt: -1, _id: -1 }, limit: 21 });
  t.mock.method(Conversation, 'findOne', (filter) => { observed.parent = filter; return query(parent); });
  await repo.findConversation({ userId, conversationId, now });
  assert.deepEqual(observed.parent, { _id: conversationId, userId, expiresAt: { $gt: now } });
  const child = {};
  t.mock.method(Message, 'find', (filter) => { child.filter = filter; return query([], child); });
  await repo.findMessages({ userId, conversationId, expiresAt, now, cursor: { sequence: 42 }, limit: 50 });
  assert.deepEqual(child, { filter: { userId, conversationId, expiresAt: { $eq: expiresAt, $gt: now },
    sequence: { $lt: 42 } }, sort: { sequence: -1 }, limit: 51 });
});

test('Create races recover the unique owner/create key without upsert or renewed timestamps', async (t) => {
  let reads = 0;
  const find = t.mock.method(Conversation, 'findOne', (filter) => {
    assert.deepEqual(filter, { userId, createRequestId: 'key' });
    return query(++reads === 1 ? null : parent);
  });
  const create = t.mock.method(Conversation, 'create', async (data) => {
    assert.deepEqual(data, { userId, createRequestId: 'key', createdAt: now, updatedAt: now, expiresAt });
    throw Object.assign(new Error('duplicate'), { code: 11000 });
  });
  assert.deepEqual(await repo.createConversation({ userId, requestId: 'key', now }), { row: parent, created: false });
  assert.equal(create.mock.callCount(), 1);
  assert.equal(find.mock.callCount(), 2);
  assert.deepEqual(await repo.createConversation({ userId, requestId: 'key', now: expiresAt }), { row: parent, created: false });
  assert.equal(create.mock.callCount(), 1);
});

test('Create persists server dates once and propagates database failures instead of fake replay', async (t) => {
  t.mock.method(Conversation, 'findOne', () => query(null));
  t.mock.method(Conversation, 'create', async () => ({ toObject: () => parent }));
  assert.deepEqual(await repo.createConversation({ userId, requestId: 'key', now }), { row: parent, created: true });
  t.mock.method(Conversation, 'create', async () => { throw new Error('database unavailable'); });
  await assert.rejects(repo.createConversation({ userId, requestId: 'key', now }), /database unavailable/);
});

function transactionFixture(t, { missing = false, childFailure = false, finalMissing = false, retry = false } = {}) {
  const events = [];
  const session = { async withTransaction(callback, options) {
    assert.deepEqual(options, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    if (retry) await callback();
    await callback();
  }, async endSession() { events.push('end'); } };
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(Conversation, 'findOne', (filter) => {
    events.push('read');
    assert.equal(filter.userId, userId);
    assert.equal(filter._id, conversationId);
    assert.deepEqual(filter.$expr, { $gt: ['$expiresAt', '$$NOW'] });
    assert.ok(filter.expiresAt.$gt instanceof Date);
    const observed = {};
    const chain = query(missing ? null : parent, observed);
    const lean = chain.lean;
    chain.lean = () => { assert.equal(observed.session, session); return lean(); };
    return chain;
  });
  t.mock.method(Message, 'deleteMany', async (filter, options) => {
    events.push('messages');
    assert.deepEqual(filter, { userId, conversationId }); assert.equal(options.session, session);
    if (childFailure) throw new Error('delete failed');
  });
  t.mock.method(Request, 'deleteMany', async (filter, options) => {
    events.push('requests');
    assert.deepEqual(filter, { userId, conversationId }); assert.equal(options.session, session);
  });
  t.mock.method(Conversation, 'findOneAndDelete', (filter, options) => {
    events.push('fence'); assert.equal(options.session, session);
    assert.deepEqual(filter, { _id: conversationId, userId, version: parent.version,
      expiresAt: { $eq: expiresAt, $gt: now }, $expr: { $gt: ['$expiresAt', '$$NOW'] } });
    return query(finalMissing ? null : parent);
  });
  return { events };
}

test('Delete removes both child collections then conditionally removes parent at DB current time in one transaction', async (t) => {
  const { events } = transactionFixture(t, { retry: true });
  assert.deepEqual(await repo.deleteConversation({ userId, conversationId, now: () => now }), parent);
  assert.deepEqual(events, ['read', 'messages', 'requests', 'fence', 'read', 'messages', 'requests', 'fence', 'end']);
});
test('Delete missing/foreign/expired parent never mutates children', async (t) => {
  const { events } = transactionFixture(t, { missing: true });
  assert.equal(await repo.deleteConversation({ userId, conversationId, now: () => now }), null);
  assert.deepEqual(events, ['read', 'end']);
});
test('Delete child failure does not report success and always closes its session', async (t) => {
  const { events } = transactionFixture(t, { childFailure: true });
  await assert.rejects(repo.deleteConversation({ userId, conversationId, now: () => now }), /delete failed/);
  assert.deepEqual(events, ['read', 'messages', 'end']);
});
test('expiry/concurrent mutation at final Delete fence throws to roll back child deletions', async (t) => {
  const { events } = transactionFixture(t, { finalMissing: true });
  await assert.rejects(repo.deleteConversation({ userId, conversationId, now: () => now }),
    (error) => error.statusCode === 404 && error.code === 'ASSISTANT_CONVERSATION_NOT_FOUND');
  assert.deepEqual(events, ['read', 'messages', 'requests', 'fence', 'end']);
});
