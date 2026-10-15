process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.JWT_ACCESS_SECRET = 'history-send-test-secret-at-least-32-chars';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.OPENAI_API_KEY = '';
process.env.OPENAI_MODEL = '';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { createHistoryService, buildReplay } = require('../src/modules/assistant/assistant-history.service');
const repository = require('../src/modules/assistant/assistant-history.repository');
const Conversation = require('../src/modules/assistant/assistant-conversation.model');
const Message = require('../src/modules/assistant/assistant-message.model');
const Request = require('../src/modules/assistant/assistant-request.model');
const { sendMessageSchema } = require('../src/modules/assistant/assistant-history.validation');
const { AppError } = require('../src/shared/errors/app-error');
const owner = '507f1f77bcf86cd799439011';
const foreign = '507f1f77bcf86cd799439012';
const id = '507f1f77bcf86cd799439021';
const origin = new Date('2026-10-15T00:00:00.000Z');
const expiry = new Date(+origin + 2592000000);
const errorCode = (code) => (error) => error.code === code;
function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function sendInput(extra = {}) {
  return { userId: owner, conversationId: id, requestId: crypto.randomUUID(), expectedVersion: 0, content: 'lentils', ...extra };
}

// Behavioral transaction double: snapshots, rollback, callback replay and a
// shared parent write are exercised through the production repository. This
// does not claim actual Mongo isolation, unique indexes or transaction proof.
function fixture(t, { chat = async () => 'Cook lentils.', clock = origin, databaseClock, createdAt = origin } = {}) {
  let time = new Date(clock);
  let dbTime = databaseClock ? new Date(databaseClock) : null;
  let state = { conversations: [{ _id: id, userId: owner, createRequestId: crypto.randomUUID(),
    createdAt, updatedAt: createdAt, expiresAt: new Date(+createdAt + 2592000000), version: 0, nextSequence: 0, claim: null }],
  messages: [], requests: [] };
  let gate = Promise.resolve();
  let transactionNumber = 0;
  const controls = { hook: null, afterCommit: null, retry: false };
  const events = [];
  const clone = (value) => structuredClone(value);
  function comparable(value) { return value instanceof Date ? +value : value; }
  function field(row, path) { return path.split('.').reduce((value, key) => value?.[key], row); }
  function expression(expr, row) {
    if (typeof expr === 'string' && expr === '$$NOW') return +(dbTime || time);
    if (typeof expr === 'string' && expr.startsWith('$')) return comparable(field(row, expr.slice(1)));
    if (expr?.$and) return expr.$and.every((part) => expression(part, row));
    for (const operator of ['$gt', '$lte']) if (expr?.[operator]) {
      const [a, b] = expr[operator].map((part) => expression(part, row));
      return operator === '$gt' ? a > b : a <= b;
    }
    return comparable(expr);
  }
  function matches(row, filter) {
    return Object.entries(filter).every(([key, value]) => {
      if (key === '$expr') return expression(value, row);
      const actual = comparable(field(row, key));
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        return Object.entries(value).every(([op, boundary]) => {
          if (op === '$gt') return actual > comparable(boundary);
          if (op === '$lt') return actual < comparable(boundary);
          if (op === '$eq') return actual === comparable(boundary);
          throw new Error(`Unsupported test predicate ${op}`);
        });
      }
      return actual === comparable(value);
    });
  }
  function data(session) { return session?.draft || state; }
  async function observe(event, filter, session) {
    events.push({ event, filter: clone(filter), transaction: session?.number });
    if (controls.hook) await controls.hook(event, filter, session);
  }
  t.mock.method(mongoose, 'startSession', async () => {
    const session = { async withTransaction(callback, options) {
      assert.deepEqual(options, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
      const previous = gate;
      const lock = deferred(); gate = lock.promise;
      await previous;
      session.number = ++transactionNumber;
      try {
        session.draft = clone(state);
        if (controls.retry) {
          controls.retry = false;
          await callback();
          session.draft = clone(state);
        }
        await callback();
        state = session.draft;
        if (controls.afterCommit) await controls.afterCommit(session.number);
      } finally { session.draft = null; lock.resolve(); }
    }, async endSession() {} };
    return session;
  });
  for (const [model, collection] of [[Conversation, 'conversations'], [Message, 'messages'], [Request, 'requests']]) {
    for (const method of ['findOne', 'find', 'findOneAndUpdate', 'findOneAndDelete']) {
      t.mock.method(model, method, (filter, updateOrOptions, options) => {
        let session = options?.session || (method === 'findOneAndDelete' ? updateOrOptions?.session : null);
        let sort; let limit;
        return { session(value) { session = value; return this; }, sort(value) { sort = value; return this; },
          limit(value) { limit = value; return this; }, async lean() {
            await observe(`${collection}.${method}`, filter, session);
            let rows = data(session)[collection].filter((row) => matches(row, filter));
            if (sort) rows.sort((a, b) => {
              for (const [key, order] of Object.entries(sort)) {
                const av = comparable(a[key]); const bv = comparable(b[key]);
                if (av !== bv) return (av > bv ? 1 : -1) * order;
              }
              return 0;
            });
            if (limit !== undefined) rows = rows.slice(0, limit);
            if (method === 'find') return clone(rows);
            const row = rows[0];
            if (!row) return null;
            if (method === 'findOneAndDelete') data(session)[collection] = data(session)[collection].filter((item) => item !== row);
            if (method === 'findOneAndUpdate') apply(row, updateOrOptions);
            return clone(row);
          } };
      });
    }
    t.mock.method(model, 'create', async (rows, { session } = {}) => {
      await observe(`${collection}.create`, {}, session);
      for (const row of rows) {
        assert.equal(session !== undefined, true, 'generation inserts must be transactional');
        await new model(row).validate();
        data(session)[collection].push(clone(row));
      }
      return rows;
    });
    t.mock.method(model, 'updateOne', async (filter, update, { session } = {}) => {
      await observe(`${collection}.updateOne`, filter, session);
      const row = data(session)[collection].find((item) => matches(item, filter));
      if (!row) return { modifiedCount: 0 };
      apply(row, update);
      return { modifiedCount: 1 };
    });
    t.mock.method(model, 'deleteMany', async (filter, { session } = {}) => {
      await observe(`${collection}.deleteMany`, filter, session);
      data(session)[collection] = data(session)[collection].filter((row) => !matches(row, filter));
    });
  }
  function apply(row, update) {
    Object.assign(row, clone(update.$set || {}));
    for (const [key, delta] of Object.entries(update.$inc || {})) row[key] += delta;
  }
  const calls = [];
  const service = createHistoryService({ repo: repository, now: () => new Date(time),
    newId: () => String(new mongoose.Types.ObjectId()),
    getSecret: () => 'test-secret', chat: async (snapshot) => {
      assert.ok(!events.at(-1)?.transaction, 'provider must be outside a transaction');
      calls.push(clone(snapshot)); return chat(snapshot);
    } });
  return { service, calls, controls, events, get state() { return state; },
    setTime(value) { time = new Date(value); }, setDbTime(value) { dbTime = new Date(value); } };
}

