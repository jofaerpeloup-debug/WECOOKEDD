const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createHistoryService } = require('../src/modules/assistant/assistant-history.service');
const assistantService = require('../src/modules/assistant/assistant.service');
const { RETENTION_MS } = require('../src/modules/assistant/assistant-conversation.model');

const owner = '507f1f77bcf86cd799439011';
const foreign = '507f1f77bcf86cd799439012';
const id = '507f1f77bcf86cd799439021';
const secret = 'history-test-cursor-secret-at-least-32-chars';
const started = Date.parse('2026-10-15T00:00:00.000Z');
function conversation(extra = {}) {
  return { _id: id, userId: owner, createRequestId: 'private-key',
    createdAt: new Date(started), updatedAt: new Date(started), expiresAt: new Date(started + RETENTION_MS),
    version: 0, nextSequence: 0, claim: { fence: 'private-fence' }, ...extra };
}
function message(sequence, parent = conversation(), extra = {}) {
  return { _id: (sequence + 100).toString(16).padStart(24, '0'), userId: parent.userId,
    conversationId: String(parent._id), expiresAt: parent.expiresAt, createdAt: parent.createdAt,
    role: sequence % 2 ? 'assistant' : 'user', status: 'complete', sequence, content: `message ${sequence}`, ...extra };
}
function setup(rows = [conversation()], messages = []) {
  let clock = started;
  const repo = {
    async createConversation({ userId, requestId, now }) {
      const old = rows.find((row) => row.userId === userId && row.createRequestId === requestId);
      if (old) return { row: old, created: false };
      const row = conversation({ _id: (rows.length + 200).toString(16).padStart(24, '0'), userId,
        createRequestId: requestId, createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + RETENTION_MS) });
      rows.push(row); return { row, created: true };
    },
    async findConversation({ userId, conversationId, now }) {
      return rows.find((row) => row.userId === userId && String(row._id) === conversationId && row.expiresAt > now) || null;
    },
    async findConversations({ userId, now, limit, cursor }) {
      return rows.filter((row) => row.userId === userId && row.expiresAt > now
        && (!cursor || row.createdAt < cursor.createdAt
          || (+row.createdAt === +cursor.createdAt && String(row._id) < String(cursor.id))))
        .sort((a, b) => +b.createdAt - +a.createdAt || String(b._id).localeCompare(String(a._id)))
        .slice(0, limit + 1);
    },
    async findMessages({ userId, conversationId, expiresAt, now, cursor, limit }) {
      return messages.filter((row) => row.userId === userId && row.conversationId === conversationId
        && +row.expiresAt === +expiresAt && row.expiresAt > now && (!cursor || row.sequence < cursor.sequence))
        .sort((a, b) => b.sequence - a.sequence).slice(0, limit + 1);
    },
    async deleteConversation({ userId, conversationId, now }) {
      const row = await this.findConversation({ userId, conversationId, now: now() });
      if (!row) return null;
      rows.splice(rows.indexOf(row), 1); return row;
    },
  };
  const service = createHistoryService({ repo, now: () => new Date(clock), getSecret: () => secret });
  return { repo, service, setTime: (value) => { clock = value; } };
}
const is404 = (error) => error.statusCode === 404 && error.code === 'ASSISTANT_CONVERSATION_NOT_FOUND'
  && error.details === undefined;
const is400 = (error) => error.statusCode === 400 && error.code === 'VALIDATION_ERROR';

