process.env.NODE_ENV = 'test';
process.env.PORT = '4030';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');

const favoriteRepository = require('../src/modules/favorites/favorite.repository');
const recipeService = require('../src/modules/recipes/recipe.service');
const favoriteService = require('../src/modules/favorites/favorite.service');
const { AppError } = require('../src/shared/errors/app-error');

const USER_ID = '507f1f77bcf86cd799439001';
const OTHER_USER_ID = '507f1f77bcf86cd799439002';
const RECIPE_ID = '507f1f77bcf86cd799439099';

function usableRecipe(overrides = {}) {
  return {
    _id: RECIPE_ID,
    title: 'Chicken Adobo',
    region: 'central-luzon',
    category: 'main-dish',
    difficulty: 'easy',
    prepTimeMinutes: 15,
    cookTimeMinutes: 40,
    imageUrl: null,
    ...overrides,
  };
}

test('addFavorite resolves the recipe through RecipeService and persists a favorite', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe());
  let capturedArgs;
  t.mock.method(favoriteRepository, 'createFavorite', async (args) => {
    capturedArgs = args;
    return { _id: 'fav1', ...args, createdAt: new Date() };
  });

  const result = await favoriteService.addFavorite(USER_ID, RECIPE_ID);

  assert.equal(capturedArgs.userId, USER_ID);
  assert.equal(capturedArgs.recipeId, RECIPE_ID);
  assert.equal(result.recipe.title, 'Chicken Adobo');
  assert.equal(result.favorite._id, 'fav1');
});

test('addFavorite rejects with RECIPE_NOT_FOUND when the recipe does not exist', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => null);

  await assert.rejects(
    () => favoriteService.addFavorite(USER_ID, RECIPE_ID),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'RECIPE_NOT_FOUND');
      return true;
    }
  );
});

test('addFavorite rejects an archived/unusable recipe the same way as a missing one', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => null);

  await assert.rejects(
    () => favoriteService.addFavorite(USER_ID, RECIPE_ID),
    (err) => {
      assert.equal(err.code, 'RECIPE_NOT_FOUND');
      return true;
    }
  );
});

test('addFavorite propagates an unexpected RecipeService/database failure as-is, never as RECIPE_NOT_FOUND', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => {
    throw new Error('MongoServerSelectionError: connection timed out');
  });

  await assert.rejects(
    () => favoriteService.addFavorite(USER_ID, RECIPE_ID),
    (err) => {
      // A genuine infra failure must reach the caller as-is — never
      // silently reinterpreted as "recipe unavailable".
      assert.equal(err instanceof AppError, false);
      assert.equal(err.message, 'MongoServerSelectionError: connection timed out');
      return true;
    }
  );
});

test('addFavorite translates a duplicate-key error into a stable FAVORITE_ALREADY_EXISTS with no raw Mongo details leaked', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe());
  t.mock.method(favoriteRepository, 'createFavorite', async () => {
    const err = new Error(
      'E11000 duplicate key error collection: wecooked.favorites index: userId_1_recipeId_1 dup key: { userId: ObjectId(...), recipeId: ObjectId(...) }'
    );
    err.code = 11000;
    throw err;
  });

  await assert.rejects(
    () => favoriteService.addFavorite(USER_ID, RECIPE_ID),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, 'FAVORITE_ALREADY_EXISTS');
      // The raw driver error text (E11000, collection/index names) must
      // never surface in the AppError handed back to the caller.
      assert.equal(err.message, 'This recipe is already in your favorites.');
      assert.equal(/E11000|collection|index/i.test(err.message), false);
      assert.equal(err.details, undefined);
      return true;
    }
  );
});

test('addFavorite rethrows an unrelated repository error as-is', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe());
  t.mock.method(favoriteRepository, 'createFavorite', async () => {
    throw new Error('boom');
  });

  await assert.rejects(() => favoriteService.addFavorite(USER_ID, RECIPE_ID), /boom/);
});

test('listFavorites only queries the current user\'s favorites', async (t) => {
  let capturedFilter;
  t.mock.method(favoriteRepository, 'findMany', async ({ filter }) => {
    capturedFilter = filter;
    return [];
  });
  t.mock.method(favoriteRepository, 'countByFilter', async () => 0);

  await favoriteService.listFavorites({ userId: USER_ID, page: 1, limit: 20, sort: 'newest' });

  assert.deepEqual(capturedFilter, { userId: USER_ID });
});