test('strict Send/Retry schemas normalize canonical input and reject caller replay or mixed fields', () => {
  const parse = (body, query = {}) => sendMessageSchema.safeParse({ body, params: { conversationId: id }, query });
  const input = { requestId: crypto.randomUUID().toUpperCase(), expectedVersion: 0, content: '  lentils  ' };
  assert.deepEqual(parse(input).data.body, { ...input, requestId: input.requestId.toLowerCase(), content: 'lentils' });
  assert.equal(parse({ ...input, content: 'x'.repeat(2000) }).success, true);
  assert.equal(parse({ requestId: input.requestId, expectedVersion: 2, retryOf: id.toUpperCase() }).success, true);
  for (const body of [
    { ...input, content: ' ' }, { ...input, content: 'x'.repeat(2001) }, { ...input, retryOf: id },
    { ...input, userId: foreign }, { ...input, messages: [] }, { ...input, role: 'assistant' },
    { ...input, model: 'custom' }, { ...input, expiresAt: expiry.toISOString() },
    { ...input, expectedVersion: -1 }, { ...input, expectedVersion: 1.5 },
    { ...input, expectedVersion: Number.MAX_SAFE_INTEGER + 1 },
    { requestId: input.requestId, expectedVersion: 0, retryOf: 'bad' }, { ...input, requestId: 'bad' },
  ]) assert.equal(parse(body).success, false);
  assert.equal(parse(input, { owner }).success, false);
});

test('replay keeps the newest contiguous suffix at count/total boundaries and normalizes historical Assistant text', () => {
  const message = (role, content) => ({ role, content });
  assert.equal(buildReplay(Array.from({ length: 13 }, (_, i) => message('user', `${i}`))).length, 12);
  const exactly = [message('assistant', 'a'.repeat(4000)), message('assistant', 'b'.repeat(4000)),
    message('user', 'c'.repeat(2000)), message('user', 'd'.repeat(2000))];
  assert.deepEqual(buildReplay(exactly), exactly);
  assert.deepEqual(buildReplay([message('user', 'excluded'), ...exactly]), exactly);
  assert.deepEqual(buildReplay([message('user', 'do not skip the oversized predecessor'),
    message('assistant', 'a'.repeat(4000)), ...exactly.slice(1), message('user', 'x')]),
  [...exactly.slice(1), message('user', 'x')]);
  assert.deepEqual(buildReplay([message('assistant', `  ${'a'.repeat(4001)}  `),
    { role: 'user', content: '  failed prior turn  ', status: 'failed' }, message('user', '  current  ')]),
  [message('assistant', 'a'.repeat(4000)), message('user', 'failed prior turn'), message('user', 'current')]);
  assert.deepEqual(buildReplay([message('system', 'injected'), message('user', ' '), message('user', 'new')]), [message('user', 'new')]);
});

