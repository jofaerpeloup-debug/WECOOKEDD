process.env.NODE_ENV = 'test';
process.env.PORT = '4051';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createApp } = require('../src/app');
const userRepository = require('../src/modules/users/user.repository');
const sessionRepository = require('../src/modules/sessions/session.repository');
const recipeRepository = require('../src/modules/recipes/recipe.repository');
const ingredientRepository = require('../src/modules/ingredients/ingredient.repository');
const substitutionRepository = require('../src/modules/substitutions/substitution.repository');
const { signAccessToken } = require('../src/shared/security/access-token');

const app = createApp();

const IDENTITIES = Object.freeze({
  user: Object.freeze({
    id: '507f1f77bcf86cd799439101',
    sessionId: '507f1f77bcf86cd799439102',
    role: 'user',
  }),
  moderator: Object.freeze({
    id: '507f1f77bcf86cd799439103',
    sessionId: '507f1f77bcf86cd799439104',
    role: 'moderator',
  }),
  admin: Object.freeze({
    id: '507f1f77bcf86cd799439105',
    sessionId: '507f1f77bcf86cd799439106',
    role: 'admin',
  }),
});

const RESOURCE_ID = '507f1f77bcf86cd799439199';

function tokenFor(identity, tokenRole = identity.role) {
  return signAccessToken({
    userId: identity.id,
    role: tokenRole,
    sessionId: identity.sessionId,
  });
}

function authHeader(identity, tokenRole) {
  return `Bearer ${tokenFor(identity, tokenRole)}`;
}

function mockIdentityDirectory(t, identities = Object.values(IDENTITIES)) {
  const bySession = new Map(identities.map((identity) => [identity.sessionId, identity]));
  const byUser = new Map(identities.map((identity) => [identity.id, identity]));

  t.mock.method(sessionRepository, 'findActiveById', async (sessionId) => {
    const identity = bySession.get(String(sessionId));
    return identity
      ? { _id: identity.sessionId, userId: identity.id, revokedAt: null }
      : null;
  });
  t.mock.method(userRepository, 'findById', async (userId) => {
    const identity = byUser.get(String(userId));
    return identity
      ? { _id: identity.id, role: identity.role, status: 'active' }
      : null;
  });
}

test('staff/all catalog reads allow Moderator and Admin while denying User', async (t) => {
  mockIdentityDirectory(t);
  t.mock.method(recipeRepository, 'findMany', async () => []);
  t.mock.method(recipeRepository, 'countByFilter', async () => 0);
  t.mock.method(ingredientRepository, 'findMany', async () => []);
  t.mock.method(ingredientRepository, 'countByFilter', async () => 0);
  t.mock.method(substitutionRepository, 'findMany', async () => []);
  t.mock.method(substitutionRepository, 'countByFilter', async () => 0);

  for (const path of ['/api/v1/recipes', '/api/v1/ingredients', '/api/v1/substitutions']) {
    for (const role of ['moderator', 'admin']) {
      const response = await request(app)
        .get(`${path}?status=all`)
        .set('Authorization', authHeader(IDENTITIES[role]));
      assert.equal(response.status, 200, `${role} should read ${path}?status=all`);
    }

    const userResponse = await request(app)
      .get(`${path}?status=all`)
      .set('Authorization', authHeader(IDENTITIES.user));
    assert.equal(userResponse.status, 403, `user should not read ${path}?status=all`);
    assert.equal(userResponse.body.error.code, 'FORBIDDEN');
  }
});

