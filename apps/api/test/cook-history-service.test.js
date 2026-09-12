process.env.NODE_ENV = 'test';
process.env.PORT = '4037';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');

const cookHistoryRepository = require('../src/modules/cook-history/cook-history.repository');
const recipeService = require('../src/modules/recipes/recipe.service');
const cookHistoryService = require('../src/modules/cook-history/cook-history.service');
const { AppError } = require('../src/shared/errors/app-error');

const USER_ID = '507f1f77bcf86cd799439001';
const OTHER_USER_ID = '507f1f77bcf86cd799439002';
const RECIPE_ID = '507f1f77bcf86cd799439099';
const ENTRY_ID = '507f1f77bcf86cd799439044';

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

function fakeEntry(overrides = {}) {
  return {
    _id: ENTRY_ID,
    userId: USER_ID,
    recipeId: RECIPE_ID,
    servings: undefined,
    completedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// recordCompletion
// ---------------------------------------------------------------------------

test('recordCompletion requires an existing/usable recipe before touching the repository', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => null);
  let createCalled = false;
  t.mock.method(cookHistoryRepository, 'create', async () => {
    createCalled = true;
    return fakeEntry();
  });

  await assert.rejects(
    () => cookHistoryService.recordCompletion(USER_ID, { recipeId: RECIPE_ID }),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'RECIPE_NOT_FOUND');
      return true;
    }
  );
  assert.equal(createCalled, false);
});

test('recordCompletion rejects an archived/unusable recipe the same way as a missing one', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => null);

  await assert.rejects(
    () => cookHistoryService.recordCompletion(USER_ID, { recipeId: RECIPE_ID }),
    (err) => {
      assert.equal(err.code, 'RECIPE_NOT_FOUND');
      return true;
    }
  );
});

test('recordCompletion persists with the caller\'s userId, never a client-supplied one', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe());
  let capturedDoc;
  t.mock.method(cookHistoryRepository, 'create', async (doc) => {
    capturedDoc = doc;
    return fakeEntry({ ...doc });
  });

  await cookHistoryService.recordCompletion(USER_ID, { recipeId: RECIPE_ID });

  assert.equal(capturedDoc.userId, USER_ID);
  assert.equal(capturedDoc.recipeId, RECIPE_ID);
  assert.equal('completedAt' in capturedDoc, false);
});

test('recordCompletion omits servings from the persisted doc when not supplied', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe());
  let capturedDoc;
  t.mock.method(cookHistoryRepository, 'create', async (doc) => {
    capturedDoc = doc;
    return fakeEntry({ ...doc });
  });

  await cookHistoryService.recordCompletion(USER_ID, { recipeId: RECIPE_ID, servings: undefined });

  assert.equal('servings' in capturedDoc, false);
});

test('recordCompletion persists the real selected servings when supplied', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe());
  let capturedDoc;
  t.mock.method(cookHistoryRepository, 'create', async (doc) => {
    capturedDoc = doc;
    return fakeEntry({ ...doc });
  });

  await cookHistoryService.recordCompletion(USER_ID, { recipeId: RECIPE_ID, servings: 6 });

  assert.equal(capturedDoc.servings, 6);
});

test('recordCompletion allows a second completion of the same recipe by the same user (repeated cooking)', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe());
  let createCount = 0;
  t.mock.method(cookHistoryRepository, 'create', async (doc) => {
    createCount += 1;
    return fakeEntry({ ...doc, _id: `entry-${createCount}` });
  });

  const first = await cookHistoryService.recordCompletion(USER_ID, { recipeId: RECIPE_ID });
  const second = await cookHistoryService.recordCompletion(USER_ID, { recipeId: RECIPE_ID });

  assert.equal(createCount, 2);
  assert.notEqual(first.entry._id, second.entry._id);
});

