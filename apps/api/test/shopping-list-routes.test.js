process.env.NODE_ENV = 'test';
process.env.PORT = '4033';
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
const shoppingListRepository = require('../src/modules/shopping-lists/shopping-list.repository');
const ShoppingList = require('../src/modules/shopping-lists/shopping-list.model');
const { signAccessToken } = require('../src/shared/security/access-token');

const app = createApp();

const USER_ID = '507f1f77bcf86cd799439003';
const USER_SESSION_ID = '507f1f77bcf86cd799439004';
const CHICKEN_ID = '507f1f77bcf86cd799439011';
const GARLIC_ID = '507f1f77bcf86cd799439012';
const RECIPE_ID = '507f1f77bcf86cd799439099';

function buildList(items = []) {
  return new ShoppingList({ userId: USER_ID, items });
}

function activeIngredientDoc(id, name = 'Ingredient') {
  return { _id: id, name, isActive: true };
}

function mockAuth(t) {
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: USER_SESSION_ID,
    userId: USER_ID,
    revokedAt: null,
  }));
  t.mock.method(userRepository, 'findById', async () => ({ _id: USER_ID, role: 'user', status: 'active' }));
}

function token() {
  return signAccessToken({ userId: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
}

function mockNoSave(t) {
  t.mock.method(shoppingListRepository, 'save', async (list) => list);
}

function mockIngredientActive(t, name = 'Chicken') {
  t.mock.method(ingredientRepository, 'findById', async (lookupId) => activeIngredientDoc(lookupId, name));
}

for (const [method, path] of [
  ['get', '/api/v1/shopping-list'],
  ['post', '/api/v1/shopping-list/items'],
  ['patch', `/api/v1/shopping-list/items/${CHICKEN_ID}`],
  ['delete', `/api/v1/shopping-list/items/${CHICKEN_ID}`],
  ['delete', '/api/v1/shopping-list/items'],
  ['post', `/api/v1/shopping-list/recipes/${RECIPE_ID}`],
]) {
  test(`${method.toUpperCase()} ${path} without a token is rejected`, async () => {
    const response = await request(app)[method](path);
    assert.equal(response.status, 401);
  });
}

test('GET /api/v1/shopping-list lazily creates and returns the current user\'s list', async (t) => {
  mockAuth(t);
  let capturedUserId;
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async (userId) => {
    capturedUserId = userId;
    return buildList();
  });

  const response = await request(app).get('/api/v1/shopping-list').set('Authorization', `Bearer ${token()}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.deepEqual(response.body.data.shoppingList.items, []);
  assert.equal(capturedUserId, USER_ID);
});

test('GET /api/v1/shopping-list surfaces an unexpected IngredientService/database failure as a generic 500, not a stale item', async (t) => {
  mockAuth(t);
  const list = buildList([{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg' }]);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  t.mock.method(ingredientRepository, 'findById', async () => {
    throw new Error('MongoServerSelectionError: connection timed out');
  });

  const response = await request(app).get('/api/v1/shopping-list').set('Authorization', `Bearer ${token()}`);

  assert.equal(response.status, 500);
  assert.equal(response.body.error.code, 'INTERNAL_SERVER_ERROR');
  assert.equal(/connection timed out/i.test(JSON.stringify(response.body)), false);
});

test('GET /api/v1/shopping-list never leaks userId or __v', async (t) => {
  mockAuth(t);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => buildList());

  const response = await request(app).get('/api/v1/shopping-list').set('Authorization', `Bearer ${token()}`);

  assert.equal('userId' in response.body.data.shoppingList, false);
  assert.equal('__v' in response.body.data.shoppingList, false);
});

test('POST /api/v1/shopping-list/items adds a manual item for an active ingredient', async (t) => {
  mockAuth(t);
  mockIngredientActive(t);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => buildList());
  mockNoSave(t);

  const response = await request(app)
    .post('/api/v1/shopping-list/items')
    .set('Authorization', `Bearer ${token()}`)
    .send({ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg' });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.shoppingList.items.length, 1);
  assert.equal(response.body.data.shoppingList.items[0].ingredient.name, 'Chicken');
  assert.equal(response.body.data.shoppingList.items[0].isAvailable, true);
});

test('POST /api/v1/shopping-list/items merges into an existing same-ingredient+same-unit item', async (t) => {
  mockAuth(t);
  mockIngredientActive(t, 'Garlic');
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () =>
    buildList([{ ingredientId: GARLIC_ID, quantity: 3, unit: 'clove' }])
  );
  mockNoSave(t);

  const response = await request(app)
    .post('/api/v1/shopping-list/items')
    .set('Authorization', `Bearer ${token()}`)
    .send({ ingredientId: GARLIC_ID, quantity: 2, unit: 'clove' });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.shoppingList.items.length, 1);
  assert.equal(response.body.data.shoppingList.items[0].quantity, 5);
});

test('POST /api/v1/shopping-list/items returns 404 INGREDIENT_NOT_FOUND for an unknown ingredient', async (t) => {
  mockAuth(t);
  t.mock.method(ingredientRepository, 'findById', async () => null);

  const response = await request(app)
    .post('/api/v1/shopping-list/items')
    .set('Authorization', `Bearer ${token()}`)
    .send({ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg' });

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'INGREDIENT_NOT_FOUND');
});

test('POST /api/v1/shopping-list/items returns 400 INGREDIENT_INACTIVE for an archived ingredient', async (t) => {
  mockAuth(t);
  t.mock.method(ingredientRepository, 'findById', async (id) => ({ _id: id, name: 'X', isActive: false }));

  const response = await request(app)
    .post('/api/v1/shopping-list/items')
    .set('Authorization', `Bearer ${token()}`)
    .send({ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'INGREDIENT_INACTIVE');
});

test('POST /api/v1/shopping-list/items rejects a toTaste item that also supplies a quantity', async (t) => {
  mockAuth(t);

  const response = await request(app)
    .post('/api/v1/shopping-list/items')
    .set('Authorization', `Bearer ${token()}`)
    .send({ ingredientId: CHICKEN_ID, quantity: 1, unit: 'toTaste' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/shopping-list/items ignores a client-supplied userId (rejected as an unknown field)', async (t) => {
  mockAuth(t);
  mockIngredientActive(t);

  const response = await request(app)
    .post('/api/v1/shopping-list/items')
    .set('Authorization', `Bearer ${token()}`)
    .send({ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', userId: '507f1f77bcf86cd799439fff' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('PATCH /api/v1/shopping-list/items/:itemId updates quantity', async (t) => {
  mockAuth(t);
  mockIngredientActive(t);
  const list = buildList([{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg' }]);
  const itemId = String(list.items[0]._id);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  mockNoSave(t);

  const response = await request(app)
    .patch(`/api/v1/shopping-list/items/${itemId}`)
    .set('Authorization', `Bearer ${token()}`)
    .send({ quantity: 4 });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.shoppingList.items[0].quantity, 4);
});

test('PATCH /api/v1/shopping-list/items/:itemId allows switching to toTaste when quantity is explicitly cleared', async (t) => {
  mockAuth(t);
  mockIngredientActive(t);
  const list = buildList([{ ingredientId: CHICKEN_ID, quantity: 2, unit: 'piece' }]);
  const itemId = String(list.items[0]._id);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  mockNoSave(t);

  const response = await request(app)
    .patch(`/api/v1/shopping-list/items/${itemId}`)
    .set('Authorization', `Bearer ${token()}`)
    .send({ unit: 'toTaste', quantity: null });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.shoppingList.items[0].unit, 'toTaste');
  assert.equal(response.body.data.shoppingList.items[0].quantity, null);
});

test('PATCH /api/v1/shopping-list/items/:itemId rejects switching to toTaste without clearing quantity', async (t) => {
  mockAuth(t);
  mockIngredientActive(t);
  const list = buildList([{ ingredientId: CHICKEN_ID, quantity: 2, unit: 'piece' }]);
  const itemId = String(list.items[0]._id);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  mockNoSave(t);

  const response = await request(app)
    .patch(`/api/v1/shopping-list/items/${itemId}`)
    .set('Authorization', `Bearer ${token()}`)
    .send({ unit: 'toTaste' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('PATCH /api/v1/shopping-list/items/:itemId rejects an empty body', async (t) => {
  mockAuth(t);
  const response = await request(app)
    .patch(`/api/v1/shopping-list/items/${CHICKEN_ID}`)
    .set('Authorization', `Bearer ${token()}`)
    .send({});

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('PATCH /api/v1/shopping-list/items/:itemId returns 404 for a missing item', async (t) => {
  mockAuth(t);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => buildList());

  const response = await request(app)
    .patch(`/api/v1/shopping-list/items/${CHICKEN_ID}`)
    .set('Authorization', `Bearer ${token()}`)
    .send({ isChecked: true });

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'SHOPPING_LIST_ITEM_NOT_FOUND');
});

test('PATCH /api/v1/shopping-list/items/:itemId returns 409 on a unit collision', async (t) => {
  mockAuth(t);
  const list = buildList([
    { ingredientId: GARLIC_ID, quantity: 2, unit: 'piece' },
    { ingredientId: GARLIC_ID, quantity: 3, unit: 'clove' },
  ]);
  const cloveItemId = String(list.items[1]._id);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  mockNoSave(t);

  const response = await request(app)
    .patch(`/api/v1/shopping-list/items/${cloveItemId}`)
    .set('Authorization', `Bearer ${token()}`)
    .send({ unit: 'piece' });

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'SHOPPING_LIST_ITEM_ALREADY_EXISTS');
});

test('PATCH /api/v1/shopping-list/items/:itemId rejects a collision the other direction too (Garlic 2 clove + Garlic 1 piece, patch piece -> clove)', async (t) => {
  mockAuth(t);
  const list = buildList([
    { ingredientId: GARLIC_ID, quantity: 2, unit: 'clove' },
    { ingredientId: GARLIC_ID, quantity: 1, unit: 'piece' },
  ]);
  const pieceItemId = String(list.items[1]._id);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  mockNoSave(t);

  const response = await request(app)
    .patch(`/api/v1/shopping-list/items/${pieceItemId}`)
    .set('Authorization', `Bearer ${token()}`)
    .send({ unit: 'clove' });

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'SHOPPING_LIST_ITEM_ALREADY_EXISTS');
  // Rejected, not silently merged — the list must still have two items.
  assert.equal(response.body.data, undefined);
});

test('DELETE /api/v1/shopping-list/items/:itemId removes the item', async (t) => {
  mockAuth(t);
  const list = buildList([{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg' }]);
  const itemId = String(list.items[0]._id);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  mockNoSave(t);

  const response = await request(app)
    .delete(`/api/v1/shopping-list/items/${itemId}`)
    .set('Authorization', `Bearer ${token()}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.shoppingList.items.length, 0);
});

test('DELETE /api/v1/shopping-list/items/:itemId returns 404 for a missing item', async (t) => {
  mockAuth(t);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => buildList());

  const response = await request(app)
    .delete(`/api/v1/shopping-list/items/${CHICKEN_ID}`)
    .set('Authorization', `Bearer ${token()}`);

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'SHOPPING_LIST_ITEM_NOT_FOUND');
});