test('durable send/replay/conflict: one user/reply, exact wire data, immutable deadlines and no second generation', async (t) => {
  const f = fixture(t, { chat: async () => 'a'.repeat(4001) });
  const input = sendInput();
  const result = await f.service.send(input);
  assert.equal(f.calls.length, 1);
  assert.equal(result.assistantMessage.content.length, 4001, 'stored reply is not replay-truncated');
  assert.equal(result.conversation.version, 2);
  assert.equal(result.userMessage.sequence, 0); assert.equal(result.assistantMessage.sequence, 1);
  assert.equal(result.userMessage.status, 'complete');
  assert.deepEqual(Object.keys(result), ['conversation', 'requestId', 'userMessage', 'assistantMessage']);
  assert.deepEqual(await f.service.send(input), result);
  await assert.rejects(f.service.send({ ...input, content: 'changed' }), errorCode('ASSISTANT_REQUEST_CONFLICT'));
  await assert.rejects(f.service.send({ ...input, expectedVersion: 2 }), errorCode('ASSISTANT_REQUEST_CONFLICT'));
  assert.equal(f.calls.length, 1); assert.equal(f.state.messages.length, 2); assert.equal(f.state.requests.length, 1);
  for (const row of [...f.state.messages, ...f.state.requests, ...f.state.conversations]) assert.equal(+row.expiresAt, +expiry);
  assert.equal(+f.state.conversations[0].createdAt, +origin);
  assert.equal(JSON.stringify(result).includes('replaySnapshot'), false);
  const next = await f.service.send(sendInput({ expectedVersion: 2, content: 'next' }));
  assert.equal(next.conversation.version, 4);
  assert.equal(f.calls[1][1].content.length, 4000);
});

test('simultaneous same-key requests and competing devices cannot dispatch another provider call', async (t) => {
  const wait = deferred(); const started = deferred();
  const f = fixture(t, { chat: () => { started.resolve(); return wait.promise; } });
  const input = sendInput();
  const first = f.service.send(input); await started.promise;
  await assert.rejects(f.service.send(input), errorCode('ASSISTANT_REQUEST_IN_PROGRESS'));
  await assert.rejects(f.service.send(sendInput()), errorCode('ASSISTANT_CONVERSATION_STALE'));
  await assert.rejects(f.service.send(sendInput({ expectedVersion: 1 })), errorCode('ASSISTANT_REQUEST_IN_PROGRESS'));
  assert.equal(f.calls.length, 1);
  wait.resolve('real reply'); await first;
  assert.equal(f.state.messages.length, 2);
});

for (const code of ['ASSISTANT_NOT_CONFIGURED', 'ASSISTANT_UNAVAILABLE', 'ASSISTANT_TIMEOUT']) {
  test(`known ${code} is durable, replays safely, explicit retry uses exact snapshot without a second user row`, async (t) => {
    let fail = true;
    const f = fixture(t, { chat: async () => {
      if (fail) throw new AppError('private provider payload', { code, statusCode: 503 });
      return 'successful retry';
    } });
    const input = sendInput();
    await assert.rejects(f.service.send(input), errorCode(code));
    await assert.rejects(f.service.send(input), (error) => error.code === code && !error.message.includes('private'));
    assert.equal(f.calls.length, 1); assert.equal(f.state.messages.length, 1);
    assert.deepEqual(f.state.requests[0].safeOutcome, { code });
    assert.equal(f.state.conversations[0].claim, null); assert.equal(f.state.conversations[0].version, 2);
    fail = false;
    const retry = { userId: owner, conversationId: id, requestId: crypto.randomUUID(),
      expectedVersion: 2, retryOf: f.state.messages[0]._id };
    const result = await f.service.send(retry);
    assert.equal(result.userMessage.id, String(f.state.messages[0]._id));
    assert.deepEqual(f.calls[1], f.calls[0]);
    assert.equal(f.state.messages.filter((row) => row.role === 'user').length, 1);
    assert.equal(f.state.messages.filter((row) => row.role === 'assistant').length, 1);
    assert.equal(f.state.requests.length, 2); assert.equal(result.conversation.version, 4);
    assert.deepEqual(await f.service.send(retry), result); assert.equal(f.calls.length, 2);
    await assert.rejects(f.service.send({ ...retry, requestId: crypto.randomUUID(), expectedVersion: 4 }),
      errorCode('ASSISTANT_REQUEST_CONFLICT'));
  });
}