test('CRUD calls zero generation, hides internals, and create replay preserves dates/version', async (t) => {
  const spy = t.mock.method(assistantService, 'chat', () => assert.fail('History called generation'));
  const { service, setTime } = setup([]);
  const first = await service.create({ userId: owner, requestId: 'same-key' });
  assert.equal(first.created, true);
  assert.deepEqual(Object.keys(first.conversation), ['id', 'createdAt', 'updatedAt', 'expiresAt', 'version']);
  assert.equal(Date.parse(first.conversation.expiresAt) - Date.parse(first.conversation.createdAt), 2592000000);
  setTime(started + 1000);
  const replay = await service.create({ userId: owner, requestId: 'same-key' });
  assert.equal(replay.created, false);
  assert.deepEqual(replay.conversation, first.conversation);
  const other = await service.create({ userId: foreign, requestId: 'same-key' });
  assert.notEqual(other.conversation.id, first.conversation.id);
  const page = await service.list({ userId: owner });
  assert.deepEqual(page.conversations, [first.conversation]);
  const opened = await service.open({ userId: owner, conversationId: first.conversation.id });
  assert.deepEqual(opened.messages, []);
  assert.deepEqual(opened.conversation, first.conversation);
  await service.remove({ userId: owner, conversationId: first.conversation.id });
  await assert.rejects(service.open({ userId: owner, conversationId: first.conversation.id }), is404);
  assert.equal(spy.mock.callCount(), 0);
});

test('missing/foreign/expired parents and repeated Delete are opaque 404', async () => {
  const { service, setTime } = setup();
  for (const conversationId of [id, '507f1f77bcf86cd799439099']) {
    for (const action of ['open', 'remove']) await assert.rejects(service[action]({ userId: foreign, conversationId }), is404);
  }
  setTime(started + RETENTION_MS);
  for (const action of ['open', 'remove']) await assert.rejects(service[action]({ userId: owner, conversationId: id }), is404);
  await assert.rejects(service.create({ userId: owner, requestId: 'private-key' }), is404);
  assert.deepEqual(await service.list({ userId: owner }), { conversations: [], pageInfo: { hasMore: false, nextCursor: null } });
});

for (const offset of [-1, 0, 1]) {
  test(`30 elapsed days boundary ${offset}ms denies at equality independent of TTL`, async () => {
    const parent = conversation();
    const { service, setTime } = setup([parent], [message(0)]);
    setTime(started + RETENTION_MS + offset);
    const result = await service.list({ userId: owner });
    assert.equal(result.conversations.length, offset < 0 ? 1 : 0);
    if (offset < 0) {
      assert.equal((await service.open({ userId: owner, conversationId: id })).messages.length, 1);
      assert.equal((await service.create({ userId: owner, requestId: 'private-key' })).conversation.expiresAt, parent.expiresAt.toISOString());
    } else {
      await assert.rejects(service.open({ userId: owner, conversationId: id }), is404);
      await assert.rejects(service.create({ userId: owner, requestId: 'private-key' }), is404);
    }
  });
}

test('list cursors are owner/endpoint scoped, signed/canonical and use immutable ties', async () => {
  const rows = [1, 2, 3].map((n) => conversation({ _id: n.toString(16).padStart(24, '0'),
    updatedAt: new Date(started + (4 - n) * 1000) }));
  const { service } = setup([...rows, conversation({ userId: foreign, _id: foreign })]);
  const first = await service.list({ userId: owner, limit: 1 });
  assert.equal(first.conversations[0].id, rows[2]._id);
  const cursor = first.pageInfo.nextCursor;
  assert.equal(first.pageInfo.hasMore, true);
  const payload = JSON.parse(Buffer.from(cursor.split('.')[0], 'base64url').toString());
  assert.equal(JSON.stringify(payload).includes(owner), false);
  const second = await service.list({ userId: owner, limit: 1, cursor });
  assert.equal(second.conversations[0].id, rows[1]._id);
  const third = await service.list({ userId: owner, limit: 1, cursor: second.pageInfo.nextCursor });
  assert.deepEqual(third.pageInfo, { hasMore: false, nextCursor: null });
  for (const bad of [cursor + '=', cursor.replace(/.$/, '!'), '', 'garbage', `${cursor}.x`, 'x'.repeat(1001)]) {
    if (bad === '') continue; // Wire validation rejects empty cursors.
    await assert.rejects(service.list({ userId: owner, cursor: bad }), is400);
  }
  await assert.rejects(service.list({ userId: foreign, cursor }), is400);
  await assert.rejects(service.open({ userId: owner, conversationId: rows[2]._id, cursor }), is400);
  function signed(value) {
    const body = Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
  }
  for (const bad of [{ ...payload, v: 2 }, { ...payload, c: 1 }, { ...payload, c: '2026-10-15' },
    { ...payload, i: rows[2]._id.toUpperCase() + 'z' }, { ...payload, extra: true },
    { s: payload.s, v: 1, c: payload.c, i: payload.i }]) {
    await assert.rejects(service.list({ userId: owner, cursor: signed(bad) }), is400);
  }
});

