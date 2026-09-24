process.env.NODE_ENV = 'test';
process.env.PORT = '4022';
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
const recipeRepository = require('../src/modules/recipes/recipe.repository');
const substitutionRepository = require('../src/modules/substitutions/substitution.repository');
const { signAccessToken } = require('../src/shared/security/access-token');

const app = createApp();

const MODERATOR_ID = '507f1f77bcf86cd799439001';
const MODERATOR_SESSION_ID = '507f1f77bcf86cd799439002';
const USER_ID = '507f1f77bcf86cd799439003';
const USER_SESSION_ID = '507f1f77bcf86cd799439004';
const INGREDIENT_ID = '507f1f77bcf86cd799439099';

function fakeIngredientDoc(overrides = {}) {
  return {
    _id: INGREDIENT_ID,
    name: 'Butter',
    aliases: [],
    category: 'dairy',
    allergenTags: ['milk'],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Mocks the authenticate middleware's dependencies so a bearer token for
// the given { id, role } resolves to an active session/user, without a
// real MongoDB connection — same approach as auth-routes.test.js.
function mockAuth(t, { id, role, sessionId }) {
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: sessionId,
    userId: id,
    revokedAt: null,
  }));
  t.mock.method(userRepository, 'findById', async () => ({
    _id: id,
    role,
    status: 'active',
  }));
}

function tokenFor({ id, role, sessionId }) {
  return signAccessToken({ userId: id, role, sessionId });
}

function mockDependencies(t, { recipe = false, substitution = false } = {}) {
  t.mock.method(recipeRepository, 'hasActiveConsumerRecipeUsingIngredient', async () => recipe);
  t.mock.method(substitutionRepository, 'hasActiveSubstitutionUsingIngredient', async () => substitution);
}

test('GET /api/v1/ingredients without a token is rejected', async () => {
  const response = await request(app).get('/api/v1/ingredients');
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_TOKEN_MISSING');
});

test('GET /api/v1/ingredients is readable by an authenticated normal user', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  t.mock.method(ingredientRepository, 'findMany', async () => [fakeIngredientDoc()]);
  t.mock.method(ingredientRepository, 'countByFilter', async () => 1);

  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const response = await request(app).get('/api/v1/ingredients').set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.ingredients.length, 1);
  assert.equal(response.body.data.ingredients[0].name, 'Butter');
  assert.equal(response.body.data.pagination.total, 1);
});

test('GET /api/v1/ingredients keeps a legacy Other record readable', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  t.mock.method(ingredientRepository, 'findMany', async () => [
    fakeIngredientDoc({ name: 'Legacy ingredient', category: 'other' }),
  ]);
  t.mock.method(ingredientRepository, 'countByFilter', async () => 1);

  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const response = await request(app)
    .get('/api/v1/ingredients')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.ingredients[0].category, 'other');
});

test('GET /api/v1/ingredients?status=all is rejected for a normal user', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });

  const response = await request(app)
    .get('/api/v1/ingredients?status=all')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 403);
});

test('GET /api/v1/ingredients?status=inactive is allowed for a moderator', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(ingredientRepository, 'findMany', async () => [fakeIngredientDoc({ isActive: false })]);
  t.mock.method(ingredientRepository, 'countByFilter', async () => 1);

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .get('/api/v1/ingredients?status=inactive')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.ingredients[0].isActive, false);
});

test('GET /api/v1/ingredients rejects an invalid query param with the standard VALIDATION_ERROR envelope', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });

  const response = await request(app)
    .get('/api/v1/ingredients?category=not-real')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('GET /api/v1/ingredients filters by Protein, Pantry, and Soy', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const seenCategories = [];
  t.mock.method(ingredientRepository, 'findMany', async ({ filter }) => {
    seenCategories.push(filter.category);
    return [];
  });
  t.mock.method(ingredientRepository, 'countByFilter', async () => 0);

  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  for (const category of ['protein', 'pantry', 'soy']) {
    const response = await request(app)
      .get(`/api/v1/ingredients?category=${category}`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(response.status, 200, `expected ${category} filter to succeed`);
  }
  assert.deepEqual(seenCategories, ['protein', 'pantry', 'soy']);
});

test('GET /api/v1/ingredients/:id returns 404 for an archived ingredient requested by a normal user', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  t.mock.method(ingredientRepository, 'findById', async () => fakeIngredientDoc({ isActive: false }));

  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const response = await request(app)
    .get(`/api/v1/ingredients/${INGREDIENT_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'INGREDIENT_NOT_FOUND');
});

test('GET /api/v1/ingredients/:id allows a moderator to retrieve an archived ingredient', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(ingredientRepository, 'findById', async () => fakeIngredientDoc({ isActive: false }));

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .get(`/api/v1/ingredients/${INGREDIENT_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.ingredient.isActive, false);
});