test('listFavorites resolves each favorite\'s recipe through RecipeService and omits unusable ones', async (t) => {
  t.mock.method(favoriteRepository, 'findMany', async () => [
    { _id: 'fav1', userId: USER_ID, recipeId: 'r1', createdAt: new Date() },
    { _id: 'fav2', userId: USER_ID, recipeId: 'r2', createdAt: new Date() },
  ]);
  t.mock.method(favoriteRepository, 'countByFilter', async () => 2);
  t.mock.method(recipeService, 'findUsableRecipeById', async (id) =>
    id === 'r1' ? usableRecipe({ _id: 'r1' }) : null
  );

  const result = await favoriteService.listFavorites({ userId: USER_ID, page: 1, limit: 20, sort: 'newest' });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].recipe._id, 'r1');
  // Known V1 trade-off: total reflects the pre-filter Favorite count.
  assert.equal(result.total, 2);
});

test('listFavorites propagates an unexpected RecipeService/database failure instead of silently omitting the favorite', async (t) => {
  t.mock.method(favoriteRepository, 'findMany', async () => [
    { _id: 'fav1', userId: USER_ID, recipeId: 'r1', createdAt: new Date() },
  ]);
  t.mock.method(favoriteRepository, 'countByFilter', async () => 1);
  t.mock.method(recipeService, 'findUsableRecipeById', async () => {
    throw new Error('mongo timeout');
  });

  await assert.rejects(
    () => favoriteService.listFavorites({ userId: USER_ID, page: 1, limit: 20, sort: 'newest' }),
    (err) => {
      assert.equal(err instanceof AppError, false);
      assert.equal(err.message, 'mongo timeout');
      return true;
    }
  );
});

test('listFavorites applies the newest/oldest sort selection', async (t) => {
  let capturedSort;
  t.mock.method(favoriteRepository, 'findMany', async ({ sort }) => {
    capturedSort = sort;
    return [];
  });
  t.mock.method(favoriteRepository, 'countByFilter', async () => 0);

  await favoriteService.listFavorites({ userId: USER_ID, page: 1, limit: 20, sort: 'oldest' });
  assert.deepEqual(capturedSort, { createdAt: 1 });

  await favoriteService.listFavorites({ userId: USER_ID, page: 1, limit: 20, sort: 'newest' });
  assert.deepEqual(capturedSort, { createdAt: -1 });
});

test('removeFavorite deletes the current user\'s favorite for the given recipe', async (t) => {
  let capturedArgs;
  t.mock.method(favoriteRepository, 'deleteByUserAndRecipe', async (userId, recipeId) => {
    capturedArgs = { userId, recipeId };
    return { _id: 'fav1' };
  });

  await favoriteService.removeFavorite(USER_ID, RECIPE_ID);

  assert.deepEqual(capturedArgs, { userId: USER_ID, recipeId: RECIPE_ID });
});

test('removeFavorite throws FAVORITE_NOT_FOUND when the current user has no such favorite', async (t) => {
  t.mock.method(favoriteRepository, 'deleteByUserAndRecipe', async () => null);

  await assert.rejects(
    () => favoriteService.removeFavorite(USER_ID, RECIPE_ID),
    (err) => {
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'FAVORITE_NOT_FOUND');
      return true;
    }
  );
});

test('removeFavorite still succeeds even if the referenced Recipe has since become archived/unavailable', async (t) => {
  // removeFavorite never calls RecipeService at all — deletion only touches
  // the Favorite collection, so an unusable/missing recipe can't block it.
  let recipeServiceCalled = false;
  t.mock.method(recipeService, 'findUsableRecipeById', async () => {
    recipeServiceCalled = true;
    return null;
  });
  t.mock.method(favoriteRepository, 'deleteByUserAndRecipe', async () => ({ _id: 'fav1' }));

  await favoriteService.removeFavorite(USER_ID, RECIPE_ID);
  assert.equal(recipeServiceCalled, false);
});

test('removeFavorite never accepts another user\'s ownership implicitly', async (t) => {
  let capturedUserId;
  t.mock.method(favoriteRepository, 'deleteByUserAndRecipe', async (userId) => {
    capturedUserId = userId;
    return { _id: 'fav1' };
  });

  await favoriteService.removeFavorite(USER_ID, RECIPE_ID);
  assert.equal(capturedUserId, USER_ID);
  assert.notEqual(capturedUserId, OTHER_USER_ID);
});