test('Open returns ascending latest page; scoped older pages preserve gaps and private user status', async () => {
  const parent = conversation();
  const sibling = conversation({ _id: '507f1f77bcf86cd799439030' });
  const { service } = setup([parent, sibling], [0, 1, 2, 4, 5].map((n) => message(n))
    .concat(message(99, parent, { userId: foreign }), message(88, sibling),
      message(77, parent, { expiresAt: new Date(started + RETENTION_MS + 1) })));
  const page = await service.open({ userId: owner, conversationId: id, limit: 2 });
  assert.deepEqual(page.messages.map((row) => row.sequence), [4, 5]);
  assert.deepEqual(Object.keys(page.messages[0]), ['id', 'role', 'content', 'sequence', 'createdAt', 'status']);
  assert.deepEqual(Object.keys(page.messages[1]), ['id', 'role', 'content', 'sequence', 'createdAt']);
  const older = await service.open({ userId: owner, conversationId: id, limit: 2, cursor: page.pageInfo.nextCursor });
  assert.deepEqual(older.messages.map((row) => row.sequence), [1, 2]);
  const oldest = await service.open({ userId: owner, conversationId: id, limit: 2, cursor: older.pageInfo.nextCursor });
  assert.deepEqual(oldest.messages.map((row) => row.sequence), [0]);
  assert.equal(oldest.pageInfo.nextCursor, null);
  await assert.rejects(service.open({ userId: owner, conversationId: sibling._id, cursor: page.pageInfo.nextCursor }), is400);
  await assert.rejects(service.list({ userId: owner, cursor: page.pageInfo.nextCursor }), is400);
});

test('expiry during list/open/create awaits discards rows/results; response guards use fresh time', async () => {
  for (const method of ['findConversations', 'findMessages', 'createConversation']) {
    const fixture = setup([conversation()], [message(0)]);
    const original = fixture.repo[method];
    fixture.repo[method] = async function (...args) {
      const result = await original.apply(this, args);
      fixture.setTime(started + RETENTION_MS); return result;
    };
    if (method === 'findConversations') {
      assert.equal((await fixture.service.list({ userId: owner })).conversations.length, 0);
    } else if (method === 'findMessages') {
      await assert.rejects(fixture.service.open({ userId: owner, conversationId: id }), is404);
    } else {
      await assert.rejects(fixture.service.create({ userId: owner, requestId: 'private-key' }), is404);
    }
  }
  const { service, setTime } = setup();
  const result = await service.open({ userId: owner, conversationId: id });
  const list = await service.list({ userId: owner });
  setTime(started + RETENTION_MS);
  assert.throws(() => service.guardConversation(result.conversation), is404);
  assert.equal(service.guardList(list, owner).conversations.length, 0);
});

test('deletion during Open is rechecked; expiry after Delete commit returns opaque 404', async () => {
  const fixture = setup([conversation()], [message(0)]);
  const original = fixture.repo.findConversation;
  let reads = 0;
  fixture.repo.findConversation = async (input) => ++reads === 2 ? null : original(input);
  await assert.rejects(fixture.service.open({ userId: owner, conversationId: id }), is404);
  fixture.repo.deleteConversation = async () => {
    fixture.setTime(started + RETENTION_MS); return conversation();
  };
  await assert.rejects(fixture.service.remove({ userId: owner, conversationId: id }), is404);
});

test('an old valid cursor cannot revive rows after expiry', async () => {
  const fixture = setup([conversation(), conversation({ _id: foreign })]);
  const first = await fixture.service.list({ userId: owner, limit: 1 });
  fixture.setTime(started + RETENTION_MS);
  assert.deepEqual(await fixture.service.list({ userId: owner, cursor: first.pageInfo.nextCursor }),
    { conversations: [], pageInfo: { hasMore: false, nextCursor: null } });
});
