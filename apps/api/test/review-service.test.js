process.env.NODE_ENV = 'test';
process.env.PORT = '4035';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.BCRYPT_ROUNDS = '10';

const test = require('node:test');
const assert = require('node:assert/strict');

const reviewRepository = require('../src/modules/reviews/review.repository');
const recipeService = require('../src/modules/recipes/recipe.service');
const userService = require('../src/modules/users/user.service');
const cookHistoryService = require('../src/modules/cook-history/cook-history.service');
const reviewService = require('../src/modules/reviews/review.service');
const { AppError } = require('../src/shared/errors/app-error');

const USER_ID = '507f1f77bcf86cd799439001';
const OTHER_USER_ID = '507f1f77bcf86cd799439002';
const RECIPE_ID = '507f1f77bcf86cd799439099';
const OTHER_RECIPE_ID = '507f1f77bcf86cd799439098';
const REVIEW_ID = '507f1f77bcf86cd799439033';

function usableRecipe(overrides = {}) {
  return { _id: RECIPE_ID, title: 'Chicken Adobo', ...overrides };
}

function fakeUser(overrides = {}) {
  return { _id: USER_ID, name: 'Kirby', email: 'kirby@example.com', role: 'user', ...overrides };
}

function fakeReview(overrides = {}) {
  return {
    _id: REVIEW_ID,
    userId: USER_ID,
    recipeId: RECIPE_ID,
    rating: 4,
    comment: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function mockFirstReviewEligibility(t, { existing = null, completed = true } = {}) {
  t.mock.method(reviewRepository, 'findOneByUserAndRecipe', async () => existing);
  t.mock.method(cookHistoryService, 'hasCompletedRecipe', async () => completed);
}

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

test('createReview requires an existing/usable recipe before touching the repository', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => null);
  let createCalled = false;
  let eligibilityCalled = false;
  t.mock.method(reviewRepository, 'findOneByUserAndRecipe', async () => {
    eligibilityCalled = true;
    return null;
  });
  t.mock.method(cookHistoryService, 'hasCompletedRecipe', async () => {
    eligibilityCalled = true;
    return true;
  });
  t.mock.method(reviewRepository, 'create', async () => {
    createCalled = true;
    return fakeReview();
  });

  await assert.rejects(
    () => reviewService.createReview(USER_ID, RECIPE_ID, { rating: 5 }),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'RECIPE_NOT_FOUND');
      return true;
    }
  );
  assert.equal(createCalled, false);
  assert.equal(eligibilityCalled, false);
});

test('createReview persists with the caller\'s userId, never a client-supplied one', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe());
  t.mock.method(userService, 'getUserById', async () => fakeUser());
  mockFirstReviewEligibility(t);
  let capturedDoc;
  t.mock.method(reviewRepository, 'create', async (doc) => {
    capturedDoc = doc;
    return fakeReview({ ...doc });
  });

  await reviewService.createReview(USER_ID, RECIPE_ID, { rating: 5 });

  assert.equal(capturedDoc.userId, USER_ID);
  assert.equal(capturedDoc.recipeId, RECIPE_ID);
  assert.equal(capturedDoc.rating, 5);
  assert.equal('comment' in capturedDoc, false);
});

test('createReview persists an optional comment', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe());
  t.mock.method(userService, 'getUserById', async () => fakeUser());
  mockFirstReviewEligibility(t);
  let capturedDoc;
  t.mock.method(reviewRepository, 'create', async (doc) => {
    capturedDoc = doc;
    return fakeReview({ ...doc });
  });

  await reviewService.createReview(USER_ID, RECIPE_ID, { rating: 3, comment: 'Solid.' });

  assert.equal(capturedDoc.comment, 'Solid.');
});

test('createReview attaches the safe public author summary (id + name only)', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe());
  t.mock.method(userService, 'getUserById', async () => fakeUser());
  mockFirstReviewEligibility(t);
  t.mock.method(reviewRepository, 'create', async (doc) => fakeReview({ ...doc }));

  const result = await reviewService.createReview(USER_ID, RECIPE_ID, { rating: 5 });

  assert.deepEqual(result.author, { id: USER_ID, name: 'Kirby' });
  assert.equal('email' in result.author, false);
});

test('createReview translates a duplicate-key error into REVIEW_ALREADY_EXISTS (409), not a 500', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe());
  mockFirstReviewEligibility(t);
  t.mock.method(reviewRepository, 'create', async () => {
    const err = new Error('duplicate key');
    err.code = 11000;
    throw err;
  });

  await assert.rejects(
    () => reviewService.createReview(USER_ID, RECIPE_ID, { rating: 4 }),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, 'REVIEW_ALREADY_EXISTS');
      return true;
    }
  );
});

