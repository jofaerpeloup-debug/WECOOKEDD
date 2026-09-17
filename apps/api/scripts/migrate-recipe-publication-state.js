const mongoose = require('mongoose');
const { loadEnv } = require('../src/config/env');
const { disconnectDatabase } = require('../src/config/database');
const Recipe = require('../src/modules/recipes/recipe.model');
const Ingredient = require('../src/modules/ingredients/ingredient.model');
const { publishedRecipeBodySchema } = require('../src/modules/recipes/recipe.validation');

const LEGACY_FILTER = Object.freeze({ publicationStatus: { $exists: false } });
const MIGRATION_CONNECTION_OPTIONS = Object.freeze({ autoIndex: false, autoCreate: false });
const VALID_PUBLICATION_STATUSES = new Set(['draft', 'published']);
const ATTRIBUTION_FIELDS = ['createdBy', 'updatedBy', 'publishedBy'];

class MigrationBlockedError extends Error {
  constructor(report) {
    super(`Migration preflight found ${report.blockedCount} blocker(s); zero recipe writes performed.`);
    this.name = 'MigrationBlockedError';
    this.code = 'MIGRATION_PREFLIGHT_BLOCKED';
    this.report = report;
  }
}

class MigrationConflictError extends Error {
  constructor(report, recipeId) {
    super(`Migration stopped at recipe ${recipeId}: stale preflight snapshot or concurrent migration conflict.`);
    this.name = 'MigrationConflictError';
    this.code = 'MIGRATION_STALE_SNAPSHOT';
    this.report = report;
    this.recipeId = recipeId;
  }
}

class MigrationWriteError extends Error {
  constructor(report, recipeId, cause) {
    super(`Migration write failed at recipe ${recipeId}; apply stopped without retry.`, { cause });
    this.name = 'MigrationWriteError';
    this.code = 'MIGRATION_WRITE_FAILED';
    this.report = report;
    this.recipeId = recipeId;
  }
}

function parseArgs(argv) {
  if (argv.length === 0) return { apply: false };
  if (argv.length === 1 && argv[0] === '--apply') return { apply: true };
  throw new Error('Usage: node scripts/migrate-recipe-publication-state.js [--apply]');
}

function connectMigrationDatabase(uri, options = MIGRATION_CONNECTION_OPTIONS) {
  return mongoose.connect(uri, options);
}

function hasOwn(object, field) {
  return Object.prototype.hasOwnProperty.call(object, field);
}

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isValidStoredObjectId(value) {
  try {
    return mongoose.isObjectIdOrHexString(value);
  } catch {
    return false;
  }
}

function printableId(value) {
  try {
    return String(value);
  } catch {
    return '(unprintable)';
  }
}

function describeStatus(value) {
  if (value === null) return 'null';
  if (['string', 'number', 'boolean', 'undefined'].includes(typeof value)) {
    return JSON.stringify(value) ?? 'undefined';
  }
  return `[${typeof value}]`;
}

function ingredientValidationValue(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  const ingredientId = entry.ingredientId;
  return {
    ingredientId: isValidStoredObjectId(ingredientId) ? printableId(ingredientId) : ingredientId,
    quantity: entry.quantity,
    unit: entry.unit,
    note: entry.note,
    optional: entry.optional ?? false,
  };
}

// Preserve malformed containers/items for Zod to report. Only valid BSON
// ObjectIds are converted to the string representation used by the API's
// authoritative publication schema.
function validationInput(doc) {
  const input = {
    title: doc.title,
    description: doc.description,
    difficulty: doc.difficulty,
    prepTimeMinutes: doc.prepTimeMinutes,
    cookTimeMinutes: doc.cookTimeMinutes,
    servings: doc.servings,
    ingredients: Array.isArray(doc.ingredients)
      ? doc.ingredients.map(ingredientValidationValue)
      : doc.ingredients,
    instructions: doc.instructions,
    dietaryTags: doc.dietaryTags ?? [],
    imageUrl: doc.imageUrl ?? null,
    imageAssetId: doc.imageAssetId ?? null,
  };
  if (doc.region != null) input.region = doc.region;
  if (doc.category != null) input.category = doc.category;
  return input;
}

function finding(code, fields, detail) {
  return { code, fields: Array.isArray(fields) ? fields : [fields], detail };
}

