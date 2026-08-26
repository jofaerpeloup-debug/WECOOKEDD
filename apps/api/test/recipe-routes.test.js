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

const ADMIN_ID = '507f1f77bcf86cd799439001';
const ADMIN_SESSION_ID = '507f1f77bcf86cd799439002';
const USER_ID = '507f1f77bcf86cd799439003';
const USER_SESSION_ID = '507f1f77bcf86cd799439004';
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
    cuisine: 'filipino',
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
    title: 'Chicken Adobo',
    description: 'A classic Filipino chicken dish braised in soy sauce, vinegar, garlic, and spices.',
    cuisine: 'filipino',
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
  t.mock.method(sessionRepository, 'findActiveById', async () => ({
    _id: sessionId,
    userId: id,
    revokedAt: null,
  }));
  t.mock.method(userRepository, 'findById', async () => ({ _id: id, role, status: 'active' }));
}

function tokenFor({ id, role, sessionId }) {
  return signAccessToken({ userId: id, role, sessionId });
}

test('GET /api/v1/recipes without a token is rejected', async () => {
  const response = await request(app).get('/api/v1/recipes');
  assert.equal(response.status, 401);
});

test('GET /api/v1/recipes is readable by an authenticated non-admin user', async (t) => {
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

test('GET /api/v1/recipes?status=all is rejected for a non-admin user', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });

  const response = await request(app).get('/api/v1/recipes?status=all').set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 403);
});