test('createReview lets a genuine repository failure propagate as-is (not misreported as a conflict)', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe());
  mockFirstReviewEligibility(t);
  t.mock.method(reviewRepository, 'create', async () => {
    throw new Error('connection reset');
  });

  await assert.rejects(() => reviewService.createReview(USER_ID, RECIPE_ID, { rating: 4 }), /connection reset/);
});

test('createReview rejects a first rating-only review without a matching cook completion', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe());
  mockFirstReviewEligibility(t, { completed: false });
  let createCalled = false;
  t.mock.method(reviewRepository, 'create', async () => {
    createCalled = true;
    return fakeReview();
  });

  await assert.rejects(
    () => reviewService.createReview(USER_ID, RECIPE_ID, { rating: 4 }),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, 'REVIEW_COOK_REQUIRED');
      assert.equal(err.message, 'Complete this recipe in WeCooked before rating or reviewing it.');
      return true;
    }
  );
  assert.equal(createCalled, false);
});

test('createReview gates rating plus comment with the same cook-history rule', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe());
  mockFirstReviewEligibility(t, { completed: false });

  await assert.rejects(
    () => reviewService.createReview(USER_ID, RECIPE_ID, { rating: 5, comment: 'Excellent.' }),
    (err) => err.code === 'REVIEW_COOK_REQUIRED'
  );
});

test('createReview scopes cook eligibility to authenticated user and canonical recipe', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async (recipeId) => usableRecipe({
    _id: recipeId === OTHER_RECIPE_ID ? 'canonical-other-recipe' : 'canonical-recipe',
  }));
  t.mock.method(reviewRepository, 'findOneByUserAndRecipe', async () => null);
  let captured;
  t.mock.method(cookHistoryService, 'hasCompletedRecipe', async (userId, recipeId) => {
    captured = { userId, recipeId };
    return userId === USER_ID && recipeId === 'canonical-recipe';
  });
  t.mock.method(userService, 'getUserById', async () => fakeUser());
  t.mock.method(reviewRepository, 'create', async (doc) => fakeReview(doc));

  await reviewService.createReview(USER_ID, RECIPE_ID, { rating: 5 });
  assert.deepEqual(captured, { userId: USER_ID, recipeId: 'canonical-recipe' });

  await assert.rejects(
    () => reviewService.createReview(OTHER_USER_ID, RECIPE_ID, { rating: 5 }),
    (err) => err.code === 'REVIEW_COOK_REQUIRED'
  );
  await assert.rejects(
    () => reviewService.createReview(USER_ID, OTHER_RECIPE_ID, { rating: 5 }),
    (err) => err.code === 'REVIEW_COOK_REQUIRED'
  );
});

test('createReview preserves REVIEW_ALREADY_EXISTS before checking cook history', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe());
  let cookChecked = false;
  t.mock.method(reviewRepository, 'findOneByUserAndRecipe', async () => fakeReview());
  t.mock.method(cookHistoryService, 'hasCompletedRecipe', async () => {
    cookChecked = true;
    return false;
  });

  await assert.rejects(
    () => reviewService.createReview(USER_ID, RECIPE_ID, { rating: 4 }),
    (err) => err.code === 'REVIEW_ALREADY_EXISTS'
  );
  assert.equal(cookChecked, false);
});

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------

test('updateReview only ever writes allowlisted rating/comment fields', async (t) => {
  t.mock.method(cookHistoryService, 'hasCompletedRecipe', async () => {
    throw new Error('PATCH must not check cook history');
  });
  t.mock.method(userService, 'getUserById', async () => fakeUser());
  let capturedUpdate;
  t.mock.method(reviewRepository, 'updateOwnedById', async (id, userId, update) => {
    capturedUpdate = update;
    return fakeReview({ ...update });
  });

  await reviewService.updateReview(USER_ID, REVIEW_ID, { rating: 2, comment: 'Updated' });

  assert.deepEqual(Object.keys(capturedUpdate).sort(), ['comment', 'rating']);
});

test('updateReview scopes the write by { _id, userId } — User B cannot update User A\'s review (BOLA)', async (t) => {
  let capturedArgs;
  t.mock.method(reviewRepository, 'updateOwnedById', async (id, userId, update) => {
    capturedArgs = { id, userId, update };
    return null; // not owned by OTHER_USER_ID -> not found
  });

  await assert.rejects(
    () => reviewService.updateReview(OTHER_USER_ID, REVIEW_ID, { rating: 1 }),
    (err) => {
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'REVIEW_NOT_FOUND');
      return true;
    }
  );
  assert.equal(capturedArgs.userId, OTHER_USER_ID);
});

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

