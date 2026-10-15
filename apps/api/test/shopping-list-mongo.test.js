const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const ShoppingList = require('../src/modules/shopping-lists/shopping-list.model');
const shoppingListRepository = require('../src/modules/shopping-lists/shopping-list.repository');
const shoppingListService = require('../src/modules/shopping-lists/shopping-list.service');
const ingredientService = require('../src/modules/ingredients/ingredient.service');
const recipeService = require('../src/modules/recipes/recipe.service');

const MONGO_URI = process.env.SHOPPING_LIST_MONGO_URI;
const APPROVED_DB = process.env.SHOPPING_LIST_MONGO_APPROVED_DB;

function validateTarget(uri, approvedDb, options = {}, phase = 'shop4') {
  assert.ok(uri, 'SHOPPING_LIST_MONGO_URI is required');
  const expectedName = phase === 'shop5' ? /^wecooked-shop5-test-[a-z0-9]+$/ : /^wecooked-shop4-test-[a-z0-9]+$/;
  assert.match(approvedDb || '', expectedName,
    `An explicit isolated ${phase.toUpperCase()} test database approval is required`);
  assert.equal(options.dbName, undefined, 'Explicit dbName overrides are forbidden');
  const parsed = new URL(uri);
  assert.ok(['mongodb:', 'mongodb+srv:'].includes(parsed.protocol), 'Mongo URI scheme required');
  assert.ok(parsed.hostname, 'Mongo host required');
  assert.equal(parsed.hash, '', 'Mongo URI fragments are forbidden');
  assert.equal(decodeURIComponent(parsed.pathname.slice(1)), approvedDb,
    'Mongo URI database must match the approved isolated target');
  for (const [key, value] of parsed.searchParams) {
    assert.ok((key === 'retryWrites' && value === 'true')
      || (key === 'w' && value === 'majority')
      || (key === 'tls' && value === 'true')
      || (key === 'appName' && /^[a-zA-Z0-9_-]+$/.test(value)),
    `Unsafe Mongo connection option: ${key}`);
  }
  return approvedDb;
}

test('unsafe Mongo targets fail before a connection or mutation', () => {
  const approved = 'wecooked-shop4-test-review';
  const safe = `mongodb://localhost:27017/${approved}`;
  assert.equal(validateTarget(safe, approved), approved);
  for (const uri of [
    'mongodb://localhost:27017/wecooked-production',
    'mongodb://localhost:27017/wecooked-dev',
    'mongodb://localhost:27017/',
    'mongodb://localhost:27017/other-test',
    `${safe}?dbName=wecooked-production`,
    `${safe}?authSource=admin`,
    `${safe}#wecooked-production`,
  ]) assert.throws(() => validateTarget(uri, approved));
  assert.throws(() => validateTarget(safe, undefined));
  assert.throws(() => validateTarget(safe, approved, { dbName: 'wecooked-dev' }));
});

