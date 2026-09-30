process.env.NODE_ENV = 'test';
process.env.PORT = '4033';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');

const collectionRepository = require('../src/modules/collections/collection.repository');
const collectionRecipeRepository = require('../src/modules/collections/collection-recipe.repository');
const recipeService = require('../src/modules/recipes/recipe.service');
const collectionService = require('../src/modules/collections/collection.service');
const { AppError } = require('../src/shared/errors/app-error');

const USER_ID = '507f1f77bcf86cd799439001';
const OTHER_USER_ID = '507f1f77bcf86cd799439002';
const COLLECTION_ID = '507f1f77bcf86cd799439033';
const RECIPE_ID = '507f1f77bcf86cd799439099';

function usableRecipe(overrides = {}) {
  return {
    _id: RECIPE_ID,
    title: 'Chicken Adobo',
    region: 'central-luzon',
    category: 'dinner',
    difficulty: 'easy',
    prepTimeMinutes: 15,
    cookTimeMinutes: 40,
    imageUrl: null,
    ...overrides,
  };
}

test('createCollection persists with the caller\'s userId, never a client-supplied one', async (t) => {
  let capturedDoc;
  t.mock.method(collectionRepository, 'createCollection', async (doc) => {
    capturedDoc = doc;
    return { _id: COLLECTION_ID, ...doc, createdAt: new Date(), updatedAt: new Date() };
  });

  await collectionService.createCollection(USER_ID, { name: 'My Weeknight Meals' });

  assert.equal(capturedDoc.userId, USER_ID);
  assert.equal(capturedDoc.name, 'My Weeknight Meals');
  assert.equal('description' in capturedDoc, false);
});

test('createCollection persists an optional description', async (t) => {
  let capturedDoc;
  t.mock.method(collectionRepository, 'createCollection', async (doc) => {
    capturedDoc = doc;
    return { _id: COLLECTION_ID, ...doc, createdAt: new Date(), updatedAt: new Date() };
  });

  await collectionService.createCollection(USER_ID, { name: 'Valid', description: 'Comfort food' });

  assert.equal(capturedDoc.description, 'Comfort food');
});

test('listCollections only queries the current user\'s collections', async (t) => {
  let capturedUserId;
  t.mock.method(collectionRepository, 'findManyByUser', async (userId) => {
    capturedUserId = userId;
    return [];
  });

  await collectionService.listCollections(USER_ID);

  assert.equal(capturedUserId, USER_ID);
});

test('listCollections resolves recipeCount and cover images per collection', async (t) => {
  const collection = { _id: COLLECTION_ID, userId: USER_ID, name: 'Weeknight' };
  t.mock.method(collectionRepository, 'findManyByUser', async () => [collection]);
  t.mock.method(collectionRecipeRepository, 'countByFilter', async () => 3);
  t.mock.method(collectionRecipeRepository, 'findRecentRecipeIds', async () => [
    { recipeId: RECIPE_ID },
  ]);
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe());

  const [card] = await collectionService.listCollections(USER_ID);

  assert.equal(card.recipeCount, 3);
  assert.equal(card.coverRecipes.length, 1);
  assert.equal(card.coverRecipes[0].title, 'Chicken Adobo');
});

test('listCollections omits a since-archived cover recipe without fabricating a placeholder', async (t) => {
  const collection = { _id: COLLECTION_ID, userId: USER_ID, name: 'Weeknight' };
  t.mock.method(collectionRepository, 'findManyByUser', async () => [collection]);
  t.mock.method(collectionRecipeRepository, 'countByFilter', async () => 1);
  t.mock.method(collectionRecipeRepository, 'findRecentRecipeIds', async () => [
    { recipeId: RECIPE_ID },
  ]);
  t.mock.method(recipeService, 'findUsableRecipeById', async () => null);

  const [card] = await collectionService.listCollections(USER_ID);

  assert.deepEqual(card.coverRecipes, []);
});

test('getCollection returns the owner\'s collection', async (t) => {
  let capturedArgs;
  t.mock.method(collectionRepository, 'findOwnedById', async (id, userId) => {
    capturedArgs = { id, userId };
    return { _id: COLLECTION_ID, userId: USER_ID, name: 'Weeknight' };
  });

  const collection = await collectionService.getCollection(USER_ID, COLLECTION_ID);

  assert.equal(collection.name, 'Weeknight');
  assert.deepEqual(capturedArgs, { id: COLLECTION_ID, userId: USER_ID });
});