test('deleteReview succeeds for the owner', async (t) => {
  t.mock.method(cookHistoryService, 'hasCompletedRecipe', async () => {
    throw new Error('DELETE must not check cook history');
  });
  let capturedArgs;
  t.mock.method(reviewRepository, 'deleteOwnedById', async (id, userId) => {
    capturedArgs = { id, userId };
    return fakeReview();
  });

  await reviewService.deleteReview(USER_ID, REVIEW_ID);

  assert.deepEqual(capturedArgs, { id: REVIEW_ID, userId: USER_ID });
});

test('deleteReview denies another user (BOLA) with REVIEW_NOT_FOUND, no existence leak', async (t) => {
  t.mock.method(reviewRepository, 'deleteOwnedById', async () => null);

  await assert.rejects(
    () => reviewService.deleteReview(OTHER_USER_ID, REVIEW_ID),
    (err) => {
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'REVIEW_NOT_FOUND');
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// LIST / AGGREGATE / CURRENT USER REVIEW
// ---------------------------------------------------------------------------

test('listReviews requires an existing/usable recipe', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => null);

  await assert.rejects(
    () => reviewService.listReviews(USER_ID, RECIPE_ID, { page: 1, limit: 20, sort: 'newest' }),
    (err) => {
      assert.equal(err.code, 'RECIPE_NOT_FOUND');
      return true;
    }
  );
});

test('listReviews returns a deterministic empty summary (null average, zero count) with no reviews', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe());
  t.mock.method(reviewRepository, 'findMany', async () => []);
  t.mock.method(reviewRepository, 'countByFilter', async () => 0);
  t.mock.method(reviewRepository, 'aggregateSummary', async () => null);
  t.mock.method(reviewRepository, 'findOneByUserAndRecipe', async () => null);

  const result = await reviewService.listReviews(USER_ID, RECIPE_ID, { page: 1, limit: 20, sort: 'newest' });

  assert.deepEqual(result.summary, { averageRating: null, ratingCount: 0 });
  assert.equal(result.currentUserReview, null);
  assert.deepEqual(result.items, []);
});

test('listReviews computes the authoritative average/count from the aggregate, rounded to 1 decimal', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe());
  t.mock.method(reviewRepository, 'findMany', async () => [fakeReview()]);
  t.mock.method(reviewRepository, 'countByFilter', async () => 3);
  t.mock.method(reviewRepository, 'aggregateSummary', async () => ({ avg: 4.3333333, count: 3 }));
  t.mock.method(reviewRepository, 'findOneByUserAndRecipe', async () => null);
  t.mock.method(userService, 'getUserById', async () => fakeUser());

  const result = await reviewService.listReviews(USER_ID, RECIPE_ID, { page: 1, limit: 20, sort: 'newest' });

  assert.deepEqual(result.summary, { averageRating: 4.3, ratingCount: 3 });
});

test('listReviews includes currentUserReview when the caller has already reviewed the recipe', async (t) => {
  const myReview = fakeReview({ _id: 'r-mine', userId: USER_ID, rating: 5 });
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe());
  t.mock.method(reviewRepository, 'findMany', async () => [myReview]);
  t.mock.method(reviewRepository, 'countByFilter', async () => 1);
  t.mock.method(reviewRepository, 'aggregateSummary', async () => ({ avg: 5, count: 1 }));
  t.mock.method(reviewRepository, 'findOneByUserAndRecipe', async () => myReview);
  t.mock.method(userService, 'getUserById', async () => fakeUser());

  const result = await reviewService.listReviews(USER_ID, RECIPE_ID, { page: 1, limit: 20, sort: 'newest' });

  assert.equal(result.currentUserReview.review._id, 'r-mine');
  assert.equal(result.currentUserReview.review.rating, 5);
});

test('listReviews never lets a nonexistent/other-user author leak sensitive fields', async (t) => {
  t.mock.method(recipeService, 'findUsableRecipeById', async () => usableRecipe());
  t.mock.method(reviewRepository, 'findMany', async () => [fakeReview()]);
  t.mock.method(reviewRepository, 'countByFilter', async () => 1);
  t.mock.method(reviewRepository, 'aggregateSummary', async () => ({ avg: 4, count: 1 }));
  t.mock.method(reviewRepository, 'findOneByUserAndRecipe', async () => null);
  t.mock.method(userService, 'getUserById', async () => fakeUser({ role: 'admin', status: 'active' }));

  const [{ author }] = (
    await reviewService.listReviews(USER_ID, RECIPE_ID, { page: 1, limit: 20, sort: 'newest' })
  ).items;

  assert.deepEqual(Object.keys(author).sort(), ['id', 'name']);
});
