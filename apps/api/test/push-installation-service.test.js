process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_notif2_test';
process.env.JWT_ACCESS_SECRET = 'push-service-secret-at-least-32-characters';

const test = require('node:test');
const assert = require('node:assert/strict');
const repository = require('../src/modules/push-installations/push-installation.repository');
const sessionService = require('../src/modules/sessions/session.service');
const userRepository = require('../src/modules/users/user.repository');
const service = require('../src/modules/push-installations/push-installation.service');

const ID = '123e4567-e89b-42d3-a456-426614174000';
const OWNER = '507f1f77bcf86cd799439001';
const SESSION = '507f1f77bcf86cd799439002';
const OTHER_OWNER = '507f1f77bcf86cd799439009';
const OTHER_SESSION = '507f1f77bcf86cd799439008';
const credential = 'A'.repeat(43);

function row(overrides = {}) {
  return {
    installationId: ID, bindingCredentialHash: service.hashCredential(credential), recipientId: OWNER,
    sessionId: SESSION, provider: 'expo', platform: 'ios', expoPushToken: 'ExpoPushToken[one]',
    bindingGeneration: 2, status: 'active', unregisteredAt: null,
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  };
}

test('first bind persists only server-derived binding fields and maps an active public installation', async (t) => {
  let created;
  t.mock.method(repository, 'findByInstallationIdWithSecrets', async () => null);
  t.mock.method(repository, 'createInstallation', async (values) => {
    created = values;
    return row({ ...values, bindingGeneration: 1 });
  });
  const result = await service.register({
    installationId: ID, recipientId: OWNER, sessionId: SESSION, platform: 'ios',
    expoPushToken: 'ExpoPushToken[first]', bindingCredential: credential, bindingGeneration: 1,
  });
  assert.equal(created.recipientId, OWNER);
  assert.equal(created.sessionId, SESSION);
  assert.equal(created.provider, 'expo');
  assert.equal(created.bindingCredentialHash, service.hashCredential(credential));
  assert.equal(result.bindingGeneration, 1);
  assert.equal('expoPushToken' in result, false);
  assert.equal('bindingCredentialHash' in result, false);
});

test('active-token collisions fail closed on both first bind and higher-generation rotation', async (t) => {
  t.mock.method(repository, 'findByInstallationIdWithSecrets', async () => null);
  t.mock.method(repository, 'createInstallation', async () => {
    throw Object.assign(new Error('duplicate token'), { code: 11000, keyPattern: { provider: 1, expoPushToken: 1 } });
  });
  await assert.rejects(() => service.register({
    installationId: ID, recipientId: OWNER, sessionId: SESSION, platform: 'ios',
    expoPushToken: 'ExpoPushToken[collision]', bindingCredential: credential, bindingGeneration: 1,
  }), { code: 'PUSH_INSTALLATION_TOKEN_CONFLICT' });

  t.mock.restoreAll();
  t.mock.method(repository, 'findByInstallationIdWithSecrets', async () => row());
  t.mock.method(repository, 'updateAuthorized', async () => {
    throw Object.assign(new Error('duplicate token'), { code: 11000, keyPattern: { provider: 1, expoPushToken: 1 } });
  });
  await assert.rejects(() => service.register({
    installationId: ID, recipientId: OWNER, sessionId: SESSION, platform: 'ios',
    expoPushToken: 'ExpoPushToken[collision]', bindingCredential: credential, bindingGeneration: 3,
  }), { code: 'PUSH_INSTALLATION_TOKEN_CONFLICT' });
});

test('same-generation exact retry is idempotent while contradiction, stale, and wrong credential fail closed', async (t) => {
  t.mock.method(repository, 'findByInstallationIdWithSecrets', async () => row());
  const base = { installationId: ID, recipientId: OWNER, sessionId: SESSION, platform: 'ios', expoPushToken: 'ExpoPushToken[one]', bindingCredential: credential };
  assert.equal((await service.register({ ...base, bindingGeneration: 2 })).bindingGeneration, 2);
  await assert.rejects(() => service.register({ ...base, bindingGeneration: 1 }), { code: 'PUSH_INSTALLATION_STALE' });
  await assert.rejects(() => service.register({ ...base, bindingGeneration: 2, platform: 'android' }), { code: 'PUSH_INSTALLATION_GENERATION_CONFLICT' });
  await assert.rejects(() => service.register({ ...base, bindingGeneration: 3, bindingCredential: 'B'.repeat(43) }), { code: 'PUSH_INSTALLATION_NOT_FOUND' });
});

