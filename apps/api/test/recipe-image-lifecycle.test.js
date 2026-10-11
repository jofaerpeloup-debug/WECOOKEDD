process.env.NODE_ENV = 'test';
process.env.PORT = '4042';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';

const test = require('node:test');
const assert = require('node:assert/strict');

const Recipe = require('../src/modules/recipes/recipe.model');
const { createRecipeSchema, updateRecipeSchema } = require('../src/modules/recipes/recipe.validation');
const { toPublicRecipe } = require('../src/modules/recipes/recipe.serializer');
const recipeService = require('../src/modules/recipes/recipe.service');
const recipeRepository = require('../src/modules/recipes/recipe.repository');
const ingredientService = require('../src/modules/ingredients/ingredient.service');
const imageProvider = require('../src/modules/uploads/cloudinary-image.provider');

const INGREDIENT_ID = '507f1f77bcf86cd799439011';
const RECIPE_ID = '507f1f77bcf86cd799439099';
const PUBLIC_URL = 'https://images.example.com/cdn/opaque-resource?width=1200';

function createBody(overrides = {}) {
  return {
    title: 'Adobo',
    description: 'A Filipino braised dish.',
    difficulty: 'easy',
    prepTimeMinutes: 10,
    cookTimeMinutes: 30,
    servings: 4,
    ingredients: [{ ingredientId: INGREDIENT_ID, quantity: 1, unit: 'kg' }],
    instructions: ['Cook until tender.'],
    imageUrl: null,
    confirmFilipinoCuisine: true,
    ...overrides,
  };
}

function existing(overrides = {}) {
  return {
    _id: RECIPE_ID,
    isActive: true,
    ingredients: [{ ingredientId: INGREDIENT_ID, quantity: 1, unit: 'kg' }],
    imageUrl: 'https://res.cloudinary.com/demo/image/upload/old.jpg',
    imageAssetId: 'old-asset-id',
    ...overrides,
  };
}

test('manual image URL accepts public and extensionless HTTPS URLs', () => {
  for (const imageUrl of ['https://example.com/image.jpg', PUBLIC_URL]) {
    assert.equal(createRecipeSchema.safeParse({ body: createBody({ imageUrl }) }).success, true);
  }
});

test('manual image URL rejects HTTP, local/private literals, credentials, and non-HTTPS schemes', () => {
  const rejected = [
    'http://example.com/image.jpg',
    'file:///C:/image.jpg',
    'data:image/png;base64,AAAA',
    'javascript:alert(1)',
    'ftp://example.com/image.jpg',
    'https://localhost/image.jpg',
    'https://127.0.0.1/image.jpg',
    'https://192.168.1.10/image.jpg',
    'https://10.0.0.5/image.jpg',
    'https://172.16.0.5/image.jpg',
    'https://[::1]/image.jpg',
    'https://user:password@example.com/image.jpg',
  ];
  for (const imageUrl of rejected) {
    assert.equal(
      createRecipeSchema.safeParse({ body: createBody({ imageUrl }) }).success,
      false,
      `expected ${imageUrl} to be rejected`
    );
  }
});

test('recipe validation rejects managed metadata without a non-null URL', () => {
  assert.equal(
    createRecipeSchema.safeParse({ body: createBody({ imageUrl: null, imageAssetId: 'asset' }) }).success,
    false
  );
  assert.equal(
    updateRecipeSchema.safeParse({
      params: { recipeId: RECIPE_ID },
      body: { imageAssetId: 'asset' },
    }).success,
    false
  );
});

test('old imageUrl-only Recipe remains valid without imageAssetId', async () => {
  const recipe = new Recipe(createBody({ imageUrl: PUBLIC_URL }));
  await assert.doesNotReject(() => recipe.validate());
  assert.equal(recipe.imageAssetId, undefined);
});

test('Recipe model rejects imageAssetId when imageUrl is absent', async () => {
  const recipe = new Recipe(createBody({ imageUrl: null, imageAssetId: 'asset' }));
  await assert.rejects(() => recipe.validate(), /imageAssetId requires imageUrl/);
});

test('serializer exposes imageUrl but never imageAssetId', () => {
  const serialized = toPublicRecipe({
    _id: RECIPE_ID,
    title: 'Adobo', description: 'Dish', difficulty: 'easy',
    prepTimeMinutes: 1, cookTimeMinutes: 1, servings: 1,
    ingredients: [], instructions: ['Cook'], dietaryTags: [],
    imageUrl: PUBLIC_URL, imageAssetId: 'internal-asset', isActive: true,
  });
  assert.equal(serialized.imageUrl, PUBLIC_URL);
  assert.equal('imageAssetId' in serialized, false);
});

test('managed create persists imageUrl and immutable imageAssetId', async (t) => {
  t.mock.method(ingredientService, 'findIngredientById', async () => ({
    _id: INGREDIENT_ID,
    isActive: true,
  }));
  t.mock.method(recipeRepository, 'findDuplicateCandidates', async () => ({
    candidates: [], candidateUniverseCount: 0, comparedCount: 0, truncated: false,
  }));
  let saved;
  t.mock.method(recipeRepository, 'createRecipe', async (data) => { saved = data; return data; });
  await recipeService.createRecipe(createBody({ imageUrl: PUBLIC_URL, imageAssetId: 'new-asset' }));
  assert.equal(saved.imageUrl, PUBLIC_URL);
  assert.equal(saved.imageAssetId, 'new-asset');
});

