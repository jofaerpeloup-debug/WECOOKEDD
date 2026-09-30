process.env.NODE_ENV = 'test';
process.env.PORT = '4034';
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
const collectionRepository = require('../src/modules/collections/collection.repository');
const collectionRecipeRepository = require('../src/modules/collections/collection-recipe.repository');
const { signAccessToken } = require('../src/shared/security/access-token');

const app = createApp();

const USER_ID = '507f1f77bcf86cd799439003';
const USER_SESSION_ID = '507f1f77bcf86cd799439004';
const OTHER_USER_ID = '507f1f77bcf86cd799439005';
const OTHER_SESSION_ID = '507f1f77bcf86cd799439006';
const CHICKEN_ID = '507f1f77bcf86cd799439011';
const RECIPE_ID = '507f1f77bcf86cd799439099';
const COLLECTION_ID = '507f1f77bcf86cd799439033';

function activeIngredient(id, name = 'Ingredient') {
  return { _id: id, name, isActive: true };
}

function fakeRecipeDoc(overrides = {}) {
  return {
    _id: RECIPE_ID,
    title: 'Chicken Adobo',
    description: 'A complete Filipino braised chicken recipe.',
    region: 'central-luzon',
    category: 'dinner',
    difficulty: 'easy',
    prepTimeMinutes: 15,
    cookTimeMinutes: 40,
    servings: 4,
    ingredients: [{ ingredientId: activeIngredient(CHICKEN_ID, 'Chicken'), quantity: 1, unit: 'kg', optional: false }],
    instructions: ['Combine and simmer.'],
    dietaryTags: [],
    imageUrl: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeCollectionDoc(overrides = {}) {
  return {
    _id: COLLECTION_ID,
    userId: USER_ID,
    name: 'My Weeknight Meals',
    description: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function mockAuth(t, { id, role = 'user', sessionId }) {
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: sessionId,
    userId: id,
    revokedAt: null,
  }));
  t.mock.method(userRepository, 'findById', async () => ({ _id: id, role, status: 'active' }));
}

function tokenFor({ id, role = 'user', sessionId }) {
  return signAccessToken({ userId: id, role, sessionId });
}

function authHeader(t, identity) {
  mockAuth(t, identity);
  return `Bearer ${tokenFor(identity)}`;
}

// ---------------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------------

test('GET /api/v1/collections without a token is rejected', async () => {
  const response = await request(app).get('/api/v1/collections');
  assert.equal(response.status, 401);
});

test('POST /api/v1/collections without a token is rejected', async () => {
  const response = await request(app).post('/api/v1/collections').send({ name: 'X' });
  assert.equal(response.status, 401);
});

test('GET /api/v1/collections/:collectionId without a token is rejected', async () => {
  const response = await request(app).get(`/api/v1/collections/${COLLECTION_ID}`);
  assert.equal(response.status, 401);
});

test('PATCH /api/v1/collections/:collectionId without a token is rejected', async () => {
  const response = await request(app).patch(`/api/v1/collections/${COLLECTION_ID}`).send({ name: 'X' });
  assert.equal(response.status, 401);
});

test('DELETE /api/v1/collections/:collectionId without a token is rejected', async () => {
  const response = await request(app).delete(`/api/v1/collections/${COLLECTION_ID}`);
  assert.equal(response.status, 401);
});

test('POST /api/v1/collections/:collectionId/recipes without a token is rejected', async () => {
  const response = await request(app)
    .post(`/api/v1/collections/${COLLECTION_ID}/recipes`)
    .send({ recipeId: RECIPE_ID });
  assert.equal(response.status, 401);
});

test('DELETE /api/v1/collections/:collectionId/recipes/:recipeId without a token is rejected', async () => {
  const response = await request(app).delete(`/api/v1/collections/${COLLECTION_ID}/recipes/${RECIPE_ID}`);
  assert.equal(response.status, 401);
});

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

test('POST /api/v1/collections creates a collection for the authenticated user', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  let capturedDoc;
  t.mock.method(collectionRepository, 'createCollection', async (doc) => {
    capturedDoc = doc;
    return fakeCollectionDoc({ ...doc });
  });

  const response = await request(app)
    .post('/api/v1/collections')
    .set('Authorization', auth)
    .send({ name: 'My Weeknight Meals' });

  assert.equal(response.status, 201);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.collection.name, 'My Weeknight Meals');
  assert.equal(capturedDoc.userId, USER_ID);
});

test('POST /api/v1/collections ignores/rejects a client-supplied userId/ownerId (mass assignment)', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .post('/api/v1/collections')
    .set('Authorization', auth)
    .send({ name: 'Valid', userId: OTHER_USER_ID, ownerId: OTHER_USER_ID });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/collections rejects an empty name', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app).post('/api/v1/collections').set('Authorization', auth).send({ name: '' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/collections rejects a name over the max length', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .post('/api/v1/collections')
    .set('Authorization', auth)
    .send({ name: 'x'.repeat(61) });

  assert.equal(response.status, 400);
});