test('POST /api/v1/ingredients is forbidden for a normal user', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });

  const response = await request(app)
    .post('/api/v1/ingredients')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Butter', category: 'dairy' });

  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'FORBIDDEN');
});

test('POST /api/v1/ingredients reaches the existing handler for a moderator after M19E', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(ingredientRepository, 'createIngredient', async (doc) => fakeIngredientDoc(doc));
  const token = tokenFor({
    id: MODERATOR_ID,
    role: 'moderator',
    sessionId: MODERATOR_SESSION_ID,
  });

  const response = await request(app)
    .post('/api/v1/ingredients')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Butter', category: 'dairy' });

  assert.equal(response.status, 201);
  assert.equal(response.body.data.ingredient.name, 'Butter');
});

test('POST /api/v1/ingredients creates an ingredient for a moderator and never returns normalizedName', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(ingredientRepository, 'createIngredient', async (data) => fakeIngredientDoc(data));

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .post('/api/v1/ingredients')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Butter', aliases: ['unsalted butter'], category: 'dairy', allergenTags: ['milk'] });

  assert.equal(response.status, 201);
  assert.equal(response.body.data.ingredient.name, 'Butter');
  assert.equal('normalizedName' in response.body.data.ingredient, false);
  assert.equal(JSON.stringify(response.body).includes('normalizedName'), false);
});

test('POST /api/v1/ingredients accepts Protein, Pantry, and Soy and keeps Soy allergen-independent', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(ingredientRepository, 'createIngredient', async (data) => fakeIngredientDoc(data));

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  for (const category of ['protein', 'pantry', 'soy']) {
    const response = await request(app)
      .post('/api/v1/ingredients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `${category} ingredient`, category });

    assert.equal(response.status, 201, `expected ${category} create to succeed`);
    assert.equal(response.body.data.ingredient.category, category);
    assert.deepEqual(response.body.data.ingredient.allergenTags, []);
  }
});

test('POST /api/v1/ingredients rejects retired Other before persistence', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  let createCalled = false;
  t.mock.method(ingredientRepository, 'createIngredient', async () => {
    createCalled = true;
    return fakeIngredientDoc();
  });

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .post('/api/v1/ingredients')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Legacy ingredient', category: 'other' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.equal(createCalled, false);
});

test('POST /api/v1/ingredients rejects a client-supplied isActive field before it reaches the service', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });

  const response = await request(app)
    .post('/api/v1/ingredients')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Butter', category: 'dairy', isActive: false });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/ingredients returns a stable 409 for a duplicate name, not a raw Mongo error', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(ingredientRepository, 'createIngredient', async () => {
    const err = new Error('E11000 duplicate key error index: normalizedName_1');
    err.code = 11000;
    throw err;
  });

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .post('/api/v1/ingredients')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Butter', category: 'dairy' });

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'INGREDIENT_ALREADY_EXISTS');
  assert.equal(JSON.stringify(response.body).includes('E11000'), false);
});

test('PATCH /api/v1/ingredients/:id is forbidden for a normal user', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });

  const response = await request(app)
    .patch(`/api/v1/ingredients/${INGREDIENT_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'New Name' });

  assert.equal(response.status, 403);
});

test('PATCH /api/v1/ingredients/:id applies a partial update for a moderator', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(ingredientRepository, 'updateById', async (id, update) =>
    fakeIngredientDoc({ _id: id, name: update.$set.name })
  );

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .patch(`/api/v1/ingredients/${INGREDIENT_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Salted Butter' });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.ingredient.name, 'Salted Butter');
});

