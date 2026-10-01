const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OPENAI_RESPONSES_URL,
  PROVIDER_TIMEOUT_MS,
  extractReply,
  createOpenAiProvider,
} = require('../src/modules/assistant/openai.provider');

const EXPECTED_SERVER_INSTRUCTIONS =
  "You are WeCooked's cooking assistant. Help with cooking questions, recipe ideas, ingredient substitutions, recipe scaling, and meal ideas. You do not have access to the user's pantry, profile, saved recipes, or the WeCooked catalog unless that context is explicitly supplied by the WeCooked server in this request. Never claim that you accessed information that was not supplied. Do not claim that food, ingredients, substitutions, or recipes are allergy-safe, and do not give allergy-safety guarantees. Do not provide medical guarantees. Do not claim exact nutritional values or guarantees unless authoritative nutritional data is explicitly supplied by the WeCooked server. Do not claim that you saved, changed, added, removed, ordered, or otherwise performed any action in WeCooked. Be clear when uncertain, and keep the answer concise and practical.";

function response({ ok = true, payload = {} } = {}) {
  return { ok, json: async () => payload };
}

test('provider sends only the frozen server-owned Responses request', async () => {
  let request;
  const provider = createOpenAiProvider({
    fetchImpl: async (...args) => {
      request = args;
      return response({
        payload: {
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '  Use lentils.  ' }] }],
        },
      });
    },
  });
  const messages = [{ role: 'user', content: 'Ideas?' }];
  assert.equal(await provider({ apiKey: 'server-secret', model: 'chosen-model', messages }), 'Use lentils.');
  assert.equal(request[0], OPENAI_RESPONSES_URL);
  const options = request[1];
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Authorization, 'Bearer server-secret');
  assert.equal(options.headers['Content-Type'], 'application/json');
  const body = JSON.parse(options.body);
  assert.deepEqual(body, {
    model: 'chosen-model',
    instructions: EXPECTED_SERVER_INSTRUCTIONS,
    input: messages,
    max_output_tokens: 600,
    store: false,
    tools: [],
  });
  for (const forbidden of ['previous_response_id', 'conversation', 'background', 'metadata']) {
    assert.equal(forbidden in body, false);
  }
});

test('provider extracts only assistant message output_text in deterministic order', () => {
  assert.equal(
    extractReply({
      output: [
        { type: 'message', role: 'user', content: [{ type: 'output_text', text: 'ignored' }] },
        { type: 'reasoning', content: [{ type: 'output_text', text: 'ignored' }] },
        { type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'ignored' }, { type: 'output_text', text: ' First ' }] },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'second ' }] },
      ],
    }),
    'First second'
  );
});

test('provider normalizes HTTP, network, invalid JSON, malformed, and empty responses', async () => {
  const cases = [
    async () => response({ ok: false }),
    async () => { throw new Error('raw network secret'); },
    async () => ({ ok: true, json: async () => { throw new Error('raw body'); } }),
    async () => response({ payload: { output: 'wrong' } }),
    async () => response({ payload: { output: [{ type: 'message', role: 'assistant', content: [] }] } }),
    async () => response({ payload: { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '   ' }] }] } }),
    async () => { throw new DOMException('caller aborted', 'AbortError'); },
  ];
  for (const fetchImpl of cases) {
    const provider = createOpenAiProvider({ fetchImpl });
    await assert.rejects(
      () => provider({ apiKey: 'secret', model: 'model', messages: [{ role: 'user', content: 'private' }] }),
      (error) => error.statusCode === 503 && error.code === 'ASSISTANT_UNAVAILABLE' && !error.message.includes('raw')
    );
  }
});

test('provider clears its timer after successful non-timeout completion', async () => {
  const cleared = [];
  const provider = createOpenAiProvider({
    setTimeoutImpl() { return 'success-timer'; },
    clearTimeoutImpl(timer) { cleared.push(timer); },
    fetchImpl: async () => response({
      payload: {
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Ready.' }] }],
      },
    }),
  });

  assert.equal(
    await provider({ apiKey: 'secret', model: 'model', messages: [{ role: 'user', content: 'private' }] }),
    'Ready.'
  );
  assert.deepEqual(cleared, ['success-timer']);
});

test('provider aborts at twenty seconds and always clears its timer', async () => {
  let scheduled;
  let cleared;
  const provider = createOpenAiProvider({
    setTimeoutImpl(callback, delay) {
      assert.equal(delay, PROVIDER_TIMEOUT_MS);
      scheduled = callback;
      return 'timer-id';
    },
    clearTimeoutImpl(timer) { cleared = timer; },
    fetchImpl: async (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      scheduled();
    }),
  });
  await assert.rejects(
    () => provider({ apiKey: 'secret', model: 'model', messages: [{ role: 'user', content: 'private' }] }),
    (error) => error.statusCode === 504 && error.code === 'ASSISTANT_TIMEOUT'
  );
  assert.equal(cleared, 'timer-id');
});
