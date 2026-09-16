process.env.NODE_ENV = 'test';
process.env.PORT = '4024';
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
const ingredientRepository = require('../src/modules/ingredients/ingredient.repository');
const substitutionRepository = require('../src/modules/substitutions/substitution.repository');
const { signAccessToken } = require('../src/shared/security/access-token');

const app = createApp();

const ADMIN_ID = '507f1f77bcf86cd799439001';
const ADMIN_SESSION_ID = '507f1f77bcf86cd799439002';
const USER_ID = '507f1f77bcf86cd799439003';
const USER_SESSION_ID = '507f1f77bcf86cd799439004';
const SOURCE_ID = '507f1f77bcf86cd799439011';
const SUBSTITUTE_ID = '507f1f77bcf86cd799439012';
const SUBSTITUTION_ID = '507f1f77bcf86cd799439099';

function activeIngredient(id, name = 'Ingredient') {
  return { _id: id, name, isActive: true };
}

function fakeSubstitutionDoc(overrides = {}) {
  return {
    _id: SUBSTITUTION_ID,
    sourceIngredientId: activeIngredient(SOURCE_ID, 'Butter'),
    substituteIngredientId: activeIngredient(SUBSTITUTE_ID, 'Olive Oil'),
    ratio: { sourceAmount: 1, substituteAmount: 0.75 },
    contexts: ['baking'],
    notes: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function mockAuth(t, { id, role, sessionId }) {
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: sessionId,
    userId: id,
    revokedAt: null,
  }));
  // Legacy catalog success fixtures still mint an "admin" token. During the
  // M19E cutover they intentionally resolve that stale claim to the current
  // database-authoritative Moderator role.
  const currentRole = role === 'admin' ? 'moderator' : role;
  t.mock.method(userRepository, 'findById', async () => ({
    _id: id,
    role: currentRole,
    status: 'active',
  }));
}

function tokenFor({ id, role, sessionId }) {
  return signAccessToken({ userId: id, role, sessionId });
}

test('GET /api/v1/substitutions without a token is rejected', async () => {
  const response = await request(app).get('/api/v1/substitutions');
  assert.equal(response.status, 401);
});

test('GET /api/v1/substitutions?sourceIngredientId=... is readable by an authenticated user', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  let capturedFilter;
  t.mock.method(substitutionRepository, 'findMany', async ({ filter }) => {
    capturedFilter = filter;
    return [fakeSubstitutionDoc()];
  });
  t.mock.method(substitutionRepository, 'countByFilter', async () => 1);

  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const response = await request(app)
    .get(`/api/v1/substitutions?sourceIngredientId=${SOURCE_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(capturedFilter.sourceIngredientId, SOURCE_ID);
  assert.equal(response.body.data.substitutions[0].sourceIngredient.name, 'Butter');
  assert.equal(response.body.data.substitutions[0].substituteIngredient.name, 'Olive Oil');
});

test('GET /api/v1/substitutions never leaks internal ingredient fields in the populated summary', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  t.mock.method(substitutionRepository, 'findMany', async () => [fakeSubstitutionDoc()]);
  t.mock.method(substitutionRepository, 'countByFilter', async () => 1);

  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const response = await request(app)
    .get('/api/v1/substitutions')
    .set('Authorization', `Bearer ${token}`);

  const sourceSummary = response.body.data.substitutions[0].sourceIngredient;
  const substituteSummary = response.body.data.substitutions[0].substituteIngredient;
  assert.deepEqual(Object.keys(sourceSummary).sort(), ['id', 'name']);
  assert.deepEqual(Object.keys(substituteSummary).sort(), ['id', 'name']);
});

test('GET /api/v1/substitutions?status=all is rejected for a non-admin user', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });

  const response = await request(app)
    .get('/api/v1/substitutions?status=all')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 403);
});

test('GET /api/v1/substitutions rejects invalid query params', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });

  const response = await request(app)
    .get('/api/v1/substitutions?sourceIngredientId=not-an-id')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('GET /api/v1/substitutions/:id returns 404 for an unknown id', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  t.mock.method(substitutionRepository, 'findByIdWithIngredients', async () => null);

  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const response = await request(app)
    .get(`/api/v1/substitutions/${SUBSTITUTION_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'SUBSTITUTION_NOT_FOUND');
});

