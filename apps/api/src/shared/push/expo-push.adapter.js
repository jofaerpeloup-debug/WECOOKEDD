const pushInstallationService = require('../../modules/push-installations/push-installation.service');
const { loadEnv } = require('../../config/env');

const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const SEND_BATCH_SIZE = 100;
const RECEIPT_BATCH_SIZE = 300;
const MAX_TARGETS = 500;

function providerError(code, message = 'Expo Push Service response was unavailable.') {
  return Object.assign(new Error(message), { code });
}

function assertJsonResponse(response) {
  if (!response?.ok) throw providerError('EXPO_PUSH_HTTP_ERROR');
  const contentType = response.headers?.get?.('content-type') || '';
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw providerError('EXPO_PUSH_MALFORMED_RESPONSE');
  }
}

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}

function boundedString(value, min, max) {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

function validToken(value) {
  return boundedString(value, 1, 255)
    && /^(?:Expo|Exponent)PushToken\[[A-Za-z0-9_-]{1,200}\]$/.test(value);
}

function validProviderError(value) {
  return exactKeys(value, ['error']) && boundedString(value.error, 1, 100);
}

function parseTicket(ticket) {
  if (!ticket || typeof ticket !== 'object' || Array.isArray(ticket)) throw providerError('EXPO_PUSH_MALFORMED_RESPONSE');
  if (ticket.status === 'ok' && exactKeys(ticket, ['status', 'id'])
      && typeof ticket.id === 'string' && ticket.id.length > 0 && ticket.id.length <= 255) {
    return { status: 'accepted', receiptId: ticket.id };
  }
  if (ticket.status === 'error' && exactKeys(ticket, ['status', 'message', 'details'])
      && boundedString(ticket.message, 1, 500) && validProviderError(ticket.details)
      && ticket.details.error === 'DeviceNotRegistered') {
    return { status: 'deviceNotRegistered' };
  }
  if (ticket.status === 'error' && exactKeys(ticket, ['status', 'message', 'details'])
      && boundedString(ticket.message, 1, 500) && validProviderError(ticket.details)) {
    return { status: 'rejected', code: ticket.details.error };
  }
  throw providerError('EXPO_PUSH_MALFORMED_RESPONSE');
}

async function requestJson(url, body, { fetchImpl, accessToken }) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw providerError('EXPO_PUSH_REQUEST_FAILED');
  }
  assertJsonResponse(response);
  try {
    return await response.json();
  } catch {
    throw providerError('EXPO_PUSH_MALFORMED_RESPONSE');
  }
}

async function sendNotification(notification, targets, options = {}) {
  const accessToken = options.accessToken ?? loadEnv().expoPushAccessToken;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!accessToken) throw providerError('EXPO_PUSH_UNAVAILABLE');
  if (!Array.isArray(targets) || targets.length > MAX_TARGETS || typeof fetchImpl !== 'function') {
    throw providerError('EXPO_PUSH_INPUT_INVALID');
  }
  const notificationId = String(notification?._id || '');
  const title = notification?.content?.title;
  const body = notification?.content?.body;
  if (!/^[0-9a-f]{24}$/.test(notificationId)
      || !boundedString(title, 1, 120) || title.trim() !== title
      || !boundedString(body, 1, 500) || body.trim() !== body) {
    throw providerError('EXPO_PUSH_INPUT_INVALID');
  }
  if (targets.some((target) => !exactKeys(target, ['token', 'platform'])
      || !validToken(target.token) || !['ios', 'android'].includes(target.platform))) {
    throw providerError('EXPO_PUSH_INPUT_INVALID');
  }
  const tokens = [...new Set(targets.map((target) => target.token))];

  const results = [];
  for (let offset = 0; offset < tokens.length; offset += SEND_BATCH_SIZE) {
    const batch = tokens.slice(offset, offset + SEND_BATCH_SIZE);
    const messages = batch.map((to) => ({
      to, title, body, data: { version: 1, kind: 'notification', notificationId },
    }));
    const payload = await requestJson(SEND_URL, messages, { fetchImpl, accessToken });
    if (!exactKeys(payload, ['data']) || !Array.isArray(payload.data) || payload.data.length !== batch.length) {
      throw providerError('EXPO_PUSH_MALFORMED_RESPONSE');
    }
    const parsed = payload.data.map(parseTicket);
    for (let index = 0; index < parsed.length; index += 1) {
      const result = parsed[index];
      const token = batch[index];
      if (result.status === 'deviceNotRegistered') await pushInstallationService.unregisterExactToken(token);
      results.push(result.receiptId
        ? { token, status: result.status, receipt: { id: result.receiptId, token } }
        : { token, ...result });
    }
  }
  return results;
}

function parseReceipt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw providerError('EXPO_PUSH_MALFORMED_RESPONSE');
  if (value.status === 'ok' && exactKeys(value, ['status'])) {
    return { status: 'delivered' };
  }
  if (value.status === 'error' && exactKeys(value, ['status', 'message', 'details'])
      && boundedString(value.message, 1, 500) && validProviderError(value.details)
      && value.details.error === 'DeviceNotRegistered') {
    return { status: 'deviceNotRegistered' };
  }
  if (value.status === 'error' && exactKeys(value, ['status', 'message', 'details'])
      && boundedString(value.message, 1, 500) && validProviderError(value.details)) {
    return { status: 'rejected', code: value.details.error };
  }
  throw providerError('EXPO_PUSH_MALFORMED_RESPONSE');
}

async function getReceipts(probes, options = {}) {
  const accessToken = options.accessToken ?? loadEnv().expoPushAccessToken;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!accessToken) throw providerError('EXPO_PUSH_UNAVAILABLE');
  if (!Array.isArray(probes) || probes.length > RECEIPT_BATCH_SIZE
      || probes.some((probe) => !exactKeys(probe, ['id', 'token'])
        || !boundedString(probe.id, 1, 255) || !validToken(probe.token))
      || new Set(probes.map(({ id }) => id)).size !== probes.length) {
    throw providerError('EXPO_PUSH_INPUT_INVALID');
  }
  const payload = await requestJson(RECEIPTS_URL, { ids: probes.map(({ id }) => id) }, { fetchImpl, accessToken });
  if (!exactKeys(payload, ['data']) || !payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
    throw providerError('EXPO_PUSH_MALFORMED_RESPONSE');
  }
  const requested = new Set(probes.map(({ id }) => id));
  if (Object.keys(payload.data).some((id) => !requested.has(id))) throw providerError('EXPO_PUSH_MALFORMED_RESPONSE');
  const results = [];
  const cleanupTokens = [];
  for (const probe of probes) {
    if (!Object.hasOwn(payload.data, probe.id)) throw providerError('EXPO_PUSH_MALFORMED_RESPONSE');
    const result = parseReceipt(payload.data[probe.id]);
    if (result.status === 'deviceNotRegistered') cleanupTokens.push(probe.token);
    results.push({ id: probe.id, token: probe.token, ...result });
  }
  for (const token of cleanupTokens) await pushInstallationService.unregisterExactToken(token);
  return results;
}

module.exports = { SEND_URL, RECEIPTS_URL, SEND_BATCH_SIZE, RECEIPT_BATCH_SIZE, MAX_TARGETS, sendNotification, getReceipts };
