const dns = require('node:dns');
const https = require('node:https');
const { TextDecoder } = require('node:util');
const ipaddr = require('ipaddr.js');
const { AppError } = require('../../shared/errors/app-error');

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
const CONNECTION_TIMEOUT_MS = 3_000;
const TOTAL_TIMEOUT_MS = 5_000;
const MAX_HEADER_SIZE = 16 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const RESPONSES = Object.freeze({
  invalid: [400, 'RECIPE_IMPORT_URL_INVALID', 'Enter a valid absolute recipe URL.'],
  protocol: [400, 'RECIPE_IMPORT_PROTOCOL_UNSUPPORTED', 'Recipe import supports HTTPS URLs only.'],
  credentials: [400, 'RECIPE_IMPORT_CREDENTIALS_NOT_ALLOWED', 'Recipe URLs must not contain credentials.'],
  port: [400, 'RECIPE_IMPORT_PORT_NOT_ALLOWED', 'Recipe URLs must use the default HTTPS port.'],
  blocked: [422, 'RECIPE_IMPORT_DESTINATION_BLOCKED', 'This destination cannot be imported.'],
  redirectBlocked: [422, 'RECIPE_IMPORT_REDIRECT_BLOCKED', 'The recipe website redirected to a blocked destination.'],
  dns: [502, 'RECIPE_IMPORT_DNS_FAILED', 'The recipe website could not be resolved.'],
  redirects: [422, 'RECIPE_IMPORT_TOO_MANY_REDIRECTS', 'The recipe website redirected too many times.'],
  timeout: [504, 'RECIPE_IMPORT_TIMEOUT', 'The recipe website took too long to respond.'],
  large: [413, 'RECIPE_IMPORT_RESPONSE_TOO_LARGE', 'The recipe page is too large to import.'],
  contentType: [415, 'RECIPE_IMPORT_CONTENT_TYPE_UNSUPPORTED', 'The URL did not return a supported HTML page.'],
  encoding: [415, 'RECIPE_IMPORT_CONTENT_ENCODING_UNSUPPORTED', 'The recipe page used an unsupported content encoding.'],
  charset: [415, 'RECIPE_IMPORT_CHARSET_UNSUPPORTED', 'The recipe page must use UTF-8 text.'],
  text: [422, 'RECIPE_IMPORT_TEXT_INVALID', 'The recipe page could not be decoded safely.'],
  remote: [502, 'RECIPE_IMPORT_REMOTE_FAILED', 'The recipe website could not be retrieved.'],
});

function failure(key) {
  const [statusCode, code, message] = RESPONSES[key];
  return new AppError(message, { statusCode, code });
}

function normalizedAddress(address) {
  if (!ipaddr.isValid(address)) return null;
  const parsed = ipaddr.parse(address);
  return parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress()
    ? parsed.toIPv4Address()
    : parsed;
}

function isGlobalAddress(address) {
  const parsed = normalizedAddress(address);
  return Boolean(parsed && parsed.range() === 'unicast');
}

function sameAddress(left, right) {
  const first = normalizedAddress(left);
  const second = normalizedAddress(right);
  return Boolean(first && second && first.kind() === second.kind() && first.toString() === second.toString());
}

function createPinnedLookup(chosen) {
  return (_hostname, options, callback) => {
    const pinned = { address: chosen.address, family: chosen.family };
    if (options?.all === true) {
      callback(null, [pinned]);
      return;
    }
    callback(null, pinned.address, pinned.family);
  };
}

function parseImportUrl(input, { redirect = false } = {}) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw failure(redirect ? 'redirectBlocked' : 'invalid');
  }
  const reject = (key) => { throw failure(redirect ? 'redirectBlocked' : key); };
  if (url.protocol !== 'https:') reject('protocol');
  if (url.username || url.password) reject('credentials');
  if (url.port && url.port !== '443') reject('port');

  url.hash = '';
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, '');
  const literalHostname = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  const labels = hostname.split('.');
  if (
    !hostname || labels.length < 2 || labels.some((label) => !label) ||
    hostname === 'localhost' || hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') || hostname.endsWith('.internal') ||
    ipaddr.isValid(literalHostname)
  ) reject('blocked');

  url.hostname = hostname;
  return url;
}

function resolveHostname(hostname, lookup) {
  return new Promise((resolve, reject) => {
    lookup(hostname, { all: true, order: 'verbatim' }, (error, addresses) => {
      if (error || !Array.isArray(addresses) || addresses.length === 0) return reject(failure('dns'));
      resolve(addresses);
    });
  });
}

function contentPolicy(headers) {
  const rawType = String(headers['content-type'] || '');
  const [mediaType, ...parameters] = rawType.split(';').map((part) => part.trim());
  if (!['text/html', 'application/xhtml+xml'].includes(mediaType.toLowerCase())) {
    throw failure('contentType');
  }
  const charsetParameters = parameters.filter((part) => /^charset(?:\s*=|\s*$)/iu.test(part));
  if (charsetParameters.length > 1) throw failure('charset');
  if (charsetParameters.length === 1) {
    const match = charsetParameters[0].match(/^charset\s*=\s*(?:"(utf-8|utf8)"|'(utf-8|utf8)'|(utf-8|utf8))\s*$/iu);
    if (!match) throw failure('charset');
  }
  const encoding = String(headers['content-encoding'] || '').trim().toLowerCase();
  if (encoding && encoding !== 'identity') throw failure('encoding');

  const length = String(headers['content-length'] || '').trim();
  if (/^\d+$/u.test(length) && Number(length) > MAX_RESPONSE_BYTES) throw failure('large');
}

