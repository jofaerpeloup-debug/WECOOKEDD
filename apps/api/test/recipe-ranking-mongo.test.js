process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const mongoose = require('mongoose');

const Recipe = require('../src/modules/recipes/recipe.model');
const Review = require('../src/modules/reviews/review.model');
const Ingredient = require('../src/modules/ingredients/ingredient.model');
const recipeService = require('../src/modules/recipes/recipe.service');
const recipeRepository = require('../src/modules/recipes/recipe.repository');
const {
  assertCommandTarget,
  analyzeIndexes,
  FROZEN_INDEX,
  logCommandFailure,
  migrateRecipeRankingIndex,
} = require('../scripts/migrate-recipe-ranking-index');

const uri = process.env.RECIPE_RANKING_MONGO_URI;
const liveMode = process.env.RECIPE_RANKING_MONGO_RUN;
const liveRequested = liveMode === 'ranking';
const failureRequested = liveMode === 'ranking-failure';
const silentLogger = { log() {} };
let physicalBackfillPassed = false;

function assertLiveMode({ mode = liveMode, selectedUri = uri,
  path = process.env.RECIPE_RANKING_MONGO_PREFLIGHT_FILE } = {}) {
  if (!mode && !selectedUri && !path) return;
  assert.ok(['ranking', 'ranking-failure', 'authoring'].includes(mode),
    'RECIPE_RANKING_MONGO_RUN must select ranking, ranking-failure, or authoring');
  assert.ok(mode === 'ranking' || mode === 'ranking-failure',
    'This file runs only ranking or ranking-failure physical proof');
}

function requireTargetConfiguration({ selectedUri = uri,
  path = process.env.RECIPE_RANKING_MONGO_PREFLIGHT_FILE,
  configuration: suppliedConfiguration,
  mode = liveMode } = {}) {
  assertLiveMode({ mode, selectedUri, path });
  assert.ok(selectedUri, 'RECIPE_RANKING_MONGO_URI is required for requested physical proof');
  const selectedDatabase = assertCommandTarget(selectedUri, { apply: true });
  if (mode === 'ranking-failure') {
    assert.ok(/failure/i.test(selectedDatabase),
      'Failure injection requires a separately named resettable RANK1 database');
  } else if (mode === 'ranking') {
    assert.ok(!/failure/i.test(selectedDatabase),
      'Normal query proof cannot use the failure-injection database');
  }
  assert.ok(path, 'RANK1 target configuration file is required');
  let configuration;
  try {
    configuration = suppliedConfiguration || JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Invalid RANK1 target configuration file.');
  }
  assert.ok(configuration && typeof configuration === 'object' && !Array.isArray(configuration),
    'RANK1 target configuration must be an object');
  const allowedFields = ['connectedDatabase', 'deploymentIdentity', 'serverVersion',
    'authenticatedUser', 'effectiveGrants'];
  assert.ok(Object.keys(configuration).every((field) => allowedFields.includes(field)),
    'Target configuration cannot contain local approval or unverified evidence metadata');
  assert.equal(configuration.connectedDatabase, selectedDatabase,
    'Configured database differs from the selected database');
  const identity = configuration.deploymentIdentity;
  assert.ok(identity && typeof identity === 'object' && !Array.isArray(identity),
    'Expected deployment identity is required');
  assert.ok(Object.keys(identity).every((field) => ['setName', 'hosts', 'me'].includes(field))
    && (identity.setName === null || typeof identity.setName === 'string')
    && Array.isArray(identity.hosts) && identity.hosts.every((host) => typeof host === 'string' && host)
    && (identity.me === null || typeof identity.me === 'string')
    && (identity.hosts.length > 0 || identity.me),
  'Expected deployment identity must identify a connected host or replica set');
  assert.ok(/^\d+\.\d+\.\d+/.test(configuration.serverVersion || ''),
    'Expected server version is required');
  assert.ok(configuration.authenticatedUser && typeof configuration.authenticatedUser.user === 'string'
    && configuration.authenticatedUser.user && typeof configuration.authenticatedUser.db === 'string'
    && configuration.authenticatedUser.db,
  'Expected authenticated user is required');
  assert.ok(JSON.stringify(configuration.effectiveGrants)
    === JSON.stringify([{ database: selectedDatabase, role: 'readWrite' }]),
  'Expected grants must contain only isolated-database readWrite');
  return configuration;
}