test('only latest failed user turn is retryable; missing/foreign retry references are opaque', async (t) => {
  const f = fixture(t, { chat: async () => { throw new Error('secret provider detail'); } });
  await assert.rejects(f.service.send(sendInput()), errorCode('ASSISTANT_UNAVAILABLE'));
  const old = f.state.messages[0]._id;
  await assert.rejects(f.service.send(sendInput({ expectedVersion: 2, content: 'later turn' })), errorCode('ASSISTANT_UNAVAILABLE'));
  const retry = { userId: owner, conversationId: id, requestId: crypto.randomUUID(), expectedVersion: 4, retryOf: old };
  await assert.rejects(f.service.send(retry), errorCode('ASSISTANT_REQUEST_CONFLICT'));
  await assert.rejects(f.service.send({ ...retry, retryOf: foreign }), errorCode('ASSISTANT_CONVERSATION_NOT_FOUND'));
  await assert.rejects(f.service.send(sendInput({ userId: foreign })), errorCode('ASSISTANT_CONVERSATION_NOT_FOUND'));
  assert.equal(f.calls.length, 2);
});

test('server replay includes failed prior user text and bounded recent persisted messages', async (t) => {
  let fail = true;
  const f = fixture(t, { chat: async () => { if (fail) throw new Error('failure'); return 'reply'; } });
  await assert.rejects(f.service.send(sendInput({ content: 'failed question' })), errorCode('ASSISTANT_UNAVAILABLE'));
  fail = false;
  await f.service.send(sendInput({ expectedVersion: 2, content: 'new question' }));
  assert.deepEqual(f.calls[1], [{ role: 'user', content: 'failed question' }, { role: 'user', content: 'new question' }]);
});

test('Delete while provider is pending removes everything; late completion cannot recreate children', async (t) => {
  const wait = deferred(); const started = deferred();
  const f = fixture(t, { chat: () => { started.resolve(); return wait.promise; } });
  const sending = f.service.send(sendInput()); await started.promise;
  assert.deepEqual(await f.service.remove({ userId: owner, conversationId: id }), { deleted: true });
  wait.resolve('late private reply');
  await assert.rejects(sending, errorCode('ASSISTANT_CONVERSATION_NOT_FOUND'));
  assert.deepEqual(f.state, { conversations: [], messages: [], requests: [] });
  assert.equal(f.calls.length, 1);
});

test('Delete after completed send removes committed cached results too', async (t) => {
  const f = fixture(t); const input = sendInput();
  await f.service.send(input); await f.service.remove({ userId: owner, conversationId: id });
  await assert.rejects(f.service.send(input), errorCode('ASSISTANT_CONVERSATION_NOT_FOUND'));
  assert.deepEqual(f.state, { conversations: [], messages: [], requests: [] }); assert.equal(f.calls.length, 1);
});

for (const offset of [-1, 0, 1]) {
  test(`immutable expiry at deadline ${offset}ms denies expired send/retry/replay even with retained records`, async (t) => {
    const f = fixture(t); const input = sendInput();
    await f.service.send(input); f.setTime(+expiry + offset);
    if (offset < 0) {
      assert.equal((await f.service.send(input)).assistantMessage.content, 'Cook lentils.');
    } else {
      for (const body of [input, sendInput({ expectedVersion: 2 }),
        { ...sendInput({ expectedVersion: 2 }), content: undefined, retryOf: f.state.messages[0]._id },
        { ...input, content: 'conflicting' }]) {
        await assert.rejects(f.service.send(body), errorCode('ASSISTANT_CONVERSATION_NOT_FOUND'));
      }
    }
    assert.equal(f.calls.length, 1); assert.equal(f.state.messages.length, 2);
  });
}

test('expiry during accepted claim read prevents dispatch and does not renew or publish anything', async (t) => {
  const f = fixture(t);
  f.controls.afterCommit = async () => { f.setTime(expiry); };
  await assert.rejects(f.service.send(sendInput()), errorCode('ASSISTANT_CONVERSATION_NOT_FOUND'));
  assert.equal(f.calls.length, 0); assert.equal(f.state.messages.length, 1);
  assert.equal(f.state.requests[0].state, 'pending'); assert.equal(+f.state.requests[0].expiresAt, +expiry);
});

