process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const net = require('node:net');
const { PassThrough } = require('node:stream');
const {
  MAX_HEADER_SIZE,
  MAX_REDIRECTS,
  MAX_RESPONSE_BYTES,
  createPinnedLookup,
  createRecipeUrlFetcher,
  isGlobalAddress,
  parseImportUrl,
  requestHop,
  sameAddress,
} = require('../src/modules/recipes/recipe-url-fetcher');

function lookupFrom(map, calls = []) {
  return (hostname, options, callback) => {
    calls.push({ hostname, options });
    const value = map[hostname];
    if (value instanceof Error) callback(value);
    else callback(null, value || []);
  };
}

function fakeTransport(plans, captured = []) {
  let index = 0;
  return (options, onResponse) => {
    const plan = plans[index++] || {};
    const request = new EventEmitter();
    const record = { options, request, response: null };
    captured.push(record);
    request.destroy = () => { request.destroyed = true; };
    request.end = () => queueMicrotask(() => {
      const socket = new EventEmitter();
      socket.remoteAddress = plan.remoteAddress || '8.8.8.8';
      socket.destroy = () => { socket.destroyed = true; };
      request.emit('socket', socket);
      if (plan.neverConnect) return;
      socket.emit('secureConnect');
      if (plan.requestError) return request.emit('error', plan.requestError);

      const response = new PassThrough();
      record.response = response;
      response.statusCode = plan.statusCode ?? 200;
      response.headers = plan.headers || { 'content-type': 'text/html; charset=utf-8' };
      onResponse(response);
      for (const chunk of plan.chunks || [Buffer.from('<html>ok</html>')]) response.write(chunk);
      if (!plan.stall) response.end();
    });
    return request;
  };
}

function publicAnswers(address = '8.8.8.8') {
  return [{ address, family: address.includes(':') ? 6 : 4 }];
}

function code(errorCode) {
  return (error) => error.code === errorCode;
}

test('URL parsing rejects malformed, relative, non-HTTPS, credentials, ports, local names, and literals', () => {
  for (const value of ['not a url', '/relative']) assert.throws(() => parseImportUrl(value), code('RECIPE_IMPORT_URL_INVALID'));
  for (const value of ['http://example.com', 'ftp://example.com/a', 'file:///tmp/a', '//example.com/a']) {
    assert.throws(() => parseImportUrl(value), (error) => ['RECIPE_IMPORT_PROTOCOL_UNSUPPORTED', 'RECIPE_IMPORT_URL_INVALID'].includes(error.code));
  }
  assert.throws(() => parseImportUrl('https://u:p@example.com'), code('RECIPE_IMPORT_CREDENTIALS_NOT_ALLOWED'));
  assert.throws(() => parseImportUrl('https://example.com:444/a'), code('RECIPE_IMPORT_PORT_NOT_ALLOWED'));
  for (const value of ['https://localhost/a', 'https://x.local/a', 'https://x.internal/a', 'https://127.0.0.1/a', 'https://8.8.8.8/a', 'https://[::1]/a', 'https://[2606:4700:4700::1111]/a', 'https://example/a']) {
    assert.throws(() => parseImportUrl(value), code('RECIPE_IMPORT_DESTINATION_BLOCKED'));
  }
  const normalized = parseImportUrl('https://EXAMPLE.com.:443/a?q=1#secret');
  assert.equal(normalized.href, 'https://example.com/a?q=1');
});

test('real ipaddr classification rejects non-global IPv4, IPv6, metadata, and mapped addresses', () => {
  const blocked = [
    '0.0.0.0', '127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.0.1', '169.254.169.254',
    '100.64.0.1', '192.0.2.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', 'fe80::1', 'fc00::1', 'ff02::1', '2001:db8::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254',
  ];
  for (const address of blocked) assert.equal(isGlobalAddress(address), false, address);
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(isGlobalAddress(address), true, address);
  assert.equal(sameAddress('::ffff:8.8.8.8', '8.8.8.8'), true);
  assert.equal(sameAddress('8.8.8.8', '1.1.1.1'), false);
});