function requireExternalOperatorApproval() {
  // No trusted verifier is installed. An external gate must independently approve the isolated
  // deployment, disposable database, restricted credentials, FCV, nutrition prerequisite,
  // writer freeze, and the separately resettable failure target before this hold can change.
  const error = new Error('Independent operator approval is required before Mongo connection; '
    + 'local target configuration and approval claims cannot authorize physical proof.');
  error.code = 'RANK1_EXTERNAL_APPROVAL_REQUIRED';
  throw error;
}

function assertConnectedTarget(configuration, { databaseName, hello, build, status }) {
  assert.equal(databaseName, configuration.connectedDatabase,
    'Connected database differs from target configuration');
  const connectedIdentity = {
    setName: hello.setName || null,
    hosts: [...(hello.hosts || [])].sort(),
    me: hello.me || null,
  };
  const expectedIdentity = {
    ...configuration.deploymentIdentity,
    hosts: [...configuration.deploymentIdentity.hosts].sort(),
  };
  assert.ok(JSON.stringify(connectedIdentity) === JSON.stringify(expectedIdentity),
    'Connected deployment identity differs from target configuration');
  assert.equal(build.version, configuration.serverVersion,
    'Runtime server version differs from target configuration');
  const users = status.authInfo?.authenticatedUsers;
  assert.ok(JSON.stringify(users) === JSON.stringify([configuration.authenticatedUser]),
    'Authenticated user differs from target configuration');
  const privileges = status.authInfo?.authenticatedUserPrivileges;
  const roles = status.authInfo?.authenticatedUserRoles;
  assert.ok(JSON.stringify(roles?.map(({ db, role }) => ({ database: db, role })))
    === JSON.stringify(configuration.effectiveGrants),
  'Authenticated roles differ from expected grants');
  assert.ok(Array.isArray(privileges) && privileges.length > 0,
    'Effective credential privileges must be inspectable');
  assert.ok(privileges.every(({ resource }) => resource?.db === configuration.connectedDatabase
    && resource?.anyResource !== true && resource?.cluster !== true),
  'Credential has grants outside the isolated database');
}

async function connectForPhysicalProof() {
  const configuration = requireTargetConfiguration();
  requireExternalOperatorApproval();
  try {
    await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
  } catch {
    throw new Error('Isolated Mongo connection failed.');
  }
  try {
    const admin = mongoose.connection.db.admin();
    const [hello, build, status] = await Promise.all([
      admin.command({ hello: 1 }),
      admin.command({ buildInfo: 1 }),
      admin.command({ connectionStatus: 1, showPrivileges: true }),
    ]);
    assertConnectedTarget(configuration, {
      databaseName: mongoose.connection.db.databaseName, hello, build, status,
    });
    assert.equal(await Recipe.collection.countDocuments({}), 0,
      'Physical proof requires an empty disposable Recipe collection');
    assert.equal(await Review.collection.countDocuments({}), 0,
      'Physical proof requires an empty disposable Review collection');
    assert.equal(await Ingredient.collection.countDocuments({}), 0,
      'Physical proof requires an empty disposable Ingredient collection');
  } catch (error) {
    await mongoose.disconnect();
    throw error;
  }
}

test('live Mongo selector is explicit and valid for this file', () => {
  assertLiveMode();
});

test('requested physical proof fails closed without a URI or external approval', {
  skip: !(liveRequested || failureRequested),
}, () => {
  requireTargetConfiguration();
  requireExternalOperatorApproval();
});

