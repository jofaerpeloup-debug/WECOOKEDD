process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');

const { isPublicHttpsUrl } = require('../src/shared/validation/public-https-url');
const {
  DERIVED_FIELD,
  NUTRITION_DERIVED_FIELD,
  FROZEN_INDEX,
  MIGRATION_CONNECTION_OPTIONS,
  PRODUCTION_DATABASE_NAME,
  analyzeIndexes,
  deriveImageUrlIsPublicHttps,
  deriveNutritionSourceUrlIsPublicHttps,
  migrateRecipeRankingIndex,
  parseCommandFlags,
  assertCommandTarget,
  runMigrationCommand,
  logCommandFailure,
} = require('../scripts/migrate-recipe-ranking-index');

const silentLogger = { log() {} };

function exactIndex() {
  return {
    name: FROZEN_INDEX.options.name,
    key: { _fts: 'text', _ftsx: 1 },
    weights: { title: 10, description: 1 },
    default_language: 'english',
    language_override: 'language',
    textIndexVersion: 3,
  };
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function matches(document, filter) {
  if (filter.$and && !filter.$and.every((condition) => matches(document, condition))) return false;
  return Object.entries(filter).every(([field, expected]) => {
    if (field === '$and') return true;
    if (expected && typeof expected === 'object' && hasOwn(expected, '$exists')) {
      return hasOwn(document, field) === expected.$exists;
    }
    return isDeepStrictEqual(document[field], expected);
  });
}

function collection(
  indexes = [{ name: '_id_', key: { _id: 1 } }],
  documents = []
) {
  const indexState = structuredClone(indexes);
  const documentState = structuredClone(documents);
  const calls = { creates: [], drops: [], writes: [], finds: [] };
  return {
    calls,
    documents: documentState,
    listIndexes() { return { toArray: async () => structuredClone(indexState) }; },
    find(filter, options) {
      calls.finds.push({ filter, options });
      return { toArray: async () => structuredClone(documentState) };
    },
    async createIndex(key, options) {
      calls.creates.push({ key, options });
      indexState.push({ ...exactIndex(), name: options.name, weights: options.weights });
      return options.name;
    },
    async dropIndex(name) { calls.drops.push(name); },
    async updateOne(filter, update) {
      calls.writes.push({ filter: structuredClone(filter), update: structuredClone(update) });
      const document = documentState.find((item) => matches(item, filter));
      if (!document) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
      Object.assign(document, update.$set);
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    },
  };
}

test('dry-run scans every Recipe with a bounded projection and performs zero writes', async () => {
  const recipes = collection(undefined, [
    { _id: 'public', imageUrl: 'https://example.com/a.jpg' },
    { _id: 'private', imageUrl: 'https://2130706433/a.jpg', imageUrlIsPublicHttps: true },
  ]);
  const report = await migrateRecipeRankingIndex({ collection: recipes, logger: silentLogger });
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.wouldCreate, true);
  assert.equal(report.created, 0);
  assert.equal(report.publicHttpsImageCount, 1);
  assert.equal(report.invalidImageCount, 1);
  assert.equal(report.absentImageCount, 0);
  assert.equal(report.missingDerivedCount, 1);
  assert.equal(report.staleDerivedCount, 1);
  assert.equal(report.wouldModifyCount, 2);
  assert.deepEqual(recipes.calls.finds[0], {
    filter: {},
    options: { projection: {
      _id: 1, imageUrl: 1, nutritionProvenance: 1,
      imageUrlIsPublicHttps: 1, nutritionSourceUrlIsPublicHttps: 1,
    } },
  });
  assert.equal(recipes.calls.creates.length, 0);
  assert.equal(recipes.calls.drops.length, 0);
  assert.equal(recipes.calls.writes.length, 0);
});

test('a missing Recipe collection is an empty catalogue and empty backfill', async () => {
  const recipes = collection();
  const missing = Object.assign(new Error('missing'), { code: 26 });
  recipes.listIndexes = () => ({ toArray: async () => { throw missing; } });
  recipes.find = () => ({ toArray: async () => { throw missing; } });
  const report = await migrateRecipeRankingIndex({ collection: recipes, logger: silentLogger });
  assert.equal(report.wouldCreate, true);
  assert.equal(report.totalRecipeCount, 0);
  assert.equal(report.wouldModifyCount, 0);
  assert.equal(recipes.calls.creates.length, 0);
});

