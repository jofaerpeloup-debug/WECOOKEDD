process.env.NODE_ENV = 'test';
process.env.PORT = '4097';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createApp } = require('../src/app');
const { errorMiddleware } = require('../src/middleware/error.middleware');
const {
  RECIPE_IMPORT_RATE_LIMITS,
  createRecipeImportRateLimiters,
} = require('../src/middleware/rate-limiter');
const userRepository = require('../src/modules/users/user.repository');
const sessionRepository = require('../src/modules/sessions/session.repository');
const recipeUrlImportService = require('../src/modules/recipes/recipe-url-import.service');
const recipeRepository = require('../src/modules/recipes/recipe.repository');
const ingredientRepository = require('../src/modules/ingredients/ingredient.repository');
const substitutionRepository = require('../src/modules/substitutions/substitution.repository');
const imageProvider = require('../src/modules/uploads/cloudinary-image.provider');
const { signAccessToken } = require('../src/shared/security/access-token');

const app = createApp();
const identities = {
  moderator: { id: '507f1f77bcf86cd799439201', sessionId: '507f1f77bcf86cd799439202', role: 'moderator' },
  admin: { id: '507f1f77bcf86cd799439203', sessionId: '507f1f77bcf86cd799439204', role: 'admin' },
  user: { id: '507f1f77bcf86cd799439205', sessionId: '507f1f77bcf86cd799439206', role: 'user' },
};

function mockDirectory(t, selected = Object.values(identities)) {
  const sessions = new Map(selected.map((identity) => [identity.sessionId, identity]));
  const users = new Map(selected.map((identity) => [identity.id, identity]));
  t.mock.method(sessionRepository, 'findActiveById', async (id) => {
    const identity = sessions.get(String(id));
    return identity ? { _id: identity.sessionId, userId: identity.id, revokedAt: null } : null;
  });
  t.mock.method(userRepository, 'findById', async (id) => {
    const identity = users.get(String(id));
    return identity ? { _id: identity.id, role: identity.role, status: 'active' } : null;
  });
}

function authorization(identity) {
  return `Bearer ${signAccessToken({ userId: identity.id, sessionId: identity.sessionId, role: identity.role })}`;
}

test('import route requires current Moderator catalog.write before validation or transport', async (t) => {
  mockDirectory(t, [identities.admin, identities.user]);
  let imports = 0;
  t.mock.method(recipeUrlImportService, 'importRecipeUrl', async () => { imports += 1; });
  for (const identity of [identities.admin, identities.user]) {
    const response = await request(app)
      .post('/api/v1/recipes/import-url')
      .set('Authorization', authorization(identity))
      .send({ unexpected: true });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'FORBIDDEN');
  }
  const anonymous = await request(app).post('/api/v1/recipes/import-url').send({ url: 'https://example.com' });
  assert.equal(anonymous.status, 401);
  assert.equal(imports, 0);
});

test('Moderator receives the raw preview response and no repository mutation is invoked', async (t) => {
  mockDirectory(t, [identities.moderator]);
  const candidate = { '@type': 'Recipe', name: 'Adobo', unsupported: true };
  t.mock.method(recipeUrlImportService, 'importRecipeUrl', async (url) => {
    assert.equal(url, 'https://example.com/recipe');
    return { sourceUrl: 'https://www.example.com/recipe', candidate };
  });
  const mutationBoundaries = [
    [recipeRepository, 'createRecipe'],
    [recipeRepository, 'updateById'],
    [recipeRepository, 'publishById'],
    [recipeRepository, 'archiveById'],
    [recipeRepository, 'restoreById'],
    [ingredientRepository, 'createIngredient'],
    [ingredientRepository, 'updateById'],
    [ingredientRepository, 'updateByIdIfActiveState'],
    [substitutionRepository, 'createSubstitution'],
    [substitutionRepository, 'updateById'],
    [substitutionRepository, 'archiveById'],
    [imageProvider, 'uploadImage'],
    [imageProvider, 'deleteByAssetId'],
  ];
  const mutationMocks = mutationBoundaries.map(([boundary, method]) => (
    t.mock.method(boundary, method, async () => assert.fail(`${method} mutation boundary called`))
  ));
  const response = await request(app)
    .post('/api/v1/recipes/import-url')
    .set('Authorization', authorization(identities.moderator))
    .send({ url: '  https://example.com/recipe  ' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    success: true,
    data: { sourceUrl: 'https://www.example.com/recipe', candidate },
  });
  for (const mock of mutationMocks) assert.equal(mock.mock.callCount(), 0);
});

test('body validation is strict and bounded before the import service', async (t) => {
  mockDirectory(t, [identities.moderator]);
  let imports = 0;
  t.mock.method(recipeUrlImportService, 'importRecipeUrl', async () => { imports += 1; });
  for (const body of [{}, { url: 'https://example.com', extra: true }, { url: `https://${'a'.repeat(2048)}.com` }]) {
    const response = await request(app)
      .post('/api/v1/recipes/import-url')
      .set('Authorization', authorization(identities.moderator))
      .send(body);
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  }
  assert.equal(imports, 0);
});

function limiterApp({ useIp, useUser }) {
  const fresh = createRecipeImportRateLimiters();
  const limiterAppInstance = express();
  limiterAppInstance.use((req, res, next) => {
    req.auth = { userId: req.get('X-Test-User') || 'same-user' };
    next();
  });
  if (useIp) limiterAppInstance.use(fresh.ip);
  if (useUser) limiterAppInstance.use(fresh.user);
  limiterAppInstance.get('/attempt', (req, res) => res.json({ success: true }));
  limiterAppInstance.use(errorMiddleware);
  return limiterAppInstance;
}

test('dedicated import limiters enforce the frozen per-user and per-IP budgets', async () => {
  assert.deepEqual(RECIPE_IMPORT_RATE_LIMITS, {
    ip: { windowMs: 15 * 60 * 1000, limit: 20 },
    user: { windowMs: 15 * 60 * 1000, limit: 10 },
  });

  const byUser = limiterApp({ useIp: false, useUser: true });
  for (let index = 0; index < 10; index += 1) assert.equal((await request(byUser).get('/attempt')).status, 200);
  assert.equal((await request(byUser).get('/attempt')).body.error.code, 'RATE_LIMIT_EXCEEDED');

  const byIp = limiterApp({ useIp: true, useUser: false });
  for (let index = 0; index < 20; index += 1) {
    assert.equal((await request(byIp).get('/attempt').set('X-Test-User', `user-${index}`)).status, 200);
  }
  const limited = await request(byIp).get('/attempt').set('X-Test-User', 'user-21');
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'RATE_LIMIT_EXCEEDED');
});