test('physical runner rejects self-approval, malformed targets, and mismatched modes', () => {
  const target = 'mongodb://127.0.0.1/wecooked-rank1-isolated';
  assert.throws(() => requireTargetConfiguration({ selectedUri: '', path: '', mode: 'ranking' }),
    /RECIPE_RANKING_MONGO_URI/);
  assert.throws(() => requireTargetConfiguration({ selectedUri: target, path: '', mode: 'ranking' }),
    /configuration file/);
  assert.throws(() => assertLiveMode({ mode: '', selectedUri: target }),
    /RECIPE_RANKING_MONGO_RUN/);
  assert.throws(() => assertLiveMode({ mode: 'rankings', selectedUri: target }),
    /RECIPE_RANKING_MONGO_RUN/);
  assert.throws(() => assertLiveMode({ mode: 'authoring', selectedUri: target }),
    /only ranking or ranking-failure/);
  const configuration = {
    connectedDatabase: 'wecooked-rank1-isolated',
    deploymentIdentity: { setName: 'qa-replica', hosts: ['qa.example.test:27017'], me: null },
    serverVersion: '8.0.0',
    authenticatedUser: { user: 'rank1-qa', db: 'admin' },
    effectiveGrants: [{ database: 'wecooked-rank1-isolated', role: 'readWrite' }],
  };
  assert.doesNotThrow(() => requireTargetConfiguration({ selectedUri: target,
    path: 'synthetic', configuration, mode: 'ranking' }));
  assert.throws(requireExternalOperatorApproval, { code: 'RANK1_EXTERNAL_APPROVAL_REQUIRED' });
  assert.throws(() => requireTargetConfiguration({ selectedUri: target,
    path: 'synthetic', configuration: { ...configuration, reviewedBy: 'self',
      evidence: { deployment: 'external' } }, mode: 'ranking' }),
  /cannot contain local approval/);
  assert.throws(() => requireTargetConfiguration({ selectedUri: target,
    path: 'synthetic', configuration: { ...configuration, fcv: '8.0',
      writerFreezeActive: true, resettableFailureState: true }, mode: 'ranking' }),
  /unverified evidence metadata/);
  assert.throws(() => requireTargetConfiguration({ selectedUri: target,
    path: 'synthetic', configuration: { ...configuration, deploymentIdentity: 'dedicated-qa' },
    mode: 'ranking' }), /Expected deployment identity/);
  assert.throws(() => requireTargetConfiguration({ selectedUri: target,
    path: 'synthetic', configuration: { ...configuration, connectedDatabase: 'rank1-other-test' },
    mode: 'ranking' }), /Configured database differs/);
  assert.throws(() => requireTargetConfiguration({ selectedUri: target,
    path: 'synthetic', configuration: { ...configuration, effectiveGrants: [
      ...configuration.effectiveGrants, { database: 'wecooked-dev', role: 'readWrite' },
    ] }, mode: 'ranking' }), { code: 'ERR_ASSERTION' });
  assert.throws(() => requireTargetConfiguration({ selectedUri: target,
    path: 'synthetic', configuration, mode: 'ranking-failure' }),
  /separately named resettable/);
  const failureDatabase = 'wecooked-rank1-failure-test';
  const failureUri = `mongodb://127.0.0.1/${failureDatabase}`;
  const failureConfiguration = { ...configuration, connectedDatabase: failureDatabase,
    effectiveGrants: [{ database: failureDatabase, role: 'readWrite' }] };
  assert.doesNotThrow(() => requireTargetConfiguration({ selectedUri: failureUri,
    path: 'synthetic', configuration: failureConfiguration, mode: 'ranking-failure' }));
  assert.throws(() => requireTargetConfiguration({ selectedUri: failureUri,
    path: 'synthetic', configuration: failureConfiguration, mode: 'ranking' }),
  /cannot use the failure-injection database/);
  const runtime = {
    databaseName: configuration.connectedDatabase,
    hello: { setName: 'qa-replica', hosts: ['qa.example.test:27017'] },
    build: { version: '8.0.0' },
    status: { authInfo: {
      authenticatedUsers: [{ user: 'rank1-qa', db: 'admin' }],
      authenticatedUserRoles: [{ db: configuration.connectedDatabase, role: 'readWrite' }],
      authenticatedUserPrivileges: [{ resource: { db: configuration.connectedDatabase,
        collection: '' }, actions: ['find'] }],
    } },
  };
  assert.doesNotThrow(() => assertConnectedTarget(configuration, runtime));
  assert.throws(() => assertConnectedTarget(configuration, { ...runtime,
    databaseName: 'wecooked-dev',
  }), /Connected database differs/);
  assert.throws(() => assertConnectedTarget(configuration, { ...runtime,
    hello: { ...runtime.hello, setName: 'shared-replica' },
  }), /Connected deployment identity differs/);
  assert.throws(() => assertConnectedTarget(configuration, { ...runtime,
    status: { authInfo: { ...runtime.status.authInfo,
      authenticatedUserRoles: [{ db: 'wecooked-dev', role: 'readWrite' }],
    } },
  }), /Authenticated roles differ/);
  assert.throws(() => assertConnectedTarget(configuration, { ...runtime,
    status: { authInfo: { ...runtime.status.authInfo,
      authenticatedUserPrivileges: [{ resource: { db: 'wecooked-dev', collection: '' },
        actions: ['insert'] }],
    } },
  }), /grants outside the isolated database/);
});

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