test('an exact index plus aligned derived fields is an apply no-op', async () => {
  const recipes = collection([exactIndex()], [
    { _id: 'public', imageUrl: 'https://example.com/a.jpg', imageUrlIsPublicHttps: true, nutritionSourceUrlIsPublicHttps: false },
    { _id: 'absent', imageUrlIsPublicHttps: false, nutritionSourceUrlIsPublicHttps: false },
  ]);
  const report = await migrateRecipeRankingIndex({ collection: recipes, apply: true, logger: silentLogger });
  assert.equal(report.exact, true);
  assert.equal(report.derivedAligned, true);
  assert.equal(report.created, 0);
  assert.equal(report.modifiedCount, 0);
  assert.equal(recipes.calls.creates.length, 0);
  assert.equal(recipes.calls.writes.length, 0);
});

test('conflicting name, text index, and logical options block index and document writes', async () => {
  const conflicts = [
    { ...exactIndex(), weights: { title: 1, description: 1 } },
    { ...exactIndex(), name: 'other_text_index' },
    { ...exactIndex(), unique: true },
    { ...exactIndex(), sparse: true },
    { ...exactIndex(), expireAfterSeconds: 10 },
    { ...exactIndex(), partialFilterExpression: { isActive: true } },
    { ...exactIndex(), hidden: true },
    { ...exactIndex(), default_language: 'spanish' },
    { ...exactIndex(), language_override: 'locale' },
  ];
  for (const conflict of conflicts) {
    const recipes = collection([conflict], [{ _id: 'needs-backfill' }]);
    await assert.rejects(
      () => migrateRecipeRankingIndex({ collection: recipes, apply: true, logger: silentLogger }),
      (error) => error.report.blockers.length === 1
    );
    assert.equal(recipes.calls.creates.length, 0);
    assert.equal(recipes.calls.drops.length, 0);
    assert.equal(recipes.calls.writes.length, 0);
  }
});

test('apply backfills only the derived field, creates the exact index, verifies, and reruns idempotently', async () => {
  const recipes = collection(undefined, [
    { _id: 'absent' },
    { _id: 'public', imageUrl: 'https://example.com/a.jpg' },
    { _id: 'private', imageUrl: 'https://0x7f000001/a.jpg', imageUrlIsPublicHttps: true },
    { _id: 'aligned', imageUrl: 'https://cdn.example/a.jpg', imageUrlIsPublicHttps: true, nutritionSourceUrlIsPublicHttps: false },
  ]);
  const first = await migrateRecipeRankingIndex({ collection: recipes, apply: true, logger: silentLogger });
  assert.equal(first.created, 1);
  assert.equal(first.plannedModifyCount, 3);
  assert.equal(first.modifiedCount, 3);
  assert.equal(first.wouldModifyCount, 0);
  assert.equal(first.derivedAligned, true);
  assert.deepEqual(recipes.calls.creates, [{ key: FROZEN_INDEX.key, options: FROZEN_INDEX.options }]);
  assert.deepEqual(
    recipes.documents.map((document) => [document._id, document[DERIVED_FIELD]]),
    [['absent', false], ['public', true], ['private', false], ['aligned', true]]
  );
  for (const call of recipes.calls.writes) {
    assert.deepEqual(Object.keys(call.update.$set), [DERIVED_FIELD, NUTRITION_DERIVED_FIELD]);
    assert.equal(call.filter.$and.length, 4, 'both URLs and both prior-derived snapshots must guard the write');
  }

  const second = await migrateRecipeRankingIndex({ collection: recipes, apply: true, logger: silentLogger });
  assert.equal(second.created, 0);
  assert.equal(second.modifiedCount, 0);
  assert.equal(second.plannedModifyCount, 0);
  assert.equal(recipes.calls.creates.length, 1);
  assert.equal(recipes.calls.writes.length, 3);
  assert.equal(recipes.calls.drops.length, 0);
});

