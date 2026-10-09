process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_notif2_test';
process.env.JWT_ACCESS_SECRET = 'push-repository-secret-at-least-32-characters';

const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../src/modules/push-installations/push-installation.model');
const repository = require('../src/modules/push-installations/push-installation.repository');

test('authorized update predicates include credential and observed generation atomically', (t) => {
  let captured;
  t.mock.method(Model, 'findOneAndUpdate', (filter, update, options) => { captured = { filter, update, options }; return {}; });
  repository.updateAuthorized({
    installationId: 'id', credentialHash: 'hash', expectedGeneration: 4,
    values: { bindingGeneration: 5, recipientId: 'new-owner' },
  });
  assert.deepEqual(captured.filter, { installationId: 'id', bindingCredentialHash: 'hash', bindingGeneration: 4 });
  assert.equal(captured.update.$set.bindingGeneration, 5);
  assert.equal(captured.options.returnDocument, 'after');
});

test('DELETE additionally predicates current server-derived owner, session, active state, credential, and generation', (t) => {
  let captured;
  t.mock.method(Model, 'findOneAndUpdate', (filter, update) => { captured = { filter, update }; return {}; });
  repository.unregisterAuthorized({
    installationId: 'id', recipientId: 'owner', sessionId: 'session', credentialHash: 'hash',
    expectedGeneration: 7, generation: 8, now: new Date(0),
  });
  assert.deepEqual(captured.filter, {
    installationId: 'id', recipientId: 'owner', sessionId: 'session', bindingCredentialHash: 'hash',
    bindingGeneration: 7, status: 'active',
  });
  assert.equal(captured.update.$set.expoPushToken, null);
});

test('provider invalidation predicates the exact still-active token so an old receipt cannot clear a rotated token', (t) => {
  let captured;
  t.mock.method(Model, 'updateMany', (filter, update) => { captured = { filter, update }; return {}; });
  repository.unregisterExactToken('ExpoPushToken[old]', new Date(0));
  assert.deepEqual(captured.filter, {
    provider: 'expo', status: 'active', expoPushToken: 'ExpoPushToken[old]',
  });
  assert.equal(captured.update.$set.expoPushToken, null);
  assert.equal(captured.update.$set.status, 'unregistered');
});