for (const failure of [false, true]) {
  test(`expiry during pending provider ${failure ? 'failure' : 'success'} discards outcome before any completion write`, async (t) => {
    const f = fixture(t, { chat: async () => {
      f.setTime(expiry);
      if (failure) throw new AppError('private failure', { code: 'ASSISTANT_TIMEOUT' });
      return 'late reply';
    } });
    await assert.rejects(f.service.send(sendInput()), errorCode('ASSISTANT_CONVERSATION_NOT_FOUND'));
    assert.equal(f.calls.length, 1); assert.equal(f.state.messages.length, 1);
    assert.equal(f.state.requests[0].state, 'pending');
    assert.equal(f.events.filter((event) => event.event === 'requests.updateOne').length, 0);
  });
}

test('database deadline at final claim write rolls back user and snapshot with zero dispatch', async (t) => {
  const f = fixture(t);
  f.controls.hook = (event) => { if (event === 'requests.create') f.setDbTime(expiry); };
  await assert.rejects(f.service.send(sendInput()), errorCode('ASSISTANT_CONVERSATION_NOT_FOUND'));
  assert.equal(f.state.messages.length, 0); assert.equal(f.state.requests.length, 0); assert.equal(f.calls.length, 0);
});

test('expiry at final completion write rolls back reply/request/status and returns opaque 404', async (t) => {
  const f = fixture(t);
  f.controls.hook = (event, filter) => {
    if (event === 'conversations.findOneAndUpdate' && filter['claim.fence']) f.setTime(expiry);
  };
  await assert.rejects(f.service.send(sendInput()), errorCode('ASSISTANT_CONVERSATION_NOT_FOUND'));
  assert.equal(f.state.messages.length, 1); assert.equal(f.state.messages[0].status, 'pending');
  assert.equal(f.state.requests[0].state, 'pending'); assert.equal(f.calls.length, 1);
});

test('Mongo current time alone can deny the final completion fence without committing children', async (t) => {
  const f = fixture(t);
  f.controls.hook = (event, filter) => {
    if (event === 'conversations.findOneAndUpdate' && filter['claim.fence']) f.setDbTime(expiry);
  };
  await assert.rejects(f.service.send(sendInput()), errorCode('ASSISTANT_CONVERSATION_NOT_FOUND'));
  assert.equal(f.state.messages.length, 1); assert.equal(f.state.requests[0].state, 'pending');
});

test('expiry after replay reads and immediately before dispatch returns 404 without generation', async (t) => {
  const f = fixture(t); let reads = 0;
  f.controls.hook = (event, filter, session) => {
    if (event === 'messages.findOne' && !session && ++reads === 1) f.setTime(expiry);
  };
  await assert.rejects(f.service.send(sendInput()), errorCode('ASSISTANT_CONVERSATION_NOT_FOUND'));
  assert.equal(f.calls.length, 0); assert.equal(f.state.messages.length, 1);
});

test('a delayed worker cannot dispatch an already timed-out generation claim', async (t) => {
  const f = fixture(t);
  f.controls.afterCommit = (number) => { if (number === 1) f.setTime(+origin + 20000); };
  await assert.rejects(f.service.send(sendInput()), errorCode('ASSISTANT_SEND_UNCERTAIN'));
  assert.equal(f.calls.length, 0); assert.equal(f.state.requests[0].state, 'uncertain');
});

test('commit confirmed after expiry exposes no success, including unknown-commit reconciliation', async (t) => {
  const f = fixture(t);
  f.controls.afterCommit = (number) => {
    if (number === 2) { f.setTime(expiry); throw new Error('unknown commit'); }
  };
  const input = sendInput();
  await assert.rejects(f.service.send(input), errorCode('ASSISTANT_CONVERSATION_NOT_FOUND'));
  await assert.rejects(f.service.send(input), errorCode('ASSISTANT_CONVERSATION_NOT_FOUND'));
  assert.equal(f.calls.length, 1); assert.equal(f.state.requests[0].state, 'complete');
});

test('unknown completed commit reconciles durable result without regenerating', async (t) => {
  const f = fixture(t); f.controls.afterCommit = (number) => { if (number === 2) throw new Error('lost acknowledgement'); };
  const input = sendInput(); const result = await f.service.send(input);
  assert.equal(result.assistantMessage.content, 'Cook lentils.');
  assert.deepEqual(await f.service.send(input), result); assert.equal(f.calls.length, 1);
});