function assessLegacyRecipe(doc) {
  const blockers = [];
  const warnings = [];
  let result;
  try {
    result = publishedRecipeBodySchema.safeParse(validationInput(doc));
  } catch (error) {
    blockers.push(finding('STRUCTURE_INVALID', ['(root)'], `Assessment failed safely: ${error.message}`));
  }
  if (result && !result.success) {
    blockers.push(finding(
      'STRUCTURE_INVALID',
      [...new Set(result.error.issues.map((issue) => issue.path.join('.') || '(root)'))],
      'Recipe does not satisfy the current published-recipe structure.'
    ));
  }

  if (!isValidDate(doc.createdAt)) {
    blockers.push(finding('CREATED_AT_INVALID', ['createdAt'], 'A valid createdAt is required for publishedAt backfill.'));
  }

  const existingAttribution = [];
  const invalidAttribution = [];
  for (const field of ATTRIBUTION_FIELDS) {
    if (doc[field] == null) continue;
    if (isValidStoredObjectId(doc[field])) existingAttribution.push(field);
    else invalidAttribution.push(field);
  }
  if (existingAttribution.length > 0) {
    warnings.push(finding('EXISTING_ATTRIBUTION', existingAttribution, 'Existing non-null attribution will be preserved.'));
  }
  if (invalidAttribution.length > 0) {
    blockers.push(finding('ATTRIBUTION_INVALID', invalidAttribution, 'Stored attribution is not a valid ObjectId and will not be replaced.'));
  }

  if (doc.publishedAt != null) {
    if (!isValidDate(doc.publishedAt)) {
      blockers.push(finding(
        'PUBLISHED_AT_INVALID',
        ['publishedAt'],
        'Existing publishedAt is not a valid stored Date.'
      ));
    } else if (isValidDate(doc.createdAt) && doc.publishedAt.getTime() !== doc.createdAt.getTime()) {
      blockers.push(finding(
        'PUBLISHED_AT_CONFLICT',
        ['publishedAt', 'createdAt'],
        'Existing valid publishedAt differs from the intended createdAt-derived value.'
      ));
    } else if (isValidDate(doc.createdAt)) {
      warnings.push(finding(
        'EXISTING_PUBLISHED_AT_EQUIVALENT',
        ['publishedAt'],
        'Existing publishedAt already equals createdAt and will be preserved.'
      ));
    }
  }

  return { valid: blockers.length === 0, blockers, warnings };
}

function lifecycleOf(doc) {
  return doc.isActive === true ? 'active' : 'archived';
}

function ingredientKey(value) {
  return printableId(value);
}

function toLookupObjectId(value) {
  if (value instanceof mongoose.Types.ObjectId) return value;
  return new mongoose.Types.ObjectId(value);
}

async function loadIngredientsById(ingredientCollection, docs) {
  const ids = new Map();
  for (const doc of docs) {
    if (!Array.isArray(doc.ingredients)) continue;
    for (const entry of doc.ingredients) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      if (!isValidStoredObjectId(entry.ingredientId)) continue;
      ids.set(ingredientKey(entry.ingredientId), toLookupObjectId(entry.ingredientId));
    }
  }
  if (ids.size === 0) return new Map();
  const ingredients = await ingredientCollection.find({ _id: { $in: [...ids.values()] } }).toArray();
  return new Map(ingredients.map((ingredient) => [ingredientKey(ingredient._id), ingredient]));
}

function assessIngredientIntegrity(doc, ingredientsById) {
  const blockers = [];
  const warnings = [];
  if (!Array.isArray(doc.ingredients)) return { blockers, warnings };

  for (let index = 0; index < doc.ingredients.length; index += 1) {
    const entry = doc.ingredients[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !isValidStoredObjectId(entry.ingredientId)) {
      continue;
    }
    const ingredient = ingredientsById.get(ingredientKey(entry.ingredientId));
    if (ingredient && ingredient.isActive === true) continue;

    const unavailableState = ingredient ? 'inactive' : 'missing';
    const field = `ingredients.${index}.ingredientId`;
    if (doc.isActive === true && entry.optional !== true) {
      blockers.push(finding(
        ingredient ? 'REQUIRED_INGREDIENT_INACTIVE' : 'REQUIRED_INGREDIENT_MISSING',
        [field],
        `Required ingredient ${ingredientKey(entry.ingredientId)} is ${unavailableState}.`
      ));
    } else {
      warnings.push(finding(
        doc.isActive === true ? 'OPTIONAL_INGREDIENT_UNAVAILABLE' : 'ARCHIVED_INGREDIENT_UNAVAILABLE',
        [field],
        `${doc.isActive === true ? 'Optional' : 'Archived recipe'} ingredient ${ingredientKey(entry.ingredientId)} is ${unavailableState}.`
      ));
    }
  }
  return { blockers, warnings };
}

