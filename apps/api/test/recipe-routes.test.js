process.env.NODE_ENV = 'test';
process.env.PORT = '4026';
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
const { signAccessToken } = require('../src/shared/security/access-token');

const app = createApp();

const MODERATOR_ID = '507f1f77bcf86cd799439001';
const MODERATOR_SESSION_ID = '507f1f77bcf86cd799439002';
const USER_ID = '507f1f77bcf86cd799439003';
const USER_SESSION_ID = '507f1f77bcf86cd799439004';
const ADMIN_ID = '507f1f77bcf86cd799439005';
const ADMIN_SESSION_ID = '507f1f77bcf86cd799439006';
const CHICKEN_ID = '507f1f77bcf86cd799439011';
const GARLIC_ID = '507f1f77bcf86cd799439012';
const RECIPE_ID = '507f1f77bcf86cd799439099';

function activeIngredient(id, name = 'Ingredient') {
  return { _id: id, name, isActive: true };
}

function inactiveIngredient(id, name = 'Ingredient') {
  return { _id: id, name, isActive: false };
}

function fakeRecipeDoc(overrides = {}) {
  return {
    _id: RECIPE_ID,
    title: 'Chicken Adobo',
    description: 'A classic Filipino chicken dish braised in soy sauce, vinegar, garlic, and spices.',
    region: 'central-luzon',
    category: 'dinner',
    difficulty: 'easy',
    prepTimeMinutes: 15,
    cookTimeMinutes: 40,
    servings: 4,
    ingredients: [
      {
        ingredientId: activeIngredient(CHICKEN_ID, 'Chicken'),
        quantity: 1,
        unit: 'kg',
        note: 'cut into serving pieces',
        optional: false,
      },
    ],
    instructions: [
      'Combine chicken, soy sauce, garlic, and bay leaves.',
      'Marinate for at least 30 minutes.',
      'Simmer until the chicken is cooked through.',
    ],
    dietaryTags: [],
    imageUrl: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function validCreatePayload(overrides = {}) {
  return {
    confirmFilipinoCuisine: true,
    title: 'Chicken Adobo',
    description: 'A classic Filipino chicken dish braised in soy sauce, vinegar, garlic, and spices.',
    difficulty: 'easy',
    prepTimeMinutes: 15,
    cookTimeMinutes: 40,
    servings: 4,
    ingredients: [
      { ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', note: 'cut into serving pieces', optional: false },
      { ingredientId: GARLIC_ID, quantity: 0.5, unit: 'cup', note: null, optional: false },
    ],
    instructions: [
      'Combine chicken, soy sauce, garlic, and bay leaves.',
      'Marinate for at least 30 minutes.',
      'Simmer until the chicken is cooked through.',
      'Add vinegar and reduce the sauce.',
    ],
    dietaryTags: [],
    imageUrl: null,
    ...overrides,
  };
}

function mockAuth(t, { id, role, sessionId }) {
  t.mock.method(recipeRepository, 'findDuplicateCandidates', async () => ({
    candidates: [], candidateUniverseCount: 0, comparedCount: 0, truncated: false,
  }));
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

test('POST /api/v1/recipes/duplicate-check is Moderator-only and validates the saved Draft form strictly', async (t) => {
  const updatedAt = new Date('2026-09-29T00:00:00.000Z');
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    ...validCreatePayload(), _id: RECIPE_ID, publicationStatus: 'draft', isActive: true, updatedAt,
  }));
  t.mock.method(ingredientRepository, 'findById', async (id) => activeIngredient(id));
  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });

  const response = await request(app)
    .post('/api/v1/recipes/duplicate-check')
    .set('Authorization', `Bearer ${token}`)
    .send({ recipeId: RECIPE_ID, expectedUpdatedAt: updatedAt.toISOString() });
  assert.equal(response.status, 200);
  assert.match(response.body.data.duplicateReview.resultDigest, /^[0-9a-f]{64}$/);
  assert.equal(response.body.data.duplicateReview.candidateLimit, 500);

  const malformed = await request(app)
    .post('/api/v1/recipes/duplicate-check')
    .set('Authorization', `Bearer ${token}`)
    .send({ recipeId: RECIPE_ID, expectedUpdatedAt: updatedAt.toISOString(), sourceUrl: 'https://example.com' });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/recipes/duplicate-check analyzes valid nutrition without a Recipe mutation', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(ingredientRepository, 'findById', async (id) => activeIngredient(id));
  for (const method of ['createRecipe', 'updateById', 'publishById', 'archiveById', 'restoreById']) {
    t.mock.method(recipeRepository, method, async () => assert.fail(`duplicate analysis must not call ${method}`));
  }
  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const nutrition = {
    schemaVersion: 1, basis: 'perServing', caloriesKcal: 320, proteinGrams: 28,
    carbohydrateGrams: 12, fatGrams: 18, sugarGrams: 3, fiberGrams: 2,
  };
  const { confirmFilipinoCuisine, ...candidate } = validCreatePayload({
    nutrition,
    nutritionSource: { kind: 'manual', label: 'Reviewed laboratory panel' },
  });

  const accepted = await request(app)
    .post('/api/v1/recipes/duplicate-check')
    .set('Authorization', `Bearer ${token}`)
    .send({ candidate });
  assert.equal(accepted.status, 200);
  assert.match(accepted.body.data.duplicateReview.resultDigest, /^[0-9a-f]{64}$/u);

  const rejected = await request(app)
    .post('/api/v1/recipes/duplicate-check')
    .set('Authorization', `Bearer ${token}`)
    .send({ candidate: { ...candidate, nutrition: { ...nutrition, fiberGrams: '2' } } });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error.code, 'VALIDATION_ERROR');
});

for (const actor of [
  { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID },
  { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID },
]) {
  test(`POST /api/v1/recipes/duplicate-check denies ${actor.role}`, async (t) => {
    mockAuth(t, actor);
    const token = tokenFor(actor);
    const response = await request(app)
      .post('/api/v1/recipes/duplicate-check')
      .set('Authorization', `Bearer ${token}`)
      .send({ recipeId: RECIPE_ID, expectedUpdatedAt: '2026-09-29T00:00:00.000Z' });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'FORBIDDEN');
  });
}