test('unknown claim commit never dispatches; live Open recovers to uncertain at provider deadline', async (t) => {
  const f = fixture(t);
  f.controls.afterCommit = (number) => { if (number === 1) throw new Error('lost claim acknowledgement'); };
  const input = sendInput();
  await assert.rejects(f.service.send(input), errorCode('ASSISTANT_SEND_UNCERTAIN'));
  assert.equal(f.calls.length, 0);
  f.setTime(+origin + 19999);
  await assert.rejects(f.service.send(input), errorCode('ASSISTANT_REQUEST_IN_PROGRESS'));
  f.setTime(+origin + 20000);
  const opened = await f.service.open({ userId: owner, conversationId: id });
  assert.equal(opened.messages[0].status, 'uncertain'); assert.equal(opened.conversation.version, 2);
  assert.equal(f.state.conversations[0].claim, null);
  await assert.rejects(f.service.send(input), errorCode('ASSISTANT_SEND_UNCERTAIN'));
  await assert.rejects(f.service.send({ userId: owner, conversationId: id, requestId: crypto.randomUUID(),
    expectedVersion: 2, retryOf: f.state.messages[0]._id }), errorCode('ASSISTANT_REQUEST_CONFLICT'));
  assert.equal(f.calls.length, 0);
  await f.service.send(sendInput({ expectedVersion: 2, content: 'reviewed and sending again' }));
  assert.equal(f.calls.length, 1);
});

test('process-loss recovery fences late completion; same request never redispatches', async (t) => {
  const wait = deferred(); const started = deferred();
  const f = fixture(t, { chat: () => { started.resolve(); return wait.promise; } });
  const input = sendInput(); const sending = f.service.send(input); await started.promise;
  f.setTime(+origin + 20000);
  await assert.rejects(f.service.send(input), errorCode('ASSISTANT_SEND_UNCERTAIN'));
  wait.resolve('late reply'); await assert.rejects(sending, errorCode('ASSISTANT_SEND_UNCERTAIN'));
  assert.equal(f.state.messages.length, 1); assert.equal(f.state.messages[0].status, 'uncertain');
  assert.equal(f.calls.length, 1); assert.equal(f.state.conversations[0].claim, null);
});

test('expiry wins over abandoned claim recovery with no retained-state mutation', async (t) => {
  const f = fixture(t); f.controls.afterCommit = (number) => { if (number === 1) throw new Error('lost acknowledgement'); };
  const input = sendInput(); await assert.rejects(f.service.send(input), errorCode('ASSISTANT_SEND_UNCERTAIN'));
  f.setTime(expiry);
  await assert.rejects(f.service.send(input), errorCode('ASSISTANT_CONVERSATION_NOT_FOUND'));
  await assert.rejects(f.service.open({ userId: owner, conversationId: id }), errorCode('ASSISTANT_CONVERSATION_NOT_FOUND'));
  assert.equal(f.state.requests[0].state, 'pending'); assert.equal(f.state.conversations[0].version, 1);
});

test('transaction callback retry rolls back inserts and still calls the provider exactly once', async (t) => {
  const f = fixture(t); f.controls.retry = true;
  const result = await f.service.send(sendInput());
  assert.equal(result.conversation.version, 2); assert.equal(f.state.messages.length, 2);
  assert.equal(f.state.requests.length, 1); assert.equal(f.calls.length, 1);
  assert.equal(f.events.filter((event) => event.event === 'requests.create').length, 2);
});

test('unique-index loser resolves same-key winner, rejects changed input and reports a competing version without dispatch', async (t) => {
  const f = fixture(t); const input = sendInput(); const result = await f.service.send(input);
  t.mock.method(repository, 'claimGeneration', async () => { throw Object.assign(new Error('duplicate key'), { code: 11000 }); });
  assert.deepEqual(await f.service.send(input), result);
  await assert.rejects(f.service.send({ ...input, content: 'different payload' }), errorCode('ASSISTANT_REQUEST_CONFLICT'));
  await assert.rejects(f.service.send(sendInput()), errorCode('ASSISTANT_CONVERSATION_STALE'));
  await assert.rejects(f.service.send(sendInput({ expectedVersion: 2 })), errorCode('ASSISTANT_REQUEST_CONFLICT'));
  assert.equal(f.calls.length, 1);
});

test('simultaneous competing claims from the same initial version produce a single accepted send', async (t) => {
  const f = fixture(t);
  const results = await Promise.allSettled([f.service.send(sendInput()), f.service.send(sendInput())]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'ASSISTANT_CONVERSATION_STALE');
  assert.equal(f.calls.length, 1); assert.equal(f.state.requests.length, 1); assert.equal(f.state.messages.length, 2);
});

test('completion database failure rolls back reply and remains uncertain without provider retry', async (t) => {
  const f = fixture(t);
  f.controls.hook = (event) => { if (event === 'requests.updateOne') throw new Error('private database error'); };
  const input = sendInput(); await assert.rejects(f.service.send(input), errorCode('ASSISTANT_SEND_UNCERTAIN'));
  assert.equal(f.state.messages.length, 1); assert.equal(f.state.requests[0].state, 'pending');
  await assert.rejects(f.service.send(input), errorCode('ASSISTANT_REQUEST_IN_PROGRESS'));
  assert.equal(f.calls.length, 1);
});

