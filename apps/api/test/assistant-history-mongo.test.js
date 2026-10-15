// Explicit opt-in, localhost replica set, dedicated test database only.
// This file never reads MONGODB_URI or any .env file.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const Conversation = require('../src/modules/assistant/assistant-conversation.model');
const Message = require('../src/modules/assistant/assistant-message.model');
const Request = require('../src/modules/assistant/assistant-request.model');
const repository = require('../src/modules/assistant/assistant-history.repository');
const { createHistoryService } = require('../src/modules/assistant/assistant-history.service');

const enabled = process.env.AI2_HISTORY_MONGO_QA === '1';
const uri = process.env.AI2_HISTORY_TEST_MONGODB_URI || '';
function assertIsolatedTarget(value) {
  const url = new URL(value);
  assert.equal(url.protocol, 'mongodb:');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Only loopback Mongo is allowed.');
  assert.equal(url.username, ''); assert.equal(url.password, '');
  assert.match(url.pathname, /^\/wecooked_ai2_test_[a-z0-9_]+$/);
  for (const key of url.searchParams.keys()) assert.ok(['replicaSet', 'directConnection'].includes(key), 'Unsafe URI option.');
}

test('isolated Mongo target guard refuses production/Atlas/shared databases and unapproved options', () => {
  assert.doesNotThrow(() => assertIsolatedTarget('mongodb://127.0.0.1:27017/wecooked_ai2_test_slice1?replicaSet=rs0'));
  for (const bad of ['mongodb+srv://atlas.example/wecooked_ai2_test_x',
    'mongodb://remote.example/wecooked_ai2_test_x', 'mongodb://127.0.0.1/wecooked-production',
    'mongodb://127.0.0.1/wecooked-dev', 'mongodb://127.0.0.1/wecooked_test',
    'mongodb://user:pass@127.0.0.1/wecooked_ai2_test_x',
    'mongodb://127.0.0.1/wecooked_ai2_test_x?authSource=admin']) {
    assert.throws(() => assertIsolatedTarget(bad));
  }
});