function reportEntry(doc, findings) {
  return {
    id: printableId(doc._id),
    lifecycle: lifecycleOf(doc),
    reasons: findings.map((item) => item.code),
    findings,
  };
}

async function preflightMigration({ recipeCollection, ingredientCollection, databaseName = '(unknown)' }) {
  const docs = await recipeCollection.find({}).toArray();
  const legacyDocs = [];
  const invalidExplicitDocs = [];
  let explicitDraftCount = 0;
  let explicitPublishedCount = 0;

  for (const doc of docs) {
    if (!hasOwn(doc, 'publicationStatus')) {
      legacyDocs.push(doc);
    } else if (doc.publicationStatus === 'draft') {
      explicitDraftCount += 1;
    } else if (doc.publicationStatus === 'published') {
      explicitPublishedCount += 1;
    } else if (!VALID_PUBLICATION_STATUSES.has(doc.publicationStatus)) {
      invalidExplicitDocs.push(doc);
    }
  }

  const ingredientsById = await loadIngredientsById(ingredientCollection, legacyDocs);
  const blockers = invalidExplicitDocs.map((doc) => reportEntry(doc, [finding(
    'INVALID_EXPLICIT_PUBLICATION_STATUS',
    ['publicationStatus'],
    `Explicit publicationStatus value ${describeStatus(doc.publicationStatus)} is invalid and will not be rewritten.`
  )]));
  const warnings = [];
  const eligible = [];

  for (const doc of legacyDocs) {
    const structural = assessLegacyRecipe(doc);
    const integrity = assessIngredientIntegrity(doc, ingredientsById);
    const docBlockers = [...structural.blockers, ...integrity.blockers];
    const docWarnings = [...structural.warnings, ...integrity.warnings];
    if (docBlockers.length > 0) blockers.push(reportEntry(doc, docBlockers));
    else eligible.push(doc);
    if (docWarnings.length > 0) warnings.push(reportEntry(doc, docWarnings));
  }

  return {
    databaseName,
    totalRecipeCount: docs.length,
    legacyMissingStatusCount: legacyDocs.length,
    eligibleCount: eligible.length,
    blockedCount: blockers.length,
    warningCount: warnings.reduce((count, item) => count + item.findings.length, 0),
    wouldModifyCount: eligible.length,
    explicitDraftCount,
    explicitPublishedCount,
    invalidExplicitStatusCount: invalidExplicitDocs.length,
    legacyActiveCount: legacyDocs.filter((doc) => doc.isActive === true).length,
    legacyArchivedCount: legacyDocs.filter((doc) => doc.isActive !== true).length,
    blockers,
    warnings,
    eligible,
  };
}

function migrationUpdate(doc) {
  const set = { publicationStatus: 'published' };
  if (doc.publishedAt == null) set.publishedAt = doc.createdAt;
  for (const field of ATTRIBUTION_FIELDS) {
    if (doc[field] == null) set[field] = null;
  }
  return { $set: set };
}

function migrationFilter(doc) {
  const base = { _id: doc._id, publicationStatus: { $exists: false } };
  if (!hasOwn(doc, 'updatedAt')) {
    return { ...base, updatedAt: { $exists: false } };
  }
  if (doc.updatedAt === null) {
    return { ...base, $and: [{ updatedAt: null }, { updatedAt: { $exists: true } }] };
  }
  return { ...base, updatedAt: doc.updatedAt };
}

function logFinding(logger, label, entry) {
  const codes = entry.reasons.join(',');
  const fields = [...new Set(entry.findings.flatMap((item) => item.fields))].join(',');
  logger.log(`[migrate-recipe-publication-state] ${label} id=${entry.id} lifecycle=${entry.lifecycle} reasons=${codes} fields=${fields}`);
}

function logReport(report, logger) {
  logger.log(`[migrate-recipe-publication-state] database=${report.databaseName} mode=${report.mode}`);
  const modified = report.applied ? ` modified=${report.modifiedCount}` : '';
  logger.log(
    `[migrate-recipe-publication-state] total=${report.totalRecipeCount} legacyMissingStatus=${report.legacyMissingStatusCount} ` +
    `eligible=${report.eligibleCount} blocked=${report.blockedCount} warnings=${report.warningCount} ` +
    `wouldModify=${report.wouldModifyCount}${modified}`
  );
  logger.log(
    `[migrate-recipe-publication-state] explicitDraft=${report.explicitDraftCount} ` +
    `explicitPublished=${report.explicitPublishedCount} invalidExplicitStatus=${report.invalidExplicitStatusCount} ` +
    `legacyActive=${report.legacyActiveCount} legacyArchived=${report.legacyArchivedCount}`
  );
  for (const entry of report.blockers) logFinding(logger, 'BLOCKED', entry);
  for (const entry of report.warnings) logFinding(logger, 'WARNING', entry);
}