test('GET /api/v1/substitutions/:id returns 404 for a non-admin when the source ingredient is archived (no cascade, filtered at read time)', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  t.mock.method(substitutionRepository, 'findByIdWithIngredients', async () =>
    fakeSubstitutionDoc({
      isActive: true,
      sourceIngredientId: { _id: SOURCE_ID, name: 'Butter', isActive: false },
      substituteIngredientId: activeIngredient(SUBSTITUTE_ID, 'Olive Oil'),
    })
  );

  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const response = await request(app)
    .get(`/api/v1/substitutions/${SUBSTITUTION_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'SUBSTITUTION_NOT_FOUND');
});

test('GET /api/v1/substitutions/:id returns 404 for a non-admin when the substitute ingredient is archived', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  t.mock.method(substitutionRepository, 'findByIdWithIngredients', async () =>
    fakeSubstitutionDoc({
      isActive: true,
      sourceIngredientId: activeIngredient(SOURCE_ID, 'Butter'),
      substituteIngredientId: { _id: SUBSTITUTE_ID, name: 'Olive Oil', isActive: false },
    })
  );

  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const response = await request(app)
    .get(`/api/v1/substitutions/${SUBSTITUTION_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'SUBSTITUTION_NOT_FOUND');
});

test('GET /api/v1/substitutions/:id allows a moderator to inspect an archived ingredient relationship', async (t) => {
  mockAuth(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  t.mock.method(substitutionRepository, 'findByIdWithIngredients', async () =>
    fakeSubstitutionDoc({
      isActive: true,
      sourceIngredientId: { _id: SOURCE_ID, name: 'Butter', isActive: false },
      substituteIngredientId: activeIngredient(SUBSTITUTE_ID, 'Olive Oil'),
    })
  );

  const token = tokenFor({ id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  const response = await request(app)
    .get(`/api/v1/substitutions/${SUBSTITUTION_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.substitution.id, SUBSTITUTION_ID);
});

test('POST /api/v1/substitutions is forbidden for a non-admin user', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });

  const response = await request(app)
    .post('/api/v1/substitutions')
    .set('Authorization', `Bearer ${token}`)
    .send({
      sourceIngredientId: SOURCE_ID,
      substituteIngredientId: SUBSTITUTE_ID,
      ratio: { sourceAmount: 1, substituteAmount: 0.75 },
    });

  assert.equal(response.status, 403);
});

test('POST /api/v1/substitutions creates a substitution for a moderator when both ingredients are active', async (t) => {
  mockAuth(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  t.mock.method(ingredientRepository, 'findById', async (id) => activeIngredient(id, id === SOURCE_ID ? 'Butter' : 'Olive Oil'));
  // The real repository populates sourceIngredientId/substituteIngredientId
  // before returning (see substitution.repository.js) — simulate that here
  // rather than echoing back the raw ObjectId strings from the request.
  t.mock.method(substitutionRepository, 'createSubstitution', async (data) =>
    fakeSubstitutionDoc({
      ...data,
      sourceIngredientId: activeIngredient(data.sourceIngredientId, 'Butter'),
      substituteIngredientId: activeIngredient(data.substituteIngredientId, 'Olive Oil'),
    })
  );

  const token = tokenFor({ id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  const response = await request(app)
    .post('/api/v1/substitutions')
    .set('Authorization', `Bearer ${token}`)
    .send({
      sourceIngredientId: SOURCE_ID,
      substituteIngredientId: SUBSTITUTE_ID,
      ratio: { sourceAmount: 1, substituteAmount: 0.75 },
      contexts: ['baking'],
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.data.substitution.sourceIngredient.name, 'Butter');
  assert.equal(response.body.data.substitution.ratio.substituteAmount, 0.75);
});

test('POST /api/v1/substitutions rejects a request referencing a nonexistent ingredient', async (t) => {
  mockAuth(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  t.mock.method(ingredientRepository, 'findById', async () => null);

  const token = tokenFor({ id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  const response = await request(app)
    .post('/api/v1/substitutions')
    .set('Authorization', `Bearer ${token}`)
    .send({
      sourceIngredientId: SOURCE_ID,
      substituteIngredientId: SUBSTITUTE_ID,
      ratio: { sourceAmount: 1, substituteAmount: 0.75 },
    });

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'INGREDIENT_NOT_FOUND');
});

test('POST /api/v1/substitutions rejects a request referencing an inactive ingredient', async (t) => {
  mockAuth(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  t.mock.method(ingredientRepository, 'findById', async (id) => ({ _id: id, name: 'X', isActive: false }));

  const token = tokenFor({ id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  const response = await request(app)
    .post('/api/v1/substitutions')
    .set('Authorization', `Bearer ${token}`)
    .send({
      sourceIngredientId: SOURCE_ID,
      substituteIngredientId: SUBSTITUTE_ID,
      ratio: { sourceAmount: 1, substituteAmount: 0.75 },
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'INGREDIENT_INACTIVE');
});

test('POST /api/v1/substitutions rejects identical source/substitute ids via validation, before the service runs', async (t) => {
  mockAuth(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  const token = tokenFor({ id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });

  const response = await request(app)
    .post('/api/v1/substitutions')
    .set('Authorization', `Bearer ${token}`)
    .send({
      sourceIngredientId: SOURCE_ID,
      substituteIngredientId: SOURCE_ID,
      ratio: { sourceAmount: 1, substituteAmount: 0.75 },
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/substitutions returns a stable 409 for a duplicate ordered pair', async (t) => {
  mockAuth(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  t.mock.method(ingredientRepository, 'findById', async (id) => activeIngredient(id));
  t.mock.method(substitutionRepository, 'createSubstitution', async () => {
    const err = new Error(
      'E11000 duplicate key error collection: wecooked.substitutions index: sourceIngredientId_1_substituteIngredientId_1'
    );
    err.code = 11000;
    throw err;
  });

  const token = tokenFor({ id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  const response = await request(app)
    .post('/api/v1/substitutions')
    .set('Authorization', `Bearer ${token}`)
    .send({
      sourceIngredientId: SOURCE_ID,
      substituteIngredientId: SUBSTITUTE_ID,
      ratio: { sourceAmount: 1, substituteAmount: 0.75 },
    });

  assert.equal(response.status, 409);
  assert.equal(JSON.stringify(response.body).includes('E11000'), false);
  assert.equal(JSON.stringify(response.body).includes('wecooked.substitutions'), false);
  assert.equal(response.body.error.code, 'SUBSTITUTION_ALREADY_EXISTS');
});

test('PATCH /api/v1/substitutions/:id is forbidden for a non-admin user', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });

  const response = await request(app)
    .patch(`/api/v1/substitutions/${SUBSTITUTION_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ notes: 'x' });

  assert.equal(response.status, 403);
});

test('PATCH /api/v1/substitutions/:id applies a partial update for a moderator', async (t) => {
  mockAuth(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  t.mock.method(substitutionRepository, 'findRawById', async () => ({
    _id: SUBSTITUTION_ID,
    sourceIngredientId: SOURCE_ID,
    substituteIngredientId: SUBSTITUTE_ID,
    isActive: true,
  }));
  t.mock.method(substitutionRepository, 'updateById', async (id, update) =>
    fakeSubstitutionDoc({ notes: update.$set.notes })
  );

  const token = tokenFor({ id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  const response = await request(app)
    .patch(`/api/v1/substitutions/${SUBSTITUTION_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ notes: 'Updated guidance.' });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.substitution.notes, 'Updated guidance.');
});

test('PATCH /api/v1/substitutions/:id rejects an empty body', async (t) => {
  mockAuth(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  const token = tokenFor({ id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });

  const response = await request(app)
    .patch(`/api/v1/substitutions/${SUBSTITUTION_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({});

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('DELETE /api/v1/substitutions/:id is forbidden for a non-admin user', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });

  const response = await request(app)
    .delete(`/api/v1/substitutions/${SUBSTITUTION_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 403);
});

test('DELETE /api/v1/substitutions/:id archives (soft-deletes) for a moderator', async (t) => {
  mockAuth(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  let archivedId;
  t.mock.method(substitutionRepository, 'archiveById', async (id) => {
    archivedId = id;
    return fakeSubstitutionDoc({ isActive: false });
  });

  const token = tokenFor({ id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  const response = await request(app)
    .delete(`/api/v1/substitutions/${SUBSTITUTION_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.substitution.isActive, false);
  assert.equal(archivedId, SUBSTITUTION_ID);
});