test('DNS fails closed for errors, empty results, and mixed public/private answers', async () => {
  let requests = 0;
  const request = () => { requests += 1; };
  for (const answers of [new Error('resolver detail'), [], [...publicAnswers(), { address: '127.0.0.1', family: 4 }]]) {
    const fetch = createRecipeUrlFetcher({ lookup: lookupFrom({ 'example.com': answers }), request, totalTimeoutMs: 50 });
    await assert.rejects(() => fetch('https://example.com/a'), (error) => ['RECIPE_IMPORT_DNS_FAILED', 'RECIPE_IMPORT_DESTINATION_BLOCKED'].includes(error.code));
  }
  assert.equal(requests, 0);
});

test('pins the chosen address while preserving hostname, SNI, headers, and a fresh direct connection', async () => {
  const dnsCalls = [];
  const captured = [];
  const fetch = createRecipeUrlFetcher({
    lookup: lookupFrom({ 'recipes.example': publicAnswers('8.8.8.8') }, dnsCalls),
    request: fakeTransport([{ chunks: [Buffer.from('<html>recipe</html>')] }], captured),
  });
  const result = await fetch('https://recipes.example/path?q=1#discard');
  assert.deepEqual(result, { sourceUrl: 'https://recipes.example/path?q=1', html: '<html>recipe</html>' });
  assert.equal(dnsCalls.length, 1);
  assert.deepEqual(dnsCalls[0].options, { all: true, order: 'verbatim' });
  const options = captured[0].options;
  assert.equal(options.hostname, 'recipes.example');
  assert.equal(options.servername, 'recipes.example');
  assert.equal(options.agent, false);
  assert.equal(options.maxHeaderSize, MAX_HEADER_SIZE);
  assert.equal(options.method, 'GET');
  assert.equal(options.path, '/path?q=1');
  assert.deepEqual(options.headers, {
    Accept: 'text/html, application/xhtml+xml;q=0.9',
    'Accept-Encoding': 'identity',
    'User-Agent': 'wecooked-recipe-importer/1.0',
    Connection: 'close',
  });
  assert.equal(Object.hasOwn(options.headers, 'Authorization'), false);
  assert.equal(Object.hasOwn(options.headers, 'Cookie'), false);
  let pinned;
  options.lookup('attacker.test', {}, (error, address, family) => { pinned = { error, address, family }; });
  assert.deepEqual(pinned, { error: null, address: '8.8.8.8', family: 4 });
  let pinnedAll;
  options.lookup('attacker.test', { all: true }, (error, addresses) => { pinnedAll = { error, addresses }; });
  assert.deepEqual(pinnedAll, { error: null, addresses: [{ address: '8.8.8.8', family: 4 }] });
  assert.equal(dnsCalls.length, 1);
});

test('pinned lookup satisfies the real Node all:true connection contract with one address', async (t) => {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const pinnedLookup = createPinnedLookup({ address: '127.0.0.1', family: 4 });
  let observedOptions;
  let observedResult;
  const socket = net.createConnection({
    host: 'recipes.example',
    port: server.address().port,
    autoSelectFamily: true,
    lookup(hostname, options, callback) {
      observedOptions = options;
      pinnedLookup(hostname, options, (...args) => {
        observedResult = args;
        callback(...args);
      });
    },
  });
  t.after(() => {
    socket.destroy();
    return new Promise((resolve) => server.close(resolve));
  });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });

  assert.equal(observedOptions.all, true);
  assert.deepEqual(observedResult, [null, [{ address: '127.0.0.1', family: 4 }]]);
  assert.equal(socket.remoteAddress, '127.0.0.1');
});

test('rejects socket address mismatch and non-public remote addresses after TLS connection', async () => {
  for (const remoteAddress of ['1.1.1.1', '127.0.0.1']) {
    const fetch = createRecipeUrlFetcher({
      lookup: lookupFrom({ 'example.com': publicAnswers('8.8.8.8') }),
      request: fakeTransport([{ remoteAddress }]),
    });
    await assert.rejects(() => fetch('https://example.com'), code('RECIPE_IMPORT_DESTINATION_BLOCKED'));
  }
});