test('the migration classifier delegates WHATWG-normalized boundaries to isPublicHttpsUrl', () => {
  const cases = [
    'https://127.0.0.1\\a.jpg',
    'https://10.0.0.1\\a.jpg',
    'https://2130706433/a.jpg',
    'https://0x7f000001/a.jpg',
    'https://0177.0.0.1/a.jpg',
    'https://192.168.1/a.jpg',
    'https://loc%61lhost/a.jpg',
    'https://foo.loc%61lhost/a.jpg',
    'https://１２７.０.０.１/a.jpg',
    'https://fca.example/a.jpg',
    'https://fd.example/a.jpg',
    'https://fe8.example/a.jpg',
    'https://example.com/a.jpg',
  ];
  for (const value of cases) {
    assert.equal(
      deriveImageUrlIsPublicHttps(`  ${value}  `),
      isPublicHttpsUrl(value),
      `migration classifier must delegate ${value}`
    );
  }
  assert.equal(deriveImageUrlIsPublicHttps(null), false);
  assert.equal(deriveImageUrlIsPublicHttps(123), false);
});

test('two-field backfill classifies optional, public, and hostile nutrition source URLs independently', async () => {
  const recipes = collection([exactIndex()], [
    { _id: 'optional', imageUrlIsPublicHttps: false,
      nutritionProvenance: { sourceKind: 'manual', sourceLabel: 'Panel' } },
    { _id: 'public', imageUrlIsPublicHttps: false,
      nutritionProvenance: { sourceUrl: '  https://example.com/panel  ' } },
    { _id: 'private', imageUrlIsPublicHttps: false,
      nutritionProvenance: { sourceUrl: 'https://loc%61lhost/panel' },
      nutritionSourceUrlIsPublicHttps: true },
  ]);
  const dryRun = await migrateRecipeRankingIndex({ collection: recipes, logger: silentLogger });
  assert.equal(dryRun.publicHttpsNutritionSourceCount, 1);
  assert.equal(dryRun.absentNutritionSourceCount, 1);
  assert.equal(dryRun.invalidNutritionSourceCount, 1);
  assert.equal(dryRun.missingNutritionDerivedCount, 2);
  assert.equal(dryRun.staleNutritionDerivedCount, 1);
  assert.equal(dryRun.imageWouldModifyCount, 0);
  assert.equal(dryRun.nutritionWouldModifyCount, 3);
  assert.equal(recipes.calls.writes.length, 0);
  const applied = await migrateRecipeRankingIndex({ collection: recipes, apply: true, logger: silentLogger });
  assert.equal(applied.modifiedCount, 3);
  assert.deepEqual(recipes.documents.map((row) => row[NUTRITION_DERIVED_FIELD]), [false, true, false]);
  assert.ok(recipes.calls.writes.every((call) => Object.keys(call.update.$set).length === 1));
  assert.ok(recipes.calls.writes.every((call) => call.filter.$and.length === 4));
  const second = await migrateRecipeRankingIndex({ collection: recipes, apply: true, logger: silentLogger });
  assert.equal(second.modifiedCount, 0);
});

test('created index with zero document updates remains partial progress after derived postcondition failure', async () => {
  const recipes = collection(undefined, []);
  let scans = 0;
  recipes.find = () => ({ toArray: async () => {
    scans += 1;
    return scans === 1 ? [] : [{ _id: 'concurrent', imageUrl: 'https://example.com/new.jpg' }];
  } });
  await assert.rejects(
    () => migrateRecipeRankingIndex({ collection: recipes, apply: true, logger: silentLogger }),
    (error) => error.code === 'RECIPE_RANKING_DERIVED_POSTCONDITION_FAILED'
      && error.report.created === 1
      && error.report.modifiedCount === 0
      && error.report.failedPostcondition === 'derivedFields'
      && error.report.partialApply === true
  );
  assert.equal(recipes.calls.creates.length, 1);
  assert.equal(recipes.calls.writes.length, 0);
});