test('a concurrent first-bind winner is reread and an exact same-generation retry stays idempotent', async (t) => {
  let reads = 0;
  t.mock.method(repository, 'findByInstallationIdWithSecrets', async () => {
    reads += 1;
    return reads === 1 ? null : row({ bindingGeneration: 1 });
  });
  t.mock.method(repository, 'createInstallation', async () => {
    throw Object.assign(new Error('duplicate'), { code: 11000, keyPattern: { installationId: 1 } });
  });
  const result = await service.register({
    installationId: ID, recipientId: OWNER, sessionId: SESSION, platform: 'ios',
    expoPushToken: 'ExpoPushToken[one]', bindingCredential: credential, bindingGeneration: 1,
  });
  assert.equal(result.bindingGeneration, 1);
  assert.equal(reads, 2);
});

test('higher generation atomically rebinds to the current server user/session and a lost race is a conflict', async (t) => {
  t.mock.method(repository, 'findByInstallationIdWithSecrets', async () => row());
  let update;
  t.mock.method(repository, 'updateAuthorized', async (input) => { update = input; return row({ ...input.values }); });
  await service.register({
    installationId: ID, recipientId: '507f1f77bcf86cd799439009', sessionId: '507f1f77bcf86cd799439008',
    platform: 'android', expoPushToken: 'ExpoPushToken[two]', bindingCredential: credential, bindingGeneration: 3,
  });
  assert.equal(update.expectedGeneration, 2);
  assert.equal(update.values.recipientId, '507f1f77bcf86cd799439009');
  assert.equal(update.values.sessionId, '507f1f77bcf86cd799439008');
});

test('a lost higher-generation PUT race fails without retrying or weakening the observed-generation predicate', async (t) => {
  let attempts = 0;
  t.mock.method(repository, 'findByInstallationIdWithSecrets', async () => row());
  t.mock.method(repository, 'updateAuthorized', async (input) => {
    attempts += 1;
    assert.equal(input.expectedGeneration, 2);
    return null;
  });
  await assert.rejects(() => service.register({
    installationId: ID, recipientId: OTHER_OWNER, sessionId: OTHER_SESSION,
    platform: 'android', expoPushToken: 'ExpoPushToken[newowner]',
    bindingCredential: credential, bindingGeneration: 99,
  }), { code: 'PUSH_INSTALLATION_GENERATION_CONFLICT' });
  assert.equal(attempts, 1);
});

test('DELETE requires exact current owner, session, credential, and a higher generation', async (t) => {
  let mutation;
  t.mock.method(repository, 'findByInstallationIdWithSecrets', async () => row());
  t.mock.method(repository, 'unregisterAuthorized', async (input) => {
    mutation = input;
    return row({ bindingGeneration: input.generation, status: 'unregistered', expoPushToken: null });
  });
  assert.deepEqual(await service.unregister({
    installationId: ID, recipientId: OWNER, sessionId: SESSION,
    bindingCredential: credential, bindingGeneration: 3,
  }), { unregistered: true, bindingGeneration: 3 });
  assert.equal(mutation.recipientId, OWNER);
  assert.equal(mutation.sessionId, SESSION);
  assert.equal(mutation.credentialHash, service.hashCredential(credential));
  assert.equal(mutation.expectedGeneration, 2);
  assert.equal(mutation.generation, 3);
});

test('DELETE is idempotent only for the same-generation tombstone and otherwise fails closed', async (t) => {
  let current = row({ status: 'unregistered', expoPushToken: null, unregisteredAt: new Date() });
  t.mock.method(repository, 'findByInstallationIdWithSecrets', async () => current);
  assert.deepEqual(await service.unregister({
    installationId: ID, recipientId: OWNER, sessionId: SESSION,
    bindingCredential: credential, bindingGeneration: 2,
  }), { unregistered: true, bindingGeneration: 2 });

  current = row();
  await assert.rejects(() => service.unregister({
    installationId: ID, recipientId: OWNER, sessionId: SESSION,
    bindingCredential: credential, bindingGeneration: 2,
  }), { code: 'PUSH_INSTALLATION_GENERATION_CONFLICT' });
  await assert.rejects(() => service.unregister({
    installationId: ID, recipientId: OWNER, sessionId: SESSION,
    bindingCredential: credential, bindingGeneration: 1,
  }), { code: 'PUSH_INSTALLATION_STALE' });

  for (const overrides of [
    { recipientId: OTHER_OWNER },
    { sessionId: OTHER_SESSION },
    { bindingCredential: 'B'.repeat(43) },
  ]) {
    await assert.rejects(() => service.unregister({
      installationId: ID, recipientId: OWNER, sessionId: SESSION,
      bindingCredential: credential, bindingGeneration: 3, ...overrides,
    }), { code: 'PUSH_INSTALLATION_NOT_FOUND' });
  }
});

