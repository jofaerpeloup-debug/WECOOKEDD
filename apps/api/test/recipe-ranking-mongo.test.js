process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Recipe = require('../src/modules/recipes/recipe.model');
const Review = require('../src/modules/reviews/review.model');
const Ingredient = require('../src/modules/ingredients/ingredient.model');
const recipeService = require('../src/modules/recipes/recipe.service');
const recipeRepository = require('../src/modules/recipes/recipe.repository');
const {
  assertCommandTarget,
  migrateRecipeRankingIndex,
} = require('../scripts/migrate-recipe-ranking-index');

const uri = process.env.RECIPE_RANKING_MONGO_URI;
const silentLogger = { log() {} };

function reviewRows(recipeId, ratings) {
  return ratings.map((rating) => ({
    _id: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    recipeId,
    rating,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
}

test('isolated Mongo proves physical text index, relevance, raw Top Rated order, and live Review reflection', {
  skip: !uri,
  timeout: 60000,
}, async () => {
  assertCommandTarget(uri, { apply: true });
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false });

  const ingredientId = new mongoose.Types.ObjectId();
  const ids = [0, 1, 2, 3, 4, 5].map(() => new mongoose.Types.ObjectId());
  const utf16Ids = [0, 1, 2, 3, 4, 5].map(() => new mongoose.Types.ObjectId());
  const nutritionIds = [0, 1, 2, 3, 4, 5].map(() => new mongoose.Types.ObjectId());
  const now = new Date();
  const base = {
    description: 'A complete ranked recipe description.',
    difficulty: 'easy',
    prepTimeMinutes: 10,
    cookTimeMinutes: 20,
    servings: 4,
    ingredients: [{ ingredientId, quantity: 1, unit: 'piece', optional: false }],
    instructions: ['Cook until ready.'],
    dietaryTags: [],
    imageUrlIsPublicHttps: false,
    isActive: true,
    publicationStatus: 'published',
    createdAt: now,
    updatedAt: now,
  };
  const missingDerived = {
    ...base,
    _id: ids[5],
    title: 'Eligibility Probe Missing',
    imageUrl: 'https://example.com/missing.jpg',
  };
  delete missingDerived.imageUrlIsPublicHttps;

  try {
    const applied = await migrateRecipeRankingIndex({ collection: Recipe.collection, apply: true, logger: silentLogger });
    const repeated = await migrateRecipeRankingIndex({ collection: Recipe.collection, apply: true, logger: silentLogger });
    assert.equal(applied.exact, true);
    assert.equal(repeated.created, 0);
    await Ingredient.collection.insertOne({
      _id: ingredientId,
      name: `Rank1 ingredient ${ingredientId}`,
      slug: `rank1-${ingredientId}`,
      category: 'other',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await Recipe.collection.insertMany([
      { ...base, _id: ids[0], title: 'Sinigang Feast', description: 'A bright broth.' },
      { ...base, _id: ids[1], title: 'Broth Supper', description: 'A Sinigang feast for everyone.' },
      { ...base, _id: ids[2], title: 'Rated Newcomer' },
      {
        ...base,
        _id: ids[3],
        title: 'Eligibility Probe Valid',
        imageUrl: 'https://example.com/valid.jpg',
        imageUrlIsPublicHttps: true,
      },
      {
        ...base,
        _id: ids[4],
        title: 'Eligibility Probe Private',
        imageUrl: 'https://2130706433/private.jpg',
        imageUrlIsPublicHttps: false,
      },
      missingDerived,
    ]);
    await Review.collection.insertMany([
      ...reviewRows(ids[0], [5, 5, 5, 5, 5, 4, 4, 4, 4, 4]),
      ...reviewRows(ids[1], [5, 5, 5, 5, 5, 5, 5, 4, 4, 3, 3]),
    ]);

    const relevance = await recipeService.listRecipes({
      search: 'sinigang feast', ingredientId: String(ingredientId), status: 'active', page: 1, limit: 20,
      sort: 'relevance', isAdmin: false,
    });
    assert.deepEqual(relevance.items.map((recipe) => String(recipe._id)).slice(0, 2), [String(ids[0]), String(ids[1])]);

    const eligibility = await recipeService.listRecipes({
      search: 'Eligibility Probe', ingredientId: String(ingredientId), status: 'active', page: 1, limit: 20,
      sort: 'titleAsc', isAdmin: false,
    });
    assert.equal(eligibility.total, 1);
    assert.deepEqual(eligibility.items.map((recipe) => String(recipe._id)), [String(ids[3])]);

    const titleCases = [
      'A'.repeat(150), 'A'.repeat(151),
      '😀'.repeat(75), '😀'.repeat(76),
      'A'.repeat(148) + '😀', 'A'.repeat(149) + '😀',
    ];
    await Recipe.collection.insertMany(titleCases.map((title, index) => ({
      ...base, _id: utf16Ids[index], title, description: 'UTF16 Probe recipe.',
    })));
    const utf16 = await recipeService.listRecipes({
      search: 'UTF16 Probe', ingredientId: String(ingredientId), status: 'active',
      page: 1, limit: 20, sort: 'titleAsc', isAdmin: false,
    });
    assert.equal(utf16.total, 3);
    assert.deepEqual(new Set(utf16.items.map((recipe) => String(recipe._id))),
      new Set([utf16Ids[0], utf16Ids[2], utf16Ids[4]].map(String)));

    const nutrition = {
      schemaVersion: 1, basis: 'perServing', caloriesKcal: 300,
      proteinGrams: 20, carbohydrateGrams: 20, fatGrams: 12,
      sugarGrams: 3, fiberGrams: 2,
    };
    const attribution = { sourceKind: 'manual', sourceLabel: 'Reviewed panel',
      acceptedBy: ingredientId, acceptedAt: now };
    await Recipe.collection.insertMany([
      { ...base, _id: nutritionIds[0], title: 'Nutrition Public', description: 'Nutrition Probe',
        nutrition, nutritionProvenance: { ...attribution, sourceUrl: 'https://example.com/panel' },
        nutritionSourceUrlIsPublicHttps: true },
      { ...base, _id: nutritionIds[1], title: 'Nutrition Optional', description: 'Nutrition Probe',
        nutrition, nutritionProvenance: attribution, nutritionSourceUrlIsPublicHttps: false },
      { ...base, _id: nutritionIds[2], title: 'Nutrition Private', description: 'Nutrition Probe',
        nutrition, nutritionProvenance: { ...attribution, sourceUrl: 'https://loc%61lhost/panel' },
        nutritionSourceUrlIsPublicHttps: false },
      { ...base, _id: nutritionIds[3], title: 'Nutrition Missing Author', description: 'Nutrition Probe',
        nutrition, nutritionProvenance: { sourceKind: 'manual', sourceLabel: 'Panel', acceptedAt: now,
          sourceUrl: 'https://example.com/panel' }, nutritionSourceUrlIsPublicHttps: true },
      { ...base, _id: nutritionIds[4], title: 'Nutrition Missing Date', description: 'Nutrition Probe',
        nutrition, nutritionProvenance: { sourceKind: 'manual', sourceLabel: 'Panel', acceptedBy: ingredientId,
          sourceUrl: 'https://example.com/panel' }, nutritionSourceUrlIsPublicHttps: true },
      { ...base, _id: nutritionIds[5], title: 'Nutrition Invalid Asset', description: 'Nutrition Probe',
        imageAssetId: 'managed-asset' },
    ]);
    const provenance = await recipeService.listRecipes({
      search: 'Nutrition Probe', ingredientId: String(ingredientId), status: 'active',
      page: 1, limit: 20, sort: 'titleAsc', isAdmin: false,
    });
    assert.equal(provenance.total, 2);
    assert.deepEqual(new Set(provenance.items.map((recipe) => String(recipe._id))),
      new Set([nutritionIds[0], nutritionIds[1]].map(String)));

    const topRated = await recipeService.listRecipes({
      ingredientId: String(ingredientId), status: 'active', page: 1, limit: 20, sort: 'topRated', isAdmin: false,
    });
    const proofItems = topRated.items.filter((recipe) => ids.some((id) => id.equals(recipe._id)));
    assert.deepEqual(proofItems.slice(0, 2).map((recipe) => String(recipe._id)), [String(ids[0]), String(ids[1])]);
    assert.equal(proofItems[0]._ratingSummary.averageRating, 4.5);
    assert.equal(proofItems[1]._ratingSummary.averageRating, 4.5);
    assert.ok(proofItems[0]._ratingSummary.ratingCount < proofItems[1]._ratingSummary.ratingCount);

    const newcomerReview = reviewRows(ids[2], [5])[0];
    await Review.collection.insertOne(newcomerReview);
    let reflected = await recipeService.listRecipes({
      ingredientId: String(ingredientId), status: 'active', page: 1, limit: 20, sort: 'topRated', isAdmin: false,
    });
    assert.ok(reflected.items.some((recipe) => String(recipe._id) === String(ids[2])));

    await Review.collection.updateOne({ _id: newcomerReview._id }, { $set: { rating: 1 } });
    reflected = await recipeService.listRecipes({
      ingredientId: String(ingredientId), status: 'active', page: 1, limit: 20, sort: 'topRated', isAdmin: false,
    });
    assert.equal(reflected.items.find((recipe) => String(recipe._id) === String(ids[2]))._ratingSummary.averageRating, 1);

    await Review.collection.deleteOne({ _id: newcomerReview._id });
    reflected = await recipeService.listRecipes({
      ingredientId: String(ingredientId), status: 'active', page: 1, limit: 20, sort: 'topRated', isAdmin: false,
    });
    assert.equal(reflected.items.some((recipe) => String(recipe._id) === String(ids[2])), false);
  } finally {
    await Review.collection.deleteMany({ recipeId: { $in: ids } });
    await Recipe.collection.deleteMany({ _id: { $in: [...ids, ...utf16Ids, ...nutritionIds] } });
    await Ingredient.collection.deleteOne({ _id: ingredientId });
    await mongoose.disconnect();
  }
});

test('isolated Mongo proves missing, zero, and positive Recipe CAS plus a same-millisecond stale conflict', {
  skip: !uri,
  timeout: 60000,
}, async (t) => {
  assertCommandTarget(uri, { apply: true });
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
  const ids = [0, 1, 2, 3].map(() => new mongoose.Types.ObjectId());
  const ingredientId = new mongoose.Types.ObjectId();
  const timestamp = new Date('2026-10-11T00:00:00.000Z');
  const base = {
    title: 'CAS Proof Recipe', description: 'Complete Recipe for revision proof.',
    difficulty: 'easy', cookTimeMinutes: 20, servings: 4,
    ingredients: [{ ingredientId, quantity: 1, unit: 'piece', optional: false }],
    instructions: ['Cook until ready.'], dietaryTags: [],
    imageUrlIsPublicHttps: false, nutritionSourceUrlIsPublicHttps: false,
    isActive: true, publicationStatus: 'draft', createdAt: timestamp, updatedAt: timestamp,
  };
  try {
    await Ingredient.collection.insertOne({
      _id: ingredientId, name: `Rank1 CAS ${ingredientId}`, slug: `rank1-cas-${ingredientId}`,
      category: 'other', isActive: true, createdAt: timestamp, updatedAt: timestamp,
    });
    await Recipe.collection.insertMany([
      { ...base, _id: ids[0] },
      { ...base, _id: ids[1], __v: 0 },
      { ...base, _id: ids[2], __v: 5 },
      { ...base, _id: ids[3], __v: 5 },
    ]);
    for (const [index, revision, next] of [[0, undefined, 1], [1, 0, 1], [2, 5, 6]]) {
      const competing = await Promise.all([
        recipeRepository.updateById(ids[index], { $set: { title: `CAS winner A ${index}` } }, { expectedRevision: revision }),
        recipeRepository.updateById(ids[index], { $set: { title: `CAS winner B ${index}` } }, { expectedRevision: revision }),
      ]);
      assert.equal(competing.filter(Boolean).length, 1);
      assert.equal(competing.find(Boolean).__v, next);
      const raw = await Recipe.collection.findOne({ _id: ids[index] });
      assert.equal(raw.__v, next);
      assert.ok([`CAS winner A ${index}`, `CAS winner B ${index}`].includes(raw.title));
    }
    const snapshot = await recipeRepository.findRawById(ids[3]);
    t.mock.method(recipeRepository, 'findRawById', async () => snapshot);
    const nutrition = {
      schemaVersion: 1, basis: 'perServing', caloriesKcal: 300,
      proteinGrams: 20, carbohydrateGrams: 20, fatGrams: 12,
      sugarGrams: 3, fiberGrams: 2,
    };
    const outcomes = await Promise.allSettled([
      recipeService.updateRecipe(ids[3], {
        nutrition,
        nutritionSource: { kind: 'manual', label: 'Reviewed panel', url: 'https://example.com/panel' },
      }, { actorId: ingredientId, now: timestamp }),
      recipeService.updateRecipe(ids[3], { title: 'Competing title' }),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected'
      && outcome.reason.code === 'RECIPE_EDIT_CONFLICT'
      && outcome.reason.statusCode === 409).length, 1);
    const raced = await Recipe.collection.findOne({ _id: ids[3] });
    assert.equal(raced.__v, 6);
    if (raced.nutritionProvenance?.sourceUrl) {
      assert.equal(raced.nutritionProvenance.sourceUrl, 'https://example.com/panel');
      assert.equal(raced.nutritionSourceUrlIsPublicHttps, true);
      assert.equal(raced.title, 'CAS Proof Recipe');
    } else {
      assert.equal(raced.nutritionSourceUrlIsPublicHttps, false);
      assert.equal(raced.title, 'Competing title');
    }
  } finally {
    await Recipe.collection.deleteMany({ _id: { $in: ids } });
    await Ingredient.collection.deleteOne({ _id: ingredientId });
    await mongoose.disconnect();
  }
});
