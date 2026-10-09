import { ApiError, api } from './client';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}

function invalid() {
  return new ApiError('The push installation response was malformed.', {
    kind: 'api', code: 'INVALID_RESPONSE', status: 502,
  });
}

function parseInstallation(data, expectedId, expectedGeneration) {
  const row = data?.installation;
  if (!exact(data, ['installation'])
    || !exact(row, ['installationId', 'provider', 'platform', 'bindingGeneration', 'status', 'createdAt', 'updatedAt'])
    || row.installationId !== expectedId || !UUID.test(row.installationId)
    || row.provider !== 'expo' || !['ios', 'android'].includes(row.platform)
    || row.bindingGeneration !== expectedGeneration || row.status !== 'active'
    || Number.isNaN(Date.parse(row.createdAt)) || Number.isNaN(Date.parse(row.updatedAt))) throw invalid();
  return row;
}

function parseUnregistered(data, expectedGeneration) {
  if (!exact(data, ['unregistered', 'bindingGeneration'])
    || data.unregistered !== true || data.bindingGeneration !== expectedGeneration) throw invalid();
  return data;
}

export function registerPushInstallation(record, { platform, expoPushToken }) {
  return api.request(`/notifications/push-installations/${encodeURIComponent(record.installationId)}`, {
    method: 'PUT',
    body: {
      platform, expoPushToken,
      bindingCredential: record.bindingCredential,
      bindingGeneration: record.bindingGeneration,
    },
  }).then((data) => parseInstallation(data, record.installationId, record.bindingGeneration));
}

export function unregisterPushInstallation(record) {
  return api.del(`/notifications/push-installations/${encodeURIComponent(record.installationId)}`, {
    body: {
      bindingCredential: record.bindingCredential,
      bindingGeneration: record.bindingGeneration,
    },
  }).then((data) => parseUnregistered(data, record.bindingGeneration));
}

export const pushInstallationValidation = { exact, parseInstallation, parseUnregistered };