test('handles relative redirects with per-hop re-resolution and allows exactly three redirects', async () => {
  const dnsCalls = [];
  const plans = Array.from({ length: MAX_REDIRECTS }, (_, index) => ({
    statusCode: 302,
    headers: { location: `/hop-${index + 1}` },
  })).concat({ chunks: [Buffer.from('done')] });
  const fetch = createRecipeUrlFetcher({
    lookup: lookupFrom({ 'example.com': publicAnswers() }, dnsCalls),
    request: fakeTransport(plans),
  });
  assert.deepEqual(await fetch('https://example.com/start'), { sourceUrl: 'https://example.com/hop-3', html: 'done' });
  assert.equal(dnsCalls.length, 4);

  const tooMany = createRecipeUrlFetcher({
    lookup: lookupFrom({ 'example.com': publicAnswers() }),
    request: fakeTransport(Array.from({ length: 4 }, () => ({ statusCode: 302, headers: { location: '/again' } }))),
  });
  await assert.rejects(() => tooMany('https://example.com/start'), code('RECIPE_IMPORT_TOO_MANY_REDIRECTS'));
});

test('blocks unsafe redirect targets before making a second request', async () => {
  for (const location of ['http://example.com/a', 'https://u:p@example.com/a', 'https://example.com:444/a', 'https://localhost/a', 'https://127.0.0.1/a']) {
    const captured = [];
    const fetch = createRecipeUrlFetcher({
      lookup: lookupFrom({ 'example.com': publicAnswers() }),
      request: fakeTransport([{ statusCode: 302, headers: { location } }], captured),
    });
    await assert.rejects(() => fetch('https://example.com/start'), code('RECIPE_IMPORT_REDIRECT_BLOCKED'));
    assert.equal(captured.length, 1, location);
  }

  const captured = [];
  const fetch = createRecipeUrlFetcher({
    lookup: lookupFrom({
      'example.com': publicAnswers(),
      'redirect.example': [{ address: '169.254.169.254', family: 4 }],
    }),
    request: fakeTransport([{ statusCode: 302, headers: { location: 'https://redirect.example/metadata' } }], captured),
  });
  await assert.rejects(() => fetch('https://example.com/start'), code('RECIPE_IMPORT_REDIRECT_BLOCKED'));
  assert.equal(captured.length, 1);
});

test('starts a real per-hop deadline before a stalled TLS connection completes', async (t) => {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise((resolve) => server.close(resolve));
  });

  let lookupOptions;
  let lookupResult;
  const startedAt = Date.now();
  await assert.rejects(() => requestHop(
    new URL('https://recipes.example/path'),
    { address: '127.0.0.1', family: 4 },
    (options, onResponse) => https.request({
      ...options,
      port: server.address().port,
      lookup(hostname, nodeOptions, callback) {
        lookupOptions = nodeOptions;
        options.lookup(hostname, nodeOptions, (...args) => {
          lookupResult = args;
          callback(...args);
        });
      },
    }, onResponse),
    { activeRequest: null, timedOut: false },
    { connectionTimeoutMs: 40 }
  ), code('RECIPE_IMPORT_TIMEOUT'));
  const elapsed = Date.now() - startedAt;
  assert.equal(lookupOptions.all, true);
  assert.deepEqual(lookupResult, [null, [{ address: '127.0.0.1', family: 4 }]]);
  assert.ok(elapsed >= 25, `deadline fired too early after ${elapsed}ms`);
  assert.ok(elapsed < 1_000, `deadline did not bound TLS establishment: ${elapsed}ms`);
});

test('keeps the independent total timeout for resolution and stalled bodies', async () => {

  const total = createRecipeUrlFetcher({
    lookup: lookupFrom({ 'example.com': publicAnswers() }),
    request: fakeTransport([{ neverConnect: true }]),
    totalTimeoutMs: 10,
  });
  await assert.rejects(() => total('https://example.com'), (error) => {
    assert.equal(error.code, 'RECIPE_IMPORT_TIMEOUT');
    assert.equal(error.message.includes('8.8.8.8'), false);
    return true;
  });

  const stalled = createRecipeUrlFetcher({
    lookup: lookupFrom({ 'example.com': publicAnswers() }),
    request: fakeTransport([{ chunks: [Buffer.from('<html>')], stall: true }]),
    totalTimeoutMs: 10,
  });
  await assert.rejects(() => stalled('https://example.com'), code('RECIPE_IMPORT_TIMEOUT'));
});