test('isolated Mongo backfills populated legacy Recipes and preserves all other fields', {
  skip: !liveRequested,
  timeout: 60000,
}, async () => {
  await connectForPhysicalProof();
  const ids = Array.from({ length: 5 }, () => new mongoose.Types.ObjectId());
  const actorId = new mongoose.Types.ObjectId();
  const now = new Date('2026-10-11T00:00:00.000Z');
  const nutrition = {
    schemaVersion: 1, basis: 'perServing', caloriesKcal: 300,
    proteinGrams: 20, carbohydrateGrams: 20, fatGrams: 12,
    sugarGrams: 3, fiberGrams: 2,
  };
  const provenance = { sourceKind: 'manual', sourceLabel: 'Verified panel',
    acceptedBy: actorId, acceptedAt: now };
  const base = {
    description: 'Complete legacy Recipe with preserved data.',
    difficulty: 'easy', cookTimeMinutes: 20, servings: 4,
    ingredients: [{ ingredientId: actorId, quantity: 1, unit: 'piece', optional: false }],
    instructions: ['Cook until ready.'], dietaryTags: ['vegetarian'],
    isActive: true, publicationStatus: 'published', createdAt: now, updatedAt: now,
    createdBy: actorId, __v: 5,
  };
  const rows = [
    { ...base, _id: ids[0], title: 'Legacy public sources',
      imageUrl: 'https://example.com/image.jpg', nutrition,
      nutritionProvenance: { ...provenance, sourceUrl: 'https://example.com/panel' } },
    { ...base, _id: ids[1], title: 'Legacy hostile sources',
      imageUrl: 'https://2130706433/image.jpg', imageUrlIsPublicHttps: true,
      nutrition, nutritionProvenance: { ...provenance, sourceUrl: 'https://loc%61lhost/panel' },
      nutritionSourceUrlIsPublicHttps: true },
    { ...base, _id: ids[2], title: 'Legacy optional sources',
      nutrition, nutritionProvenance: { ...provenance } },
    { ...base, _id: ids[3], title: 'Legacy stale public image',
      imageUrl: 'https://example.com/other.jpg', imageUrlIsPublicHttps: false,
      nutritionSourceUrlIsPublicHttps: false },
    { ...base, _id: ids[4], title: 'Legacy aligned absent nutrition',
      imageUrlIsPublicHttps: false, nutritionSourceUrlIsPublicHttps: false },
  ];
  const readRows = () => Recipe.collection.find({ _id: { $in: ids } }).sort({ _id: 1 }).toArray();
  const withoutDerived = (row) => {
    const { imageUrlIsPublicHttps, nutritionSourceUrlIsPublicHttps, ...other } = row;
    return other;
  };
  try {
    await Ingredient.collection.insertOne({ _id: actorId,
      name: `Rank1 legacy ${actorId}`, slug: `rank1-legacy-${actorId}`,
      category: 'other', isActive: true, createdAt: now, updatedAt: now });
    await Recipe.collection.insertMany(rows);
    const before = await readRows();
    assert.equal(before.length, 5, 'Recipes must be populated before migration');
    const dry = await migrateRecipeRankingIndex({ collection: Recipe.collection, logger: silentLogger });
    assert.equal(dry.totalRecipeCount, 5);
    assert.equal(dry.publicHttpsImageCount, 2);
    assert.equal(dry.invalidImageCount, 1);
    assert.equal(dry.absentImageCount, 2);
    assert.equal(dry.missingDerivedCount, 2);
    assert.equal(dry.staleDerivedCount, 2);
    assert.equal(dry.alignedDerivedCount, 1);
    assert.equal(dry.publicHttpsNutritionSourceCount, 1);
    assert.equal(dry.invalidNutritionSourceCount, 1);
    assert.equal(dry.absentNutritionSourceCount, 3);
    assert.equal(dry.missingNutritionDerivedCount, 2);
    assert.equal(dry.staleNutritionDerivedCount, 1);
    assert.equal(dry.alignedNutritionDerivedCount, 2);
    assert.equal(dry.wouldModifyCount, 4);
    assert.deepEqual(await readRows(), before, 'dry-run must not change a Recipe');

    const first = await migrateRecipeRankingIndex({ collection: Recipe.collection,
      apply: true, logger: silentLogger });
    assert.equal(first.created, Number(dry.wouldCreate));
    assert.equal(first.plannedModifyCount, 4);
    assert.equal(first.modifiedCount, 4);
    assert.equal(first.wouldModifyCount, 0);
    assert.equal(first.alignedDerivedCount, 5);
    assert.equal(first.alignedNutritionDerivedCount, 5);
    assert.equal(first.derivedAligned, true);
    const indexes = await Recipe.collection.listIndexes().toArray();
    assert.equal(analyzeIndexes(indexes).exact, true);
    assert.deepEqual(indexes.find((index) => index.name === FROZEN_INDEX.options.name)?.weights,
      FROZEN_INDEX.options.weights);
    const after = await readRows();
    const byId = new Map(after.map((row) => [String(row._id), row]));
    assert.deepEqual(ids.map((id) => {
      const row = byId.get(String(id));
      return [row.imageUrlIsPublicHttps, row.nutritionSourceUrlIsPublicHttps];
    }), [[true, true], [false, false], [false, false], [true, false], [false, false]]);
    assert.deepEqual(after.map(withoutDerived), before.map(withoutDerived),
      'backfill may change only the two derived facts');
    const second = await migrateRecipeRankingIndex({ collection: Recipe.collection,
      apply: true, logger: silentLogger });
    assert.equal(second.created, 0);
    assert.equal(second.plannedModifyCount, 0);
    assert.equal(second.modifiedCount, 0);
    assert.deepEqual(await readRows(), after);
    physicalBackfillPassed = true;
  } finally {
    await Recipe.collection.deleteMany({ _id: { $in: ids } });
    await Ingredient.collection.deleteOne({ _id: actorId });
    await mongoose.disconnect();
  }
});