test('GET /api/v1/recipes?status=inactive is allowed for an admin', async (t) => {
  mockAuth(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  t.mock.method(recipeRepository, 'findMany', async () => [fakeRecipeDoc({ isActive: false })]);
  t.mock.method(recipeRepository, 'countByFilter', async () => 1);

  const token = tokenFor({ id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  const response = await request(app)
    .get('/api/v1/recipes?status=inactive')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.recipes[0].isActive, false);
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

test('GET /api/v1/recipes?cuisine=filipino&maxPrepTimeMinutes=20 is applied as filters', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  let capturedFilter;
  t.mock.method(recipeRepository, 'findMany', async ({ filter }) => {
    capturedFilter = filter;
    return [];
  });
  t.mock.method(recipeRepository, 'countByFilter', async () => 0);

  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const response = await request(app)
    .get('/api/v1/recipes?cuisine=filipino&maxPrepTimeMinutes=20')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(capturedFilter.cuisine, 'filipino');
  assert.deepEqual(capturedFilter.prepTimeMinutes, { $lte: 20 });
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

test('GET /api/v1/recipes/:id returns 404 for a non-admin when the recipe is archived', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () => fakeRecipeDoc({ isActive: false }));

  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const response = await request(app)
    .get(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'RECIPE_NOT_FOUND');
});

test('GET /api/v1/recipes/:id returns 404 for a non-admin when a required ingredient is archived (no cascade, filtered at read time)', async (t) => {
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

test('GET /api/v1/recipes/:id still allows an admin to inspect it when a required ingredient is archived', async (t) => {
  mockAuth(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () =>
    fakeRecipeDoc({
      ingredients: [
        { ingredientId: inactiveIngredient(CHICKEN_ID, 'Chicken'), quantity: 1, unit: 'kg', optional: false },
      ],
    })
  );

  const token = tokenFor({ id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
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

test('GET /api/v1/recipes/:id shows an admin the complete ingredient relationship, including an archived optional entry', async (t) => {
  mockAuth(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  t.mock.method(recipeRepository, 'findByIdWithIngredients', async () =>
    fakeRecipeDoc({
      ingredients: [
        { ingredientId: activeIngredient(CHICKEN_ID, 'Chicken'), quantity: 1, unit: 'kg', optional: false },
        { ingredientId: inactiveIngredient(GARLIC_ID, 'Garlic'), quantity: 1, unit: 'clove', optional: true },
      ],
    })
  );

  const token = tokenFor({ id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
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

test('POST /api/v1/recipes is forbidden for a non-admin user', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });

  const response = await request(app)
    .post('/api/v1/recipes')
    .set('Authorization', `Bearer ${token}`)
    .send(validCreatePayload());

  assert.equal(response.status, 403);
});

test('POST /api/v1/recipes creates a recipe for an admin when every ingredient is active', async (t) => {
  mockAuth(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  t.mock.method(ingredientRepository, 'findById', async (id) =>
    activeIngredient(id, id === CHICKEN_ID ? 'Chicken' : 'Garlic')
  );
  t.mock.method(recipeRepository, 'createRecipe', async (data) =>
    fakeRecipeDoc({
      ...data,
      ingredients: data.ingredients.map((entry) => ({
        ...entry,
        ingredientId: activeIngredient(entry.ingredientId, entry.ingredientId === CHICKEN_ID ? 'Chicken' : 'Garlic'),
      })),
    })
  );

  const token = tokenFor({ id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  const response = await request(app)
    .post('/api/v1/recipes')
    .set('Authorization', `Bearer ${token}`)
    .send(validCreatePayload());

  assert.equal(response.status, 201);
  assert.equal(response.body.data.recipe.title, 'Chicken Adobo');
  assert.equal(response.body.data.recipe.ingredients[0].ingredient.name, 'Chicken');
});

test('POST /api/v1/recipes rejects a request referencing a nonexistent ingredient', async (t) => {
  mockAuth(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  t.mock.method(ingredientRepository, 'findById', async () => null);

  const token = tokenFor({ id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  const response = await request(app)
    .post('/api/v1/recipes')
    .set('Authorization', `Bearer ${token}`)
    .send(validCreatePayload());

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'RECIPE_INGREDIENT_NOT_FOUND');
});

test('POST /api/v1/recipes rejects a request referencing an inactive ingredient', async (t) => {
  mockAuth(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  t.mock.method(ingredientRepository, 'findById', async (id) => ({ _id: id, name: 'X', isActive: false }));

  const token = tokenFor({ id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  const response = await request(app)
    .post('/api/v1/recipes')
    .set('Authorization', `Bearer ${token}`)
    .send(validCreatePayload());

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'RECIPE_INGREDIENT_INACTIVE');
});

test('POST /api/v1/recipes rejects unit "toTaste" combined with a quantity before the service runs', async (t) => {
  mockAuth(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  const token = tokenFor({ id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });

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
  mockAuth(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  t.mock.method(ingredientRepository, 'findById', async (id) => activeIngredient(id, 'Salt'));
  t.mock.method(recipeRepository, 'createRecipe', async (data) =>
    fakeRecipeDoc({
      ...data,
      ingredients: data.ingredients.map((entry) => ({ ...entry, ingredientId: activeIngredient(entry.ingredientId, 'Salt') })),
    })
  );

  const token = tokenFor({ id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
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

test('POST /api/v1/recipes rejects unknown top-level fields', async (t) => {
  mockAuth(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  const token = tokenFor({ id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });

  const response = await request(app)
    .post('/api/v1/recipes')
    .set('Authorization', `Bearer ${token}`)
    .send(validCreatePayload({ notAField: true }));

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('PATCH /api/v1/recipes/:id is forbidden for a non-admin user', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });

  const response = await request(app)
    .patch(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ servings: 6 });

  assert.equal(response.status, 403);
});

test('PATCH /api/v1/recipes/:id applies a partial update for an admin', async (t) => {
  mockAuth(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    _id: RECIPE_ID,
    isActive: true,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', optional: false }],
  }));
  t.mock.method(recipeRepository, 'updateById', async (id, update) =>
    fakeRecipeDoc({ servings: update.$set.servings })
  );

  const token = tokenFor({ id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  const response = await request(app)
    .patch(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ servings: 6 });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.recipe.servings, 6);
});

test('PATCH /api/v1/recipes/:id rejects an empty body', async (t) => {
  mockAuth(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  const token = tokenFor({ id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });

  const response = await request(app)
    .patch(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({});

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

test('PATCH /api/v1/recipes/:id replaces the ingredients array and validates it via IngredientService', async (t) => {
  mockAuth(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    _id: RECIPE_ID,
    isActive: true,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', optional: false }],
  }));
  t.mock.method(ingredientRepository, 'findById', async () => null);

  const token = tokenFor({ id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  const response = await request(app)
    .patch(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ ingredients: [{ ingredientId: GARLIC_ID, quantity: 2, unit: 'clove' }] });

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'RECIPE_INGREDIENT_NOT_FOUND');
});

function patchIngredientsWith(t, entry) {
  mockAuth(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
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

  const token = tokenFor({ id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
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

test('PATCH /api/v1/recipes/:id reactivation is rejected when a stored ingredient is inactive', async (t) => {
  mockAuth(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  t.mock.method(recipeRepository, 'findRawById', async () => ({
    _id: RECIPE_ID,
    isActive: false,
    ingredients: [{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'kg', optional: false }],
  }));
  t.mock.method(ingredientRepository, 'findById', async (id) => ({ _id: id, name: 'X', isActive: false }));

  const token = tokenFor({ id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  const response = await request(app)
    .patch(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ isActive: true });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'RECIPE_INGREDIENT_INACTIVE');
});

test('PATCH /api/v1/recipes/:id returns 404 for an unknown id', async (t) => {
  mockAuth(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  t.mock.method(recipeRepository, 'findRawById', async () => null);

  const token = tokenFor({ id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  const response = await request(app)
    .patch(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ servings: 2 });

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'RECIPE_NOT_FOUND');
});

test('DELETE /api/v1/recipes/:id is forbidden for a non-admin user', async (t) => {
  mockAuth(t, { id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });
  const token = tokenFor({ id: USER_ID, role: 'user', sessionId: USER_SESSION_ID });

  const response = await request(app)
    .delete(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 403);
});

test('DELETE /api/v1/recipes/:id archives (soft-deletes) for an admin', async (t) => {
  mockAuth(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  let archivedId;
  t.mock.method(recipeRepository, 'archiveById', async (id) => {
    archivedId = id;
    return fakeRecipeDoc({ isActive: false });
  });

  const token = tokenFor({ id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  const response = await request(app)
    .delete(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.recipe.isActive, false);
  assert.equal(archivedId, RECIPE_ID);
});

test('DELETE /api/v1/recipes/:id returns 404 for an unknown id', async (t) => {
  mockAuth(t, { id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  t.mock.method(recipeRepository, 'archiveById', async () => null);

  const token = tokenFor({ id: ADMIN_ID, role: 'admin', sessionId: ADMIN_SESSION_ID });
  const response = await request(app)
    .delete(`/api/v1/recipes/${RECIPE_ID}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'RECIPE_NOT_FOUND');
});