test('POST /api/v1/collections rejects an unknown sensitive field', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .post('/api/v1/collections')
    .set('Authorization', auth)
    .send({ name: 'Valid', role: 'admin' });

  assert.equal(response.status, 400);
});

// ---------------------------------------------------------------------------
// LIST
// ---------------------------------------------------------------------------

test('GET /api/v1/collections returns only the current user\'s collections with real card data', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  let capturedUserId;
  t.mock.method(collectionRepository, 'findManyByUser', async (userId) => {
    capturedUserId = userId;
    return [fakeCollectionDoc()];
  });
  t.mock.method(collectionRecipeRepository, 'countByFilter', async () => 1);
  t.mock.method(collectionRecipeRepository, 'findRecentRecipeIds', async () => [{ recipeId: RECIPE_ID }]);
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => fakeRecipeDoc());

  const response = await request(app).get('/api/v1/collections').set('Authorization', auth);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.collections.length, 1);
  assert.equal(response.body.data.collections[0].recipeCount, 1);
  assert.deepEqual(response.body.data.collections[0].coverImageUrls, []);
  assert.equal(capturedUserId, USER_ID);
});

test('GET /api/v1/collections never leaks a userId field on each collection', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(collectionRepository, 'findManyByUser', async () => [fakeCollectionDoc()]);
  t.mock.method(collectionRecipeRepository, 'countByFilter', async () => 0);
  t.mock.method(collectionRecipeRepository, 'findRecentRecipeIds', async () => []);

  const response = await request(app).get('/api/v1/collections').set('Authorization', auth);

  assert.equal('userId' in response.body.data.collections[0], false);
});

test('User B never receives User A\'s collections (BOLA)', async (t) => {
  const auth = authHeader(t, { id: OTHER_USER_ID, sessionId: OTHER_SESSION_ID });
  let capturedUserId;
  t.mock.method(collectionRepository, 'findManyByUser', async (userId) => {
    capturedUserId = userId;
    return [];
  });

  const response = await request(app).get('/api/v1/collections').set('Authorization', auth);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.collections, []);
  assert.equal(capturedUserId, OTHER_USER_ID);
  assert.notEqual(capturedUserId, USER_ID);
});

// ---------------------------------------------------------------------------
// GET (owner vs other user, malformed id)
// ---------------------------------------------------------------------------

test('GET /api/v1/collections/:collectionId succeeds for the owner', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(collectionRepository, 'findOwnedById', async () => fakeCollectionDoc());

  const response = await request(app).get(`/api/v1/collections/${COLLECTION_ID}`).set('Authorization', auth);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.collection.id, COLLECTION_ID);
});

test('GET /api/v1/collections/:collectionId returns 404 for another user\'s collection (BOLA, no existence leak)', async (t) => {
  const auth = authHeader(t, { id: OTHER_USER_ID, sessionId: OTHER_SESSION_ID });
  let capturedArgs;
  t.mock.method(collectionRepository, 'findOwnedById', async (id, userId) => {
    capturedArgs = { id, userId };
    return null;
  });

  const response = await request(app).get(`/api/v1/collections/${COLLECTION_ID}`).set('Authorization', auth);

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'COLLECTION_NOT_FOUND');
  assert.deepEqual(capturedArgs, { id: COLLECTION_ID, userId: OTHER_USER_ID });
});

test('GET /api/v1/collections/:collectionId rejects a malformed ObjectId with a controlled 400, never a 500', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app).get('/api/v1/collections/not-an-id').set('Authorization', auth);

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

test('PATCH /api/v1/collections/:collectionId lets the owner update allowed fields', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  let capturedUpdate;
  t.mock.method(collectionRepository, 'updateOwnedById', async (id, userId, update) => {
    capturedUpdate = update;
    return fakeCollectionDoc({ ...update });
  });

  const response = await request(app)
    .patch(`/api/v1/collections/${COLLECTION_ID}`)
    .set('Authorization', auth)
    .send({ name: 'Renamed', description: 'Updated' });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.collection.name, 'Renamed');
  assert.deepEqual(Object.keys(capturedUpdate).sort(), ['description', 'name']);
});

test('PATCH /api/v1/collections/:collectionId denies another user (BOLA)', async (t) => {
  const auth = authHeader(t, { id: OTHER_USER_ID, sessionId: OTHER_SESSION_ID });
  t.mock.method(collectionRepository, 'updateOwnedById', async () => null);

  const response = await request(app)
    .patch(`/api/v1/collections/${COLLECTION_ID}`)
    .set('Authorization', auth)
    .send({ name: 'Hijacked' });

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'COLLECTION_NOT_FOUND');
});