test('getCollection throws COLLECTION_NOT_FOUND when the caller does not own it (BOLA)', async (t) => {
  t.mock.method(collectionRepository, 'findOwnedById', async () => null);

  await assert.rejects(
    () => collectionService.getCollection(OTHER_USER_ID, COLLECTION_ID),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'COLLECTION_NOT_FOUND');
      return true;
    }
  );
});

test('updateCollection only ever writes allowlisted name/description fields', async (t) => {
  let capturedUpdate;
  t.mock.method(collectionRepository, 'updateOwnedById', async (id, userId, update) => {
    capturedUpdate = update;
    return { _id: COLLECTION_ID, userId, name: update.name, description: update.description };
  });

  await collectionService.updateCollection(USER_ID, COLLECTION_ID, {
    name: 'Renamed',
    description: 'New description',
  });

  assert.deepEqual(Object.keys(capturedUpdate).sort(), ['description', 'name']);
});

test('updateCollection throws COLLECTION_NOT_FOUND for another user\'s collection (BOLA)', async (t) => {
  t.mock.method(collectionRepository, 'updateOwnedById', async () => null);

  await assert.rejects(
    () => collectionService.updateCollection(OTHER_USER_ID, COLLECTION_ID, { name: 'Hijacked' }),
    (err) => {
      assert.equal(err.code, 'COLLECTION_NOT_FOUND');
      return true;
    }
  );
});

test('deleteCollection cascades to remove membership rows only after ownership is confirmed', async (t) => {
  let deleteCalledWith;
  t.mock.method(collectionRepository, 'deleteOwnedById', async () => ({ _id: COLLECTION_ID }));
  t.mock.method(collectionRecipeRepository, 'deleteAllByCollectionId', async (collectionId) => {
    deleteCalledWith = collectionId;
    return { deletedCount: 2 };
  });

  await collectionService.deleteCollection(USER_ID, COLLECTION_ID);

  assert.equal(deleteCalledWith, COLLECTION_ID);
});

test('deleteCollection throws COLLECTION_NOT_FOUND and never cascades when the caller does not own it (BOLA)', async (t) => {
  t.mock.method(collectionRepository, 'deleteOwnedById', async () => null);
  let cascadeCalled = false;
  t.mock.method(collectionRecipeRepository, 'deleteAllByCollectionId', async () => {
    cascadeCalled = true;
    return { deletedCount: 0 };
  });

  await assert.rejects(
    () => collectionService.deleteCollection(OTHER_USER_ID, COLLECTION_ID),
    (err) => {
      assert.equal(err.code, 'COLLECTION_NOT_FOUND');
      return true;
    }
  );
  assert.equal(cascadeCalled, false);
});

test('listCollectionRecipes throws COLLECTION_NOT_FOUND for another user\'s collection (BOLA)', async (t) => {
  t.mock.method(collectionRepository, 'findOwnedById', async () => null);

  await assert.rejects(
    () =>
      collectionService.listCollectionRecipes(OTHER_USER_ID, COLLECTION_ID, {
        page: 1,
        limit: 20,
        sort: 'newest',
      }),
    (err) => {
      assert.equal(err.code, 'COLLECTION_NOT_FOUND');
      return true;
    }
  );
});

test('listCollectionRecipes resolves membership recipes through RecipeService and omits unusable ones', async (t) => {
  t.mock.method(collectionRepository, 'findOwnedById', async () => ({ _id: COLLECTION_ID, userId: USER_ID }));
  t.mock.method(collectionRecipeRepository, 'findMany', async () => [
    { _id: 'm1', collectionId: COLLECTION_ID, recipeId: 'r1', createdAt: new Date() },
    { _id: 'm2', collectionId: COLLECTION_ID, recipeId: 'r2', createdAt: new Date() },
  ]);
  t.mock.method(collectionRecipeRepository, 'countByFilter', async () => 2);
  t.mock.method(recipeService, 'findUsableRecipeById', async (id) =>
    id === 'r1' ? usableRecipe({ _id: 'r1' }) : null
  );

  const result = await collectionService.listCollectionRecipes(USER_ID, COLLECTION_ID, {
    page: 1,
    limit: 20,
    sort: 'newest',
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].recipe._id, 'r1');
  assert.equal(result.total, 2);
});