test('POST /api/v1/recipes/:id/publish-readiness returns the frozen success envelope for a Moderator', async (t) => {
  const updatedAt = new Date('2026-09-30T00:00:00.000Z');
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    ...validCreatePayload(), _id: RECIPE_ID, publicationStatus: 'draft', isActive: true, updatedAt,
  }));
  t.mock.method(ingredientRepository, 'findById', async (id) => activeIngredient(id));
  for (const method of ['createRecipe', 'updateById', 'publishById', 'archiveById', 'restoreById']) {
    t.mock.method(recipeRepository, method, async () => assert.fail(`readiness must not call ${method}`));
  }
  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });

  const response = await request(app)
    .post(`/api/v1/recipes/${RECIPE_ID}/publish-readiness`)
    .set('Authorization', `Bearer ${token}`)
    .send({ expectedUpdatedAt: updatedAt.toISOString() });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.deepEqual(Object.keys(response.body.data), ['publishReadiness']);
  assert.deepEqual(response.body.data.publishReadiness, {
    ready: true,
    recipeId: RECIPE_ID,
    recipeUpdatedAt: updatedAt.toISOString(),
    issues: [],
    duplicateReview: {
      fingerprintVersion: 'recipe-duplicate-v1',
      resultDigest: response.body.data.publishReadiness.duplicateReview.resultDigest,
      candidateLimit: 500,
      candidateUniverseCount: 0,
      comparedCount: 0,
      truncated: false,
      candidates: [],
    },
  });
  assert.match(response.body.data.publishReadiness.duplicateReview.resultDigest, /^[0-9a-f]{64}$/);
});

test('publish-readiness rejects stale versions and invalid requests rather than returning a negative projection', async (t) => {
  const updatedAt = new Date('2026-09-30T00:00:00.000Z');
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(recipeRepository, 'findRawById', async () => fakeRecipeDoc({
    publicationStatus: 'draft', updatedAt,
  }));
  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });

  const stale = await request(app)
    .post(`/api/v1/recipes/${RECIPE_ID}/publish-readiness`)
    .set('Authorization', `Bearer ${token}`)
    .send({ expectedUpdatedAt: '2026-09-29T00:00:00.000Z' });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'RECIPE_EDIT_CONFLICT');

  for (const { path, body } of [
    { path: RECIPE_ID, body: {} },
    { path: RECIPE_ID, body: { expectedUpdatedAt: updatedAt.toISOString(), unknown: true } },
    { path: 'invalid', body: { expectedUpdatedAt: updatedAt.toISOString() } },
  ]) {
    const invalid = await request(app)
      .post(`/api/v1/recipes/${path}/publish-readiness`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');
  }
});

for (const actor of [
  { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID },
  { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID },
]) {
  test(`POST /api/v1/recipes/:id/publish-readiness denies ${actor.role} before validation`, async (t) => {
    mockAuth(t, actor);
    const token = tokenFor(actor);
    const response = await request(app)
      .post(`/api/v1/recipes/${RECIPE_ID}/publish-readiness`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'FORBIDDEN');
  });
}

test('publish-readiness denies unauthenticated callers before validation', async () => {
  const response = await request(app)
    .post(`/api/v1/recipes/${RECIPE_ID}/publish-readiness`)
    .send({});
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_TOKEN_MISSING');
});

test('publish-readiness uses the current database role, not a stale Moderator token claim', async (t) => {
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: MODERATOR_SESSION_ID, userId: MODERATOR_ID, revokedAt: null,
  }));
  t.mock.method(userRepository, 'findById', async () => ({
    _id: MODERATOR_ID, role: 'user', status: 'active',
  }));
  const staleModeratorToken = tokenFor({
    id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID,
  });

  const response = await request(app)
    .post(`/api/v1/recipes/${RECIPE_ID}/publish-readiness`)
    .set('Authorization', `Bearer ${staleModeratorToken}`)
    .send({});
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'FORBIDDEN');
});

test('GET /api/v1/recipes without a token is rejected', async () => {
  const response = await request(app).get('/api/v1/recipes');
  assert.equal(response.status, 401);
});

test('GET /api/v1/recipes is readable by an authenticated normal user', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  t.mock.method(recipeRepository, 'findMany', async () => [fakeRecipeDoc()]);
  t.mock.method(recipeRepository, 'countByFilter', async () => 1);

  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const response = await request(app).get('/api/v1/recipes').set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.recipes[0].title, 'Chicken Adobo');
  assert.equal(response.body.data.recipes[0].ingredients[0].ingredient.name, 'Chicken');
  assert.deepEqual(response.body.data.pagination, { page: 1, limit: 20, total: 1, totalPages: 1 });
});

test('GET /api/v1/recipes never leaks internal ingredient fields in the populated summary', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  t.mock.method(recipeRepository, 'findMany', async () => [fakeRecipeDoc()]);
  t.mock.method(recipeRepository, 'countByFilter', async () => 1);

  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const response = await request(app).get('/api/v1/recipes').set('Authorization', `Bearer ${token}`);

  const ingredientSummary = response.body.data.recipes[0].ingredients[0].ingredient;
  assert.deepEqual(Object.keys(ingredientSummary).sort(), ['id', 'name']);
});

test('GET /api/v1/recipes filters out a recipe with an archived required ingredient for a normal user', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  t.mock.method(recipeRepository, 'findMany', async () => [
    fakeRecipeDoc({ _id: 'r1' }),
    fakeRecipeDoc({
      _id: 'r2',
      ingredients: [{ ingredientId: inactiveIngredient(CHICKEN_ID), quantity: 1, unit: 'kg', optional: false }],
    }),
  ]);
  t.mock.method(recipeRepository, 'countByFilter', async () => 2);

  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const response = await request(app).get('/api/v1/recipes').set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.recipes.length, 1);
  assert.equal(response.body.data.recipes[0].id, 'r1');
});