test('DELETE /api/v1/shopping-list/items/:itemId still works when the item\'s ingredient is stale', async (t) => {
  mockAuth(t);
  const list = buildList([{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg' }]);
  const itemId = String(list.items[0]._id);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  t.mock.method(ingredientRepository, 'findById', async () => null);
  mockNoSave(t);

  const response = await request(app)
    .delete(`/api/v1/shopping-list/items/${itemId}`)
    .set('Authorization', `Bearer ${token()}`);

  assert.equal(response.status, 200);
});

test('DELETE /api/v1/shopping-list/items clears every item for the current user', async (t) => {
  mockAuth(t);
  const list = buildList([
    { ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg' },
    { ingredientId: GARLIC_ID, quantity: 2, unit: 'clove' },
  ]);
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => list);
  mockNoSave(t);

  const response = await request(app)
    .delete('/api/v1/shopping-list/items')
    .set('Authorization', `Bearer ${token()}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.shoppingList.items.length, 0);
});

test('POST /api/v1/shopping-list/recipes/:recipeId imports the recipe\'s usable ingredients', async (t) => {
  mockAuth(t);
  mockIngredientActive(t, 'Chicken');
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => ({
    _id: RECIPE_ID,
    isActive: true,
    ingredients: [
      { ingredientId: activeIngredientDoc(CHICKEN_ID, 'Chicken'), quantity: 1, unit: 'kg', optional: false },
    ],
  }));
  t.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => buildList());
  mockNoSave(t);

  const response = await request(app)
    .post(`/api/v1/shopping-list/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token()}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.shoppingList.items.length, 1);
  assert.equal(response.body.data.shoppingList.items[0].quantity, 1);
});

test('POST /api/v1/shopping-list/recipes/:recipeId returns 404 RECIPE_NOT_FOUND for an archived recipe', async (t) => {
  mockAuth(t);
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => ({
    _id: RECIPE_ID,
    isActive: false,
    ingredients: [],
  }));

  const response = await request(app)
    .post(`/api/v1/shopping-list/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token()}`);

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'RECIPE_NOT_FOUND');
});

test('POST /api/v1/shopping-list/recipes/:recipeId rejects an invalid ObjectId param', async (t) => {
  mockAuth(t);

  const response = await request(app)
    .post('/api/v1/shopping-list/recipes/not-an-id')
    .set('Authorization', `Bearer ${token()}`);

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});