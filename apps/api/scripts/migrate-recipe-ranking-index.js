const mongoose = require('mongoose');

const Recipe = require('../src/modules/recipes/recipe.model');
const { isPublicHttpsUrl } = require('../src/shared/validation/public-https-url');

const MIGRATION_CONNECTION_OPTIONS = Object.freeze({ autoIndex: false, autoCreate: false });
const DERIVED_FIELD = 'imageUrlIsPublicHttps';
const NUTRITION_DERIVED_FIELD = 'nutritionSourceUrlIsPublicHttps';
const PRODUCTION_DATABASE_NAME = 'wecooked-production';

const FROZEN_INDEX = Object.freeze({
  key: Object.freeze({ title: 'text', description: 'text' }),
  options: Object.freeze({
    name: 'recipe_title_description_text_v1',
    weights: Object.freeze({ title: 10, description: 1 }),
    default_language: 'english',
    language_override: 'language',
  }),
});

class MigrationConflictError extends Error {
  constructor(report) {
    super('Recipe ranking migration stopped on a stale Recipe snapshot.');
    this.name = 'MigrationConflictError';
    this.code = 'RECIPE_RANKING_MIGRATION_STALE_SNAPSHOT';
    this.report = report;
  }
}

class MigrationWriteError extends Error {
  constructor(report, cause) {
    super('Recipe ranking derived-field write failed.', { cause });
    this.name = 'MigrationWriteError';
    this.code = 'RECIPE_RANKING_MIGRATION_WRITE_FAILED';
    this.report = report;
  }
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function deriveImageUrlIsPublicHttps(imageUrl) {
  return typeof imageUrl === 'string' && isPublicHttpsUrl(imageUrl.trim());
}

function deriveNutritionSourceUrlIsPublicHttps(provenance) {
  const sourceUrl = provenance?.sourceUrl;
  return typeof sourceUrl === 'string' && isPublicHttpsUrl(sourceUrl.trim());
}

function isTextIndex(index) {
  return Object.values(index.key || {}).includes('text')
    || index.key?._fts === 'text'
    || (index.weights && Object.keys(index.weights).length > 0);
}

function exactWeights(weights) {
  return !!weights
    && Object.keys(weights).length === 2
    && weights.title === 10
    && weights.description === 1;
}

function exactPhysicalIndex(index) {
  const physicalTextKey = index.key?._fts === 'text'
    && index.key?._ftsx === 1
    && Object.keys(index.key).length === 2;
  const declaredTextKey = Object.entries(index.key || {}).length === 2
    && Object.entries(FROZEN_INDEX.key).every(([field, type], position) => {
      const entry = Object.entries(index.key || {})[position];
      return entry?.[0] === field && entry?.[1] === type;
    });

  return index.name === FROZEN_INDEX.options.name
    && (physicalTextKey || declaredTextKey)
    && exactWeights(index.weights)
    && index.default_language === 'english'
    && index.language_override === 'language'
    && index.unique !== true
    && index.sparse !== true
    && index.hidden !== true
    && !own(index, 'expireAfterSeconds')
    && !own(index, 'partialFilterExpression');
}

function analyzeIndexes(indexes) {
  const exact = indexes.filter(exactPhysicalIndex);
  const blockers = indexes.filter((index) => (
    (index.name === FROZEN_INDEX.options.name || isTextIndex(index))
    && !exactPhysicalIndex(index)
  ));
  return {
    exact: exact.length === 1,
    missing: exact.length === 0 && blockers.length === 0,
    blockers: blockers.map((index) => index.name || '(unnamed)'),
  };
}

async function readCatalogue(collection) {
  try {
    return await collection.listIndexes().toArray();
  } catch (error) {
    if (error?.code === 26 || error?.codeName === 'NamespaceNotFound') return [];
    throw error;
  }
}

async function readRecipeDocuments(collection) {
  try {
    return await collection.find({}, {
      projection: {
        _id: 1, imageUrl: 1, nutritionProvenance: 1,
        [DERIVED_FIELD]: 1, [NUTRITION_DERIVED_FIELD]: 1,
      },
    }).toArray();
  } catch (error) {
    if (error?.code === 26 || error?.codeName === 'NamespaceNotFound') return [];
    throw error;
  }
}

function analyzeDerivedDocuments(documents) {
  const pending = [];
  const counts = {
    totalRecipeCount: documents.length,
    publicHttpsImageCount: 0,
    invalidImageCount: 0,
    absentImageCount: 0,
    alignedDerivedCount: 0,
    missingDerivedCount: 0,
    staleDerivedCount: 0,
    publicHttpsNutritionSourceCount: 0,
    invalidNutritionSourceCount: 0,
    absentNutritionSourceCount: 0,
    alignedNutritionDerivedCount: 0,
    missingNutritionDerivedCount: 0,
    staleNutritionDerivedCount: 0,
    imageWouldModifyCount: 0,
    nutritionWouldModifyCount: 0,
  };

  for (const document of documents) {
    const expectedImage = deriveImageUrlIsPublicHttps(document.imageUrl);
    const expectedNutrition = deriveNutritionSourceUrlIsPublicHttps(document.nutritionProvenance);
    const sourceUrl = document.nutritionProvenance?.sourceUrl;
    const updates = {};
    if (expectedImage) counts.publicHttpsImageCount += 1;
    else if (document.imageUrl == null) counts.absentImageCount += 1;
    else counts.invalidImageCount += 1;

    if (!own(document, DERIVED_FIELD)) {
      counts.missingDerivedCount += 1;
      updates[DERIVED_FIELD] = expectedImage;
    } else if (document[DERIVED_FIELD] !== expectedImage) {
      counts.staleDerivedCount += 1;
      updates[DERIVED_FIELD] = expectedImage;
    } else {
      counts.alignedDerivedCount += 1;
    }

    if (expectedNutrition) counts.publicHttpsNutritionSourceCount += 1;
    else if (sourceUrl == null) counts.absentNutritionSourceCount += 1;
    else counts.invalidNutritionSourceCount += 1;
    if (!own(document, NUTRITION_DERIVED_FIELD)) {
      counts.missingNutritionDerivedCount += 1;
      updates[NUTRITION_DERIVED_FIELD] = expectedNutrition;
    } else if (document[NUTRITION_DERIVED_FIELD] !== expectedNutrition) {
      counts.staleNutritionDerivedCount += 1;
      updates[NUTRITION_DERIVED_FIELD] = expectedNutrition;
    } else {
      counts.alignedNutritionDerivedCount += 1;
    }
    if (own(updates, DERIVED_FIELD)) counts.imageWouldModifyCount += 1;
    if (own(updates, NUTRITION_DERIVED_FIELD)) counts.nutritionWouldModifyCount += 1;
    if (Object.keys(updates).length > 0) pending.push({ document, updates });
  }

  return { ...counts, wouldModifyCount: pending.length, pending };
}

function exactFieldSnapshot(field, document) {
  if (!own(document, field)) return { [field]: { $exists: false } };
  return {
    $and: [
      { [field]: { $exists: true } },
      { [field]: document[field] },
    ],
  };
}

function derivedFieldUpdateFilter(document) {
  return {
    _id: document._id,
    $and: [
      exactFieldSnapshot('imageUrl', document),
      exactFieldSnapshot('nutritionProvenance', document),
      exactFieldSnapshot(DERIVED_FIELD, document),
      exactFieldSnapshot(NUTRITION_DERIVED_FIELD, document),
    ],
  };
}

function applyDerivedReport(report, analysis) {
  for (const field of [
    'totalRecipeCount',
    'publicHttpsImageCount',
    'invalidImageCount',
    'absentImageCount',
    'alignedDerivedCount',
    'missingDerivedCount',
    'staleDerivedCount',
    'wouldModifyCount',
    'publicHttpsNutritionSourceCount',
    'invalidNutritionSourceCount',
    'absentNutritionSourceCount',
    'alignedNutritionDerivedCount',
    'missingNutritionDerivedCount',
    'staleNutritionDerivedCount',
    'imageWouldModifyCount',
    'nutritionWouldModifyCount',
  ]) {
    report[field] = analysis[field];
  }
}

async function migrateRecipeRankingIndex({ collection, apply = false, logger = console }) {
  const beforeIndex = analyzeIndexes(await readCatalogue(collection));
  const beforeDerived = analyzeDerivedDocuments(await readRecipeDocuments(collection));
  const report = {
    mode: apply ? 'apply' : 'dry-run',
    exact: beforeIndex.exact,
    wouldCreate: beforeIndex.missing,
    created: 0,
    blockers: beforeIndex.blockers,
    plannedModifyCount: beforeDerived.wouldModifyCount,
    modifiedCount: 0,
    partialApply: false,
    failedPostcondition: null,
    derivedAligned: beforeDerived.wouldModifyCount === 0,
  };
  applyDerivedReport(report, beforeDerived);

  if (beforeIndex.blockers.length > 0) {
    throw Object.assign(new Error('Recipe ranking index preflight failed.'), {
      code: 'RECIPE_RANKING_INDEX_PREFLIGHT_FAILED', report,
    });
  }
  if (!apply) {
    logger.log(`[recipe-ranking-index] ${JSON.stringify(report)}`);
    return report;
  }

  for (const { document, updates } of beforeDerived.pending) {
    let result;
    try {
      result = await collection.updateOne(
        derivedFieldUpdateFilter(document),
        { $set: updates }
      );
    } catch (cause) {
      report.partialApply = report.created > 0 || report.modifiedCount > 0;
      throw new MigrationWriteError(report, cause);
    }
    if (result?.matchedCount !== 1 || result?.modifiedCount !== 1) {
      report.partialApply = report.created > 0 || report.modifiedCount > 0;
      throw new MigrationConflictError(report);
    }
    report.modifiedCount += 1;
  }

  if (beforeIndex.missing) {
    try {
      await collection.createIndex(FROZEN_INDEX.key, FROZEN_INDEX.options);
      report.created = 1;
    } catch (cause) {
      report.partialApply = report.created > 0 || report.modifiedCount > 0;
      throw Object.assign(new Error('Recipe ranking index creation failed.', { cause }), {
        code: 'RECIPE_RANKING_INDEX_WRITE_FAILED',
        report,
      });
    }
  }

  let afterIndex;
  try {
    afterIndex = analyzeIndexes(await readCatalogue(collection));
  } catch (cause) {
    report.failedPostcondition = 'index';
    report.partialApply = report.created > 0 || report.modifiedCount > 0;
    throw Object.assign(new Error('Recipe ranking index postcondition read failed.', { cause }), {
      code: 'RECIPE_RANKING_INDEX_POSTCONDITION_FAILED', report,
    });
  }
  if (!afterIndex.exact || afterIndex.blockers.length > 0) {
    report.blockers = afterIndex.blockers;
    report.failedPostcondition = 'index';
    report.partialApply = report.created > 0 || report.modifiedCount > 0;
    throw Object.assign(new Error('Recipe ranking index postcondition failed.'), {
      code: 'RECIPE_RANKING_INDEX_POSTCONDITION_FAILED', report,
    });
  }

  let afterDerived;
  try {
    afterDerived = analyzeDerivedDocuments(await readRecipeDocuments(collection));
  } catch (cause) {
    report.failedPostcondition = 'derivedFields';
    report.partialApply = report.created > 0 || report.modifiedCount > 0;
    throw Object.assign(new Error('Recipe ranking derived-field postcondition read failed.', { cause }), {
      code: 'RECIPE_RANKING_DERIVED_POSTCONDITION_FAILED', report,
    });
  }
  applyDerivedReport(report, afterDerived);
  if (afterDerived.wouldModifyCount > 0) {
    report.failedPostcondition = 'derivedFields';
    report.partialApply = report.created > 0 || report.modifiedCount > 0;
    throw Object.assign(new Error('Recipe ranking derived-field postcondition failed.'), {
      code: 'RECIPE_RANKING_DERIVED_POSTCONDITION_FAILED', report,
    });
  }

  report.exact = true;
  report.wouldCreate = false;
  report.derivedAligned = true;
  report.partialApply = false;
  logger.log(`[recipe-ranking-index] ${JSON.stringify(report)}`);
  return report;
}

function parseCommandFlags(argv) {
  const allowed = new Set(['--apply', '--allow-production']);
  if (argv.some((argument) => !allowed.has(argument)) || new Set(argv).size !== argv.length) {
    throw new Error(
      'Usage: npm run migrate:recipe-ranking-index -- [--apply] [--allow-production]'
    );
  }
  return {
    apply: argv.includes('--apply'),
    allowProduction: argv.includes('--allow-production'),
  };
}

function databaseName(uri) {
  const match = String(uri || '').match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/i);
  return match ? decodeURIComponent(match[1]) : '';
}