test('GET /api/v1/recipes keeps a recipe visible but omits an archived optional ingredient usage for a normal user', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  t.mock.method(recipeRepository, 'findMany', async () => [
    fakeRecipeDoc({
      ingredients: [
        { ingredientId: activeIngredient(CHICKEN_ID, 'Chicken'), quantity: 1, unit: 'kg', optional: false },
        { ingredientId: inactiveIngredient(GARLIC_ID, 'Garlic'), quantity: 1, unit: 'clove', optional: true },
      ],
    }),
  ]);
  t.mock.method(recipeRepository, 'countByFilter', async () => 1);

  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const response = await request(app).get('/api/v1/recipes').set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.recipes.length, 1);
  assert.equal(response.body.data.recipes[0].ingredients.length, 1);
  assert.equal(response.body.data.recipes[0].ingredients[0].ingredient.name, 'Chicken');
});

test('GET /api/v1/recipes?status=all is rejected for a normal user', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });

  const response = await request(app).get('/api/v1/recipes?status=all').set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 403);
});

test('GET /api/v1/recipes?status=inactive is allowed for a moderator', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(recipeRepository, 'findMany', async () => [fakeRecipeDoc({ isActive: false })]);
  t.mock.method(recipeRepository, 'countByFilter', async () => 1);

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .get('/api/v1/recipes?status=inactive')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.recipes[0].isActive, false);
});

test('GET /api/v1/recipes Draft review filter is Moderator-only and preserves the list envelope', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  let findArgs;
  t.mock.method(recipeRepository, 'findMany', async (args) => {
    findArgs = args;
    return [fakeRecipeDoc({ publicationStatus: 'draft', updatedAt: new Date('2026-09-30T02:00:00.000Z') })];
  });
  t.mock.method(recipeRepository, 'countByFilter', async () => 1);
  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });

  const response = await request(app)
    .get('/api/v1/recipes?publicationStatus=draft&status=active&sort=updatedDesc&page=1&limit=20')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.recipes[0].publicationStatus, 'draft');
  assert.deepEqual(response.body.data.pagination, { page: 1, limit: 20, total: 1, totalPages: 1 });
  assert.deepEqual(findArgs.filter, { publicationStatus: 'draft', isActive: true });
  assert.deepEqual(findArgs.sort, { updatedAt: -1 });
});

for (const actor of [
  { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID },
  { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID },
]) {
  test(`GET /api/v1/recipes Draft review filter denies ${actor.role}`, async (t) => {
    mockAuth(t, actor);
    const response = await request(app)
      .get('/api/v1/recipes?publicationStatus=draft&status=active&sort=updatedDesc')
      .set('Authorization', `Bearer ${tokenFor(actor)}`);
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'FORBIDDEN');
  });
}

test('GET /api/v1/recipes Draft review filter uses database-authoritative role demotion', async (t) => {
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: MODERATOR_SESSION_ID, userId: MODERATOR_ID, revokedAt: null,
  }));
  t.mock.method(userRepository, 'findById', async () => ({
    _id: MODERATOR_ID, role: 'user', status: 'active',
  }));
  const staleToken = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .get('/api/v1/recipes?publicationStatus=draft')
    .set('Authorization', `Bearer ${staleToken}`);
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'FORBIDDEN');
});

test('GET /api/v1/recipes validates Draft list query before its capability gate', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const response = await request(app)
    .get('/api/v1/recipes?publicationStatus=published')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('GET /api/v1/recipes rejects invalid query params', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });

  const response = await request(app)
    .get('/api/v1/recipes?ingredientId=not-an-id')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('GET /api/v1/recipes?region=&category=&maxPrepTimeMinutes=20 is applied as filters', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  let capturedFilter;
  t.mock.method(recipeRepository, 'findMany', async ({ filter }) => {
    capturedFilter = filter;
    return [];
  });
  t.mock.method(recipeRepository, 'countByFilter', async () => 0);

  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const response = await request(app)
    .get('/api/v1/recipes?region=central-luzon&category=dinner&maxPrepTimeMinutes=20')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(capturedFilter.region, 'central-luzon');
  assert.equal(capturedFilter.category, 'dinner');
  assert.deepEqual(capturedFilter.prepTimeMinutes, { $lte: 20 });
});

test('GET /api/v1/recipes composes canonical dietaryTags and totalTimeBucket through controller and service', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  let findFilter;
  let countFilter;
  t.mock.method(recipeRepository, 'findMany', async ({ filter }) => { findFilter = filter; return []; });
  t.mock.method(recipeRepository, 'countByFilter', async (filter) => { countFilter = filter; return 0; });

  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const response = await request(app)
    .get('/api/v1/recipes?search=adobo&region=central-luzon&category=dinner&difficulty=easy&dietaryTags=vegetarian%2Cvegan%2Cvegetarian&ingredientId=507f1f77bcf86cd799439011&maxPrepTimeMinutes=20&totalTimeBucket=15-to-30')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.deepEqual(findFilter, countFilter);
  assert.deepEqual(findFilter.dietaryTags, { $all: ['vegetarian', 'vegan'] });
  assert.ok(findFilter.$expr);
  assert.equal(findFilter.$or[0].title.source, 'adobo');
});

test('GET /api/v1/recipes preserves dietaryTag alias and rejects dual/repeated/empty DISC6 parameters', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const captured = [];
  t.mock.method(recipeRepository, 'findMany', async ({ filter }) => { captured.push(filter); return []; });
  t.mock.method(recipeRepository, 'countByFilter', async () => 0);
  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });

  const alias = await request(app)
    .get('/api/v1/recipes?dietaryTag=vegan')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(alias.status, 200);
  assert.deepEqual(captured[0].dietaryTags, { $all: ['vegan'] });

  for (const query of [
    'dietaryTag=vegan&dietaryTags=vegan',
    'dietaryTags=',
    'dietaryTags=vegan&dietaryTags=vegetarian',
    'totalTimeBucket=under-15&totalTimeBucket=over-60',
  ]) {
    const response = await request(app)
      .get(`/api/v1/recipes?${query}`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(response.status, 400, query);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR', query);
  }
  assert.equal(captured.length, 1);
});