test('SHOP5 isolated Mongo proves custom-row OCC and bounded additive retry', {
  skip: process.env.SHOP5_MONGO_RUN === 'true' ? false : 'Explicit SHOP5_MONGO_RUN=true is required',
  timeout: 60_000,
}, async (t) => {
  const databaseName = validateTarget(
    process.env.SHOP5_MONGO_URI, process.env.SHOP5_MONGO_APPROVED_DB, {}, 'shop5'
  );
  console.log(`SHOP5 isolated Mongo database: ${databaseName}`);
  const ownedIds = new Set();
  const fixtureId = () => {
    const id = new mongoose.Types.ObjectId();
    ownedIds.add(String(id));
    return id;
  };
  await mongoose.connect(process.env.SHOP5_MONGO_URI, { autoIndex: false, autoCreate: false });
  try {
    assert.equal(mongoose.connection.name, databaseName);
    const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
    assert.ok(collections.every(({ name }) => name === ShoppingList.collection.name));
    assert.equal(await ShoppingList.collection.countDocuments({}), 0);

    await t.test('current __v=0 stale clear cannot erase a winning custom row', async () => {
      const created = await ShoppingList.create({
        _id: fixtureId(), userId: fixtureId(), items: [item(fixtureId())],
      });
      assert.equal(created.__v, 0);
      const [stale, winner] = await Promise.all([
        ShoppingList.findById(created._id), ShoppingList.findById(created._id),
      ]);
      winner.items.push({ type: 'custom', label: 'Milk', isChecked: false });
      await winner.save();
      stale.items = [];
      stale.markModified('items');
      await assert.rejects(() => stale.save(), isVersionError);
      const stored = await ShoppingList.findById(created._id).lean();
      assert.equal(stored.items.some((entry) => entry.type === 'custom' && entry.label === 'Milk'), true);
      assert.equal(stored.__v, 1);
    });

    await t.test('migrated legacy __v=0 also preserves a winning custom row', async () => {
      const id = fixtureId();
      await ShoppingList.collection.insertOne({
        _id: id, userId: fixtureId(), items: [item(fixtureId())],
      });
      const migration = await ShoppingList.collection.updateMany(
        { _id: id, __v: { $exists: false } }, { $set: { __v: 0 } }
      );
      assert.equal(migration.modifiedCount, 1);
      const [stale, winner] = await Promise.all([
        ShoppingList.findById(id), ShoppingList.findById(id),
      ]);
      assert.equal(stale.__v, 0);
      winner.items.push({ type: 'custom', label: 'Bread' });
      await winner.save();
      stale.items[0].isChecked = true;
      await assert.rejects(() => stale.save(), isVersionError);
      const stored = await ShoppingList.findById(id).lean();
      assert.equal(stored.items.some((entry) => entry.type === 'custom' && entry.label === 'Bread'), true);
      assert.equal(stored.items[0].isChecked, false);
    });

    await t.test('Recipe import wins over a stale clear without losing provenance', async (subtest) => {
      const owner = fixtureId();
      const ingredientId = fixtureId();
      const recipeId = fixtureId();
      const created = await ShoppingList.create({
        _id: fixtureId(), userId: owner, items: [item(ingredientId)],
      });
      const stale = await ShoppingList.findById(created._id);
      subtest.mock.method(recipeService, 'findUsableRecipeById', async () => ({
        ingredients: [{ ingredient: { id: String(ingredientId) }, quantity: 1, unit: 'piece' }],
      }));
      subtest.mock.method(recipeService, 'findConsumerVisibleShoppingSources', async () =>
        new Map([[String(recipeId), { id: String(recipeId), title: 'Recipe A' }]]));
      subtest.mock.method(ingredientService, 'findIngredientById', async () => ({
        _id: ingredientId, name: 'Ingredient', isActive: true,
      }));
      await shoppingListService.addRecipeIngredients(owner, recipeId, true);
      stale.items = [];
      stale.markModified('items');
      await assert.rejects(() => stale.save(), isVersionError);
      const stored = await ShoppingList.findById(created._id).lean();
      assert.equal(stored.items[0].quantity, 2);
      assert.deepEqual(stored.items[0].sourceRecipeIds.map(String), [String(recipeId)]);
      assert.equal(stored.items[0].quantityEdited, true);
    });

    await t.test('one proven VersionError retries Custom add exactly once', async (subtest) => {
      const owner = fixtureId();
      const created = await ShoppingList.create({ _id: fixtureId(), userId: owner, items: [] });
      const originalSave = shoppingListRepository.save;
      let saves = 0;
      subtest.mock.method(shoppingListRepository, 'save', async (list) => {
        saves += 1;
        if (saves === 1) {
          const winner = await ShoppingList.findById(created._id);
          winner.items.push(item(fixtureId()));
          await winner.save();
        }
        return originalSave(list);
      });
      subtest.mock.method(ingredientService, 'findIngredientById', async (id) => ({
        _id: id, name: 'Ingredient', isActive: true,
      }));
      await shoppingListService.addCustomItem(owner, { label: 'Milk' });
      const stored = await ShoppingList.findById(created._id).lean();
      assert.equal(saves, 2);
      assert.equal(stored.items.filter((entry) => entry.type === 'custom').length, 1);
      assert.equal(stored.items.length, 2);
    });

    await t.test('ambiguous outcome never retries Custom add', async (subtest) => {
      const owner = fixtureId();
      const created = await ShoppingList.create({ _id: fixtureId(), userId: owner, items: [] });
      const originalSave = shoppingListRepository.save;
      let saves = 0;
      subtest.mock.method(shoppingListRepository, 'save', async (list) => {
        saves += 1;
        await originalSave(list);
        throw new Error('ambiguous response');
      });
      await assert.rejects(() => shoppingListService.addCustomItem(owner, { label: 'Milk' }), /ambiguous response/);
      const stored = await ShoppingList.findById(created._id).lean();
      assert.equal(saves, 1);
      assert.equal(stored.items.filter((entry) => entry.type === 'custom').length, 1);
    });
  } finally {
    try {
      if (ownedIds.size) {
        const exactIds = [...ownedIds].map((id) => new mongoose.Types.ObjectId(id));
        await ShoppingList.collection.deleteMany({ _id: { $in: exactIds } });
        assert.equal(await ShoppingList.collection.countDocuments({ _id: { $in: exactIds } }), 0);
      }
    } finally {
      await mongoose.disconnect();
    }
  }
});

