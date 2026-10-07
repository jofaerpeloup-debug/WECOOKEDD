const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { nutritionSchema, nutritionSourceSchema } = require('../src/modules/recipes/recipe.validation');

const CONNECTION_OPTIONS = Object.freeze({ autoIndex: false, autoCreate: false });
const CANONICAL_OBJECT_ID = /^[0-9a-f]{24}$/u;

function parseArgs(argv) {
  const applyArgs = argv.filter((arg) => arg === '--apply');
  const artifactArgs = argv.filter((arg) => arg.startsWith('--artifact='));
  if (
    applyArgs.length > 1
    || artifactArgs.length !== 1
    || argv.some((arg) => arg !== '--apply' && !arg.startsWith('--artifact='))
  ) {
    throw new Error('Usage: node scripts/migrate-recipe-nutrition-v1.js --artifact=<approved-json-path> [--apply]');
  }
  const artifactPath = artifactArgs[0].slice('--artifact='.length);
  if (!artifactPath) throw new Error('The approved artifact path is required.');
  return { artifactPath, apply: applyArgs.length === 1 };
}

function ownKeysAre(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseArtifact(input) {
  const artifact = typeof input === 'string' ? JSON.parse(input) : input;
  if (!ownKeysAre(artifact, ['schemaVersion', 'records']) || artifact.schemaVersion !== 1 || !Array.isArray(artifact.records)) {
    throw new Error('Artifact must be the strict v1 object { schemaVersion: 1, records: [] }.');
  }

  const seen = new Set();
  const valid = [];
  let invalid = 0;
  for (const record of artifact.records) {
    const shapeValid = ownKeysAre(record, ['recipeId', 'expectedUpdatedAt', 'nutrition', 'source']);
    const canonicalId = shapeValid && typeof record.recipeId === 'string' && CANONICAL_OBJECT_ID.test(record.recipeId);
    const timestamp = shapeValid && typeof record.expectedUpdatedAt === 'string'
      ? new Date(record.expectedUpdatedAt)
      : null;
    const timestampValid = timestamp && Number.isFinite(timestamp.getTime());
    const nutrition = shapeValid ? nutritionSchema.safeParse(record.nutrition) : { success: false };
    const source = shapeValid ? nutritionSourceSchema.safeParse(record.source) : { success: false };
    if (!shapeValid || !canonicalId || !timestampValid || !nutrition.success || !source.success || seen.has(record.recipeId)) {
      invalid += 1;
      continue;
    }
    seen.add(record.recipeId);
    valid.push({
      recipeId: record.recipeId,
      expectedUpdatedAt: timestamp,
      nutrition: nutrition.data,
      source: source.data,
    });
  }
  return { total: artifact.records.length, invalid, valid };
}

function sourceFromProvenance(provenance) {
  if (!provenance) return null;
  const source = { kind: provenance.sourceKind, label: provenance.sourceLabel };
  if (Object.hasOwn(provenance, 'sourceUrl')) source.url = provenance.sourceUrl;
  return source;
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isValidStoredNutrition(value) {
  return value == null || nutritionSchema.safeParse(value).success;
}

function isValidStoredProvenance(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const requiredKeys = ['sourceKind', 'sourceLabel', 'acceptedBy', 'acceptedAt'];
  const hasSourceUrl = Object.hasOwn(value, 'sourceUrl');
  if (!ownKeysAre(value, hasSourceUrl ? [...requiredKeys, 'sourceUrl'] : requiredKeys)) return false;
  // An optional field that is physically present must contain a valid value;
  // `undefined`, empty strings, null, and other falsy/non-string values are
  // malformed stored provenance rather than equivalent to omission.
  if (hasSourceUrl && typeof value.sourceUrl !== 'string') return false;
  const acceptedBy = value.acceptedBy?._id || value.acceptedBy;
  const acceptedAt = value.acceptedAt == null ? null : new Date(value.acceptedAt);
  return nutritionSourceSchema.safeParse(sourceFromProvenance(value)).success
    && mongoose.Types.ObjectId.isValid(acceptedBy)
    && acceptedAt != null
    && Number.isFinite(acceptedAt.getTime());
}

function isValidStoredNutritionState(doc) {
  if (!doc || !isValidStoredNutrition(doc.nutrition)) return false;
  if (doc.nutrition == null) return doc.nutritionProvenance == null;
  return isValidStoredProvenance(doc.nutritionProvenance);
}

function targetAlreadyPresent(doc, record) {
  return Boolean(doc)
    && isValidStoredNutritionState(doc)
    && sameValue(doc.nutrition, record.nutrition)
    && sameValue(sourceFromProvenance(doc.nutritionProvenance), record.source);
}

function sameTimestamp(left, right) {
  const leftTime = left == null ? Number.NaN : new Date(left).getTime();
  const rightTime = right == null ? Number.NaN : new Date(right).getTime();
  return Number.isFinite(leftTime) && leftTime === rightTime;
}

async function readRecipe(collection, recipeId) {
  return collection.findOne(
    { _id: new mongoose.Types.ObjectId(recipeId) },
    { projection: { nutrition: 1, nutritionProvenance: 1, updatedAt: 1 } },
  );
}

async function assess(collection, parsed) {
  const summary = {
    artifactRecords: parsed.total,
    matched: 0,
    eligible: 0,
    unchanged: 0,
    invalid: parsed.invalid,
    missing: 0,
    stale: 0,
    conflicts: 0,
    malformedExisting: 0,
    wouldChange: 0,
    changed: 0,
  };
  const eligible = [];
  for (const record of parsed.valid) {
    const doc = await readRecipe(collection, record.recipeId);
    if (!doc) {
      summary.missing += 1;
      continue;
    }
    summary.matched += 1;
    if (!isValidStoredNutritionState(doc)) summary.malformedExisting += 1;
    if (targetAlreadyPresent(doc, record)) {
      summary.unchanged += 1;
      continue;
    }
    if (!sameTimestamp(doc.updatedAt, record.expectedUpdatedAt)) {
      summary.stale += 1;
      continue;
    }
    summary.eligible += 1;
    summary.wouldChange += 1;
    eligible.push({ record, doc });
  }
  return { summary, eligible };
}

function provenanceFor(record, actorId, acceptedAt) {
  const provenance = {
    sourceKind: record.source.kind,
    sourceLabel: record.source.label,
    acceptedBy: new mongoose.Types.ObjectId(actorId),
    acceptedAt,
  };
  if (record.source.url !== undefined) provenance.sourceUrl = record.source.url;
  return provenance;
}

function preflightError(summary) {
  const blockers = [];
  if (summary.invalid) blockers.push(`invalid=${summary.invalid}`);
  if (summary.missing) blockers.push(`missing=${summary.missing}`);
  if (summary.stale) blockers.push(`stale=${summary.stale}`);
  if (!blockers.length) return null;
  const error = new Error(`Migration apply blocked before writes: ${blockers.join('; ')}.`);
  error.migrationReport = summary;
  return error;
}

async function runMigration({ collection, artifact, apply = false, actorId, now = new Date(), logger = console }) {
  const parsed = parseArtifact(artifact);
  const { summary, eligible } = await assess(collection, parsed);
  logger.log(`[migrate-recipe-nutrition-v1] mode=${apply ? 'APPLY' : 'DRY_RUN'} counts=${JSON.stringify(summary)}`);
  if (!apply) return { mode: 'dry-run', ...summary };

  if (!CANONICAL_OBJECT_ID.test(actorId || '')) {
    throw new Error('Apply requires a canonical server-controlled RECIPE_NUTRITION_ACTOR_ID.');
  }
  const blocked = preflightError(summary);
  if (blocked) throw blocked;

  for (const { record } of eligible) {
    const update = {
      $set: {
        nutrition: record.nutrition,
        nutritionProvenance: provenanceFor(record, actorId, now),
        updatedBy: new mongoose.Types.ObjectId(actorId),
        updatedAt: now,
      },
    };
    const result = await collection.updateOne(
      { _id: new mongoose.Types.ObjectId(record.recipeId), updatedAt: record.expectedUpdatedAt },
      update,
    );
    if (result?.acknowledged !== false && result?.matchedCount === 1 && result?.modifiedCount === 1) {
      summary.changed += 1;
      continue;
    }
    const current = await readRecipe(collection, record.recipeId);
    if (targetAlreadyPresent(current, record)) {
      summary.conflicts += 1;
      continue;
    }
    const error = new Error(`Concurrent Recipe change prevented canonical-id nutrition write for ${record.recipeId}.`);
    error.migrationReport = { mode: 'apply', ...summary };
    throw error;
  }

  for (const { record } of eligible) {
    const current = await readRecipe(collection, record.recipeId);
    if (!targetAlreadyPresent(current, record)) {
      const error = new Error(`Migration final postcondition failed for ${record.recipeId}.`);
      error.migrationReport = { mode: 'apply', ...summary };
      throw error;
    }
  }
  const report = { mode: 'apply', ...summary };
  logger.log(`[migrate-recipe-nutrition-v1] completed counts=${JSON.stringify(report)}`);
  return report;
}

async function runMigrationCommand({
  argv = process.argv.slice(2),
  env = process.env,
  readFile = fs.readFileSync,
  connect = (uri) => mongoose.connect(uri, CONNECTION_OPTIONS),
  disconnect = () => mongoose.disconnect(),
  logger = console,
} = {}) {
  const args = parseArgs(argv);
  const uri = env.RECIPE_NUTRITION_MONGO_URI;
  if (!uri) throw new Error('RECIPE_NUTRITION_MONGO_URI is required.');
  const artifact = readFile(path.resolve(args.artifactPath), 'utf8');
  let connected = false;
  try {
    const connectionResult = await connect(uri);
    connected = true;
    const connection = connectionResult?.connection || mongoose.connection;
    if (args.apply && env.RECIPE_NUTRITION_APPLY_CONFIRM !== connection.name) {
      throw new Error('Apply confirmation must exactly match the connected database name.');
    }
    return await runMigration({
      collection: connection.collection('recipes'),
      artifact,
      apply: args.apply,
      actorId: env.RECIPE_NUTRITION_ACTOR_ID,
      logger,
    });
  } finally {
    if (connected) await disconnect();
  }
}

if (require.main === module) {
  runMigrationCommand().catch((error) => {
    console.error(`[migrate-recipe-nutrition-v1] failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  CONNECTION_OPTIONS,
  CANONICAL_OBJECT_ID,
  parseArgs,
  parseArtifact,
  isValidStoredNutrition,
  targetAlreadyPresent,
  assess,
  runMigration,
  runMigrationCommand,
};