test('GET /api/v1/recipes?cuisine=filipino is rejected (retired query param)', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });

  const response = await request(app)
    .get('/api/v1/recipes?cuisine=filipino')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('GET /api/v1/recipes response carries region/category/steps and no cuisine', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  t.mock.method(recipeRepository, 'findMany', async () => [fakeRecipeDoc()]);
  t.mock.method(recipeRepository, 'countByFilter', async () => 1);

  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const response = await request(app).get('/api/v1/recipes').set('Authorization', `Bearer ${token}`);

  const recipe = response.body.data.recipes[0];
  assert.equal(recipe.region, 'central-luzon');
  assert.equal(recipe.category, 'dinner');
  assert.equal('cuisine' in recipe, false);
  assert.equal(recipe.steps[0].order, 1);
  assert.equal(recipe.steps[0].text, recipe.instructions[0]);
});

test('GET /api/v1/recipes/:id returns 404 for an unknown id', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => null);

  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const response = await request(app)
    .get(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'RECIPE_NOT_FOUND');
});

test('GET /api/v1/recipes/:id returns 404 for a normal user when the recipe is archived', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => fakeRecipeDoc({ isActive: false }));

  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const response = await request(app)
    .get(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'RECIPE_NOT_FOUND');
});

test('GET /api/v1/recipes/:id returns 404 for a normal user when a required ingredient is archived (no cascade, filtered at read time)', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () =>
    fakeRecipeDoc({
      ingredients: [
        { ingredientId: inactiveIngredient(CHICKEN_ID, 'Chicken'), quantity: 1, unit: 'kg', optional: false },
      ],
    })
  );

  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const response = await request(app)
    .get(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'RECIPE_NOT_FOUND');
});

test('GET /api/v1/recipes/:id allows a moderator to inspect an archived ingredient relationship', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () =>
    fakeRecipeDoc({
      ingredients: [
        { ingredientId: inactiveIngredient(CHICKEN_ID, 'Chicken'), quantity: 1, unit: 'kg', optional: false },
      ],
    })
  );

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .get(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.recipe.id, RECIPE_ID);
});

test('GET /api/v1/recipes/:id keeps the recipe visible but omits an archived optional ingredient usage for a normal user', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () =>
    fakeRecipeDoc({
      ingredients: [
        { ingredientId: activeIngredient(CHICKEN_ID, 'Chicken'), quantity: 1, unit: 'kg', optional: false },
        { ingredientId: inactiveIngredient(GARLIC_ID, 'Garlic'), quantity: 1, unit: 'clove', optional: true },
      ],
    })
  );

  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const response = await request(app)
    .get(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.recipe.ingredients.length, 1);
  assert.equal(response.body.data.recipe.ingredients[0].ingredient.name, 'Chicken');
});

test('GET /api/v1/recipes/:id shows a moderator the complete archived optional ingredient relationship', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () =>
    fakeRecipeDoc({
      ingredients: [
        { ingredientId: activeIngredient(CHICKEN_ID, 'Chicken'), quantity: 1, unit: 'kg', optional: false },
        { ingredientId: inactiveIngredient(GARLIC_ID, 'Garlic'), quantity: 1, unit: 'clove', optional: true },
      ],
    })
  );

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .get(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.recipe.ingredients.length, 2);
  assert.equal(response.body.data.recipe.ingredients[1].ingredient.name, 'Garlic');
});

test('GET /api/v1/recipes/:id rejects an invalid ObjectId param', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });

  const response = await request(app).get('/api/v1/recipes/not-an-id').set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/recipes is forbidden for a normal user', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });

  const response = await request(app)
    .post('/api/v1/recipes')
    .set('Authorization', `Bearer ${token}`)
    .send(validCreatePayload());

  assert.equal(response.status, 403);
});

test('POST /api/v1/recipes creates a recipe for a moderator when every ingredient is active', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  let capturedData;
  t.mock.method(ingredientRepository, 'findById', async (id) =>
    activeIngredient(id, id === CHICKEN_ID ? 'Chicken' : 'Garlic')
  );
  t.mock.method(recipeRepository, 'createRecipe', async (data) => {
    capturedData = data;
    return fakeRecipeDoc({
      ...data,
      ingredients: data.ingredients.map((entry) => ({
        ...entry,
        ingredientId: activeIngredient(entry.ingredientId, entry.ingredientId === CHICKEN_ID ? 'Chicken' : 'Garlic'),
      })),
    });
  });

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .post('/api/v1/recipes')
    .set('Authorization', `Bearer ${token}`)
    .send(validCreatePayload());

  assert.equal(response.status, 201);
  assert.equal(response.body.data.recipe.title, 'Chicken Adobo');
  assert.equal(response.body.data.recipe.ingredients[0].ingredient.name, 'Chicken');
  assert.equal(capturedData.publicationStatus, 'published');
  assert.equal(capturedData.publishedBy, MODERATOR_ID);
  assert.ok(capturedData.publishedAt instanceof Date);
  assert.equal('confirmFilipinoCuisine' in capturedData, false);
  assert.equal('confirmFilipinoCuisine' in response.body.data.recipe, false);
});