test('isolated replica-set indexes, owner isolation, create races, deletion rollback and parent-write races',
  { skip: enabled ? false : 'NOT RUN: set explicit AI2_HISTORY_MONGO_QA and dedicated loopback replica-set URI' }, async (t) => {
    assertIsolatedTarget(uri);
    await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 5000 });
    const owner = new mongoose.Types.ObjectId();
    const other = new mongoose.Types.ObjectId();
    const userId = String(owner);
    const collections = [Conversation, Message, Request];
    try {
      const hello = await mongoose.connection.db.admin().command({ hello: 1 });
      assert.ok(hello.setName, 'Replica set required: standalone Mongo cannot prove transactions.');
      // Schema index creation is confined to this explicit disposable test DB.
      for (const model of collections) {
        await model.createIndexes();
        const indexes = await model.collection.indexes();
        for (const [key, options] of model.schema.indexes()) {
          assert.ok(indexes.some((index) => JSON.stringify(index.key) === JSON.stringify(key)
            && Boolean(index.unique) === Boolean(options.unique)
            && index.expireAfterSeconds === options.expireAfterSeconds));
        }
      }
      const service = createHistoryService({ getSecret: () => 'isolated-history-test-secret-at-least-32-chars' });
      const key = crypto.randomUUID();
      const competing = await Promise.all(Array.from({ length: 8 }, () => service.create({ userId, requestId: key })));
      assert.equal(new Set(competing.map((result) => result.conversation.id)).size, 1);
      assert.equal(competing.filter((result) => result.created).length, 1);
      const conversationId = competing[0].conversation.id;
      const metadata = competing[0].conversation;
      const foreign = await service.create({ userId: String(other), requestId: key });
      assert.notEqual(foreign.conversation.id, conversationId);
      await assert.rejects(service.open({ userId: String(other), conversationId }), { code: 'ASSISTANT_CONVERSATION_NOT_FOUND' });
      await assert.rejects(service.remove({ userId: String(other), conversationId }), { code: 'ASSISTANT_CONVERSATION_NOT_FOUND' });
      const expiresAt = new Date(metadata.expiresAt);
      const userMessage = await Message.create({ userId, conversationId, sequence: 0, role: 'user',
        content: 'lentils', status: 'failed', expiresAt });
      await Message.create({ userId, conversationId, sequence: 2, role: 'assistant', content: 'real test fixture', expiresAt });
      await assert.rejects(Message.create({ userId, conversationId, sequence: 0, role: 'user',
        content: 'duplicate', status: 'failed', expiresAt }), { code: 11000 });
      const attempt = { userId, conversationId, requestId: crypto.randomUUID(), fingerprint: 'a'.repeat(64),
        userMessageId: userMessage._id, replaySnapshot: [{ role: 'user', content: 'lentils' }],
        fence: 'test-fence', claimExpiresAt: new Date(Date.now() + 20000), state: 'failed',
        safeOutcome: { code: 'ASSISTANT_UNAVAILABLE' }, expiresAt };
      await Request.create(attempt);
      await assert.rejects(Request.create(attempt), { code: 11000 });
      const page = await service.open({ userId, conversationId, limit: 1 });
      assert.deepEqual(page.messages.map((message) => message.sequence), [2]);
      assert.deepEqual((await service.open({ userId, conversationId, limit: 1, cursor: page.pageInfo.nextCursor }))
        .messages.map((message) => message.sequence), [0]);
      assert.deepEqual((await service.open({ userId, conversationId })).conversation, metadata);

      await t.test('child failure really rolls back Mongo deletions', async (subtest) => {
        subtest.mock.method(Request, 'deleteMany', async () => { throw new Error('injected child failure'); });
        await assert.rejects(repository.deleteConversation({ userId, conversationId, now: () => new Date() }), /injected child failure/);
        assert.equal(await Conversation.countDocuments({ _id: conversationId, userId }), 1);
        assert.equal(await Message.countDocuments({ conversationId, userId }), 2);
        assert.equal(await Request.countDocuments({ conversationId, userId }), 1);
      });
      await t.test('expiry at final database fence really rolls back child deletion', async (subtest) => {
        const original = Request.deleteMany.bind(Request);
        let clock = new Date();
        subtest.mock.method(Request, 'deleteMany', async (...args) => {
          const result = await original(...args); clock = expiresAt; return result;
        });
        await assert.rejects(repository.deleteConversation({ userId, conversationId, now: () => clock }),
          { code: 'ASSISTANT_CONVERSATION_NOT_FOUND' });
        assert.equal(await Message.countDocuments({ conversationId, userId }), 2);
      });

      const mutation = async () => {
        const session = await mongoose.startSession();
        try {
          await session.withTransaction(async () => {
            const parent = await Conversation.findOneAndUpdate({ _id: conversationId, userId,
              $expr: { $gt: ['$expiresAt', '$$NOW'] } }, { $inc: { version: 1 } }, { session });
            if (!parent) return;
            await Message.create([{ userId, conversationId, sequence: 4, role: 'user', content: 'racing write',
              status: 'pending', expiresAt: parent.expiresAt }], { session });
          });
        } finally { await session.endSession(); }
      };
      await Promise.all([mutation(), service.remove({ userId, conversationId })]);
      assert.equal(await Conversation.countDocuments({ _id: conversationId, userId }), 0);
      assert.equal(await Message.countDocuments({ conversationId, userId }), 0);
      assert.equal(await Request.countDocuments({ conversationId, userId }), 0);
      await assert.rejects(service.remove({ userId, conversationId }), { code: 'ASSISTANT_CONVERSATION_NOT_FOUND' });

      // Expired records are inserted directly to prove access denial even while
      // records physically exist, without altering the server TTL monitor.
      const expiredId = new mongoose.Types.ObjectId();
      const expiredKey = crypto.randomUUID();
      const expiredAt = new Date(Date.now() - 1000);
      await Conversation.collection.insertOne({ _id: expiredId, userId: owner, createRequestId: expiredKey,
        createdAt: new Date(+expiredAt - 2592000000), updatedAt: expiredAt, expiresAt: expiredAt, version: 0 });
      await Message.collection.insertOne({ userId: owner, conversationId: expiredId, sequence: 0,
        role: 'user', content: 'expired private text', status: 'failed', createdAt: expiredAt, expiresAt: expiredAt });
      await Request.collection.insertOne({ ...attempt, _id: new mongoose.Types.ObjectId(), userId: owner,
        conversationId: expiredId, expiresAt: expiredAt });
      assert.equal(await Conversation.countDocuments({ _id: expiredId }), 1, 'Expiry fixture must still physically exist.');
      await assert.rejects(service.open({ userId, conversationId: String(expiredId) }), { code: 'ASSISTANT_CONVERSATION_NOT_FOUND' });
      await assert.rejects(service.create({ userId, requestId: expiredKey }), { code: 'ASSISTANT_CONVERSATION_NOT_FOUND' });
      assert.equal((await service.list({ userId })).conversations.some((row) => row.id === String(expiredId)), false);

      await t.test('eventual physical TTL cleanup on all three collections',
        { skip: process.env.AI2_HISTORY_TTL_QA !== '1' ? 'NOT RUN: explicit AI2_HISTORY_TTL_QA=1 required' : false }, async () => {
          const timeout = Date.now() + 90000;
          let remaining;
          do {
            remaining = await Promise.all(collections.map((model) => model.countDocuments({ userId: owner, expiresAt: expiredAt })));
            if (remaining.every((count) => count === 0)) break;
            await new Promise((resolve) => setTimeout(resolve, 1000));
          } while (Date.now() < timeout);
          assert.deepEqual(remaining, [0, 0, 0], 'TTL cleanup was not observed within the isolated QA window.');
        });
    } finally {
      // Cleanup only records created by this test's random owners.
      for (const model of collections) await model.deleteMany({ userId: { $in: [owner, other] } });
      await mongoose.disconnect();
    }
  });

