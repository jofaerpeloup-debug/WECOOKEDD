const test = require('node:test');
const assert = require('node:assert/strict');
const Conversation = require('../src/modules/assistant/assistant-conversation.model');
const Message = require('../src/modules/assistant/assistant-message.model');
const Request = require('../src/modules/assistant/assistant-request.model');
const id = '507f1f77bcf86cd799439011';
const start = new Date('2026-10-15T00:00:00.000Z');
const deadline = new Date(+start + 2592000000);
const child = { userId: id, conversationId: id, createdAt: start, expiresAt: deadline };
const requestData = { ...child, requestId: '6f476b68-91d7-4b16-99dc-5cc0b0dacdbb', fingerprint: 'a'.repeat(64),
  userMessageId: id, replaySnapshot: [{ role: 'user', content: 'lentils' }],
  fence: 'fence', claimExpiresAt: new Date(+start + 20000), state: 'pending' };

test('all three collections declare independent TTLs and required ownership uniqueness/page indexes', () => {
  for (const model of [Conversation, Message, Request]) {
    const ttl = model.schema.indexes().filter(([key]) => Object.keys(key).join(',') === 'expiresAt');
    assert.equal(ttl.length, 1);
    assert.deepEqual(ttl[0][0], { expiresAt: 1 });
    assert.equal(ttl[0][1].expireAfterSeconds, 0);
    for (const field of ['userId', 'createdAt', 'expiresAt']) assert.equal(model.schema.path(field).options.immutable, true);
    assert.equal(model.schema.options.strict, 'throw');
  }
  assert.ok(Conversation.schema.indexes().some(([key, options]) =>
    JSON.stringify(key) === JSON.stringify({ userId: 1, createRequestId: 1 }) && options.unique));
  assert.ok(Conversation.schema.indexes().some(([key]) =>
    JSON.stringify(key) === JSON.stringify({ userId: 1, createdAt: -1, _id: -1 })));
  assert.ok(Message.schema.indexes().some(([key, options]) =>
    JSON.stringify(key) === JSON.stringify({ userId: 1, conversationId: 1, sequence: 1 }) && options.unique));
  assert.ok(Request.schema.indexes().some(([key, options]) =>
    JSON.stringify(key) === JSON.stringify({ userId: 1, conversationId: 1, requestId: 1 }) && options.unique));
  assert.equal(Object.values(Conversation.schema.paths).some((path) => path.instance === 'Array'), false);
});

test('conversation derives exact UTC elapsed expiry and refuses caller alternate deadline', async () => {
  assert.equal(Conversation.RETENTION_MS, 2592000000);
  const row = new Conversation({ userId: id, createRequestId: 'key', createdAt: start, updatedAt: start });
  await row.validate();
  assert.equal(row.expiresAt.toISOString(), '2026-11-14T00:00:00.000Z');
  assert.equal(row.version, 0);
  assert.equal(row.nextSequence, 0);
  assert.equal(row.claim, null);
  row.isNew = false;
  row.createdAt = new Date(+start + 1000);
  row.expiresAt = new Date(+deadline + 1000);
  assert.equal(+row.createdAt, +start);
  assert.equal(+row.expiresAt, +deadline);
  await assert.rejects(row.validate(), /immutable/);
  const unchanged = Conversation.hydrate({ userId: id, createRequestId: 'key', createdAt: start,
    updatedAt: start, expiresAt: deadline, version: 0, nextSequence: 0 });
  unchanged.updatedAt = new Date(+start + 1000);
  await unchanged.validate();
  assert.equal(+unchanged.createdAt, +start);
  assert.equal(+unchanged.expiresAt, +deadline);
  await assert.rejects(new Conversation({ userId: id, createRequestId: 'key', createdAt: start,
    expiresAt: new Date(+deadline + 1) }).validate(), /expiresAt/);
  for (const version of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(new Conversation({ userId: id, createRequestId: 'key', createdAt: start, version }).validate(), /version/);
  }
});

test('messages inherit supplied parent expiry, enforce user status/content, and preserve long real replies', async () => {
  const user = new Message({ ...child, role: 'user', sequence: 0, content: 'lentils', status: 'pending' });
  await user.validate();
  assert.equal(+user.expiresAt, +deadline);
  const assistant = new Message({ ...child, role: 'assistant', sequence: 1, content: 'a'.repeat(6000) });
  await assistant.validate();
  assert.equal(assistant.content.length, 6000);
  for (const extra of [{ role: 'system' }, { status: undefined }, { content: '' },
    { content: ' x ' }, { content: 'a'.repeat(2001) }, { sequence: 1.5 }, { expiresAt: undefined }]) {
    await assert.rejects(new Message({ ...child, role: 'user', sequence: 0, content: 'lentils', status: 'pending', ...extra }).validate());
  }
  await assert.rejects(new Message({ ...child, role: 'assistant', sequence: 1, content: 'reply', status: 'complete' }).validate(), /status/);
});

test('request snapshots are independently expiring, bounded, strict records with safe outcome codes only', async () => {
  const row = new Request(requestData);
  await row.validate();
  assert.equal(+row.expiresAt, +deadline);
  for (const replaySnapshot of [[], undefined, Array(13).fill({ role: 'user', content: 'x' }),
    [{ role: 'system', content: 'x' }], [{ role: 'user', content: 'x'.repeat(2001) }],
    [{ role: 'user', content: ' x ' }], [{ role: 'assistant', content: 'reply' }],
    [{ role: 'assistant', content: 'x'.repeat(4001) }, { role: 'user', content: 'x' }],
    [1, 2, 3].map(() => ({ role: 'assistant', content: 'x'.repeat(4000) })).concat({ role: 'user', content: 'x' })]) {
    await assert.rejects(new Request({ ...requestData, replaySnapshot }).validate());
  }
  assert.throws(() => new Request({ ...requestData, providerPayload: 'secret' }));
  await assert.rejects(new Request({ ...requestData, safeOutcome: { code: 'RAW_PROVIDER_ERROR' } }).validate());
});