test('every generation mutation has owner/inherited deadline and the final parent fence uses current database time', async (t) => {
  const f = fixture(t); await f.service.send(sendInput());
  const mutations = f.events.filter(({ event }) => /updateOne|findOneAndUpdate/.test(event));
  for (const { filter } of mutations) {
    assert.equal(filter.userId, owner); assert.equal(+filter.expiresAt.$eq, +expiry);
    assert.ok(filter.expiresAt.$gt instanceof Date); assert.deepEqual(filter.$expr, { $gt: ['$expiresAt', '$$NOW'] });
  }
  const fences = mutations.filter(({ event }) => event === 'conversations.findOneAndUpdate');
  assert.equal(fences.length, 2); assert.equal(fences[0].filter.version, 0); assert.equal(fences[1].filter.version, 1);
  assert.equal(fences[0].filter.claim, null); assert.ok(fences[1].filter['claim.fence']);
});

const http = require('supertest');
const { createApp } = require('../src/app');
const history = require('../src/modules/assistant/assistant-history.service');
const assistant = require('../src/modules/assistant/assistant.service');
const sessionService = require('../src/modules/sessions/session.service');
const userService = require('../src/modules/users/user.service');
const { signAccessToken } = require('../src/shared/security/access-token');
const { assistantUserRateLimiter, assistantIpRateLimiter } = require('../src/middleware/rate-limiter');
const base = `/api/v1/assistant/conversations/${id}/messages`;
function routeIdentity(t, users = [owner], state = {}) {
  const sessions = new Map(users.map((userId) => [String(new mongoose.Types.ObjectId()), userId]));
  t.mock.method(console, 'error', () => {});
  t.mock.method(sessionService, 'getActiveSessionById', async (sessionId) => state.revoked ? null : ({
    _id: sessionId, userId: sessions.get(sessionId), securityGeneration: state.stale ? 1 : 2,
  }));
  t.mock.method(userService, 'getUserById', async (userId) => ({
    _id: userId, status: state.suspended ? 'suspended' : 'active', role: 'user',
    deactivatedAt: state.deactivated ? origin : null, sessionGeneration: 2,
  }));
  const tokens = new Map([...sessions].map(([sessionId, userId]) => [userId,
    `Bearer ${signAccessToken({ userId, sessionId, role: 'user' })}`]));
  for (const userId of users) assistantUserRateLimiter.resetKey(userId);
  // Supertest's socket uses loopback; do not create alternate generation budgets.
  for (const ip of ['::/56', '::1', '127.0.0.1', '::ffff:127.0.0.1']) assistantIpRateLimiter.resetKey(ip);
  return tokens;
}

test('mounted persistent Send uses authenticated owner, strict body, exact success and no-store', async (t) => {
  const tokens = routeIdentity(t); const start = new Date(); const f = fixture(t, { clock: start, createdAt: start });
  t.mock.method(history, 'send', (input) => f.service.send(input));
  const chat = t.mock.method(assistant, 'chat', () => assert.fail('persistent send bypassed injected AI1 service'));
  const input = sendInput(); const { userId, conversationId, ...body } = input;
  const response = await http(createApp()).post(base).set('Authorization', tokens.get(owner)).send(body);
  assert.equal(response.status, 200); assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(Object.keys(response.body.data), ['conversation', 'requestId', 'userMessage', 'assistantMessage']);
  assert.equal(response.body.data.userMessage.content, 'lentils'); assert.equal(f.calls.length, 1);
  assert.equal(chat.mock.callCount(), 0);
  assert.equal(JSON.stringify(response.body.data).includes('userId'), false);
  assert.equal(JSON.stringify(response.body.data).includes('replaySnapshot'), false);
});

for (const state of [{}, { suspended: true }, { deactivated: true }, { revoked: true }, { stale: true }]) {
  test(`mounted Send denies ${Object.keys(state)[0] || 'unauthenticated'} session before storage/generation`, async (t) => {
    const tokens = routeIdentity(t, [owner], state);
    const spy = t.mock.method(history, 'send', () => assert.fail('invalid session touched generation'));
    const call = http(createApp()).post(base).send({ requestId: crypto.randomUUID(), expectedVersion: 0, content: 'lentils' });
    if (Object.keys(state).length) call.set('Authorization', tokens.get(owner));
    const response = await call;
    assert.equal(response.status, 401); assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(spy.mock.callCount(), 0);
  });
}