test('recordCompletion lets a genuine repository failure propagate as-is, never as RECIPE_NOT_FOUND', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe());
  t.mock.method(cookHistoryRepository, 'create', async () => {
    throw new Error('MongoServerSelectionError: connection timed out');
  });

  await assert.rejects(
    () => cookHistoryService.recordCompletion(USER_ID, { recipeId: RECIPE_ID }),
    (err) => {
      assert.equal(err instanceof AppError, false);
      assert.equal(err.message, 'MongoServerSelectionError: connection timed out');
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// listHistory
// ---------------------------------------------------------------------------

test('listHistory only queries the current user\'s history', async (t) => {
  let capturedFilter;
  t.mock.method(cookHistoryRepository, 'findMany', async ({ filter }) => {
    capturedFilter = filter;
    return [];
  });
  t.mock.method(cookHistoryRepository, 'countByFilter', async () => 0);

  await cookHistoryService.listHistory({ userId: USER_ID, page: 1, limit: 20, sort: 'newest' });

  assert.deepEqual(capturedFilter, { userId: USER_ID });
});

test('listHistory never accepts another user\'s id implicitly (BOLA)', async (t) => {
  let capturedFilter;
  t.mock.method(cookHistoryRepository, 'findMany', async ({ filter }) => {
    capturedFilter = filter;
    return [];
  });
  t.mock.method(cookHistoryRepository, 'countByFilter', async () => 0);

  await cookHistoryService.listHistory({ userId: OTHER_USER_ID, page: 1, limit: 20, sort: 'newest' });

  assert.deepEqual(capturedFilter, { userId: OTHER_USER_ID });
  assert.notEqual(capturedFilter.userId, USER_ID);
});

test('listHistory applies the newest/oldest sort selection by completedAt', async (t) => {
  let capturedSort;
  t.mock.method(cookHistoryRepository, 'findMany', async ({ sort }) => {
    capturedSort = sort;
    return [];
  });
  t.mock.method(cookHistoryRepository, 'countByFilter', async () => 0);

  await cookHistoryService.listHistory({ userId: USER_ID, page: 1, limit: 20, sort: 'oldest' });
  assert.deepEqual(capturedSort, { completedAt: 1 });

  await cookHistoryService.listHistory({ userId: USER_ID, page: 1, limit: 20, sort: 'newest' });
  assert.deepEqual(capturedSort, { completedAt: -1 });
});

test('listHistory resolves each entry\'s recipe through RecipeService and omits unusable ones', async (t) => {
  t.mock.method(cookHistoryRepository, 'findMany', async () => [
    fakeEntry({ _id: 'e1', recipeId: 'r1' }),
    fakeEntry({ _id: 'e2', recipeId: 'r2' }),
  ]);
  t.mock.method(cookHistoryRepository, 'countByFilter', async () => 2);
  t.mock.method(recipeService, 'findUsableRecipeById', async (id) =>
    id === 'r1' ? usableRecipe({ _id: 'r1' }) : null
  );

  const result = await cookHistoryService.listHistory({ userId: USER_ID, page: 1, limit: 20, sort: 'newest' });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].recipe._id, 'r1');
  // Known V1 trade-off, matching Favorites: total reflects the pre-filter count.
  assert.equal(result.total, 2);
});

test('listHistory never deletes the underlying event for an archived recipe — it is only omitted from presentation', async (t) => {
  let deleteCalled = false;
  t.mock.method(cookHistoryRepository, 'findMany', async () => [fakeEntry({ recipeId: 'r1' })]);
  t.mock.method(cookHistoryRepository, 'countByFilter', async () => 1);
  t.mock.method(recipeService, 'findUsableRecipeById', async () => null);
  // No delete method exists on the repository at all — this module is
  // append-only. Asserting its absence guards against ever reintroducing one
  // without a deliberate product decision.
  assert.equal('deleteMany' in cookHistoryRepository, false);
  assert.equal('deleteByUserAndRecipe' in cookHistoryRepository, false);
  deleteCalled = false;

  const result = await cookHistoryService.listHistory({ userId: USER_ID, page: 1, limit: 20, sort: 'newest' });
  assert.equal(result.items.length, 0);
  assert.equal(deleteCalled, false);
});

// ---------------------------------------------------------------------------
// getStats
// ---------------------------------------------------------------------------

test('getStats returns deterministic zeroed stats when the user has no history', async (t) => {
  t.mock.method(cookHistoryRepository, 'aggregateStats', async () => null);

  const stats = await cookHistoryService.getStats(USER_ID);

  assert.deepEqual(stats, { totalCooks: 0, uniqueRecipesCooked: 0 });
});

