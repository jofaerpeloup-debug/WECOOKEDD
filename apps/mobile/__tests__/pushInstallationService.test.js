jest.mock('../src/api/client', () => ({
  ApiError: class ApiError extends Error { constructor(message, options) { super(message); Object.assign(this, options); } },
  api: { request: jest.fn(), del: jest.fn() },
}));

const { api } = require('../src/api/client');
const service = require('../src/api/pushInstallationService');

const record = {
  version: 1,
  installationId: '123e4567-e89b-42d3-a456-426614174000',
  bindingCredential: 'A'.repeat(43),
  bindingGeneration: 7,
};
const ISO = '2026-10-05T01:02:03.000Z';

beforeEach(() => jest.clearAllMocks());

it('sends only platform, token, credential, and generation to the authenticated endpoints', async () => {
  api.request.mockResolvedValue({ installation: {
    installationId: record.installationId, provider: 'expo', platform: 'ios',
    bindingGeneration: 7, status: 'active', createdAt: ISO, updatedAt: ISO,
  } });
  api.del.mockResolvedValue({ unregistered: true, bindingGeneration: 8 });
  await service.registerPushInstallation(record, { platform: 'ios', expoPushToken: 'ExpoPushToken[abc_123]' });
  await service.unregisterPushInstallation({ ...record, bindingGeneration: 8 });
  expect(api.request).toHaveBeenCalledWith(`/notifications/push-installations/${record.installationId}`, {
    method: 'PUT', body: {
      platform: 'ios', expoPushToken: 'ExpoPushToken[abc_123]',
      bindingCredential: record.bindingCredential, bindingGeneration: 7,
    },
  });
  expect(JSON.stringify(api.request.mock.calls)).not.toMatch(/recipientId|sessionId|provider|role/);
  expect(api.del).toHaveBeenCalledWith(`/notifications/push-installations/${record.installationId}`, {
    body: { bindingCredential: record.bindingCredential, bindingGeneration: 8 },
  });
});

it('rejects malformed success rather than claiming registration', async () => {
  api.request.mockResolvedValue({ installation: {
    installationId: record.installationId, provider: 'expo', platform: 'ios', bindingGeneration: 7,
    status: 'active', createdAt: ISO, updatedAt: ISO, expoPushToken: 'ExpoPushToken[secret]',
  } });
  await expect(service.registerPushInstallation(record, { platform: 'ios', expoPushToken: 'ExpoPushToken[abc]' }))
    .rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});