test('isolated replica-set generation claims, retry, rollback, unknown commits and Delete fencing',
  { skip: enabled ? false : 'NOT RUN: explicit isolated replica-set opt-in required' }, async (t) => {
    assertIsolatedTarget(uri);
    await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 5000 });
    const userId = String(new mongoose.Types.ObjectId());
    const models = [Conversation, Message, Request];
    function deferred() {
      let resolve;
      const promise = new Promise((yes) => { resolve = yes; });
      return { promise, resolve };
    }
    const newConversation = async (service) => (await service.create({ userId, requestId: crypto.randomUUID() })).conversation;
    const body = (conversation, extra = {}) => ({ userId, conversationId: conversation.id,
      requestId: crypto.randomUUID(), expectedVersion: conversation.version, content: 'lentils', ...extra });
    try {
      const hello = await mongoose.connection.db.admin().command({ hello: 1 });
      assert.ok(hello.setName, 'Replica set required.');
      for (const model of models) await model.createIndexes();
      await t.test('competing claims and same-key pending replay dispatch only one mocked provider', async () => {
        const started = deferred(); const wait = deferred(); let calls = 0;
        const service = createHistoryService({ chat: async () => { calls += 1; started.resolve(); return wait.promise; } });
        const conversation = await newConversation(service); const input = body(conversation);
        const first = service.send(input); await started.promise;
        await assert.rejects(service.send(input), { code: 'ASSISTANT_REQUEST_IN_PROGRESS' });
        await assert.rejects(service.send(body(conversation)), { code: 'ASSISTANT_CONVERSATION_STALE' });
        wait.resolve('mocked real-format reply'); const result = await first;
        assert.deepEqual(await service.send(input), result); assert.equal(calls, 1);
        assert.equal(await Message.countDocuments({ userId, conversationId: conversation.id }), 2);
        assert.equal(await Request.countDocuments({ userId, conversationId: conversation.id }), 1);
        assert.equal((await Conversation.findById(conversation.id).lean()).version, 2);
      });
      await t.test('known failure retries exact persisted snapshot without duplicate user', async () => {
        const snapshots = []; let fail = true;
        const service = createHistoryService({ chat: async (snapshot) => {
          snapshots.push(snapshot); if (fail) throw new Error('injected provider failure'); return 'retry reply';
        } });
        const conversation = await newConversation(service); const input = body(conversation);
        await assert.rejects(service.send(input), { code: 'ASSISTANT_UNAVAILABLE' });
        await assert.rejects(service.send(input), { code: 'ASSISTANT_UNAVAILABLE' });
        const message = await Message.findOne({ userId, conversationId: conversation.id, role: 'user' }).lean();
        fail = false;
        await service.send({ userId, conversationId: conversation.id, requestId: crypto.randomUUID(),
          expectedVersion: 2, retryOf: String(message._id) });
        assert.deepEqual(snapshots[1], snapshots[0]); assert.equal(snapshots.length, 2);
        assert.equal(await Message.countDocuments({ userId, conversationId: conversation.id, role: 'user' }), 1);
        assert.equal(await Message.countDocuments({ userId, conversationId: conversation.id, role: 'assistant' }), 1);
        const children = await Request.find({ userId, conversationId: conversation.id }).lean();
        assert.ok(children.every((row) => +row.expiresAt === +new Date(conversation.expiresAt)));
      });
      await t.test('actual completion rollback leaves no Assistant reply', async (subtest) => {
        const service = createHistoryService({ chat: async () => 'discard on rollback' });
        const conversation = await newConversation(service);
        subtest.mock.method(Request, 'updateOne', async () => { throw new Error('injected completion failure'); });
        await assert.rejects(service.send(body(conversation)), { code: 'ASSISTANT_SEND_UNCERTAIN' });
        assert.equal(await Message.countDocuments({ userId, conversationId: conversation.id, role: 'assistant' }), 0);
        assert.equal((await Request.findOne({ userId, conversationId: conversation.id }).lean()).state, 'pending');
      });
      await t.test('lost final commit acknowledgement reconciles Mongo result without generation again', async (subtest) => {
        let calls = 0; let transactions = 0;
        const service = createHistoryService({ chat: async () => { calls += 1; return 'committed reply'; } });
        const conversation = await newConversation(service);
        const startSession = mongoose.startSession.bind(mongoose);
        subtest.mock.method(mongoose, 'startSession', async () => {
          const session = await startSession(); const withTransaction = session.withTransaction.bind(session);
          session.withTransaction = async (...args) => {
            const result = await withTransaction(...args);
            if (++transactions === 2) throw new Error('injected lost commit acknowledgement');
            return result;
          };
          return session;
        });
        const input = body(conversation); const result = await service.send(input);
        assert.deepEqual(await service.send(input), result); assert.equal(calls, 1);
        assert.equal(await Message.countDocuments({ userId, conversationId: conversation.id }), 2);
      });
      await t.test('Delete during pending generation removes all children and fences late completion', async () => {
        const started = deferred(); const wait = deferred();
        const service = createHistoryService({ chat: async () => { started.resolve(); return wait.promise; } });
        const conversation = await newConversation(service); const input = body(conversation);
        const sending = service.send(input); await started.promise;
        await service.remove({ userId, conversationId: conversation.id });
        wait.resolve('reply after Delete');
        await assert.rejects(sending, { code: 'ASSISTANT_CONVERSATION_NOT_FOUND' });
        assert.equal(await Conversation.countDocuments({ userId, _id: conversation.id }), 0);
        for (const model of [Message, Request]) assert.equal(await model.countDocuments({ userId, conversationId: conversation.id }), 0);
      });
      await t.test('expiry during completion transaction rolls back inserted reply', async (subtest) => {
        let time = new Date();
        const service = createHistoryService({ now: () => time, chat: async () => 'late reply' });
        const conversation = await newConversation(service);
        const update = Request.updateOne.bind(Request);
        subtest.mock.method(Request, 'updateOne', async (...args) => {
          const result = await update(...args); time = new Date(conversation.expiresAt); return result;
        });
        await assert.rejects(service.send(body(conversation)), { code: 'ASSISTANT_CONVERSATION_NOT_FOUND' });
        assert.equal(await Message.countDocuments({ userId, conversationId: conversation.id, role: 'assistant' }), 0);
        assert.equal((await Request.findOne({ userId, conversationId: conversation.id }).lean()).state, 'pending');
      });
    } finally {
      for (const model of models) await model.deleteMany({ userId });
      await mongoose.disconnect();
    }
  });