test('sanitized CLI failure includes actual migration code and progress', () => {
  const lines = [];
  logCommandFailure({
    code: 'RECIPE_RANKING_DERIVED_POSTCONDITION_FAILED',
    message: 'mongodb://user:secret@hidden',
    report: { created: 1, modifiedCount: 0, failedPostcondition: 'derivedFields', partialApply: true },
  }, { error: (line) => lines.push(line) });
  const output = JSON.parse(lines[0].replace('[recipe-ranking-index] failed: ', ''));
  assert.deepEqual(output, {
    message: 'Recipe ranking migration failed.',
    code: 'RECIPE_RANKING_DERIVED_POSTCONDITION_FAILED',
    causeCode: null,
    indexCreated: true,
    modifiedCount: 0,
    failedPostcondition: 'derivedFields',
    partialApply: true,
  });
  assert.doesNotMatch(lines[0], /secret|mongodb:\/\//);
});

test('a stale guarded snapshot stops before index creation and never overwrites concurrent state', async () => {
  const recipes = collection(undefined, [{ _id: 'changed', imageUrl: 'https://example.com/a.jpg' }]);
  recipes.updateOne = async (filter, update) => {
    recipes.calls.writes.push({ filter, update });
    recipes.documents[0].imageUrl = 'https://other.example/b.jpg';
    return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
  };
  await assert.rejects(
    () => migrateRecipeRankingIndex({ collection: recipes, apply: true, logger: silentLogger }),
    (error) => error.code === 'RECIPE_RANKING_MIGRATION_STALE_SNAPSHOT'
  );
  assert.equal(recipes.documents[0][DERIVED_FIELD], undefined);
  assert.equal(recipes.calls.creates.length, 0);
});

test('apply rereads every Recipe and fails if a concurrent writer leaves an unclassified row', async () => {
  const recipes = collection([exactIndex()], [{ _id: 'initial' }]);
  const originalUpdate = recipes.updateOne.bind(recipes);
  recipes.updateOne = async (...args) => {
    const result = await originalUpdate(...args);
    recipes.documents.push({ _id: 'concurrent', imageUrl: 'https://example.com/new.jpg' });
    return result;
  };

  await assert.rejects(
    () => migrateRecipeRankingIndex({ collection: recipes, apply: true, logger: silentLogger }),
    (error) => /derived-field postcondition/.test(error.message)
      && error.report.wouldModifyCount === 1
  );
});

test('write failure reports partial progress and stops without creating the index', async () => {
  const recipes = collection(undefined, [{ _id: 'first' }, { _id: 'second' }]);
  const originalUpdate = recipes.updateOne.bind(recipes);
  let calls = 0;
  recipes.updateOne = async (...args) => {
    calls += 1;
    if (calls === 2) throw new Error('write failed');
    return originalUpdate(...args);
  };
  await assert.rejects(
    () => migrateRecipeRankingIndex({ collection: recipes, apply: true, logger: silentLogger }),
    (error) => error.code === 'RECIPE_RANKING_MIGRATION_WRITE_FAILED'
      && error.report.modifiedCount === 1
      && error.report.partialApply === true
  );
  assert.equal(recipes.calls.creates.length, 0);
});

test('post-create catalogue drift fails closed', async () => {
  const recipes = collection();
  recipes.createIndex = async () => {
    recipes.calls.creates.push({ bad: true });
  };
  await assert.rejects(
    () => migrateRecipeRankingIndex({ collection: recipes, apply: true, logger: silentLogger }),
    /postcondition/
  );
});

test('index creation failure reports a completed derived-field partial apply', async () => {
  const recipes = collection(undefined, [{ _id: 'backfill-first' }]);
  recipes.createIndex = async () => { throw new Error('index failed'); };

  await assert.rejects(
    () => migrateRecipeRankingIndex({ collection: recipes, apply: true, logger: silentLogger }),
    (error) => error.code === 'RECIPE_RANKING_INDEX_WRITE_FAILED'
      && error.report.modifiedCount === 1
      && error.report.partialApply === true
  );
  assert.equal(recipes.documents[0].imageUrlIsPublicHttps, false);
});

test('CLI is dry-run by default and preserves isolated non-production apply safety', () => {
  assert.deepEqual(parseCommandFlags([]), { apply: false, allowProduction: false });
  assert.deepEqual(parseCommandFlags(['--apply']), { apply: true, allowProduction: false });
  assert.deepEqual(parseCommandFlags(['--allow-production']), {
    apply: false,
    allowProduction: true,
  });
  assert.deepEqual(parseCommandFlags(['--apply', '--allow-production']), {
    apply: true,
    allowProduction: true,
  });
  assert.throws(() => parseCommandFlags(['--force']));
  assert.throws(() => parseCommandFlags(['--allow-production', '--allow-production']));
  assert.doesNotThrow(() => assertCommandTarget('mongodb://x/wecooked-rank1-test', { apply: true }));
  assert.doesNotThrow(() => assertCommandTarget('mongodb://x/rank1-isolated-proof', { apply: true }));
  assert.doesNotThrow(() => assertCommandTarget('mongodb://x/wecooked-dev'));
  for (const uri of [
    '',
    'mongodb://x/wecooked-production-rank1-test',
    'mongodb://x/wecooked-rank1',
    'mongodb://x/wecooked-test',
    'mongodb://x/wecooked-dev',
  ]) {
    assert.throws(() => assertCommandTarget(uri, { apply: true }), /Refusing/);
  }
});

test('production is denied without explicit approval and never connects', async () => {
  let connected = false;
  await assert.rejects(() => runMigrationCommand({
    uri: `mongodb://x/${PRODUCTION_DATABASE_NAME}`,
    connect: async () => { connected = true; },
  }), /non-production database binding/);
  assert.equal(connected, false);
});

test('production approval rejects every database name except the exact production identity', async () => {
  for (const name of [
    'wecooked-production-copy',
    'wecooked-prod',
    'WECOOKED-PRODUCTION',
    'wecooked-rank1-test',
  ]) {
    let connected = false;
    await assert.rejects(() => runMigrationCommand({
      argv: ['--allow-production'],
      uri: `mongodb://x/${name}`,
      nodeEnv: 'production',
      connect: async () => { connected = true; },
    }), new RegExp(PRODUCTION_DATABASE_NAME));
    assert.equal(connected, false);
  }
});

test('production approval requires NODE_ENV=production before connecting', async () => {
  let connected = false;
  await assert.rejects(() => runMigrationCommand({
    argv: ['--allow-production'],
    uri: `mongodb://x/${PRODUCTION_DATABASE_NAME}`,
    nodeEnv: 'test',
    connect: async () => { connected = true; },
  }), /NODE_ENV=production/);
  assert.equal(connected, false);
});

test('CLI derives production authorization from process.env.NODE_ENV without injection', async (t) => {
  const previousNodeEnv = process.env.NODE_ENV;
  t.after(() => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  });

  process.env.NODE_ENV = 'test';
  let connected = false;
  await assert.rejects(() => runMigrationCommand({
    argv: ['--allow-production'],
    uri: `mongodb://x/${PRODUCTION_DATABASE_NAME}`,
    connect: async () => { connected = true; },
  }), /NODE_ENV=production/);
  assert.equal(connected, false);

  process.env.NODE_ENV = 'production';
  const recipes = collection([exactIndex()]);
  const report = await runMigrationCommand({
    argv: ['--allow-production'],
    uri: `mongodb://x/${PRODUCTION_DATABASE_NAME}`,
    connect: async () => {},
    disconnect: async () => {},
    getConnectedDatabaseName: () => PRODUCTION_DATABASE_NAME,
    getCollection: () => recipes,
    logger: silentLogger,
  });
  assert.equal(report.mode, 'dry-run');
});