async function runMigration({
  recipeCollection,
  ingredientCollection,
  collection,
  apply = false,
  databaseName = '(unknown)',
  logger = console,
}) {
  // `collection` remains a compatibility alias for callers of the original
  // unit-testable API; production always supplies both named collections.
  recipeCollection = recipeCollection || collection;
  if (!recipeCollection || !ingredientCollection) {
    throw new Error('Both recipeCollection and ingredientCollection are required.');
  }

  const assessment = await preflightMigration({ recipeCollection, ingredientCollection, databaseName });
  const report = {
    ...assessment,
    mode: apply ? 'apply' : 'dry-run',
    applied: apply,
    modifiedCount: 0,
    partialApply: false,
  };
  delete report.eligible;
  logReport(report, logger);

  if (!apply) return report;
  if (report.blockedCount > 0) {
    logger.log('[migrate-recipe-publication-state] APPLY ABORTED: blockers found; zero recipe writes performed.');
    throw new MigrationBlockedError(report);
  }

  for (const doc of assessment.eligible) {
    const recipeId = printableId(doc._id);
    let result;
    try {
      result = await recipeCollection.updateOne(migrationFilter(doc), migrationUpdate(doc));
    } catch (cause) {
      report.partialApply = report.modifiedCount > 0;
      report.failureRecipeId = recipeId;
      logger.log(
        `[migrate-recipe-publication-state] APPLY STOPPED: code=MIGRATION_WRITE_FAILED ` +
        `modified=${report.modifiedCount} partialApply=${report.partialApply} recipeId=${recipeId}`
      );
      throw new MigrationWriteError(report, recipeId, cause);
    }
    if (result.matchedCount !== 1 || result.modifiedCount !== 1) {
      report.partialApply = report.modifiedCount > 0;
      report.conflictRecipeId = recipeId;
      logger.log(
        `[migrate-recipe-publication-state] APPLY STOPPED: id=${report.conflictRecipeId} stale snapshot/conflict ` +
        `modifiedBeforeFailure=${report.modifiedCount} partialApply=${report.partialApply}`
      );
      throw new MigrationConflictError(report, report.conflictRecipeId);
    }
    report.modifiedCount += 1;
  }
  logger.log(`[migrate-recipe-publication-state] applyComplete modified=${report.modifiedCount}`);
  return report;
}

function formatMigrationFailure(error) {
  const progress = error.code === 'MIGRATION_WRITE_FAILED'
    ? ` modified=${error.report?.modifiedCount ?? 0}` +
      ` partialApply=${Boolean(error.report?.partialApply)}` +
      ` recipeId=${error.recipeId || error.report?.failureRecipeId || '(unknown)'}`
    : '';
  return `[migrate-recipe-publication-state] failed code=${error.code || 'UNEXPECTED'}${progress} message=${error.message}`;
}

async function runMigrationCommand({
  argv = process.argv.slice(2),
  loadEnvironment = loadEnv,
  connect = connectMigrationDatabase,
  disconnect = disconnectDatabase,
  getCollections = () => ({
    recipeCollection: Recipe.collection,
    ingredientCollection: Ingredient.collection,
  }),
  logger = console,
} = {}) {
  const { apply } = parseArgs(argv);
  const env = loadEnvironment();
  let connected = false;
  try {
    const connectionResult = await connect(env.mongodbUri, MIGRATION_CONNECTION_OPTIONS);
    connected = true;
    const connection = connectionResult?.connection || mongoose.connection;
    return await runMigration({
      ...getCollections(),
      apply,
      databaseName: connection?.name || '(unknown)',
      logger,
    });
  } finally {
    if (connected) await disconnect();
  }
}

if (require.main === module) {
  runMigrationCommand().catch((error) => {
    console.error(formatMigrationFailure(error));
    process.exitCode = 1;
  });
}

module.exports = {
  LEGACY_FILTER,
  MIGRATION_CONNECTION_OPTIONS,
  MigrationBlockedError,
  MigrationConflictError,
  MigrationWriteError,
  parseArgs,
  connectMigrationDatabase,
  validationInput,
  assessLegacyRecipe,
  assessIngredientIntegrity,
  preflightMigration,
  migrationFilter,
  migrationUpdate,
  runMigration,
  runMigrationCommand,
  formatMigrationFailure,
};
