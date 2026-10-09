process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_notif2_test';
process.env.JWT_ACCESS_SECRET = 'expo-adapter-secret-at-least-32-characters';

const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../src/modules/push-installations/push-installation.service');
const adapter = require('../src/shared/push/expo-push.adapter');

const notification = { _id: '507f1f77bcf86cd799439011', content: { title: 'Title', body: 'Body' } };
const jsonResponse = (data) => ({ ok: true, headers: { get: () => 'application/json; charset=utf-8' }, json: async () => data });
const response = ({ ok = true, contentType = 'application/json', data, jsonError } = {}) => ({
  ok,
  headers: { get: () => contentType },
  json: async () => {
    if (jsonError) throw jsonError;
    return data;
  },
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('sends authenticated exact payload, deduplicates tokens, and returns private receipt pairs', async () => {
  let request;
  const fetchImpl = async (_url, options) => { request = options; return jsonResponse({ data: [{ status: 'ok', id: 'receipt-1' }] }); };
  const result = await adapter.sendNotification(notification, [{ token: 'ExpoPushToken[one]', platform: 'ios' }, { token: 'ExpoPushToken[one]', platform: 'ios' }], { accessToken: 'server-secret', fetchImpl });
  assert.equal(request.headers.Authorization, 'Bearer server-secret');
  assert.deepEqual(JSON.parse(request.body), [{
    to: 'ExpoPushToken[one]', title: 'Title', body: 'Body',
    data: { version: 1, kind: 'notification', notificationId: String(notification._id) },
  }]);
  assert.deepEqual(result, [{ token: 'ExpoPushToken[one]', status: 'accepted', receipt: { id: 'receipt-1', token: 'ExpoPushToken[one]' } }]);
});

test('malformed/count mismatch fails closed and absence of Push Security token is unavailable', async () => {
  await assert.rejects(() => adapter.sendNotification(notification, [{ token: 'ExpoPushToken[one]', platform: 'ios' }], { accessToken: '', fetchImpl: async () => jsonResponse({ data: [] }) }), { code: 'EXPO_PUSH_UNAVAILABLE' });
  await assert.rejects(() => adapter.sendNotification(notification, [{ token: 'ExpoPushToken[one]', platform: 'ios' }], { accessToken: 'secret', fetchImpl: async () => jsonResponse({ data: [] }) }), { code: 'EXPO_PUSH_MALFORMED_RESPONSE' });
});

test('chunks 101 unique targets into exact 100 and 1 request batches without changing payload authority', async () => {
  const batches = [];
  const targets = Array.from({ length: 101 }, (_, index) => ({
    token: `ExpoPushToken[token${index}]`, platform: index % 2 ? 'android' : 'ios',
  }));
  const fetchImpl = async (_url, options) => {
    const messages = JSON.parse(options.body);
    batches.push(messages);
    return jsonResponse({ data: messages.map((_message, index) => ({ status: 'ok', id: `receipt-${batches.length}-${index}` })) });
  };
  const results = await adapter.sendNotification(notification, targets, { accessToken: 'secret', fetchImpl });
  assert.deepEqual(batches.map((batch) => batch.length), [100, 1]);
  assert.equal(results.length, 101);
  assert.ok(batches.flat().every((message) => (
    message.title === 'Title'
    && message.body === 'Body'
    && JSON.stringify(message.data) === JSON.stringify({ version: 1, kind: 'notification', notificationId: String(notification._id) })
  )));
});

test('DeviceNotRegistered invalidates only the exact implicated token', async (t) => {
  const provider = deferred();
  const tokens = [];
  t.mock.method(service, 'unregisterExactToken', async (token) => tokens.push(token));
  const send = adapter.sendNotification(notification, [{ token: 'ExpoPushToken[old]', platform: 'ios' }], {
    accessToken: 'secret', fetchImpl: async () => provider.promise,
  });
  const rotatedToken = 'ExpoPushToken[new]';
  provider.resolve(jsonResponse({ data: [{ status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }] }));
  await send;
  assert.deepEqual(tokens, ['ExpoPushToken[old]']);
  assert.equal(tokens.includes(rotatedToken), false);
});

test('receipt lookup validates exact probes and receipt shapes before classifying delivery', async () => {
  const fetchImpl = async () => jsonResponse({ data: { 'receipt-1': { status: 'ok' } } });
  assert.deepEqual(
    await adapter.getReceipts([{ id: 'receipt-1', token: 'ExpoPushToken[one]' }], { accessToken: 'secret', fetchImpl }),
    [{ id: 'receipt-1', token: 'ExpoPushToken[one]', status: 'delivered' }]
  );
  await assert.rejects(
    () => adapter.getReceipts([{ id: 'receipt-1', token: 'invalid' }], { accessToken: 'secret', fetchImpl }),
    { code: 'EXPO_PUSH_INPUT_INVALID' }
  );
  await assert.rejects(
    () => adapter.getReceipts([
      { id: 'receipt-1', token: 'ExpoPushToken[one]' },
      { id: 'receipt-1', token: 'ExpoPushToken[two]' },
    ], { accessToken: 'secret', fetchImpl }),
    { code: 'EXPO_PUSH_INPUT_INVALID' }
  );
  await assert.rejects(
    () => adapter.getReceipts([{ id: 'receipt-1', token: 'ExpoPushToken[one]' }], {
      accessToken: 'secret',
      fetchImpl: async () => jsonResponse({ data: { 'receipt-1': { status: 'ok', details: {} } } }),
    }),
    { code: 'EXPO_PUSH_MALFORMED_RESPONSE' }
  );
});

test('send fails closed for malformed HTTP, content-type, JSON, top-level, and ticket responses', async () => {
  const target = [{ token: 'ExpoPushToken[one]', platform: 'ios' }];
  const cases = [
    ['HTTP failure', response({ ok: false, data: { data: [] } }), 'EXPO_PUSH_HTTP_ERROR'],
    ['non-JSON content type', response({ contentType: 'text/html', data: { data: [] } }), 'EXPO_PUSH_MALFORMED_RESPONSE'],
    ['unparseable JSON', response({ jsonError: new Error('invalid json') }), 'EXPO_PUSH_MALFORMED_RESPONSE'],
    ['provider top-level error', jsonResponse({ errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS' }] }), 'EXPO_PUSH_MALFORMED_RESPONSE'],
    ['extra top-level field', jsonResponse({ data: [{ status: 'ok', id: 'receipt-1' }], extra: true }), 'EXPO_PUSH_MALFORMED_RESPONSE'],
    ['non-array data', jsonResponse({ data: { status: 'ok' } }), 'EXPO_PUSH_MALFORMED_RESPONSE'],
    ['unexpected ticket status', jsonResponse({ data: [{ status: 'pending', id: 'receipt-1' }] }), 'EXPO_PUSH_MALFORMED_RESPONSE'],
    ['extra ticket field', jsonResponse({ data: [{ status: 'ok', id: 'receipt-1', message: 'extra' }] }), 'EXPO_PUSH_MALFORMED_RESPONSE'],
  ];
  for (const [label, providerResponse, code] of cases) {
    await assert.rejects(
      () => adapter.sendNotification(notification, target, {
        accessToken: 'secret', fetchImpl: async () => providerResponse,
      }),
      (error) => error?.code === code,
      label
    );
  }
});

test('multiple receipt probes preserve exact ID/token pairing and clean only the implicated active token', async (t) => {
  const tokens = [];
  t.mock.method(service, 'unregisterExactToken', async (token) => tokens.push(token));
  const probes = [
    { id: 'receipt-a', token: 'ExpoPushToken[tokenA]' },
    { id: 'receipt-b', token: 'ExpoPushToken[tokenB]' },
    { id: 'receipt-c', token: 'ExpoPushToken[tokenC]' },
  ];
  const result = await adapter.getReceipts(probes, {
    accessToken: 'secret',
    fetchImpl: async () => jsonResponse({
      data: {
        'receipt-c': { status: 'error', message: 'temporary', details: { error: 'MessageRateExceeded' } },
        'receipt-a': { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
        'receipt-b': { status: 'ok' },
      },
    }),
  });
  assert.deepEqual(tokens, ['ExpoPushToken[tokenA]']);
  assert.deepEqual(result, [
    { id: 'receipt-a', token: 'ExpoPushToken[tokenA]', status: 'deviceNotRegistered' },
    { id: 'receipt-b', token: 'ExpoPushToken[tokenB]', status: 'delivered' },
    { id: 'receipt-c', token: 'ExpoPushToken[tokenC]', status: 'rejected', code: 'MessageRateExceeded' },
  ]);
});

test('a valid first DeviceNotRegistered receipt followed by malformed data performs zero cleanup', async (t) => {
  const tokens = [];
  t.mock.method(service, 'unregisterExactToken', async (token) => tokens.push(token));
  const probes = [
    { id: 'receipt-a', token: 'ExpoPushToken[tokenA]' },
    { id: 'receipt-b', token: 'ExpoPushToken[tokenB]' },
  ];
  await assert.rejects(
    () => adapter.getReceipts(probes, {
      accessToken: 'secret',
      fetchImpl: async () => jsonResponse({ data: {
        'receipt-a': { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
        'receipt-b': { status: 'pending' },
      } }),
    }),
    { code: 'EXPO_PUSH_MALFORMED_RESPONSE' }
  );
  assert.deepEqual(tokens, []);
});

test('malformed, unexpected, and missing mixed receipt batches perform zero cleanup', async (t) => {
  const tokens = [];
  t.mock.method(service, 'unregisterExactToken', async (token) => tokens.push(token));
  const probes = [
    { id: 'receipt-a', token: 'ExpoPushToken[tokenA]' },
    { id: 'receipt-b', token: 'ExpoPushToken[tokenB]' },
  ];
  const deviceNotRegistered = { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } };
  const cases = [
    ['malformed later receipt', { data: { 'receipt-a': deviceNotRegistered, 'receipt-b': { status: 'ok', extra: true } } }],
    ['unexpected receipt ID', { data: { 'receipt-a': deviceNotRegistered, 'receipt-b': { status: 'ok' }, unexpected: { status: 'ok' } } }],
    ['missing expected receipt', { data: { 'receipt-a': deviceNotRegistered } }],
  ];
  for (const [label, payload] of cases) {
    await assert.rejects(
      () => adapter.getReceipts(probes, {
        accessToken: 'secret', fetchImpl: async () => jsonResponse(payload),
      }),
      (error) => error?.code === 'EXPO_PUSH_MALFORMED_RESPONSE',
      label
    );
  }
  assert.deepEqual(tokens, []);
});

test('a valid multi-receipt batch performs only the cleanup intended by exact probe/token pairs', async (t) => {
  const tokens = [];
  t.mock.method(service, 'unregisterExactToken', async (token) => tokens.push(token));
  const probes = [
    { id: 'receipt-a', token: 'ExpoPushToken[tokenA]' },
    { id: 'receipt-b', token: 'ExpoPushToken[tokenB]' },
    { id: 'receipt-c', token: 'ExpoPushToken[tokenC]' },
  ];
  await adapter.getReceipts(probes, {
    accessToken: 'secret',
    fetchImpl: async () => jsonResponse({ data: {
      'receipt-a': { status: 'ok' },
      'receipt-b': { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
      'receipt-c': { status: 'ok' },
    } }),
  });
  assert.deepEqual(tokens, ['ExpoPushToken[tokenB]']);
});

test('receipt lookup rejects malformed and unexpected provider responses before cleanup', async (t) => {
  const tokens = [];
  t.mock.method(service, 'unregisterExactToken', async (token) => tokens.push(token));
  const probes = [{ id: 'receipt-1', token: 'ExpoPushToken[one]' }];
  const cases = [
    ['HTTP failure', response({ ok: false, data: { data: {} } }), 'EXPO_PUSH_HTTP_ERROR'],
    ['non-JSON content type', response({ contentType: 'text/plain', data: { data: {} } }), 'EXPO_PUSH_MALFORMED_RESPONSE'],
    ['unparseable JSON', response({ jsonError: new Error('invalid json') }), 'EXPO_PUSH_MALFORMED_RESPONSE'],
    ['provider top-level error', jsonResponse({ errors: [{ code: 'PUSH_TOO_MANY_RECEIPTS' }] }), 'EXPO_PUSH_MALFORMED_RESPONSE'],
    ['extra top-level field', jsonResponse({ data: { 'receipt-1': { status: 'ok' } }, extra: true }), 'EXPO_PUSH_MALFORMED_RESPONSE'],
    ['unexpected receipt ID', jsonResponse({ data: { unexpected: { status: 'ok' } } }), 'EXPO_PUSH_MALFORMED_RESPONSE'],
    ['missing requested receipt', jsonResponse({ data: {} }), 'EXPO_PUSH_MALFORMED_RESPONSE'],
    ['unexpected receipt status', jsonResponse({ data: { 'receipt-1': { status: 'pending' } } }), 'EXPO_PUSH_MALFORMED_RESPONSE'],
    ['malformed provider error', jsonResponse({ data: { 'receipt-1': { status: 'error', message: 'gone', details: { error: '' } } } }), 'EXPO_PUSH_MALFORMED_RESPONSE'],
  ];
  for (const [label, providerResponse, code] of cases) {
    await assert.rejects(
      () => adapter.getReceipts(probes, {
        accessToken: 'secret', fetchImpl: async () => providerResponse,
      }),
      (error) => error?.code === code,
      label
    );
  }
  assert.deepEqual(tokens, []);
});