test('isolated Mongo rejects stale backfill and recovers after partial physical progress', {
  skip: !failureRequested,
  timeout: 60000,
}, async () => {
  await connectForPhysicalProof();
  const ids = Array.from({ length: 3 }, () => new mongoose.Types.ObjectId());
  const ingredientId = new mongoose.Types.ObjectId();
  const now = new Date('2026-10-11T00:00:00.000Z');
  const collection = Recipe.collection;
  const wrapper = (updateOne) => ({
    listIndexes: (...args) => collection.listIndexes(...args),
    find: (...args) => collection.find(...args),
    updateOne,
    createIndex: () => { throw new Error('Unexpected index creation in recovery fixture'); },
  });
  try {
    const initialized = await migrateRecipeRankingIndex({ collection, apply: true,
      logger: silentLogger });
    assert.equal(initialized.totalRecipeCount, 0);
    assert.equal(analyzeIndexes(await collection.listIndexes().toArray()).exact, true);
    await Ingredient.collection.insertOne({ _id: ingredientId,
      name: `Rank1 recovery ${ingredientId}`, slug: `rank1-recovery-${ingredientId}`,
      category: 'other', isActive: true, createdAt: now, updatedAt: now });
    const base = {
      description: 'Complete Recipe for recovery proof.', difficulty: 'easy',
      cookTimeMinutes: 20, servings: 4,
      ingredients: [{ ingredientId, quantity: 1, unit: 'piece', optional: false }],
      instructions: ['Cook until ready.'], dietaryTags: [],
      imageUrl: 'https://example.com/image.jpg',
      nutrition: { schemaVersion: 1, basis: 'perServing', caloriesKcal: 300,
        proteinGrams: 20, carbohydrateGrams: 20, fatGrams: 12,
        sugarGrams: 3, fiberGrams: 2 },
      nutritionProvenance: { sourceKind: 'manual', sourceLabel: 'Verified panel',
        acceptedBy: ingredientId, acceptedAt: now, sourceUrl: 'https://example.com/panel' },
      isActive: true, publicationStatus: 'published', createdAt: now, updatedAt: now,
    };
    await collection.insertMany(ids.slice(0, 2).map((_id, index) => ({
      ...base, _id, title: `Partial progress ${index}`,
    })));
    let writes = 0;
    await assert.rejects(() => migrateRecipeRankingIndex({
      collection: wrapper((filter, update) => {
        writes += 1;
        if (writes === 2) throw new Error('Controlled test-driver write failure');
        return collection.updateOne(filter, update);
      }), apply: true, logger: silentLogger,
    }), (error) => {
      assert.equal(error.code, 'RECIPE_RANKING_MIGRATION_WRITE_FAILED');
      assert.equal(error.report.modifiedCount, 1);
      assert.equal(error.report.partialApply, true);
      assert.equal(error.report.created, 0);
      const lines = [];
      logCommandFailure(error, { error: (line) => lines.push(line) });
      const safe = JSON.parse(lines[0].replace('[recipe-ranking-index] failed: ', ''));
      assert.equal(safe.code, error.code);
      assert.equal(safe.modifiedCount, 1);
      assert.equal(safe.partialApply, true);
      assert.doesNotMatch(lines[0], /mongodb:\/\//);
      return true;
    });
    assert.equal((await collection.countDocuments({ _id: { $in: ids.slice(0, 2) },
      imageUrlIsPublicHttps: true, nutritionSourceUrlIsPublicHttps: true })), 1);
    const recovered = await migrateRecipeRankingIndex({ collection, apply: true, logger: silentLogger });
    assert.equal(recovered.plannedModifyCount, 1);
    assert.equal(recovered.modifiedCount, 1);
    assert.equal(recovered.derivedAligned, true);
    assert.equal((await migrateRecipeRankingIndex({ collection, apply: true,
      logger: silentLogger })).modifiedCount, 0);

    await collection.insertOne({ ...base, _id: ids[2], title: 'Stale snapshot',
      imageUrl: 'https://example.com/old.jpg',
      nutritionProvenance: { ...base.nutritionProvenance,
        sourceUrl: 'https://example.com/old-panel' } });
    let attempted = false;
    await assert.rejects(() => migrateRecipeRankingIndex({
      collection: wrapper(async (filter, update) => {
        assert.equal(attempted, false);
        attempted = true;
        await collection.updateOne({ _id: ids[2] }, {
          $set: { imageUrl: 'https://example.com/new.jpg' },
        });
        return collection.updateOne(filter, update);
      }), apply: true, logger: silentLogger,
    }), (error) => error.code === 'RECIPE_RANKING_MIGRATION_STALE_SNAPSHOT'
      && error.report.modifiedCount === 0 && error.report.partialApply === false);
    const stale = await collection.findOne({ _id: ids[2] });
    assert.equal(stale.imageUrl, 'https://example.com/new.jpg');
    assert.equal(Object.hasOwn(stale, 'imageUrlIsPublicHttps'), false);
    assert.equal(Object.hasOwn(stale, 'nutritionSourceUrlIsPublicHttps'), false);
    const rerun = await migrateRecipeRankingIndex({ collection, apply: true, logger: silentLogger });
    assert.equal(rerun.modifiedCount, 1);
    assert.equal(rerun.derivedAligned, true);
    assert.equal((await migrateRecipeRankingIndex({ collection, apply: true,
      logger: silentLogger })).modifiedCount, 0);
  } finally {
    await collection.deleteMany({ _id: { $in: ids } });
    await Ingredient.collection.deleteOne({ _id: ingredientId });
    await mongoose.disconnect();
  }
});

test('isolated Mongo proves physical text index, relevance, raw Top Rated order, and live Review reflection', {
  skip: !liveRequested,
  timeout: 60000,
}, async () => {
  assert.equal(physicalBackfillPassed, true,
    'Physical backfill and index verification must precede query activation');
  await connectForPhysicalProof();

  const ingredientId = new mongoose.Types.ObjectId();
  const ids = [0, 1, 2, 3, 4, 5].map(() => new mongoose.Types.ObjectId());
  const tieIds = [0, 1].map(() => new mongoose.Types.ObjectId());
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
      ...tieIds.map((_id) => ({ ...base, _id, title: 'Sinigang Feast',
        description: 'A bright broth.' })),
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

    const relevancePage = (page) => recipeService.listRecipes({
      search: 'sinigang feast', ingredientId: String(ingredientId), status: 'active', page, limit: 2,
      sort: 'relevance', isAdmin: false,
    });
    const relevancePages = await Promise.all([relevancePage(1), relevancePage(2),
      relevancePage(1), relevancePage(2)]);
    const expectedRelevance = [...[ids[0], ...tieIds].map(String).sort(), String(ids[1])];
    assert.deepEqual(relevancePages.map(({ total }) => total), [4, 4, 4, 4]);
    assert.deepEqual(relevancePages.map(({ items }) => items.map((row) => String(row._id))), [
      expectedRelevance.slice(0, 2), expectedRelevance.slice(2),
      expectedRelevance.slice(0, 2), expectedRelevance.slice(2),
    ]);
    const rawScores = await Recipe.aggregate([
      { $match: { _id: { $in: [ids[0], ids[1], ...tieIds] },
        $text: { $search: 'sinigang feast' } } },
      { $project: { _id: 1, score: { $meta: 'textScore' } } },
      { $sort: { score: -1, _id: 1 } },
    ]);
    assert.deepEqual(rawScores.map((row) => String(row._id)), expectedRelevance);
    assert.ok(rawScores[2].score > rawScores[3].score,
      'weighted title hits must outrank description hits');
    assert.equal(rawScores[0].score, rawScores[1].score);
    assert.equal(rawScores[1].score, rawScores[2].score);

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
    const nutritionPage = (page) => recipeService.listRecipes({
      search: 'Nutrition Probe', ingredientId: String(ingredientId), status: 'active',
      page, limit: 1, sort: 'titleAsc', isAdmin: false,
    });
    const nutritionPages = await Promise.all([nutritionPage(1), nutritionPage(2), nutritionPage(3),
      nutritionPage(1), nutritionPage(2)]);
    assert.deepEqual(nutritionPages.map(({ total }) => total), [2, 2, 2, 2, 2]);
    assert.deepEqual(nutritionPages.map(({ items }) => items.map((row) => String(row._id))), [
      [String(nutritionIds[1])], [String(nutritionIds[0])], [],
      [String(nutritionIds[1])], [String(nutritionIds[0])],
    ]);

    const topRated = await recipeService.listRecipes({
      ingredientId: String(ingredientId), status: 'active', page: 1, limit: 20, sort: 'topRated', isAdmin: false,
    });
    const proofItems = topRated.items.filter((recipe) => ids.some((id) => id.equals(recipe._id)));
    assert.deepEqual(proofItems.slice(0, 2).map((recipe) => String(recipe._id)), [String(ids[0]), String(ids[1])]);
    assert.equal(proofItems[0]._ratingSummary.averageRating, 4.5);
    assert.equal(proofItems[1]._ratingSummary.averageRating, 4.5);
    assert.ok(proofItems[0]._ratingSummary.ratingCount < proofItems[1]._ratingSummary.ratingCount);
    const ratedPage = (page) => recipeService.listRecipes({
      ingredientId: String(ingredientId), status: 'active', page, limit: 1,
      sort: 'topRated', isAdmin: false,
    });
    const ratedPages = await Promise.all([ratedPage(1), ratedPage(2), ratedPage(3),
      ratedPage(1), ratedPage(2)]);
    assert.deepEqual(ratedPages.map(({ total }) => total), [2, 2, 2, 2, 2]);
    assert.deepEqual(ratedPages.map(({ items }) => items.map((row) => String(row._id))), [
      [String(ids[0])], [String(ids[1])], [], [String(ids[0])], [String(ids[1])],
    ]);

    const newcomerReview = reviewRows(ids[2], [5])[0];
    await Review.collection.insertOne(newcomerReview);
    let reflected = await recipeService.listRecipes({
      ingredientId: String(ingredientId), status: 'active', page: 1, limit: 20, sort: 'topRated', isAdmin: false,
    });
    assert.ok(reflected.items.some((recipe) => String(recipe._id) === String(ids[2])));
    assert.equal(reflected.total, 3);
    assert.equal(String(reflected.items[0]._id), String(ids[2]));

    await Review.collection.updateOne({ _id: newcomerReview._id }, { $set: { rating: 1 } });
    reflected = await recipeService.listRecipes({
      ingredientId: String(ingredientId), status: 'active', page: 1, limit: 20, sort: 'topRated', isAdmin: false,
    });
    assert.equal(reflected.items.find((recipe) => String(recipe._id) === String(ids[2]))._ratingSummary.averageRating, 1);
    assert.equal(String(reflected.items.at(-1)._id), String(ids[2]));

    await Review.collection.deleteOne({ _id: newcomerReview._id });
    reflected = await recipeService.listRecipes({
      ingredientId: String(ingredientId), status: 'active', page: 1, limit: 20, sort: 'topRated', isAdmin: false,
    });
    assert.equal(reflected.items.some((recipe) => String(recipe._id) === String(ids[2])), false);
    assert.equal(reflected.total, 2);
  } finally {
    await Review.collection.deleteMany({ recipeId: { $in: ids } });
    await Recipe.collection.deleteMany({ _id: { $in: [...ids, ...tieIds, ...utf16Ids, ...nutritionIds] } });
    await Ingredient.collection.deleteOne({ _id: ingredientId });
    await mongoose.disconnect();
  }
});

test('isolated Mongo proves missing, zero, and positive Recipe CAS plus a same-millisecond stale conflict', {
  skip: !liveRequested,
  timeout: 60000,
}, async (t) => {
  await connectForPhysicalProof();
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
    recipeRepository.findRawById.mock.mockImplementation(async () => Recipe.collection.findOne({ _id: ids[3] }));
    await recipeService.updateRecipe(ids[3], { title: 'Fresh reread edit' },
      { actorId: ingredientId, now: timestamp });
    const afterReread = await Recipe.collection.findOne({ _id: ids[3] });
    assert.equal(afterReread.__v, 7);
    assert.equal(afterReread.title, 'Fresh reread edit');
    assert.equal(afterReread.nutritionSourceUrlIsPublicHttps,
      Boolean(afterReread.nutritionProvenance?.sourceUrl));
    assert.equal(afterReread.imageUrlIsPublicHttps, false);
  } finally {
    await Recipe.collection.deleteMany({ _id: { $in: ids } });
    await Ingredient.collection.deleteOne({ _id: ingredientId });
    await mongoose.disconnect();
  }
});