test('mounted Send rejects forged ownership/transcript and returns opaque foreign-parent errors', async (t) => {
  const tokens = routeIdentity(t, [owner, foreign]); const f = fixture(t);
  const spy = t.mock.method(history, 'send', (input) => f.service.send(input));
  const app = createApp(); const body = { requestId: crypto.randomUUID(), expectedVersion: 0, content: 'lentils' };
  for (const extra of [{ userId: foreign }, { messages: [] }, { retryOf: id }, { tools: [] }]) {
    const response = await http(app).post(base).set('Authorization', tokens.get(owner)).send({ ...body, ...extra });
    assert.equal(response.status, 400); assert.equal(response.headers['cache-control'], 'no-store');
  }
  assert.equal(spy.mock.callCount(), 0);
  const response = await http(app).post(base).set('Authorization', tokens.get(foreign)).send(body);
  assert.equal(response.status, 404); assert.equal(response.body.error.code, 'ASSISTANT_CONVERSATION_NOT_FOUND');
  assert.equal(f.calls.length, 0); assert.equal(response.headers['cache-control'], 'no-store');
});

test('mounted Send keeps known provider errors safe and denies expired controller success', async (t) => {
  const tokens = routeIdentity(t);
  t.mock.method(history, 'send', async () => { throw new AppError('The cooking assistant request timed out.',
    { code: 'ASSISTANT_TIMEOUT', statusCode: 504 }); });
  const app = createApp(); const body = { requestId: crypto.randomUUID(), expectedVersion: 0, content: 'lentils' };
  const failed = await http(app).post(base).set('Authorization', tokens.get(owner)).send(body);
  assert.equal(failed.status, 504); assert.equal(failed.body.error.code, 'ASSISTANT_TIMEOUT');
  assert.equal(failed.headers['cache-control'], 'no-store');
  t.mock.method(history, 'send', async () => ({ conversation: { expiresAt: new Date(0).toISOString() },
    userMessage: { content: 'private text' }, assistantMessage: { content: 'late reply' } }));
  const expired = await http(app).post(base).set('Authorization', tokens.get(owner)).send(body);
  assert.equal(expired.status, 404); assert.equal(expired.body.error.code, 'ASSISTANT_CONVERSATION_NOT_FOUND');
  assert.equal(JSON.stringify(expired.body).includes('private text'), false);
  assert.equal(expired.headers['cache-control'], 'no-store');
});

test('legacy chat and persistent Send share the actual 10/11 user limiter, including transport replay', async (t) => {
  const tokens = routeIdentity(t); let sends = 0;
  t.mock.method(history, 'send', async () => { sends += 1;
    return { conversation: { expiresAt: new Date(Date.now() + 2592000000).toISOString() } }; });
  const chat = t.mock.method(assistant, 'chat', async () => 'legacy reply');
  t.mock.method(repository, 'findConversations', async () => []);
  const app = createApp(); const body = { requestId: crypto.randomUUID(), expectedVersion: 0, content: 'lentils' };
  for (let count = 0; count < 10; count += 1) {
    const persistent = count % 2 === 0;
    const result = await http(app).post(persistent ? base : '/api/v1/assistant/chat')
      .set('Authorization', tokens.get(owner)).send(persistent ? body : { messages: [{ role: 'user', content: 'lentils' }] });
    assert.equal(result.status, 200);
  }
  const limited = await http(app).post(base).set('Authorization', tokens.get(owner)).send(body);
  assert.equal(limited.status, 429); assert.equal(limited.body.error.code, 'RATE_LIMIT_EXCEEDED');
  assert.equal(limited.headers['cache-control'], 'no-store'); assert.equal(sends, 5); assert.equal(chat.mock.callCount(), 5);
  const crud = await http(app).get('/api/v1/assistant/conversations').set('Authorization', tokens.get(owner));
  assert.equal(crud.status, 200);
});

test('legacy chat and persistent Send share the actual 20/21 IP limiter across authenticated users', async (t) => {
  const users = [owner, foreign, '507f1f77bcf86cd799439013']; const tokens = routeIdentity(t, users);
  let sends = 0;
  t.mock.method(history, 'send', async () => { sends += 1;
    return { conversation: { expiresAt: new Date(Date.now() + 2592000000).toISOString() } }; });
  const chat = t.mock.method(assistant, 'chat', async () => 'legacy reply');
  const app = createApp();
  for (let count = 0; count < 20; count += 1) {
    const persistent = count % 2 === 0;
    const result = await http(app).post(persistent ? base : '/api/v1/assistant/chat')
      .set('Authorization', tokens.get(users[Math.floor(count / 10)]))
      .send(persistent ? { requestId: crypto.randomUUID(), expectedVersion: 0, content: 'lentils' }
        : { messages: [{ role: 'user', content: 'lentils' }] });
    assert.equal(result.status, 200, `request ${count + 1}`);
  }
  const limited = await http(app).post(base).set('Authorization', tokens.get(users[2]))
    .send({ requestId: crypto.randomUUID(), expectedVersion: 0, content: 'lentils' });
  assert.equal(limited.status, 429); assert.equal(limited.headers['cache-control'], 'no-store');
  assert.equal(sends, 10); assert.equal(chat.mock.callCount(), 10);
});