test('Admin direct catalog mutations are denied across every existing write route', async (t) => {
  mockIdentityDirectory(t, [IDENTITIES.admin]);
  const authorization = authHeader(IDENTITIES.admin);
  const requests = [
    request(app).post('/api/v1/recipes').set('Authorization', authorization).send({}),
    request(app).post('/api/v1/recipes/drafts').set('Authorization', authorization).send({ title: 'Draft' }),
    request(app).post(`/api/v1/recipes/${RESOURCE_ID}/publish`).set('Authorization', authorization).send({ confirmFilipinoCuisine: true }),
    request(app).post(`/api/v1/recipes/${RESOURCE_ID}/archive`).set('Authorization', authorization).send({}),
    request(app).post(`/api/v1/recipes/${RESOURCE_ID}/restore`).set('Authorization', authorization).send({}),
    request(app).patch(`/api/v1/recipes/${RESOURCE_ID}`).set('Authorization', authorization).send({}),
    request(app).delete(`/api/v1/recipes/${RESOURCE_ID}`).set('Authorization', authorization),
    request(app).post('/api/v1/ingredients').set('Authorization', authorization).send({}),
    request(app).patch(`/api/v1/ingredients/${RESOURCE_ID}`).set('Authorization', authorization).send({}),
    request(app).delete(`/api/v1/ingredients/${RESOURCE_ID}`).set('Authorization', authorization),
    request(app).post('/api/v1/substitutions').set('Authorization', authorization).send({}),
    request(app).patch(`/api/v1/substitutions/${RESOURCE_ID}`).set('Authorization', authorization).send({}),
    request(app).delete(`/api/v1/substitutions/${RESOURCE_ID}`).set('Authorization', authorization),
  ];

  for (const pendingRequest of requests) {
    const response = await pendingRequest;
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'FORBIDDEN');
  }
});

test('Admin direct recipe-image upload is denied before multipart parsing', async (t) => {
  mockIdentityDirectory(t, [IDENTITIES.admin]);
  const response = await request(app)
    .post('/api/v1/admin/uploads/recipe-image')
    .set('Authorization', authHeader(IDENTITIES.admin));

  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'FORBIDDEN');
});

test('catalog read/write authority follows every meaningful current-DB/stale-JWT combination', async (t) => {
  const currentModerator = { ...IDENTITIES.moderator };
  const demotedUser = {
    id: '507f1f77bcf86cd799439107',
    sessionId: '507f1f77bcf86cd799439108',
    role: 'user',
  };
  const currentAdmin = { ...IDENTITIES.admin };
  mockIdentityDirectory(t, [currentModerator, demotedUser, currentAdmin]);
  t.mock.method(ingredientRepository, 'findMany', async () => []);
  t.mock.method(ingredientRepository, 'countByFilter', async () => 0);

  const cases = [
    { identity: currentModerator, staleRole: 'admin', read: 200, write: 400 },
    { identity: demotedUser, staleRole: 'moderator', read: 403, write: 403 },
    { identity: currentAdmin, staleRole: 'moderator', read: 200, write: 403 },
    { identity: currentModerator, staleRole: 'user', read: 200, write: 400 },
    { identity: demotedUser, staleRole: 'admin', read: 403, write: 403 },
  ];

  for (const item of cases) {
    const readResponse = await request(app)
      .get('/api/v1/ingredients?status=all')
      .set('Authorization', authHeader(item.identity, item.staleRole));
    assert.equal(readResponse.status, item.read);

    const writeResponse = await request(app)
      .post('/api/v1/ingredients')
      .set('Authorization', authHeader(item.identity, item.staleRole))
      .send({});
    assert.equal(writeResponse.status, item.write);
    assert.equal(
      writeResponse.body.error.code,
      item.write === 400 ? 'VALIDATION_ERROR' : 'FORBIDDEN'
    );
  }

  const moderatorUpload = await request(app)
    .post('/api/v1/admin/uploads/recipe-image')
    .set('Authorization', authHeader(currentModerator, 'admin'));
  assert.equal(moderatorUpload.status, 400);
  assert.equal(moderatorUpload.body.error.code, 'IMAGE_FILE_REQUIRED');

  const adminUpload = await request(app)
    .post('/api/v1/admin/uploads/recipe-image')
    .set('Authorization', authHeader(currentAdmin, 'moderator'));
  assert.equal(adminUpload.status, 403);
  assert.equal(adminUpload.body.error.code, 'FORBIDDEN');

  const consumerRead = await request(app)
    .get('/api/v1/ingredients')
    .set('Authorization', authHeader(demotedUser, 'moderator'));
  assert.equal(consumerRead.status, 200);
});