test('PATCH /api/v1/ingredients/:id accepts Protein, Pantry, and Soy categories', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(ingredientRepository, 'updateById', async (id, update) =>
    fakeIngredientDoc({ _id: id, category: update.$set.category })
  );

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  for (const category of ['protein', 'pantry', 'soy']) {
    const response = await request(app)
      .patch(`/api/v1/ingredients/${INGREDIENT_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ category });

    assert.equal(response.status, 200, `expected edit to ${category} to succeed`);
    assert.equal(response.body.data.ingredient.category, category);
  }
});

test('PATCH /api/v1/ingredients/:id rejects retired Other before persistence', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  let updateCalled = false;
  t.mock.method(ingredientRepository, 'updateById', async () => {
    updateCalled = true;
    return fakeIngredientDoc();
  });

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .patch(`/api/v1/ingredients/${INGREDIENT_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ category: 'other' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.equal(updateCalled, false);
});

test('PATCH /api/v1/ingredients/:id keeps isActive=true reactivation supported for a moderator', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(ingredientRepository, 'updateById', async (id, update) =>
    fakeIngredientDoc({ _id: id, isActive: update.$set.isActive })
  );

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .patch(`/api/v1/ingredients/${INGREDIENT_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ isActive: true });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.ingredient.isActive, true);
});

test('PATCH /api/v1/ingredients/:id returns controlled 409 and applies nothing when deactivation is blocked', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(ingredientRepository, 'findById', async () => fakeIngredientDoc());
  mockDependencies(t, { recipe: true });
  let mutationCalled = false;
  t.mock.method(ingredientRepository, 'updateById', async () => {
    mutationCalled = true;
    return null;
  });

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .patch(`/api/v1/ingredients/${INGREDIENT_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Updated Name', isActive: false });

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'INGREDIENT_HAS_ACTIVE_DEPENDENCIES');
  assert.deepEqual(response.body.error.details, { recipe: true, substitution: false });
  assert.equal(mutationCalled, false);
  assert.equal(JSON.stringify(response.body).includes('recipeId'), false);
});

test('PATCH /api/v1/ingredients/:id renaming into another ingredient\'s normalized name is a stable 409, not a raw Mongo error', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  let capturedUpdate;
  t.mock.method(ingredientRepository, 'updateById', async (id, update) => {
    capturedUpdate = update;
    // Simulates the unique index on normalizedName rejecting the rename
    // because "  CASTER   SUGAR  " normalizes to the same value already
    // stored on another ingredient ("Caster Sugar").
    const err = new Error(
      'E11000 duplicate key error collection: wecooked.ingredients index: normalizedName_1 dup key: { normalizedName: "caster sugar" }'
    );
    err.code = 11000;
    throw err;
  });

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .patch(`/api/v1/ingredients/${INGREDIENT_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name: '  CASTER   SUGAR  ' });

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'INGREDIENT_ALREADY_EXISTS');
  assert.equal(JSON.stringify(response.body).includes('E11000'), false);
  assert.equal(JSON.stringify(response.body).includes('wecooked.ingredients'), false);
  // Same normalization rule as create: trim + lowercase + collapse whitespace.
  assert.equal(capturedUpdate.$set.normalizedName, 'caster sugar');
});

test('PATCH /api/v1/ingredients/:id rejects an empty body', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });

  const response = await request(app)
    .patch(`/api/v1/ingredients/${INGREDIENT_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({});

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('DELETE /api/v1/ingredients/:id is forbidden for a normal user', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });

  const response = await request(app)
    .delete(`/api/v1/ingredients/${INGREDIENT_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 403);
});

test('DELETE /api/v1/ingredients/:id archives (soft-deletes) for a moderator', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  let archivedId;
  t.mock.method(ingredientRepository, 'findById', async () => fakeIngredientDoc());
  mockDependencies(t);
  t.mock.method(ingredientRepository, 'updateByIdIfActiveState', async (id, expectedIsActive, update) => {
    archivedId = id;
    assert.equal(expectedIsActive, true);
    return fakeIngredientDoc(update.$set);
  });

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .delete(`/api/v1/ingredients/${INGREDIENT_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.ingredient.isActive, false);
  assert.equal(archivedId, INGREDIENT_ID);
});

test('DELETE /api/v1/ingredients/:id uses the same dependency policy and returns controlled 409', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(ingredientRepository, 'findById', async () => fakeIngredientDoc());
  mockDependencies(t, { substitution: true });
  let mutationCalled = false;
  t.mock.method(ingredientRepository, 'updateByIdIfActiveState', async () => {
    mutationCalled = true;
    return null;
  });

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .delete(`/api/v1/ingredients/${INGREDIENT_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'INGREDIENT_HAS_ACTIVE_DEPENDENCIES');
  assert.deepEqual(response.body.error.details, { recipe: false, substitution: true });
  assert.equal(mutationCalled, false);
  assert.equal(JSON.stringify(response.body).includes('substitutionId'), false);
});

test('DELETE /api/v1/ingredients/:id returns 404 for an unknown id', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(ingredientRepository, 'findById', async () => null);

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .delete(`/api/v1/ingredients/${INGREDIENT_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'INGREDIENT_NOT_FOUND');
});