test('enforces body size both from Content-Length and streaming while accepting the exact boundary', async () => {
  const lookup = lookupFrom({ 'example.com': publicAnswers() });
  const declared = createRecipeUrlFetcher({
    lookup,
    request: fakeTransport([{ headers: { 'content-type': 'text/html', 'content-length': String(MAX_RESPONSE_BYTES + 1) } }]),
  });
  await assert.rejects(() => declared('https://example.com'), code('RECIPE_IMPORT_RESPONSE_TOO_LARGE'));

  const overflowCapture = [];
  const overflow = createRecipeUrlFetcher({
    lookup,
    request: fakeTransport([{ chunks: [Buffer.alloc(MAX_RESPONSE_BYTES), Buffer.from('x')] }], overflowCapture),
  });
  await assert.rejects(() => overflow('https://example.com'), code('RECIPE_IMPORT_RESPONSE_TOO_LARGE'));
  assert.equal(overflowCapture[0].response.destroyed, true);

  const exact = createRecipeUrlFetcher({ lookup, request: fakeTransport([{ chunks: [Buffer.alloc(MAX_RESPONSE_BYTES, 97)] }]) });
  assert.equal((await exact('https://example.com')).html.length, MAX_RESPONSE_BYTES);
});

test('enforces HTML media type, UTF-8 charset, identity encoding, fatal decoding, and remote status', async () => {
  const cases = [
    [{ headers: {} }, 'RECIPE_IMPORT_CONTENT_TYPE_UNSUPPORTED'],
    [{ headers: { 'content-type': 'application/json' } }, 'RECIPE_IMPORT_CONTENT_TYPE_UNSUPPORTED'],
    [{ headers: { 'content-type': 'text/html; charset=iso-8859-1' } }, 'RECIPE_IMPORT_CHARSET_UNSUPPORTED'],
    [{ headers: { 'content-type': 'text/html; charset=utf-8; charset=utf-8' } }, 'RECIPE_IMPORT_CHARSET_UNSUPPORTED'],
    [{ headers: { 'content-type': 'text/html; charset=utf-8; charset=utf8' } }, 'RECIPE_IMPORT_CHARSET_UNSUPPORTED'],
    [{ headers: { 'content-type': 'text/html; charset=utf-8; charset=iso-8859-1' } }, 'RECIPE_IMPORT_CHARSET_UNSUPPORTED'],
    [{ headers: { 'content-type': 'text/html; charset' } }, 'RECIPE_IMPORT_CHARSET_UNSUPPORTED'],
    [{ headers: { 'content-type': 'text/html; charset=' } }, 'RECIPE_IMPORT_CHARSET_UNSUPPORTED'],
    [{ headers: { 'content-type': 'text/html; charset="utf-8' } }, 'RECIPE_IMPORT_CHARSET_UNSUPPORTED'],
    [{ headers: { 'content-type': 'application/xhtml+xml', 'content-encoding': 'gzip' } }, 'RECIPE_IMPORT_CONTENT_ENCODING_UNSUPPORTED'],
    [{ chunks: [Buffer.from([0xc3, 0x28])] }, 'RECIPE_IMPORT_TEXT_INVALID'],
    [{ statusCode: 401 }, 'RECIPE_IMPORT_REMOTE_FAILED'],
  ];
  for (const [plan, expected] of cases) {
    const fetch = createRecipeUrlFetcher({
      lookup: lookupFrom({ 'example.com': publicAnswers() }),
      request: fakeTransport([plan]),
    });
    await assert.rejects(() => fetch('https://example.com'), code(expected));
  }
  for (const contentType of ['text/html', 'text/html; charset=UTF8', 'application/xhtml+xml; charset="utf-8"']) {
    const fetch = createRecipeUrlFetcher({
      lookup: lookupFrom({ 'example.com': publicAnswers() }),
      request: fakeTransport([{ headers: { 'content-type': contentType, 'content-encoding': 'identity' } }]),
    });
    assert.equal((await fetch('https://example.com')).html, '<html>ok</html>');
  }
});