function ids() {
  return {
    userId: new mongoose.Types.ObjectId(),
    ingredientId: new mongoose.Types.ObjectId(),
    otherIngredientId: new mongoose.Types.ObjectId(),
  };
}

function item(ingredientId, overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    ingredientId,
    quantity: 1,
    unit: 'piece',
    isChecked: false,
    ...overrides,
  };
}

function isVersionError(reason) {
  return reason instanceof mongoose.Error.VersionError;
}

test('isolated Mongo proves SHOP4 optimistic concurrency, mapping, retry, and MIG1-gated legacy __v safety', {
  skip: MONGO_URI ? false : 'SHOPPING_LIST_MONGO_URI is required for isolated live-Mongo proof',
  timeout: 60_000,
}, async (t) => {
  const databaseName = validateTarget(MONGO_URI, APPROVED_DB);
  const ownedIds = new Set();
  const fixtureId = () => {
    const id = new mongoose.Types.ObjectId();
    ownedIds.add(String(id));
    return id;
  };
  await mongoose.connect(MONGO_URI, { autoIndex: false, autoCreate: false });
  try {
    assert.equal(mongoose.connection.name, databaseName);
    const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
    assert.ok(collections.every(({ name }) => name === ShoppingList.collection.name),
      'Isolated SHOP4 target must have no unrelated collections');
    assert.equal(await ShoppingList.collection.countDocuments({}), 0,
      'Isolated SHOP4 target must contain no existing shopping lists');

  await t.test('two current-document saves produce exactly one winner and preserve it', async () => {
    const { userId, ingredientId, otherIngredientId } = ids();
    const created = await ShoppingList.create({ _id: fixtureId(), userId, items: [item(ingredientId)] });
    assert.equal(created.__v, 0);

    const [left, right] = await Promise.all([
      ShoppingList.findById(created._id),
      ShoppingList.findById(created._id),
    ]);
    left.items.push(item(otherIngredientId, { quantity: 2 }));
    right.items[0].isChecked = true;

    const outcomes = await Promise.allSettled([left.save(), right.save()]);
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((outcome) =>
      outcome.status === 'rejected' && isVersionError(outcome.reason)).length, 1);

    const stored = await ShoppingList.findById(created._id).lean();
    const leftWon = stored.items.length === 2 && stored.items[0].isChecked === false;
    const rightWon = stored.items.length === 1 && stored.items[0].isChecked === true;
    assert.equal(leftWon || rightWon, true);
    assert.equal(stored.__v, 1);
  });

  await t.test('the application maps a real stale save to SHOPPING_LIST_STALE', async (st) => {
    const { userId, ingredientId } = ids();
    const created = await ShoppingList.create({
      _id: fixtureId(), userId, items: [item(ingredientId, { isChecked: true })],
    });
    const stale = await ShoppingList.findById(created._id);
    const winner = await ShoppingList.findById(created._id);
    winner.items[0].isChecked = false;
    await winner.save();

    const find = st.mock.method(shoppingListRepository, 'findOrCreateByUserId', async () => stale);
    await assert.rejects(
      () => shoppingListService.clearItems(userId),
      (err) => err?.statusCode === 409 && err?.code === 'SHOPPING_LIST_STALE'
    );
    assert.equal(find.mock.callCount(), 1);
  });

  await t.test('additive retry reapplies the validated payload exactly once', async (st) => {
    const { userId, ingredientId, otherIngredientId } = ids();
    await ShoppingList.create({
      _id: fixtureId(), userId,
      items: [item(ingredientId, { quantity: 3 }), item(otherIngredientId)],
    });
    st.mock.method(ingredientService, 'findIngredientById', async (id) => ({
      _id: id, name: 'Live ingredient', isActive: true,
    }));
    const originalSave = shoppingListRepository.save;
    let saveCalls = 0;
    st.mock.method(shoppingListRepository, 'save', async (list) => {
      saveCalls += 1;
      if (saveCalls === 1) {
        const concurrent = await ShoppingList.findById(list._id);
        concurrent.items.id(concurrent.items[1]._id).isChecked = true;
        await concurrent.save();
      }
      return originalSave(list);
    });

    await shoppingListService.addItem(userId, {
      ingredientId: String(ingredientId), quantity: 2, unit: 'piece',
    });

    const stored = await ShoppingList.findOne({ userId }).lean();
    assert.equal(saveCalls, 2);
    assert.equal(stored.items.find((row) => row.ingredientId.equals(ingredientId)).quantity, 5);
    assert.equal(stored.items.find((row) => row.ingredientId.equals(otherIngredientId)).isChecked, true);
    assert.equal(stored.__v, 2);
  });

  await t.test('the MIG1 missing-version backfill is required before legacy documents have safe OCC', async () => {
    const { userId, ingredientId, otherIngredientId } = ids();
    const unsafeLegacyId = fixtureId();
    await ShoppingList.collection.insertOne({
      _id: unsafeLegacyId,
      userId,
      items: [item(ingredientId)],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const rawBefore = await ShoppingList.collection.findOne({ _id: unsafeLegacyId });
    assert.equal(Object.hasOwn(rawBefore, '__v'), false);

    const [unsafeLeft, unsafeRight] = await Promise.all([
      ShoppingList.findById(unsafeLegacyId),
      ShoppingList.findById(unsafeLegacyId),
    ]);
    assert.equal(unsafeLeft.__v, undefined);
    assert.equal(unsafeRight.__v, undefined);
    unsafeLeft.items.push(item(otherIngredientId));
    unsafeRight.items[0].isChecked = true;

    const unsafeOutcomes = await Promise.allSettled([unsafeLeft.save(), unsafeRight.save()]);
    assert.equal(unsafeOutcomes.filter((outcome) => outcome.status === 'fulfilled').length, 2);
    assert.equal(unsafeOutcomes.filter((outcome) =>
      outcome.status === 'rejected' && isVersionError(outcome.reason)).length, 0);

    const migratedLegacyId = fixtureId();
    await ShoppingList.collection.insertOne({
      _id: migratedLegacyId,
      userId: new mongoose.Types.ObjectId(),
      items: [item(ingredientId)],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const rawMigrationTarget = await ShoppingList.collection.findOne({ _id: migratedLegacyId });
    assert.equal(Object.hasOwn(rawMigrationTarget, '__v'), false);

    // Exact MOBILE-SHOP4-MIG1 missing-version backfill.
    const migration = await ShoppingList.collection.updateMany(
      { _id: migratedLegacyId, __v: { $exists: false } },
      { $set: { __v: 0 } }
    );
    assert.equal(migration.acknowledged, true);
    assert.equal(migration.matchedCount, 1);
    assert.equal(migration.modifiedCount, 1);

    const rawAfterMigration = await ShoppingList.collection.findOne({ _id: migratedLegacyId });
    assert.equal(typeof rawAfterMigration.__v, 'number');
    assert.equal(rawAfterMigration.__v, 0);

    const [left, right] = await Promise.all([
      ShoppingList.findById(migratedLegacyId),
      ShoppingList.findById(migratedLegacyId),
    ]);
    assert.equal(left.__v, 0);
    assert.equal(right.__v, 0);
    left.items.push(item(otherIngredientId));
    right.items[0].isChecked = true;

    const outcomes = await Promise.allSettled([left.save(), right.save()]);
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((outcome) =>
      outcome.status === 'rejected' && isVersionError(outcome.reason)).length, 1);

    const stored = await ShoppingList.findById(migratedLegacyId).lean();
    const leftWon = stored.items.length === 2 && stored.items[0].isChecked === false;
    const rightWon = stored.items.length === 1 && stored.items[0].isChecked === true;
    assert.equal(leftWon || rightWon, true);
    assert.equal(stored.__v, 1);
  });
  } finally {
    try {
      if (ownedIds.size) {
        const exactIds = [...ownedIds].map((id) => new mongoose.Types.ObjectId(id));
        await ShoppingList.collection.deleteMany({ _id: { $in: exactIds } });
        assert.equal(await ShoppingList.collection.countDocuments({ _id: { $in: exactIds } }), 0,
          'SHOP4 fixtures must be absent after cleanup');
      }
    } finally {
      await mongoose.disconnect();
    }
  }
});
