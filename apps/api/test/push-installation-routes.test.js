process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_notif2_test';
process.env.JWT_ACCESS_SECRET = 'push-route-secret-at-least-32-characters';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { signAccessToken } = require('../src/shared/security/access-token');
const sessionRepository = require('../src/modules/sessions/session.repository');
const userRepository = require('../src/modules/users/user.repository');
const repository = require('../src/modules/push-installations/push-installation.repository');

const OWNER = '507f1f77bcf86cd799439001';
const SESSION = '507f1f77bcf86cd799439002';
const ID = '123e4567-e89b-42d3-a456-426614174000';
const CREDENTIAL = 'A'.repeat(43);
const app = createApp();

function auth(t) {
  t.mock.method(sessionRepository, 'findActiveById', async () => ({ _id: SESSION, userId: OWNER }));
  t.mock.method(userRepository, 'findById', async () => ({ _id: OWNER, role: 'user', status: 'active' }));
  return `Bearer ${signAccessToken({ userId: OWNER, sessionId: SESSION, role: 'user' })}`;
}

test('authentication precedes strict body validation and errors remain no-store', async () => {
  const response = await request(app).put(`/api/v1/notifications/push-installations/${ID}`).send({ ownerId: OWNER });
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_TOKEN_MISSING');
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('PUT derives owner/session/provider and returns no private binding material', async (t) => {
  const authorization = auth(t);
  let created;
  t.mock.method(repository, 'findByInstallationIdWithSecrets', async () => null);
  t.mock.method(repository, 'createInstallation', async (value) => {
    created = value;
    return { ...value, createdAt: new Date(), updatedAt: new Date() };
  });
  const response = await request(app).put(`/api/v1/notifications/push-installations/${ID}`)
    .set('Authorization', authorization)
    .send({ platform: 'ios', expoPushToken: 'ExpoPushToken[abc]', bindingCredential: CREDENTIAL, bindingGeneration: 1 });
  assert.equal(response.status, 200);
  assert.equal(String(created.recipientId), OWNER);
  assert.equal(String(created.sessionId), SESSION);
  assert.equal(created.provider, 'expo');
  const raw = JSON.stringify(response.body);
  assert.equal(raw.includes('expoPushToken'), false);
  assert.equal(raw.includes('bindingCredential'), false);
  assert.equal(raw.includes('recipientId'), false);
  assert.equal(raw.includes('sessionId'), false);
});

test('strict validation rejects client authority and there is no public send endpoint', async (t) => {
  const authorization = auth(t);
  const invalid = await request(app).put(`/api/v1/notifications/push-installations/${ID}`)
    .set('Authorization', authorization)
    .send({ platform: 'ios', expoPushToken: 'ExpoPushToken[abc]', bindingCredential: CREDENTIAL, bindingGeneration: 1, sessionId: SESSION });
  assert.equal(invalid.status, 400);
  const send = await request(app).post('/api/v1/notifications/send').set('Authorization', authorization).send({});
  assert.equal(send.status, 404);
});

test('DELETE unregisters only the authenticated owner/session binding and returns no private material', async (t) => {
  const authorization = auth(t);
  const hash = require('../src/modules/push-installations/push-installation.service').hashCredential(CREDENTIAL);
  t.mock.method(repository, 'findByInstallationIdWithSecrets', async () => ({
    installationId: ID, recipientId: OWNER, sessionId: SESSION, bindingCredentialHash: hash,
    bindingGeneration: 1, status: 'active', expoPushToken: 'ExpoPushToken[abc]',
  }));
  t.mock.method(repository, 'unregisterAuthorized', async (input) => ({ bindingGeneration: input.generation }));
  const response = await request(app).delete(`/api/v1/notifications/push-installations/${ID}`)
    .set('Authorization', authorization)
    .send({ bindingCredential: CREDENTIAL, bindingGeneration: 2 });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, { unregistered: true, bindingGeneration: 2 });
  assert.equal(JSON.stringify(response.body).includes(CREDENTIAL), false);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('DELETE uses one opaque not-found result for absent, foreign-session, and wrong-credential bindings', async (t) => {
  const authorization = auth(t);
  const service = require('../src/modules/push-installations/push-installation.service');
  const cases = [
    null,
    { installationId: ID, recipientId: OWNER, sessionId: '507f1f77bcf86cd799439099', bindingCredentialHash: service.hashCredential(CREDENTIAL), bindingGeneration: 1, status: 'active' },
    { installationId: ID, recipientId: OWNER, sessionId: SESSION, bindingCredentialHash: service.hashCredential('B'.repeat(43)), bindingGeneration: 1, status: 'active' },
  ];
  t.mock.method(repository, 'findByInstallationIdWithSecrets', async () => cases.shift());
  for (let index = 0; index < 3; index += 1) {
    const response = await request(app).delete(`/api/v1/notifications/push-installations/${ID}`)
      .set('Authorization', authorization)
      .send({ bindingCredential: CREDENTIAL, bindingGeneration: 2 });
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'PUSH_INSTALLATION_NOT_FOUND');
    assert.deepEqual(Object.keys(response.body.error).sort(), ['code', 'message']);
  }
});