test('getStats returns the authoritative total cook count', async (t) => {
  t.mock.method(cookHistoryRepository, 'aggregateStats', async () => ({
    totalCooks: 5,
    uniqueRecipesCooked: 3,
  }));

  const stats = await cookHistoryService.getStats(USER_ID);

  assert.equal(stats.totalCooks, 5);
});

test('getStats returns the authoritative unique-recipe count', async (t) => {
  t.mock.method(cookHistoryRepository, 'aggregateStats', async () => ({
    totalCooks: 5,
    uniqueRecipesCooked: 3,
  }));

  const stats = await cookHistoryService.getStats(USER_ID);

  assert.equal(stats.uniqueRecipesCooked, 3);
});

test('getStats: cooking the same recipe repeatedly increases totalCooks but not uniqueRecipesCooked', async (t) => {
  // Simulated by the aggregation layer directly, mirroring what a real
  // { $addToSet } over one recipeId cooked 3 times would produce.
  t.mock.method(cookHistoryRepository, 'aggregateStats', async () => ({
    totalCooks: 3,
    uniqueRecipesCooked: 1,
  }));

  const stats = await cookHistoryService.getStats(USER_ID);

  assert.equal(stats.totalCooks, 3);
  assert.equal(stats.uniqueRecipesCooked, 1);
});

test('getStats scopes to the userId passed in — never a global/other-user aggregate', async (t) => {
  let capturedUserId;
  t.mock.method(cookHistoryRepository, 'aggregateStats', async (userId) => {
    capturedUserId = userId;
    return null;
  });

  await cookHistoryService.getStats(OTHER_USER_ID);

  assert.equal(capturedUserId, OTHER_USER_ID);
});

// ---------------------------------------------------------------------------
// getRecipeStatus (RecipeDetail "Cooked" pill)
// ---------------------------------------------------------------------------

test('getRecipeStatus requires an existing/usable recipe before touching the repository', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => null);
  let existsCalled = false;
  t.mock.method(cookHistoryRepository, 'existsForUserAndRecipe', async () => {
    existsCalled = true;
    return true;
  });

  await assert.rejects(
    () => cookHistoryService.getRecipeStatus(USER_ID, RECIPE_ID),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'RECIPE_NOT_FOUND');
      return true;
    }
  );
  assert.equal(existsCalled, false);
});

test('getRecipeStatus returns hasCooked: false for a never-cooked recipe', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe());
  t.mock.method(cookHistoryRepository, 'existsForUserAndRecipe', async () => false);

  const status = await cookHistoryService.getRecipeStatus(USER_ID, RECIPE_ID);

  assert.deepEqual(status, { hasCooked: false });
});

test('getRecipeStatus returns hasCooked: true once at least one completion exists', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe());
  t.mock.method(cookHistoryRepository, 'existsForUserAndRecipe', async () => true);

  const status = await cookHistoryService.getRecipeStatus(USER_ID, RECIPE_ID);

  assert.deepEqual(status, { hasCooked: true });
});

test('getRecipeStatus queries existence scoped to the caller\'s userId, never another user\'s (BOLA)', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe());
  let capturedUserId;
  t.mock.method(cookHistoryRepository, 'existsForUserAndRecipe', async (userId) => {
    capturedUserId = userId;
    return true;
  });

  await cookHistoryService.getRecipeStatus(OTHER_USER_ID, RECIPE_ID);

  assert.equal(capturedUserId, OTHER_USER_ID);
  assert.notEqual(capturedUserId, USER_ID);
});

test('getRecipeStatus resolves recipeId to the recipe\'s own _id, not the raw param, for the existence query', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe({ _id: 'resolved-id' }));
  let capturedRecipeId;
  t.mock.method(cookHistoryRepository, 'existsForUserAndRecipe', async (userId, recipeId) => {
    capturedRecipeId = recipeId;
    return false;
  });

  await cookHistoryService.getRecipeStatus(USER_ID, RECIPE_ID);

  assert.equal(capturedRecipeId, 'resolved-id');
});