test('executable failure logging suppresses raw MongoDB connection errors and secrets', async () => {
  const sentinel = 'RANK1_SENTINEL_SECRET';
  let connectionError;
  try {
    await runMigrationCommand({
      argv: ['--allow-production'],
      uri: `mongodb://x/${PRODUCTION_DATABASE_NAME}`,
      nodeEnv: 'production',
      connect: async () => {
        throw new Error(
          `connection failed mongodb+srv://operator:${sentinel}@cluster.example/${PRODUCTION_DATABASE_NAME} password=${sentinel} token: "${sentinel}"`
        );
      },
    });
  } catch (error) {
    connectionError = error;
  }

  const lines = [];
  logCommandFailure(connectionError, { error: (line) => lines.push(line) });
  assert.deepEqual(JSON.parse(lines[0].replace('[recipe-ranking-index] failed: ', '')), {
    message: 'Recipe ranking migration failed.',
    code: 'RECIPE_RANKING_MIGRATION_FAILED',
    causeCode: null,
    indexCreated: false,
    modifiedCount: 0,
    failedPostcondition: null,
    partialApply: false,
  });
  assert.doesNotMatch(lines[0], /mongodb(?:\+srv)?:\/\/|operator|cluster\.example|RANK1_SENTINEL_SECRET/);
});