test('legacy POST /api/v1/recipes returns pre-mutation duplicate evidence and succeeds only on explicit current retry', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const payload = validCreatePayload();
  const candidate = {
    _id: RECIPE_ID, title: payload.title, ingredients: payload.ingredients, instructions: payload.instructions,
    publicationStatus: 'published', isActive: true, updatedAt: new Date('2026-09-29T00:00:00.000Z'),
  };
  recipeRepository.findDuplicateCandidates.mock.mockImplementation(async () => ({
    candidates: [candidate], candidateUniverseCount: 1, comparedCount: 1, truncated: false,
  }));
  t.mock.method(ingredientRepository, 'findById', async (id) => activeIngredient(id));
  let creates = 0;
  t.mock.method(recipeRepository, 'createRecipe', async (data) => {
    creates += 1;
    return fakeRecipeDoc({ ...data, ingredients: data.ingredients.map((entry) => ({
      ...entry, ingredientId: activeIngredient(entry.ingredientId),
    })) });
  });
  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });

  const required = await request(app).post('/api/v1/recipes').set('Authorization', `Bearer ${token}`).send(payload);
  assert.equal(required.status, 409);
  assert.equal(required.body.error.code, 'RECIPE_DUPLICATE_REVIEW_REQUIRED');
  assert.equal(creates, 0);
  const review = required.body.error.details[0].duplicateReview;

  const created = await request(app).post('/api/v1/recipes').set('Authorization', `Bearer ${token}`).send({
    ...payload,
    duplicateReview: { resultDigest: review.resultDigest, confirmDistinctRecipe: true },
  });
  assert.equal(created.status, 201);
  assert.equal(creates, 1);
  assert.equal('duplicateReview' in created.body.data.recipe, false);
});

test('legacy POST /api/v1/recipes treats a truncated empty window as required review and performs no mutation', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  recipeRepository.findDuplicateCandidates.mock.mockImplementation(async () => ({
    candidates: [], candidateUniverseCount: 501, comparedCount: 500, truncated: true,
  }));
  t.mock.method(ingredientRepository, 'findById', async (id) => activeIngredient(id));
  let creates = 0;
  t.mock.method(recipeRepository, 'createRecipe', async () => { creates += 1; return null; });
  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });

  const response = await request(app)
    .post('/api/v1/recipes')
    .set('Authorization', `Bearer ${token}`)
    .send(validCreatePayload());

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'RECIPE_DUPLICATE_REVIEW_REQUIRED');
  assert.equal(response.body.error.details[0].duplicateReview.truncated, true);
  assert.equal(response.body.error.details[0].duplicateReview.candidates.length, 0);
  assert.equal(creates, 0);
});