function collectBody(response) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    response.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (bytes + buffer.byteLength > MAX_RESPONSE_BYTES) {
        response.destroy();
        finish(reject, failure('large'));
        return;
      }
      bytes += buffer.byteLength;
      chunks.push(buffer);
    });
    response.once('end', () => finish(resolve, Buffer.concat(chunks, bytes)));
    response.once('aborted', () => finish(reject, failure('remote')));
    response.once('error', () => finish(reject, failure('remote')));
  });
}

function requestHop(url, chosen, requestImpl, operation, {
  redirect = false,
  connectionTimeoutMs = CONNECTION_TIMEOUT_MS,
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let socketVerified = false;
    let request;
    const connectionTimer = setTimeout(() => {
      request?.destroy();
      finish(reject, failure('timeout'));
    }, connectionTimeoutMs);
    connectionTimer.unref?.();
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectionTimer);
      callback(value);
    };
    const options = {
      protocol: 'https:',
      hostname: url.hostname,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      agent: false,
      servername: url.hostname,
      maxHeaderSize: MAX_HEADER_SIZE,
      headers: {
        Accept: 'text/html, application/xhtml+xml;q=0.9',
        'Accept-Encoding': 'identity',
        'User-Agent': 'wecooked-recipe-importer/1.0',
        Connection: 'close',
      },
      lookup: createPinnedLookup(chosen),
    };

    try {
      request = requestImpl(options, (response) => finish(resolve, { response, socketVerified }));
    } catch {
      finish(reject, failure('remote'));
      return;
    }
    operation.activeRequest = request;
    request.once('socket', (socket) => {
      socket.once('secureConnect', () => {
        if (!isGlobalAddress(socket.remoteAddress) || !sameAddress(socket.remoteAddress, chosen.address)) {
          socket.destroy();
          finish(reject, failure(redirect ? 'redirectBlocked' : 'blocked'));
          return;
        }
        socketVerified = true;
        clearTimeout(connectionTimer);
      });
    });
    request.once('error', (error) => {
      if (error?.code === 'ERR_HTTP_HEADERS_OVERFLOW') finish(reject, failure('remote'));
      else finish(reject, operation.timedOut ? failure('timeout') : failure('remote'));
    });
    request.end();
  });
}

function createRecipeUrlFetcher({
  lookup = dns.lookup,
  request = https.request,
  connectionTimeoutMs = CONNECTION_TIMEOUT_MS,
  totalTimeoutMs = TOTAL_TIMEOUT_MS,
} = {}) {
  return async function fetchRecipeUrl(input) {
    const operation = { activeRequest: null, timedOut: false };
    let rejectDeadline;
    const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
    const timer = setTimeout(() => {
      operation.timedOut = true;
      operation.activeRequest?.destroy();
      rejectDeadline(failure('timeout'));
    }, totalTimeoutMs);
    timer.unref?.();

    async function retrieve() {
      let url = parseImportUrl(input);
      for (let redirectCount = 0; ; redirectCount += 1) {
        if (operation.timedOut) throw failure('timeout');
        const answers = await resolveHostname(url.hostname, lookup);
        if (operation.timedOut) throw failure('timeout');
        if (answers.some(({ address }) => !isGlobalAddress(address))) {
          throw failure(redirectCount > 0 ? 'redirectBlocked' : 'blocked');
        }
        const chosen = answers[0];
        const { response, socketVerified } = await requestHop(url, chosen, request, operation, {
          redirect: redirectCount > 0,
          connectionTimeoutMs,
        });
        if (!socketVerified) {
          response.destroy();
          throw failure(redirectCount > 0 ? 'redirectBlocked' : 'blocked');
        }

        if (REDIRECT_STATUSES.has(response.statusCode)) {
          response.destroy();
          operation.activeRequest = null;
          if (redirectCount >= MAX_REDIRECTS) throw failure('redirects');
          const location = response.headers.location;
          if (!location) throw failure('remote');
          let target;
          try {
            target = new URL(location, url);
          } catch {
            throw failure('redirectBlocked');
          }
          url = parseImportUrl(target, { redirect: true });
          continue;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          response.destroy();
          operation.activeRequest = null;
          throw failure('remote');
        }

        try {
          contentPolicy(response.headers);
        } catch (error) {
          response.destroy();
          operation.activeRequest = null;
          throw error;
        }
        const body = await collectBody(response);
        operation.activeRequest = null;
        let html;
        try {
          html = new TextDecoder('utf-8', { fatal: true }).decode(body);
        } catch {
          throw failure('text');
        }
        return { sourceUrl: url.href, html };
      }
    }

    try {
      return await Promise.race([retrieve(), deadline]);
    } finally {
      clearTimeout(timer);
      operation.activeRequest?.destroy();
    }
  };
}

const fetchRecipeUrl = createRecipeUrlFetcher();

module.exports = {
  CONNECTION_TIMEOUT_MS,
  MAX_HEADER_SIZE,
  MAX_REDIRECTS,
  MAX_RESPONSE_BYTES,
  TOTAL_TIMEOUT_MS,
  createPinnedLookup,
  createRecipeUrlFetcher,
  fetchRecipeUrl,
  isGlobalAddress,
  parseImportUrl,
  requestHop,
  sameAddress,
};