test('addRecipeToCollection requires collection ownership before checking the recipe (BOLA)', async (t) => {
  t.mock.method(collectionRepository, 'findOwnedById', async () => null);
  let recipeServiceCalled = false;
  t.mock.method(recipeService, 'findUsableRecipeById', async () => {
    recipeServiceCalled = true;
    return usableRecipe();
  });

  await assert.rejects(
    () => collectionService.addRecipeToCollection(OTHER_USER_ID, COLLECTION_ID, RECIPE_ID),
    (err) => {
      assert.equal(err.code, 'COLLECTION_NOT_FOUND');
      return true;
    }
  );
  assert.equal(recipeServiceCalled, false);
});

test('addRecipeToCollection rejects with RECIPE_NOT_FOUND for a nonexistent/archived recipe', async (t) => {
  t.mock.method(collectionRepository, 'findOwnedById', async () => ({ _id: COLLECTION_ID, userId: USER_ID }));
  t.mock.method(recipeService, 'findUsableRecipeById', async () => null);

  await assert.rejects(
    () => collectionService.addRecipeToCollection(USER_ID, COLLECTION_ID, RECIPE_ID),
    (err) => {
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'RECIPE_NOT_FOUND');
      return true;
    }
  );
});

test('addRecipeToCollection persists a membership row scoped to the owned collection', async (t) => {
  t.mock.method(collectionRepository, 'findOwnedById', async () => ({ _id: COLLECTION_ID, userId: USER_ID }));
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe());
  let capturedArgs;
  t.mock.method(collectionRecipeRepository, 'createMembership', async (args) => {
    capturedArgs = args;
    return { _id: 'm1', ...args, createdAt: new Date() };
  });

  const result = await collectionService.addRecipeToCollection(USER_ID, COLLECTION_ID, RECIPE_ID);

  assert.deepEqual(capturedArgs, { collectionId: COLLECTION_ID, recipeId: RECIPE_ID });
  assert.equal(result.recipe.title, 'Chicken Adobo');
});

test('addRecipeToCollection translates a duplicate-key error into COLLECTION_RECIPE_ALREADY_EXISTS', async (t) => {
  t.mock.method(collectionRepository, 'findOwnedById', async () => ({ _id: COLLECTION_ID, userId: USER_ID }));
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe());
  t.mock.method(collectionRecipeRepository, 'createMembership', async () => {
    const err = new Error('duplicate key');
    err.code = 11000;
    throw err;
  });

  await assert.rejects(
    () => collectionService.addRecipeToCollection(USER_ID, COLLECTION_ID, RECIPE_ID),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, 'COLLECTION_RECIPE_ALREADY_EXISTS');
      return true;
    }
  );
});

test('removeRecipeFromCollection requires collection ownership (BOLA)', async (t) => {
  t.mock.method(collectionRepository, 'findOwnedById', async () => null);
  let deleteCalled = false;
  t.mock.method(collectionRecipeRepository, 'deleteByCollectionAndRecipe', async () => {
    deleteCalled = true;
    return { _id: 'm1' };
  });

  await assert.rejects(
    () => collectionService.removeRecipeFromCollection(OTHER_USER_ID, COLLECTION_ID, RECIPE_ID),
    (err) => {
      assert.equal(err.code, 'COLLECTION_NOT_FOUND');
      return true;
    }
  );
  assert.equal(deleteCalled, false);
});

test('removeRecipeFromCollection throws COLLECTION_RECIPE_NOT_FOUND when no such membership exists', async (t) => {
  t.mock.method(collectionRepository, 'findOwnedById', async () => ({ _id: COLLECTION_ID, userId: USER_ID }));
  t.mock.method(collectionRecipeRepository, 'deleteByCollectionAndRecipe', async () => null);

  await assert.rejects(
    () => collectionService.removeRecipeFromCollection(USER_ID, COLLECTION_ID, RECIPE_ID),
    (err) => {
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'COLLECTION_RECIPE_NOT_FOUND');
      return true;
    }
  );
});

test('removeRecipeFromCollection only removes the requested membership, scoped to the owned collection', async (t) => {
  t.mock.method(collectionRepository, 'findOwnedById', async () => ({ _id: COLLECTION_ID, userId: USER_ID }));
  let capturedArgs;
  t.mock.method(collectionRecipeRepository, 'deleteByCollectionAndRecipe', async (collectionId, recipeId) => {
    capturedArgs = { collectionId, recipeId };
    return { _id: 'm1' };
  });

  await collectionService.removeRecipeFromCollection(USER_ID, COLLECTION_ID, RECIPE_ID);

  assert.deepEqual(capturedArgs, { collectionId: COLLECTION_ID, recipeId: RECIPE_ID });
});
