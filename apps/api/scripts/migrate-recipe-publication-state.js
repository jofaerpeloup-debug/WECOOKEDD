const { loadEnv } = require('../src/config/env');
const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const Recipe = require('../src/modules/recipes/recipe.model');
const { publishedRecipeBodySchema } = require('../src/modules/recipes/recipe.validation');

const LEGACY_FILTER = Object.freeze({ publicationStatus: { $exists: false } });

function parseArgs(argv) {
  if (argv.length === 0) return { apply: false };
  if (argv.length === 1 && argv[0] === '--apply') return { apply: true };
  throw new Error('Usage: node scripts/migrate-recipe-publication-state.js [--apply]');
}

function validationInput(doc) {
  const input = {
    title: doc.title,
    description: doc.description,
    difficulty: doc.difficulty,
    prepTimeMinutes: doc.prepTimeMinutes,
    cookTimeMinutes: doc.cookTimeMinutes,
    servings: doc.servings,
    ingredients: (doc.ingredients || []).map((entry) => ({
      ingredientId: String(entry.ingredientId),
      quantity: entry.quantity,
      unit: entry.unit,
      note: entry.note,
      optional: entry.optional ?? false,
    })),
    instructions: doc.instructions || [],
    dietaryTags: doc.dietaryTags || [],
    imageUrl: doc.imageUrl ?? null,
    imageAssetId: doc.imageAssetId ?? null,
  };
  if (doc.region != null) input.region = doc.region;
  if (doc.category != null) input.category = doc.category;
  return input;
}

function assessLegacyRecipe(doc) {
  const issues = [];
  const result = publishedRecipeBodySchema.safeParse(validationInput(doc));
  if (!result.success) {
    issues.push(...result.error.issues.map((issue) => ({
      field: issue.path.join('.') || '(root)',
      message: issue.message,
    })));
  }
  if (!(doc.createdAt instanceof Date) || Number.isNaN(doc.createdAt.getTime())) {
    issues.push({ field: 'createdAt', message: 'A valid createdAt is required for publishedAt backfill.' });
  }
  return { valid: issues.length === 0, issues };
}

function migrationUpdate(doc) {
  return {
    $set: {
      publicationStatus: 'published',
      publishedAt: doc.createdAt,
      createdBy: null,
      updatedBy: null,
      publishedBy: null,
    },
  };
}

async function runMigration({ collection, apply = false, logger = console }) {
  const docs = await collection.find(LEGACY_FILTER).toArray();
  const malformed = [];
  let valid = 0;
  let modified = 0;

  for (const doc of docs) {
    const assessment = assessLegacyRecipe(doc);
    if (!assessment.valid) {
      malformed.push({ id: String(doc._id), issues: assessment.issues });
      continue;
    }
    valid += 1;
    if (apply) {
      const result = await collection.updateOne(
        { _id: doc._id, publicationStatus: { $exists: false } },
        migrationUpdate(doc)
      );
      modified += result.modifiedCount ?? 0;
    }
  }

  const report = {
    applied: apply,
    scanned: docs.length,
    valid,
    malformed,
    modified: apply ? modified : 0,
  };
  logger.log(`[migrate-recipe-publication-state] mode=${apply ? 'apply' : 'dry-run'}`);
  logger.log(`[migrate-recipe-publication-state] scanned=${report.scanned} valid=${valid} malformed=${malformed.length}`);
  if (apply) logger.log(`[migrate-recipe-publication-state] modified=${modified}`);
  for (const item of malformed) {
    logger.log(`[migrate-recipe-publication-state] malformed id=${item.id} fields=${item.issues.map((issue) => issue.field).join(',')}`);
  }
  return report;
}

async function runMigrationCommand({
  argv = process.argv.slice(2),
  loadEnvironment = loadEnv,
  connect = connectDatabase,
  disconnect = disconnectDatabase,
  getCollection = () => Recipe.collection,
  logger = console,
} = {}) {
  const { apply } = parseArgs(argv);
  const env = loadEnvironment();
  let connected = false;
  try {
    await connect(env.mongodbUri);
    connected = true;
    return await runMigration({ collection: getCollection(), apply, logger });
  } finally {
    if (connected) await disconnect();
  }
}

if (require.main === module) {
  runMigrationCommand().catch((error) => {
    console.error(`[migrate-recipe-publication-state] failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  LEGACY_FILTER,
  parseArgs,
  assessLegacyRecipe,
  migrationUpdate,
  runMigration,
  runMigrationCommand,
};