test('PATCH /api/v1/collections/:collectionId rejects userId/ownerId field tampering', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .patch(`/api/v1/collections/${COLLECTION_ID}`)
    .set('Authorization', auth)
    .send({ name: 'Valid', userId: OTHER_USER_ID });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('PATCH /api/v1/collections/:collectionId rejects an empty body', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app).patch(`/api/v1/collections/${COLLECTION_ID}`).set('Authorization', auth).send({});

  assert.equal(response.status, 400);
});

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

test('DELETE /api/v1/collections/:collectionId succeeds for the owner and cleans up membership', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(collectionRepository, 'deleteOwnedById', async () => fakeCollectionDoc());
  let cascadeArg;
  t.mock.method(collectionRecipeRepository, 'deleteAllByCollectionId', async (collectionId) => {
    cascadeArg = collectionId;
    return { deletedCount: 2 };
  });

  const response = await request(app).delete(`/api/v1/collections/${COLLECTION_ID}`).set('Authorization', auth);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, { deleted: true });
  assert.equal(cascadeArg, COLLECTION_ID);
});

test('DELETE /api/v1/collections/:collectionId denies another user and never cascades (BOLA)', async (t) => {
  const auth = authHeader(t, { id: OTHER_USER_ID, sessionId: OTHER_SESSION_ID });
  t.mock.method(collectionRepository, 'deleteOwnedById', async () => null);
  let cascadeCalled = false;
  t.mock.method(collectionRecipeRepository, 'deleteAllByCollectionId', async () => {
    cascadeCalled = true;
    return { deletedCount: 0 };
  });

  const response = await request(app).delete(`/api/v1/collections/${COLLECTION_ID}`).set('Authorization', auth);

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'COLLECTION_NOT_FOUND');
  assert.equal(cascadeCalled, false);
});

// ---------------------------------------------------------------------------
// MEMBERSHIP: list / add / remove
// ---------------------------------------------------------------------------

test('GET /api/v1/collections/:collectionId/recipes returns the owner\'s membership list, paginated', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(collectionRepository, 'findOwnedById', async () => fakeCollectionDoc());
  t.mock.method(collectionRecipeRepository, 'findMany', async () => [
    { _id: 'm1', collectionId: COLLECTION_ID, recipeId: RECIPE_ID, createdAt: new Date() },
  ]);
  t.mock.method(collectionRecipeRepository, 'countByFilter', async () => 1);
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => fakeRecipeDoc());

  const response = await request(app)
    .get(`/api/v1/collections/${COLLECTION_ID}/recipes`)
    .set('Authorization', auth);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.recipes[0].recipe.title, 'Chicken Adobo');
  assert.deepEqual(response.body.data.pagination, { page: 1, limit: 20, total: 1, totalPages: 1 });
});

test('GET /api/v1/collections/:collectionId/recipes denies another user (BOLA)', async (t) => {
  const auth = authHeader(t, { id: OTHER_USER_ID, sessionId: OTHER_SESSION_ID });
  t.mock.method(collectionRepository, 'findOwnedById', async () => null);

  const response = await request(app)
    .get(`/api/v1/collections/${COLLECTION_ID}/recipes`)
    .set('Authorization', auth);

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'COLLECTION_NOT_FOUND');
});

test('POST /api/v1/collections/:collectionId/recipes adds a real recipe to the owner\'s collection', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(collectionRepository, 'findOwnedById', async () => fakeCollectionDoc());
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => fakeRecipeDoc());
  let capturedArgs;
  t.mock.method(collectionRecipeRepository, 'createMembership', async (args) => {
    capturedArgs = args;
    return { _id: 'm1', ...args, createdAt: new Date() };
  });

  const response = await request(app)
    .post(`/api/v1/collections/${COLLECTION_ID}/recipes`)
    .set('Authorization', auth)
    .send({ recipeId: RECIPE_ID });

  assert.equal(response.status, 201);
  assert.equal(response.body.data.recipe.recipe.id, RECIPE_ID);
  assert.deepEqual(capturedArgs, { collectionId: COLLECTION_ID, recipeId: RECIPE_ID });
});

test('POST /api/v1/collections/:collectionId/recipes denies User B adding to User A\'s collection (BOLA)', async (t) => {
  const auth = authHeader(t, { id: OTHER_USER_ID, sessionId: OTHER_SESSION_ID });
  t.mock.method(collectionRepository, 'findOwnedById', async () => null);
  let recipeLookupCalled = false;
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => {
    recipeLookupCalled = true;
    return fakeRecipeDoc();
  });

  const response = await request(app)
    .post(`/api/v1/collections/${COLLECTION_ID}/recipes`)
    .set('Authorization', auth)
    .send({ recipeId: RECIPE_ID });

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'COLLECTION_NOT_FOUND');
  assert.equal(recipeLookupCalled, false);
});