test('create and publish routes keep malformed duplicate acknowledgements at 400 before mutation', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const invalidReviews = [
    { resultDigest: 'not-a-digest', confirmDistinctRecipe: true },
    { resultDigest: 'a'.repeat(64), confirmDistinctRecipe: 'true' },
    { resultDigest: 'a'.repeat(64), confirmDistinctRecipe: true, score: 100 },
  ];

  for (const duplicateReview of invalidReviews) {
    const created = await request(app)
      .post('/api/v1/recipes')
      .set('Authorization', `Bearer ${token}`)
      .send(validCreatePayload({ duplicateReview }));
    assert.equal(created.status, 400);
    assert.equal(created.body.error.code, 'VALIDATION_ERROR');

    const published = await request(app)
      .post(`/api/v1/recipes/${RECIPE_ID}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmFilipinoCuisine: true, duplicateReview });
    assert.equal(published.status, 400);
    assert.equal(published.body.error.code, 'VALIDATION_ERROR');
  }
});

test('POST /api/v1/recipes rejects missing, false, and non-boolean Filipino confirmation', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const missing = validCreatePayload();
  delete missing.confirmFilipinoCuisine;

  for (const payload of [
    missing,
    validCreatePayload({ confirmFilipinoCuisine: false }),
    validCreatePayload({ confirmFilipinoCuisine: 'true' }),
    validCreatePayload({ confirmFilipinoCuisine: 1 }),
  ]) {
    const response = await request(app)
      .post('/api/v1/recipes')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  }
});

test('POST /api/v1/recipes rejects a request referencing a nonexistent ingredient', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(ingredientRepository, 'findById', async () => null);

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .post('/api/v1/recipes')
    .set('Authorization', `Bearer ${token}`)
    .send(validCreatePayload());

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'RECIPE_INGREDIENT_NOT_FOUND');
});

test('POST /api/v1/recipes rejects a request referencing an inactive ingredient', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(ingredientRepository, 'findById', async (id) => ({ _id: id, name: 'X', isActive: false }));

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .post('/api/v1/recipes')
    .set('Authorization', `Bearer ${token}`)
    .send(validCreatePayload());

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'RECIPE_INGREDIENT_INACTIVE');
});

test('POST /api/v1/recipes rejects unit "toTaste" combined with a quantity before the service runs', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });

  const response = await request(app)
    .post('/api/v1/recipes')
    .set('Authorization', `Bearer ${token}`)
    .send(
      validCreatePayload({
        ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'toTaste' }],
      })
    );

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/recipes accepts a "salt to taste" style entry with no quantity', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(ingredientRepository, 'findById', async (id) => activeIngredient(id, 'Salt'));
  t.mock.method(recipeRepository, 'createRecipe', async (data) =>
    fakeRecipeDoc({
      ...data,
      ingredients: data.ingredients.map((entry) => ({ ...entry, ingredientId: activeIngredient(entry.ingredientId, 'Salt') })),
    })
  );

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .post('/api/v1/recipes')
    .set('Authorization', `Bearer ${token}`)
    .send(
      validCreatePayload({
        ingredients: [{ ingredientId: CHICKEN_ID, unit: 'toTaste', note: 'salt to taste' }],
      })
    );

  assert.equal(response.status, 201);
  assert.equal(response.body.data.recipe.ingredients[0].quantity, null);
  assert.equal(response.body.data.recipe.ingredients[0].unit, 'toTaste');
});

test('POST /api/v1/recipes preserves canonical lb/oz values through serialization', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(ingredientRepository, 'findById', async (id) => activeIngredient(id));
  let capturedData;
  t.mock.method(recipeRepository, 'createRecipe', async (data) => {
    capturedData = data;
    return fakeRecipeDoc({
      ...data,
      ingredients: data.ingredients.map((entry) => ({ ...entry, ingredientId: activeIngredient(entry.ingredientId) })),
    });
  });
  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const ingredients = [
    { ingredientId: CHICKEN_ID, quantity: 0.75, unit: 'lb' },
    { ingredientId: GARLIC_ID, quantity: 8, unit: 'oz' },
  ];
  const response = await request(app).post('/api/v1/recipes').set('Authorization', `Bearer ${token}`)
    .send(validCreatePayload({ ingredients }));

  assert.equal(response.status, 201);
  assert.deepEqual(capturedData.ingredients.map(({ quantity, unit }) => ({ quantity, unit })), [
    { quantity: 0.75, unit: 'lb' }, { quantity: 8, unit: 'oz' },
  ]);
  assert.deepEqual(response.body.data.recipe.ingredients.map(({ quantity, unit }) => ({ quantity, unit })), [
    { quantity: 0.75, unit: 'lb' }, { quantity: 8, unit: 'oz' },
  ]);
});

test('POST /api/v1/recipes rejects unknown top-level fields', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });

  const response = await request(app)
    .post('/api/v1/recipes')
    .set('Authorization', `Bearer ${token}`)
    .send(validCreatePayload({ notAField: true }));

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/recipes rejects a retired cuisine field and never stores it', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });

  const response = await request(app)
    .post('/api/v1/recipes')
    .set('Authorization', `Bearer ${token}`)
    .send(validCreatePayload({ cuisine: 'filipino' }));

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/recipes accepts structured steps and a canonical region/category, normalizing steps into instructions', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(ingredientRepository, 'findById', async (id) =>
    activeIngredient(id, id === CHICKEN_ID ? 'Chicken' : 'Garlic')
  );
  let capturedData;
  t.mock.method(recipeRepository, 'createRecipe', async (data) => {
    capturedData = data;
    return fakeRecipeDoc({
      ...data,
      ingredients: data.ingredients.map((entry) => ({
        ...entry,
        ingredientId: activeIngredient(entry.ingredientId, entry.ingredientId === CHICKEN_ID ? 'Chicken' : 'Garlic'),
      })),
    });
  });

  const body = validCreatePayload({ region: 'bicol-region', category: 'dinner' });
  delete body.instructions;
  body.steps = [
    { order: 2, text: 'Simmer until tender.' },
    { order: 1, text: 'Combine the marinade.' },
  ];

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .post('/api/v1/recipes')
    .set('Authorization', `Bearer ${token}`)
    .send(body);

  assert.equal(response.status, 201);
  assert.deepEqual(capturedData.instructions, ['Combine the marinade.', 'Simmer until tender.']);
  assert.equal(capturedData.region, 'bicol-region');
  assert.equal(capturedData.category, 'dinner');
  assert.equal('cuisine' in capturedData, false);
});

test('PATCH /api/v1/recipes/:id clears category with an explicit null and the serializer returns it as null', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    _id: RECIPE_ID,
    isActive: true,
    region: 'central-luzon',
    category: 'dinner',
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', optional: false }],
  }));
  let capturedOps;
  t.mock.method(recipeRepository, 'updateById', async (id, update) => {
    capturedOps = update;
    // Mimic $unset: the returned doc no longer carries `category`.
    const doc = fakeRecipeDoc();
    delete doc.category;
    return doc;
  });

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .patch(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ category: null });

  assert.equal(response.status, 200);
  assert.deepEqual(capturedOps.$unset, { category: '' });
  assert.deepEqual(capturedOps.$set, { updatedBy: MODERATOR_ID });
  assert.equal(response.body.data.recipe.category, null);
  // The untouched region is unaffected.
  assert.equal(response.body.data.recipe.region, 'central-luzon');
});

test('PATCH /api/v1/recipes/:id clears Draft-optional scalars with $unset and keeps expectedUpdatedAt', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const updatedAt = new Date('2026-09-17T02:00:00.000Z');
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    ...validCreatePayload(),
    _id: RECIPE_ID,
    publicationStatus: 'draft',
    isActive: true,
    updatedAt,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', optional: false }],
  }));
  let captured;
  t.mock.method(recipeRepository, 'updateById', async (id, update, options) => {
    captured = { update, options };
    return fakeRecipeDoc({ publicationStatus: 'draft', description: undefined, prepTimeMinutes: undefined });
  });

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .patch(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ description: null, prepTimeMinutes: null, expectedUpdatedAt: updatedAt.toISOString() });

  assert.equal(response.status, 200);
  assert.deepEqual(captured.update.$unset, { description: '', prepTimeMinutes: '' });
  assert.equal(captured.options.expectedUpdatedAt, updatedAt.toISOString());
  assert.equal(response.body.data.recipe.description, undefined);
});

test('PATCH /api/v1/recipes/:id rejects a Published required-scalar null clear', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    ...validCreatePayload(),
    _id: RECIPE_ID,
    publicationStatus: 'published',
    isActive: true,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', optional: false }],
  }));

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .patch(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ servings: null });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'RECIPE_INCOMPLETE');
});

test('PATCH /api/v1/recipes/:id rejects an empty-string region (clear requires null)', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });

  const response = await request(app)
    .patch(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ region: '' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('PATCH /api/v1/recipes/:id is forbidden for a normal user', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });

  const response = await request(app)
    .patch(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ servings: 6 });

  assert.equal(response.status, 403);
});

test('PATCH /api/v1/recipes/:id applies a partial update for a moderator', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    _id: RECIPE_ID,
    isActive: true,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', optional: false }],
  }));
  t.mock.method(recipeRepository, 'updateById', async (id, update) =>
    fakeRecipeDoc({ servings: update.$set.servings })
  );

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .patch(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ servings: 6 });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.recipe.servings, 6);
});

test('PATCH /api/v1/recipes/:id derives nutrition provenance from the authenticated CATALOG_WRITE actor', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const existing = fakeRecipeDoc({ publicationStatus: 'draft' });
  let mutation;
  t.mock.method(recipeRepository, 'findRawById', async () => existing);
  t.mock.method(recipeRepository, 'updateById', async (id, update, options) => {
    mutation = { id, update, options };
    return fakeRecipeDoc({ ...update.$set, publicationStatus: 'draft' });
  });
  const nutrition = {
    schemaVersion: 1, basis: 'perServing', caloriesKcal: 320, proteinGrams: 28,
    carbohydrateGrams: 12, fatGrams: 18, sugarGrams: 3, fiberGrams: 2,
  };
  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .patch(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      nutrition,
      nutritionSource: { kind: 'manual', label: 'Reviewed laboratory panel', url: 'https://example.com/panel' },
    });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.recipe.nutrition, nutrition);
  assert.deepEqual(response.body.data.recipe.nutritionSource, {
    kind: 'manual', label: 'Reviewed laboratory panel', url: 'https://example.com/panel',
  });
  assert.equal(mutation.update.$set.nutritionProvenance.acceptedBy, MODERATOR_ID);
  assert.ok(mutation.update.$set.nutritionProvenance.acceptedAt instanceof Date);
  assert.equal(JSON.stringify(response.body).includes('acceptedBy'), false);
  assert.equal(JSON.stringify(response.body).includes('acceptedAt'), false);
  assert.equal(JSON.stringify(response.body).includes('nutritionProvenance'), false);
});

test('PATCH /api/v1/recipes/:id rejects an empty body', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });

  const response = await request(app)
    .patch(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({});

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('PATCH /api/v1/recipes/:id replaces the ingredients array and validates it via IngredientService', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    _id: RECIPE_ID,
    isActive: true,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', optional: false }],
  }));
  t.mock.method(ingredientRepository, 'findById', async () => null);

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .patch(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ ingredients: [{ ingredientId: GARLIC_ID, quantity: 2, unit: 'clove' }] });

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'RECIPE_INGREDIENT_NOT_FOUND');
});

function patchIngredientsWith(t, entry) {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    _id: RECIPE_ID,
    isActive: true,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', optional: false }],
  }));
  t.mock.method(ingredientRepository, 'findById', async (id) => activeIngredient(id, 'Salt'));
  t.mock.method(recipeRepository, 'updateById', async (id, update) =>
    fakeRecipeDoc({
      ingredients: update.$set.ingredients.map((e) => ({ ...e, ingredientId: activeIngredient(e.ingredientId, 'Salt') })),
    })
  );

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  return request(app)
    .patch(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ ingredients: [entry] });
}

test('PATCH /api/v1/recipes/:id accepts a replacement ingredient with unit "toTaste" and quantity omitted', async (t) => {
  const response = await patchIngredientsWith(t, { ingredientId: CHICKEN_ID, unit: 'toTaste', note: 'salt to taste' });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.recipe.ingredients[0].unit, 'toTaste');
  assert.equal(response.body.data.recipe.ingredients[0].quantity, null);
});

test('PATCH /api/v1/recipes/:id rejects a replacement ingredient with unit "toTaste" and a quantity', async (t) => {
  const response = await patchIngredientsWith(t, { ingredientId: CHICKEN_ID, quantity: 1, unit: 'toTaste' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('PATCH /api/v1/recipes/:id rejects a replacement ingredient with a measurable unit and quantity omitted', async (t) => {
  const response = await patchIngredientsWith(t, { ingredientId: CHICKEN_ID, unit: 'tbsp' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('PATCH /api/v1/recipes/:id accepts a replacement ingredient with a measurable unit and a quantity', async (t) => {
  const response = await patchIngredientsWith(t, { ingredientId: CHICKEN_ID, quantity: 1, unit: 'tbsp' });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.recipe.ingredients[0].unit, 'tbsp');
  assert.equal(response.body.data.recipe.ingredients[0].quantity, 1);
});

for (const unit of ['lb', 'oz']) {
  test(`PATCH /api/v1/recipes/:id preserves canonical ${unit} without conversion`, async (t) => {
    const response = await patchIngredientsWith(t, { ingredientId: CHICKEN_ID, quantity: 2.5, unit });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.recipe.ingredients[0].unit, unit);
    assert.equal(response.body.data.recipe.ingredients[0].quantity, 2.5);
  });
}

test('POST /api/v1/recipes/:id/restore rejects a Published recipe with an inactive stored ingredient', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    ...validCreatePayload(),
    _id: RECIPE_ID,
    isActive: false,
    publicationStatus: 'published',
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', optional: false }],
  }));
  t.mock.method(ingredientRepository, 'findById', async (id) => ({ _id: id, name: 'X', isActive: false }));

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .post(`/api/v1/recipes/${RECIPE_ID}/restore`)
    .set('Authorization', `Bearer ${token}`)
    .send({});

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'RECIPE_INGREDIENT_INACTIVE');
});

test('PATCH /api/v1/recipes/:id returns 404 for an unknown id', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(recipeRepository, 'findRawById', async () => null);

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .patch(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ servings: 2 });

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'RECIPE_NOT_FOUND');
});

test('DELETE /api/v1/recipes/:id is forbidden for a normal user', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });

  const response = await request(app)
    .delete(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 403);
});

test('DELETE /api/v1/recipes/:id archives (soft-deletes) for a moderator', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  let archivedId;
  t.mock.method(recipeRepository, 'archiveById', async (id) => {
    archivedId = id;
    return fakeRecipeDoc({ isActive: false });
  });

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .delete(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.recipe.isActive, false);
  assert.equal(archivedId, RECIPE_ID);
});

test('DELETE /api/v1/recipes/:id returns 404 for an unknown id', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(recipeRepository, 'archiveById', async () => null);

  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const response = await request(app)
    .delete(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'RECIPE_NOT_FOUND');
});

test('POST /api/v1/recipes/drafts creates a title-only Draft with server-owned attribution', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  let captured;
  t.mock.method(recipeRepository, 'createRecipe', async (data) => {
    captured = data;
    return fakeRecipeDoc({ ...data, ingredients: [], instructions: [] });
  });
  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });

  const response = await request(app)
    .post('/api/v1/recipes/drafts')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Draft Adobo' });

  assert.equal(response.status, 201);
  assert.equal(captured.publicationStatus, 'draft');
  assert.equal(captured.createdBy, MODERATOR_ID);
  assert.equal(captured.updatedBy, MODERATOR_ID);
  assert.equal(response.body.data.recipe.publicationStatus, 'draft');
});

test('normal User cannot read a Draft by id while staff can inspect it', async (t) => {
  const draft = fakeRecipeDoc({ publicationStatus: 'draft' });
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => draft);

  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const userToken = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const hidden = await request(app)
    .get(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${userToken}`);
  assert.equal(hidden.status, 404);

  // Install a new current identity for the second request after the first
  // test-scoped mock has served its user lookup.
  userRepository.findById.mock.mockImplementation(async () => ({
    _id: MODERATOR_ID,
    role: 'moderator',
    status: 'active',
  }));
  sessionRepository.findActiveById.mock.mockImplementation(async () => ({
    _id: MODERATOR_SESSION_ID,
    userId: MODERATOR_ID,
    revokedAt: null,
  }));
  const moderatorToken = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const visible = await request(app)
    .get(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${moderatorToken}`);
  assert.equal(visible.status, 200);
  assert.equal(visible.body.data.recipe.publicationStatus, 'draft');
});

test('publish requires Filipino confirmation and a Moderator can publish a complete active Draft', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const updatedAt = new Date('2026-09-15T10:00:00.000Z');
  const rawDraft = {
    _id: RECIPE_ID,
    ...validCreatePayload(),
    isActive: true,
    publicationStatus: 'draft',
    updatedAt,
  };
  t.mock.method(recipeRepository, 'findRawById', async () => rawDraft);
  t.mock.method(ingredientRepository, 'findById', async (id) => activeIngredient(id));
  let transition;
  t.mock.method(recipeRepository, 'publishById', async (id, args) => {
    transition = args;
    return fakeRecipeDoc({ publicationStatus: 'published', publishedBy: args.actorId, publishedAt: args.publishedAt });
  });
  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });

  const missing = await request(app)
    .post(`/api/v1/recipes/${RECIPE_ID}/publish`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, 'VALIDATION_ERROR');

  const published = await request(app)
    .post(`/api/v1/recipes/${RECIPE_ID}/publish`)
    .set('Authorization', `Bearer ${token}`)
    .send({ confirmFilipinoCuisine: true, expectedUpdatedAt: updatedAt.toISOString() });
  assert.equal(published.status, 200);
  assert.equal(published.body.data.recipe.publicationStatus, 'published');
  assert.equal(transition.actorId, MODERATOR_ID);
  assert.ok(transition.publishedAt instanceof Date);
});

test('PATCH rejects state/actor mass assignment and returns 409 for a stale precondition', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  for (const body of [
    { publicationStatus: 'published' },
    { isActive: false },
    { createdBy: MODERATOR_ID },
    { updatedBy: MODERATOR_ID },
    { publishedBy: MODERATOR_ID },
    { publishedAt: new Date().toISOString() },
  ]) {
    const rejected = await request(app)
      .patch(`/api/v1/recipes/${RECIPE_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error.code, 'VALIDATION_ERROR');
  }

  t.mock.method(recipeRepository, 'findRawById', async () => ({
    _id: RECIPE_ID,
    updatedAt: new Date('2026-09-16T00:00:00.000Z'),
    publicationStatus: 'draft',
    isActive: true,
    ingredients: [],
    instructions: [],
  }));
  const conflict = await request(app)
    .patch(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Changed', expectedUpdatedAt: '2026-09-15T00:00:00.000Z' });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, 'RECIPE_EDIT_CONFLICT');
});

test('explicit archive/restore preserve Draft state and restore does not require completeness', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  t.mock.method(recipeRepository, 'archiveById', async () => fakeRecipeDoc({ isActive: false, publicationStatus: 'draft' }));
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    _id: RECIPE_ID,
    title: 'Incomplete Draft',
    isActive: false,
    publicationStatus: 'draft',
    ingredients: [],
    instructions: [],
  }));
  t.mock.method(recipeRepository, 'restoreById', async () => fakeRecipeDoc({ isActive: true, publicationStatus: 'draft' }));
  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });

  const archived = await request(app)
    .post(`/api/v1/recipes/${RECIPE_ID}/archive`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  const restored = await request(app)
    .post(`/api/v1/recipes/${RECIPE_ID}/restore`)
    .set('Authorization', `Bearer ${token}`)
    .send({});

  assert.equal(archived.status, 200);
  assert.equal(archived.body.data.recipe.publicationStatus, 'draft');
  assert.equal(archived.body.data.recipe.isActive, false);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.data.recipe.publicationStatus, 'draft');
  assert.equal(restored.body.data.recipe.isActive, true);
});

