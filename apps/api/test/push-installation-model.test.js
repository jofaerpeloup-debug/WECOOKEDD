process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_notif2_test';
process.env.JWT_ACCESS_SECRET = 'push-model-secret-at-least-32-characters';

const test = require('node:test');
const assert = require('node:assert/strict');
const PushInstallation = require('../src/modules/push-installations/push-installation.model');

const ID = '123e4567-e89b-42d3-a456-426614174000';
const OID = '507f1f77bcf86cd799439001';

test('PushInstallation is strict, migration-index-owned, private, and state validated', async () => {
  assert.equal(PushInstallation.schema.options.strict, 'throw');
  assert.equal(PushInstallation.schema.options.autoIndex, false);
  assert.equal(PushInstallation.schema.path('bindingCredentialHash').options.select, false);
  assert.equal(PushInstallation.schema.path('expoPushToken').options.select, false);
  assert.deepEqual(PushInstallation.schema.indexes(), []);
  const active = new PushInstallation({
    installationId: ID, bindingCredentialHash: 'a'.repeat(64), recipientId: OID, sessionId: OID,
    provider: 'expo', platform: 'ios', expoPushToken: 'ExpoPushToken[abc]', bindingGeneration: 1,
    status: 'active', unregisteredAt: null,
  });
  await active.validate();
  assert.throws(() => new PushInstallation({ ...active.toObject(), arbitrary: true }), /strict mode/);
  const invalid = new PushInstallation({
    installationId: ID, bindingCredentialHash: 'a'.repeat(64), recipientId: OID, sessionId: OID,
    provider: 'expo', platform: 'ios', expoPushToken: null, bindingGeneration: 1, status: 'active',
  });
  await assert.rejects(() => invalid.validate(), /Active installations require a token/);
});