test('POST /api/v1/collections/:collectionId/recipes returns 404 RECIPE_NOT_FOUND for a nonexistent recipe', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(collectionRepository, 'findOwnedById', async () => fakeCollectionDoc());
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => null);

  const response = await request(app)
    .post(`/api/v1/collections/${COLLECTION_ID}/recipes`)
    .set('Authorization', auth)
    .send({ recipeId: RECIPE_ID });

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'RECIPE_NOT_FOUND');
});

test('POST /api/v1/collections/:collectionId/recipes returns 404 RECIPE_NOT_FOUND for an archived recipe', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(collectionRepository, 'findOwnedById', async () => fakeCollectionDoc());
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => fakeRecipeDoc({ isActive: false }));

  const response = await request(app)
    .post(`/api/v1/collections/${COLLECTION_ID}/recipes`)
    .set('Authorization', auth)
    .send({ recipeId: RECIPE_ID });

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'RECIPE_NOT_FOUND');
});

test('POST /api/v1/collections/:collectionId/recipes returns 409 COLLECTION_RECIPE_ALREADY_EXISTS for a duplicate add', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(collectionRepository, 'findOwnedById', async () => fakeCollectionDoc());
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => fakeRecipeDoc());
  t.mock.method(collectionRecipeRepository, 'createMembership', async () => {
    const err = new Error('duplicate key');
    err.code = 11000;
    throw err;
  });

  const response = await request(app)
    .post(`/api/v1/collections/${COLLECTION_ID}/recipes`)
    .set('Authorization', auth)
    .send({ recipeId: RECIPE_ID });

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'COLLECTION_RECIPE_ALREADY_EXISTS');
});

test('POST /api/v1/collections/:collectionId/recipes rejects userId/ownerId tampering in the body', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .post(`/api/v1/collections/${COLLECTION_ID}/recipes`)
    .set('Authorization', auth)
    .send({ recipeId: RECIPE_ID, userId: OTHER_USER_ID });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('DELETE /api/v1/collections/:collectionId/recipes/:recipeId removes the owner\'s membership', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(collectionRepository, 'findOwnedById', async () => fakeCollectionDoc());
  let capturedArgs;
  t.mock.method(collectionRecipeRepository, 'deleteByCollectionAndRecipe', async (collectionId, recipeId) => {
    capturedArgs = { collectionId, recipeId };
    return { _id: 'm1' };
  });

  const response = await request(app)
    .delete(`/api/v1/collections/${COLLECTION_ID}/recipes/${RECIPE_ID}`)
    .set('Authorization', auth);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, { deleted: true });
  assert.deepEqual(capturedArgs, { collectionId: COLLECTION_ID, recipeId: RECIPE_ID });
});

test('DELETE /api/v1/collections/:collectionId/recipes/:recipeId denies User B removing from User A\'s collection (BOLA)', async (t) => {
  const auth = authHeader(t, { id: OTHER_USER_ID, sessionId: OTHER_SESSION_ID });
  t.mock.method(collectionRepository, 'findOwnedById', async () => null);
  let deleteCalled = false;
  t.mock.method(collectionRecipeRepository, 'deleteByCollectionAndRecipe', async () => {
    deleteCalled = true;
    return { _id: 'm1' };
  });

  const response = await request(app)
    .delete(`/api/v1/collections/${COLLECTION_ID}/recipes/${RECIPE_ID}`)
    .set('Authorization', auth);

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'COLLECTION_NOT_FOUND');
  assert.equal(deleteCalled, false);
});

test('DELETE /api/v1/collections/:collectionId/recipes/:recipeId returns 404 when the recipe is not in the collection', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });
  t.mock.method(collectionRepository, 'findOwnedById', async () => fakeCollectionDoc());
  t.mock.method(collectionRecipeRepository, 'deleteByCollectionAndRecipe', async () => null);

  const response = await request(app)
    .delete(`/api/v1/collections/${COLLECTION_ID}/recipes/${RECIPE_ID}`)
    .set('Authorization', auth);

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'COLLECTION_RECIPE_NOT_FOUND');
});

test('DELETE /api/v1/collections/:collectionId/recipes/:recipeId rejects a malformed recipeId with a controlled 400', async (t) => {
  const auth = authHeader(t, { id: USER_ID, sessionId: USER_SESSION_ID });

  const response = await request(app)
    .delete(`/api/v1/collections/${COLLECTION_ID}/recipes/not-an-id`)
    .set('Authorization', auth);

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});
