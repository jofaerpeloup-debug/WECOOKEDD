const test = require('node:test');
const assert = require('node:assert/strict');

const { AppError } = require('../src/shared/errors/app-error');
const { createAssistantService } = require('../src/modules/assistant/assistant.service');

test('service fails closed for absent or partial configuration without provider work', async () => {
  for (const config of [{ apiKey: '', model: '' }, { apiKey: 'key', model: '' }, { apiKey: '', model: 'model' }]) {
    let providerCalls = 0;
    const logs = [];
    const chat = createAssistantService({
      getConfig: () => config,
      requestReply: async () => { providerCalls += 1; },
      log: (entry) => logs.push(entry),
      now: () => 50,
    });
    await assert.rejects(
      () => chat([{ role: 'user', content: 'private transcript' }]),
      (error) => error.statusCode === 503 && error.code === 'ASSISTANT_NOT_CONFIGURED'
    );
    assert.equal(providerCalls, 0);
    assert.deepEqual(logs, [{ event: 'assistant.chat', outcome: 'failure', latencyMs: 0, category: 'not_configured' }]);
  }
});

test('service passes independent validated transcripts and logs only safe metadata', async () => {
  const calls = [];
  const logs = [];
  let time = 100;
  const chat = createAssistantService({
    getConfig: () => ({ apiKey: 'server-key', model: 'server-model' }),
    requestReply: async (request) => { calls.push(request); return `reply-${calls.length}`; },
    log: (entry) => logs.push(entry),
    now: () => time++,
  });
  const first = [{ role: 'user', content: 'first private prompt' }];
  const second = [{ role: 'user', content: 'second private prompt' }];
  assert.equal(await chat(first), 'reply-1');
  assert.equal(await chat(second), 'reply-2');
  assert.deepEqual(calls, [
    { apiKey: 'server-key', model: 'server-model', messages: first },
    { apiKey: 'server-key', model: 'server-model', messages: second },
  ]);
  assert.deepEqual(logs, [
    { event: 'assistant.chat', outcome: 'success', latencyMs: 1 },
    { event: 'assistant.chat', outcome: 'success', latencyMs: 1 },
  ]);
  assert.equal(JSON.stringify(logs).includes('private'), false);
  assert.equal(JSON.stringify(logs).includes('server-key'), false);
});

test('service preserves normalized timeout and unavailable errors and sanitizes unknown failures', async () => {
  const failures = [
    new AppError('fixed timeout', { statusCode: 504, code: 'ASSISTANT_TIMEOUT' }),
    new AppError('fixed unavailable', { statusCode: 503, code: 'ASSISTANT_UNAVAILABLE' }),
    new Error('raw provider body with secret'),
  ];
  const expected = ['ASSISTANT_TIMEOUT', 'ASSISTANT_UNAVAILABLE', 'ASSISTANT_UNAVAILABLE'];
  for (let index = 0; index < failures.length; index += 1) {
    const logs = [];
    const chat = createAssistantService({
      getConfig: () => ({ apiKey: 'key', model: 'model' }),
      requestReply: async () => { throw failures[index]; },
      log: (entry) => logs.push(entry),
      now: () => 10,
    });
    await assert.rejects(
      () => chat([{ role: 'user', content: 'private' }]),
      (error) => error.code === expected[index] && !error.message.includes('secret')
    );
    assert.equal(JSON.stringify(logs).includes('private'), false);
    assert.equal(JSON.stringify(logs).includes('secret'), false);
    assert.equal(logs[0].category, index === 0 ? 'timeout' : 'provider_unavailable');
  }
});