test('unrelated update and unchanged imageUrl preserve existing imageAssetId', async (t) => {
  t.mock.method(recipeRepository, 'findRawById', async () => existing());
  const updates = [];
  t.mock.method(recipeRepository, 'updateById', async (id, ops) => { updates.push(ops); return existing(); });
  let deletes = 0;
  t.mock.method(imageProvider, 'deleteByAssetId', async () => { deletes += 1; });

  await recipeService.updateRecipe(RECIPE_ID, { title: 'New title' });
  await recipeService.updateRecipe(RECIPE_ID, { imageUrl: existing().imageUrl });

  assert.equal('imageAssetId' in updates[0].$set, false);
  assert.equal('imageAssetId' in updates[1].$set, false);
  assert.equal(deletes, 0);
});

test('managed replacement updates DB before deleting the old managed asset', async (t) => {
  const events = [];
  t.mock.method(recipeRepository, 'findRawById', async () => existing());
  t.mock.method(recipeRepository, 'updateById', async (id, ops) => {
    events.push(['update', ops.$set]);
    return existing({ ...ops.$set });
  });
  t.mock.method(imageProvider, 'deleteByAssetId', async (assetId) => events.push(['delete', assetId]));

  await recipeService.updateRecipe(RECIPE_ID, {
    imageUrl: 'https://res.cloudinary.com/demo/image/upload/new.jpg',
    imageAssetId: 'new-asset-id',
  });

  assert.equal(events[0][0], 'update');
  assert.equal(events[0][1].imageAssetId, 'new-asset-id');
  assert.deepEqual(events[1], ['delete', 'old-asset-id']);
});

test('manual URL replacement clears imageAssetId after DB success', async (t) => {
  const events = [];
  t.mock.method(recipeRepository, 'findRawById', async () => existing());
  t.mock.method(recipeRepository, 'updateById', async (id, ops) => {
    events.push(['update', ops.$set]);
    return existing({ ...ops.$set });
  });
  t.mock.method(imageProvider, 'deleteByAssetId', async (assetId) => events.push(['delete', assetId]));
  await recipeService.updateRecipe(RECIPE_ID, { imageUrl: PUBLIC_URL });
  assert.equal(events[0][1].imageAssetId, null);
  assert.deepEqual(events[1], ['delete', 'old-asset-id']);
});

test('an old external URL is never provider-deleted', async (t) => {
  t.mock.method(recipeRepository, 'findRawById', async () => existing({ imageAssetId: null }));
  t.mock.method(recipeRepository, 'updateById', async () => existing({ imageAssetId: null }));
  let deleted = false;
  t.mock.method(imageProvider, 'deleteByAssetId', async () => { deleted = true; });
  await recipeService.updateRecipe(RECIPE_ID, {
    imageUrl: 'https://images.example.com/replacement',
  });
  assert.equal(deleted, false);
});

test('remove clears imageUrl/imageAssetId, then deletes the old managed asset', async (t) => {
  const events = [];
  t.mock.method(recipeRepository, 'findRawById', async () => existing());
  t.mock.method(recipeRepository, 'updateById', async (id, ops) => {
    events.push(['update', ops.$set]);
    return existing({ ...ops.$set });
  });
  t.mock.method(imageProvider, 'deleteByAssetId', async (assetId) => events.push(['delete', assetId]));
  await recipeService.updateRecipe(RECIPE_ID, { imageUrl: null, imageAssetId: null });
  assert.deepEqual(events[0], ['update', {
    imageUrl: null,
    imageAssetId: null,
    imageUrlIsPublicHttps: false,
    nutritionSourceUrlIsPublicHttps: false,
  }]);
  assert.deepEqual(events[1], ['delete', 'old-asset-id']);
});

test('old managed-asset deletion failure does not roll back successful update', async (t) => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(recipeRepository, 'findRawById', async () => existing());
  const updated = existing({ imageUrl: PUBLIC_URL, imageAssetId: null });
  t.mock.method(recipeRepository, 'updateById', async () => updated);
  t.mock.method(imageProvider, 'deleteByAssetId', async () => { throw new Error('provider detail'); });
  const result = await recipeService.updateRecipe(RECIPE_ID, { imageUrl: PUBLIC_URL });
  assert.equal(result, updated);
});

test('archive retains image metadata and performs no provider deletion', async (t) => {
  const archived = existing({ isActive: false });
  t.mock.method(recipeRepository, 'findRawById', async () => existing());
  t.mock.method(recipeRepository, 'archiveById', async () => archived);
  let deleted = false;
  t.mock.method(imageProvider, 'deleteByAssetId', async () => { deleted = true; });
  const result = await recipeService.archiveRecipe(RECIPE_ID);
  assert.equal(result.imageUrl, archived.imageUrl);
  assert.equal(result.imageAssetId, archived.imageAssetId);
  assert.equal(deleted, false);
});