function assertDatabaseTarget(name, {
  apply = false,
  allowProduction = false,
  nodeEnv = process.env.NODE_ENV,
} = {}) {
  if (allowProduction) {
    if (nodeEnv !== 'production') {
      throw new Error('Refusing production recipe ranking migration unless NODE_ENV=production.');
    }
    if (name !== PRODUCTION_DATABASE_NAME) {
      throw new Error(`Refusing production recipe ranking migration outside ${PRODUCTION_DATABASE_NAME}.`);
    }
    return;
  }

  if (!name || /prod(?:uction)?/i.test(name)) {
    throw new Error('Refusing recipe ranking migration access without a non-production database binding.');
  }
  if (apply && (!/rank1/i.test(name) || !/(?:test|isolated)/i.test(name))) {
    throw new Error('Refusing recipe ranking index apply outside an isolated RANK1 test database.');
  }
}

function assertCommandTarget(uri, options = {}) {
  const name = databaseName(uri);
  assertDatabaseTarget(name, options);
  return name;
}

async function runMigrationCommand({
  argv = process.argv.slice(2),
  uri = process.env.RECIPE_RANKING_MONGO_URI,
  connect = (value, options) => mongoose.connect(value, options),
  disconnect = () => mongoose.disconnect(),
  getCollection = () => Recipe.collection,
  getConnectedDatabaseName = () => mongoose.connection.db?.databaseName,
  nodeEnv = process.env.NODE_ENV,
  logger = console,
} = {}) {
  const flags = parseCommandFlags(argv);
  const options = { ...flags, nodeEnv };
  const selectedDatabaseName = assertCommandTarget(uri, options);
  let connected = false;
  try {
    await connect(uri, MIGRATION_CONNECTION_OPTIONS);
    connected = true;
    const connectedDatabaseName = getConnectedDatabaseName();
    assertDatabaseTarget(connectedDatabaseName, options);
    if (connectedDatabaseName !== selectedDatabaseName) {
      throw new Error('Refusing recipe ranking migration because the connected database differs from the selected database.');
    }
    logger.log(`[recipe-ranking-index] connectedDatabase=${connectedDatabaseName}`);
    return await migrateRecipeRankingIndex({ collection: getCollection(), apply: flags.apply, logger });
  } finally {
    if (connected) await disconnect();
  }
}