test('restore returns controlled 409 when the validated snapshot changes before reactivation', async (t) => {
  mockAuth(t, { id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });
  const updatedAt = new Date('2026-09-15T10:00:00.000Z');
  let mutationArgs;
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    _id: RECIPE_ID,
    title: 'Incomplete Draft',
    isActive: false,
    publicationStatus: 'draft',
    ingredients: [],
    instructions: [],
    updatedAt,
  }));
  t.mock.method(recipeRepository, 'restoreById', async (id, args) => {
    mutationArgs = args;
    return null;
  });
  const token = tokenFor({ id: MODERATOR_ID, role: 'moderator', sessionId: MODERATOR_SESSION_ID });

  const response = await request(app)
    .post(`/api/v1/recipes/${RECIPE_ID}/restore`)
    .set('Authorization', `Bearer ${token}`)
    .send({});

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'RECIPE_EDIT_CONFLICT');
  assert.equal(mutationArgs.expectedUpdatedAt, updatedAt.toISOString());
});

test('normal User is denied publish, archive, and restore commands', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const requests = [
    request(app)
      .post(`/api/v1/recipes/${RECIPE_ID}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmFilipinoCuisine: true }),
    request(app)
      .post(`/api/v1/recipes/${RECIPE_ID}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .send({}),
    request(app)
      .post(`/api/v1/recipes/${RECIPE_ID}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .send({}),
  ];
  for (const pending of requests) {
    const response = await pending;
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'FORBIDDEN');
  }
});