test('a lost DELETE race is one conflict and never retries against a newer binding', async (t) => {
  let attempts = 0;
  t.mock.method(repository, 'findByInstallationIdWithSecrets', async () => row());
  t.mock.method(repository, 'unregisterAuthorized', async () => { attempts += 1; return null; });
  await assert.rejects(() => service.unregister({
    installationId: ID, recipientId: OWNER, sessionId: SESSION,
    bindingCredential: credential, bindingGeneration: 50,
  }), { code: 'PUSH_INSTALLATION_GENERATION_CONFLICT' });
  assert.equal(attempts, 1);
});

test('delivery eligibility rechecks push preference and generation-bound live session ownership and deduplicates exact tokens', async (t) => {
  t.mock.method(userRepository, 'findById', async () => ({
    _id: OWNER,
    status: 'active',
    sessionGeneration: 5,
    preferences: { notifications: { push: true } },
  }));
  t.mock.method(repository, 'findActiveForRecipient', async () => [row(), row(), row({ sessionId: '507f1f77bcf86cd799439099', expoPushToken: 'ExpoPushToken[foreign]' })]);
  t.mock.method(sessionService, 'getActiveSessionsByIdsForUser', async (ids, owner, securityGeneration) => {
    assert.deepEqual(ids.sort(), [SESSION, '507f1f77bcf86cd799439099'].sort());
    assert.equal(owner, OWNER);
    assert.equal(securityGeneration, 5);
    return [{ _id: SESSION, userId: OWNER }];
  });
  assert.deepEqual(await service.selectDeliveryTargets({ recipientId: OWNER }), [{ token: 'ExpoPushToken[one]', platform: 'ios' }]);
});

test('delivery selection excludes preference-off/inactive users before installations and revoked or foreign sessions at the final gate', async (t) => {
  let installationReads = 0;
  let user = { _id: OWNER, status: 'active', preferences: { notifications: { push: false } } };
  t.mock.method(userRepository, 'findById', async () => user);
  t.mock.method(repository, 'findActiveForRecipient', async () => { installationReads += 1; return [row()]; });
  t.mock.method(sessionService, 'getActiveSessionsByIdsForUser', async () => []);
  assert.deepEqual(await service.selectDeliveryTargets({ recipientId: OWNER }), []);
  user = { ...user, status: 'suspended', preferences: { notifications: { push: true } } };
  assert.deepEqual(await service.selectDeliveryTargets({ recipientId: OWNER }), []);
  assert.equal(installationReads, 0);
  user = { ...user, status: 'active' };
  assert.deepEqual(await service.selectDeliveryTargets({ recipientId: OWNER }), []);
  assert.equal(installationReads, 1);
});

test('delivery selection excludes deactivated users before reading installations', async (t) => {
  let installationReads = 0;
  t.mock.method(userRepository, 'findById', async () => ({
    _id: OWNER,
    status: 'active',
    deactivatedAt: new Date(),
    sessionGeneration: 3,
    preferences: { notifications: { push: true } },
  }));
  t.mock.method(repository, 'findActiveForRecipient', async () => {
    installationReads += 1;
    return [row()];
  });
  assert.deepEqual(await service.selectDeliveryTargets({ recipientId: OWNER }), []);
  assert.equal(installationReads, 0);
});

test('delivery treats a legacy missing user generation as zero and fails closed on session mismatch', async (t) => {
  t.mock.method(userRepository, 'findById', async () => ({
    _id: OWNER,
    status: 'active',
    preferences: { notifications: { push: true } },
  }));
  t.mock.method(repository, 'findActiveForRecipient', async () => [row()]);
  t.mock.method(sessionService, 'getActiveSessionsByIdsForUser', async (_ids, _owner, generation) => {
    assert.equal(generation, 0);
    return [];
  });
  assert.deepEqual(await service.selectDeliveryTargets({ recipientId: OWNER }), []);
});