function secretSafeErrorMessage() {
  return 'Recipe ranking migration failed.';
}

function logCommandFailure(error, logger = console) {
  const report = error?.report || {};
  const safeErrorCode = (code) => Number.isSafeInteger(code)
    ? code
    : typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)
      ? code : null;
  const safeCode = safeErrorCode(error?.code) ?? 'RECIPE_RANKING_MIGRATION_FAILED';
  logger.error(`[recipe-ranking-index] failed: ${JSON.stringify({
    message: secretSafeErrorMessage(),
    code: safeCode,
    causeCode: safeErrorCode(error?.cause?.code),
    indexCreated: report.created === 1,
    modifiedCount: Number.isSafeInteger(report.modifiedCount) ? report.modifiedCount : 0,
    failedPostcondition: report.failedPostcondition === 'index' || report.failedPostcondition === 'derivedFields'
      ? report.failedPostcondition : null,
    partialApply: report.partialApply === true,
  })}`);
}

if (require.main === module) {
  runMigrationCommand().catch((error) => {
    logCommandFailure(error);
    process.exitCode = 1;
  });
}

module.exports = {
  DERIVED_FIELD,
  NUTRITION_DERIVED_FIELD,
  FROZEN_INDEX,
  MIGRATION_CONNECTION_OPTIONS,
  PRODUCTION_DATABASE_NAME,
  MigrationConflictError,
  MigrationWriteError,
  deriveImageUrlIsPublicHttps,
  deriveNutritionSourceUrlIsPublicHttps,
  isTextIndex,
  exactPhysicalIndex,
  analyzeIndexes,
  analyzeDerivedDocuments,
  derivedFieldUpdateFilter,
  migrateRecipeRankingIndex,
  parseCommandFlags,
  databaseName,
  assertDatabaseTarget,
  assertCommandTarget,
  runMigrationCommand,
  secretSafeErrorMessage,
  logCommandFailure,
};