test('production dry-run reports the exact connected database before a read-only preflight', async () => {
  const recipes = collection(undefined, [{ _id: 'needs-backfill' }]);
  const logs = [];
  await runMigrationCommand({
    argv: ['--allow-production'],
    uri: `mongodb://x/${PRODUCTION_DATABASE_NAME}`,
    nodeEnv: 'production',
    connect: async () => {},
    disconnect: async () => {},
    getConnectedDatabaseName: () => PRODUCTION_DATABASE_NAME,
    getCollection: () => recipes,
    logger: { log: (line) => logs.push(line) },
  });
  assert.equal(logs[0], `[recipe-ranking-index] connectedDatabase=${PRODUCTION_DATABASE_NAME}`);
  assert.match(logs[1], /\"mode\":\"dry-run\"/);
  assert.ok(logs.every((line) => !line.includes('mongodb://')));
  assert.equal(recipes.calls.creates.length, 0);
  assert.equal(recipes.calls.writes.length, 0);
});

test('production apply requires both explicit flags and reports the connected database first', async () => {
  let connectedWithoutApproval = false;
  await assert.rejects(() => runMigrationCommand({
    argv: ['--apply'],
    uri: `mongodb://x/${PRODUCTION_DATABASE_NAME}`,
    nodeEnv: 'production',
    connect: async () => { connectedWithoutApproval = true; },
  }), /non-production database binding/);
  assert.equal(connectedWithoutApproval, false);

  const recipes = collection([exactIndex()]);
  const logs = [];
  const report = await runMigrationCommand({
    argv: ['--apply', '--allow-production'],
    uri: `mongodb://x/${PRODUCTION_DATABASE_NAME}`,
    nodeEnv: 'production',
    connect: async () => {},
    disconnect: async () => {},
    getConnectedDatabaseName: () => PRODUCTION_DATABASE_NAME,
    getCollection: () => recipes,
    logger: { log: (line) => logs.push(line) },
  });
  assert.equal(report.mode, 'apply');
  assert.equal(logs[0], `[recipe-ranking-index] connectedDatabase=${PRODUCTION_DATABASE_NAME}`);
  assert.match(logs[1], /\"mode\":\"apply\"/);
  assert.ok(logs.every((line) => !line.includes('mongodb://')));
});

test('a production URI is rejected when the actual connected database name differs', async () => {
  let disconnected = false;
  let collectionRequested = false;
  await assert.rejects(() => runMigrationCommand({
    argv: ['--allow-production'],
    uri: `mongodb://x/${PRODUCTION_DATABASE_NAME}`,
    nodeEnv: 'production',
    connect: async () => {},
    disconnect: async () => { disconnected = true; },
    getConnectedDatabaseName: () => 'wecooked-production-copy',
    getCollection: () => { collectionRequested = true; },
  }), new RegExp(PRODUCTION_DATABASE_NAME));
  assert.equal(disconnected, true);
  assert.equal(collectionRequested, false);
});

test('command connection disables automatic model index and collection creation', async () => {
  const recipes = collection([exactIndex()]);
  let connection;
  await runMigrationCommand({
    uri: 'mongodb://x/wecooked-rank1-test',
    connect: async (...args) => { connection = args; },
    disconnect: async () => {},
    getConnectedDatabaseName: () => 'wecooked-rank1-test',
    getCollection: () => recipes,
    logger: silentLogger,
  });
  assert.deepEqual(MIGRATION_CONNECTION_OPTIONS, { autoIndex: false, autoCreate: false });
  assert.deepEqual(connection, ['mongodb://x/wecooked-rank1-test', MIGRATION_CONNECTION_OPTIONS]);
});

test('non-production isolated apply still requires only the existing --apply flag', async () => {
  const recipes = collection([exactIndex()]);
  const report = await runMigrationCommand({
    argv: ['--apply'],
    uri: 'mongodb://x/wecooked-rank1-test',
    connect: async () => {},
    disconnect: async () => {},
    getConnectedDatabaseName: () => 'wecooked-rank1-test',
    getCollection: () => recipes,
    logger: silentLogger,
  });
  assert.equal(report.mode, 'apply');
});

test('index analyzer accepts exactly one aligned index and blocks every other text index', () => {
  assert.deepEqual(analyzeIndexes([exactIndex()]), { exact: true, missing: false, blockers: [] });
  assert.deepEqual(analyzeIndexes([{ ...exactIndex(), name: 'unexpected' }]), {
    exact: false, missing: false, blockers: ['unexpected'],
  });
  assert.deepEqual(analyzeIndexes([{ ...exactIndex(), hidden: true }]), {
    exact: false, missing: false, blockers: [FROZEN_INDEX.options.name],
  });
});
