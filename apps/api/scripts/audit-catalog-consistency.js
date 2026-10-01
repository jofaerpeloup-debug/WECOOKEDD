const mongoose = require('mongoose');
const { loadEnv } = require('../src/config/env');
const Recipe = require('../src/modules/recipes/recipe.model');
const Ingredient = require('../src/modules/ingredients/ingredient.model');
const Substitution = require('../src/modules/substitutions/substitution.model');
const { legacyPublishedRecipeBodySchema } = require('../src/modules/recipes/recipe.validation');
const {
  ALIAS_COLLISION_TYPES,
  normalizeIngredientName,
  classifyIngredientAliasCollisions,
  summarizeIngredientAliasCollisions,
} = require('../src/modules/ingredients/ingredient-alias-collisions');

const TOOL_NAME = 'catalog-consistency-audit';
const SCHEMA_VERSION = 2;
const AUDIT_CONNECTION_OPTIONS = Object.freeze({ autoIndex: false, autoCreate: false });
const SEVERITY_ORDER = Object.freeze({ ERROR: 0, WARNING: 1, INFO: 2 });

const RECIPE_PROJECTION = Object.freeze({
  _id: 1,
  title: 1,
  isActive: 1,
  publicationStatus: 1,
  description: 1,
  region: 1,
  category: 1,
  difficulty: 1,
  prepTimeMinutes: 1,
  cookTimeMinutes: 1,
  servings: 1,
  ingredients: 1,
  instructions: 1,
  steps: 1,
  dietaryTags: 1,
  imageUrl: 1,
  imageAssetId: 1,
});
const SUBSTITUTION_PROJECTION = Object.freeze({
  _id: 1,
  isActive: 1,
  sourceIngredientId: 1,
  substituteIngredientId: 1,
});
const INGREDIENT_PROJECTION = Object.freeze({ _id: 1, name: 1, aliases: 1, isActive: 1 });

class InvalidArgumentsError extends Error {
  constructor() {
    super('Usage: node scripts/audit-catalog-consistency.js [--json]');
    this.name = 'InvalidArgumentsError';
    this.code = 'AUDIT_ARGUMENTS_INVALID';
  }
}

function hasOwn(object, field) {
  return object != null && Object.prototype.hasOwnProperty.call(object, field);
}

function printableId(value) {
  if (value === undefined || value === null) return undefined;
  try {
    return String(value);
  } catch {
    return '(unprintable)';
  }
}

function isValidStoredObjectId(value) {
  try {
    return mongoose.isObjectIdOrHexString(value);
  } catch {
    return false;
  }
}

function toLookupObjectId(value) {
  if (value instanceof mongoose.Types.ObjectId) return value;
  return new mongoose.Types.ObjectId(value);
}

function ingredientKey(value) {
  if (!isValidStoredObjectId(value)) return printableId(value);
  return printableId(toLookupObjectId(value));
}

function ingredientLookupValue(value) {
  return isValidStoredObjectId(value) ? toLookupObjectId(value) : value;
}

function parseArgs(argv) {
  if (argv.length === 0) return { json: false };
  if (argv.length === 1 && argv[0] === '--json') return { json: true };
  throw new InvalidArgumentsError();
}

function classifyPublicationStatus(recipe) {
  if (!hasOwn(recipe, 'publicationStatus')) return 'LEGACY_PUBLISHED';
  if (recipe.publicationStatus === 'published') return 'PUBLISHED';
  if (recipe.publicationStatus === 'draft') return 'DRAFT';
  return 'INVALID_PUBLICATION_STATUS';
}

function classifyActivity(value) {
  if (value === true) return 'ACTIVE';
  if (value === false) return 'ARCHIVED';
  return 'INVALID_ACTIVITY_STATE';
}

function copyPresentFields(source, fields) {
  const target = {};
  if (source == null || typeof source !== 'object' || Array.isArray(source)) return source;
  for (const field of fields) {
    if (hasOwn(source, field)) target[field] = source[field];
  }
  return target;
}

function toPublishedIngredientInput(entry) {
  if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  const input = copyPresentFields(entry, ['ingredientId', 'quantity', 'unit', 'note', 'optional']);
  if (hasOwn(input, 'ingredientId') && isValidStoredObjectId(input.ingredientId)) {
    input.ingredientId = printableId(input.ingredientId);
  }
  return input;
}

function buildPublishedValidationInput(recipe) {
  const input = copyPresentFields(recipe, [
    'title',
    'description',
    'region',
    'category',
    'difficulty',
    'prepTimeMinutes',
    'cookTimeMinutes',
    'servings',
    'ingredients',
    'instructions',
    'steps',
    'dietaryTags',
    'imageUrl',
    'imageAssetId',
  ]);
  if (input && Array.isArray(input.ingredients)) {
    input.ingredients = input.ingredients.map(toPublishedIngredientInput);
  }
  return input;
}

function connectAuditDatabase(uri, options = AUDIT_CONNECTION_OPTIONS) {
  return mongoose.connect(uri, options);
}

async function disconnectAuditDatabase() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}

function collectReferencedIngredientIds(recipes, substitutions) {
  const references = new Map();
  const add = (value) => {
    const key = ingredientKey(value);
    if (key !== undefined && !references.has(key)) references.set(key, ingredientLookupValue(value));
  };
  for (const recipe of recipes) {
    if (!Array.isArray(recipe.ingredients)) continue;
    for (const entry of recipe.ingredients) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) add(entry.ingredientId);
    }
  }
  for (const substitution of substitutions) {
    add(substitution.sourceIngredientId);
    add(substitution.substituteIngredientId);
  }
  return [...references.values()];
}

async function readCatalogSnapshot({ recipeCollection, substitutionCollection, ingredientCollection }) {
  const [recipes, substitutions, ingredients, ingredientCount] = await Promise.all([
    recipeCollection.find({}, { projection: RECIPE_PROJECTION }).toArray(),
    substitutionCollection.find({}, { projection: SUBSTITUTION_PROJECTION }).toArray(),
    ingredientCollection.find({}, { projection: INGREDIENT_PROJECTION }).toArray(),
    ingredientCollection.countDocuments({}),
  ]);
  return {
    recipes,
    substitutions,
    ingredients,
    counts: {
      recipes: recipes.length,
      substitutions: substitutions.length,
      ingredients: ingredientCount,
    },
  };
}

function lifecycleLabel(activity, publication) {
  if (activity === 'INVALID_ACTIVITY_STATE') return 'INVALID_ACTIVITY_STATE';
  if (publication === 'INVALID_PUBLICATION_STATUS') return 'INVALID_PUBLICATION_STATUS';
  return `${activity}_${publication}`;
}

function makeFinding({ severity, code, entityType, entityId, ...details }) {
  const finding = { severity, code, entityType, entityId: printableId(entityId) };
  for (const [key, value] of Object.entries(details)) {
    if (value !== undefined) finding[key] = value;
  }
  return finding;
}

function ingredientState(ingredient) {
  if (!ingredient) return 'MISSING';
  if (ingredient.isActive === true) return 'ACTIVE';
  if (ingredient.isActive === false) return 'INACTIVE';
  return 'INVALID_ACTIVITY_STATE';
}

function recipeRelationshipSeverity(activity, publication, optional) {
  if (activity === 'ACTIVE' && publication !== 'DRAFT') return optional ? 'WARNING' : 'ERROR';
  if (activity === 'ACTIVE' || publication !== 'DRAFT') return 'WARNING';
  return 'INFO';
}

function classifyRecipe(recipe, ingredientsById) {
  const findings = [];
  const activity = classifyActivity(recipe.isActive);
  const publication = classifyPublicationStatus(recipe);
  const entity = {
    entityType: 'Recipe',
    entityId: recipe._id,
    entityName: recipe.title,
  };

  if (publication === 'INVALID_PUBLICATION_STATUS') {
    findings.push(makeFinding({
      severity: 'ERROR',
      code: 'RECIPE_PUBLICATION_STATUS_INVALID',
      ...entity,
      lifecycle: lifecycleLabel(activity, publication),
      field: 'publicationStatus',
      reason: 'Recipe has an invalid explicit publication status.',
    }));
  } else if (publication === 'LEGACY_PUBLISHED') {
    findings.push(makeFinding({
      severity: 'INFO',
      code: 'RECIPE_LEGACY_PUBLICATION_STATUS',
      ...entity,
      lifecycle: lifecycleLabel(activity, publication),
      field: 'publicationStatus',
      reason: 'Publication status is physically absent; legacy Published semantics apply.',
    }));
  }

  if (activity === 'INVALID_ACTIVITY_STATE') {
    findings.push(makeFinding({
      severity: 'ERROR',
      code: 'RECIPE_ACTIVITY_STATE_INVALID',
      ...entity,
      lifecycle: lifecycleLabel(activity, publication),
      field: 'isActive',
      reason: 'Recipe has an invalid activity state.',
    }));
    return findings;
  }
  if (publication === 'INVALID_PUBLICATION_STATUS') return findings;

  const lifecycle = lifecycleLabel(activity, publication);
  if (publication === 'PUBLISHED' || publication === 'LEGACY_PUBLISHED') {
    const result = legacyPublishedRecipeBodySchema.safeParse(buildPublishedValidationInput(recipe));
    if (!result.success) {
      const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.') || '(root)'))]
        .sort()
        .join(',');
      findings.push(makeFinding({
        severity: activity === 'ACTIVE' ? 'ERROR' : 'WARNING',
        code: 'RECIPE_PUBLISHED_STRUCTURE_INVALID',
        ...entity,
        lifecycle,
        field: fields,
        reason: activity === 'ACTIVE'
          ? 'Effective-Published Recipe violates the authoritative Published structure.'
          : 'Effective-Published Recipe cannot be restored with its current structure.',
      }));
    }
  }

  if (!Array.isArray(recipe.ingredients)) return findings;
  for (let index = 0; index < recipe.ingredients.length; index += 1) {
    const entry = recipe.ingredients[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    if (entry.optional !== undefined && typeof entry.optional !== 'boolean') continue;
    const ingredientId = ingredientKey(entry.ingredientId);
    const ingredient = ingredientId === undefined ? undefined : ingredientsById.get(ingredientId);
    const state = ingredientState(ingredient);
    if (state === 'ACTIVE') continue;

    const optional = entry.optional === true;
    const common = {
      severity: recipeRelationshipSeverity(activity, publication, optional),
      ...entity,
      lifecycle,
      field: `ingredients.${index}.ingredientId`,
      relationshipRole: optional ? 'optionalIngredient' : 'requiredIngredient',
      optional,
      ingredientId,
      ingredientName: ingredient?.name,
    };
    if (state === 'MISSING') {
      findings.push(makeFinding({
        ...common,
        code: 'RECIPE_INGREDIENT_MISSING',
        reason: 'Referenced Ingredient does not exist.',
      }));
    } else if (state === 'INACTIVE') {
      findings.push(makeFinding({
        ...common,
        code: 'RECIPE_INGREDIENT_INACTIVE',
        reason: 'Referenced Ingredient is inactive.',
      }));
    } else {
      findings.push(makeFinding({
        ...common,
        severity: 'ERROR',
        code: 'INGREDIENT_ACTIVITY_STATE_INVALID',
        reason: 'Referenced Ingredient has an invalid activity state.',
      }));
    }
  }
  return findings;
}

function classifySubstitution(substitution, ingredientsById) {
  const findings = [];
  const activity = classifyActivity(substitution.isActive);
  const entity = { entityType: 'Substitution', entityId: substitution._id };
  if (activity === 'INVALID_ACTIVITY_STATE') {
    return [makeFinding({
      severity: 'ERROR',
      code: 'SUBSTITUTION_ACTIVITY_STATE_INVALID',
      ...entity,
      lifecycle: activity,
      field: 'isActive',
      reason: 'Substitution has an invalid activity state.',
    })];
  }

  const severity = activity === 'ACTIVE' ? 'ERROR' : 'WARNING';
  const relationships = [
    {
      field: 'sourceIngredientId',
      role: 'sourceIngredient',
      value: substitution.sourceIngredientId,
      missingCode: 'SUBSTITUTION_SOURCE_INGREDIENT_MISSING',
      inactiveCode: 'SUBSTITUTION_SOURCE_INGREDIENT_INACTIVE',
    },
    {
      field: 'substituteIngredientId',
      role: 'substituteIngredient',
      value: substitution.substituteIngredientId,
      missingCode: 'SUBSTITUTION_SUBSTITUTE_INGREDIENT_MISSING',
      inactiveCode: 'SUBSTITUTION_SUBSTITUTE_INGREDIENT_INACTIVE',
    },
  ];
  for (const relationship of relationships) {
    const ingredientId = ingredientKey(relationship.value);
    const ingredient = ingredientId === undefined ? undefined : ingredientsById.get(ingredientId);
    const state = ingredientState(ingredient);
    if (state === 'ACTIVE') continue;
    const common = {
      severity,
      ...entity,
      lifecycle: activity,
      field: relationship.field,
      relationshipRole: relationship.role,
      ingredientId,
      ingredientName: ingredient?.name,
    };
    if (state === 'MISSING') {
      findings.push(makeFinding({
        ...common,
        code: relationship.missingCode,
        reason: 'Referenced Ingredient does not exist.',
      }));
    } else if (state === 'INACTIVE') {
      findings.push(makeFinding({
        ...common,
        code: relationship.inactiveCode,
        reason: 'Referenced Ingredient is inactive.',
      }));
    } else {
      findings.push(makeFinding({
        ...common,
        severity: 'ERROR',
        code: 'INGREDIENT_ACTIVITY_STATE_INVALID',
        reason: 'Referenced Ingredient has an invalid activity state.',
      }));
    }
  }

  const sourceId = ingredientKey(substitution.sourceIngredientId);
  const substituteId = ingredientKey(substitution.substituteIngredientId);
  if (sourceId !== undefined && sourceId === substituteId) {
    findings.push(makeFinding({
      severity,
      code: 'SUBSTITUTION_SAME_INGREDIENT',
      ...entity,
      lifecycle: activity,
      field: 'sourceIngredientId,substituteIngredientId',
      relationshipRole: 'sourceAndSubstitute',
      ingredientId: sourceId,
      ingredientName: ingredientsById.get(sourceId)?.name,
      reason: 'Source and substitute reference the same Ingredient.',
    }));
  }
  return findings;
}

function compareText(left, right) {
  const a = left == null ? '' : String(left);
  const b = right == null ? '' : String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortFindings(findings) {
  return [...findings].sort((left, right) =>
    (SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]) ||
    compareText(left.code, right.code) ||
    compareText(left.entityType, right.entityType) ||
    compareText(left.entityId, right.entityId) ||
    compareText(left.field, right.field) ||
    compareText(left.ingredientId, right.ingredientId)
  );
}

function summarizeFindings(findings) {
  const affected = new Set();
  const summary = { errors: 0, warnings: 0, info: 0, affectedDocuments: 0 };
  for (const finding of findings) {
    if (finding.severity === 'ERROR') summary.errors += 1;
    if (finding.severity === 'WARNING') summary.warnings += 1;
    if (finding.severity === 'INFO') summary.info += 1;
    affected.add(`${finding.entityType}:${finding.entityId}`);
  }
  summary.affectedDocuments = affected.size;
  return summary;
}

function classifyCatalogSnapshot(snapshot, database = '(unknown)') {
  const ingredientsById = new Map(
    snapshot.ingredients.map((ingredient) => [ingredientKey(ingredient._id), ingredient])
  );
  const findings = sortFindings([
    ...snapshot.recipes.flatMap((recipe) => classifyRecipe(recipe, ingredientsById)),
    ...snapshot.substitutions.flatMap((substitution) => classifySubstitution(substitution, ingredientsById)),
  ]);
  const ingredientAliasCollisions = classifyIngredientAliasCollisions(snapshot.ingredients);
  return {
    tool: TOOL_NAME,
    schemaVersion: SCHEMA_VERSION,
    database,
    readOnly: true,
    observation: 'Non-transactional observation; rerun before remediation.',
    counts: { ...snapshot.counts },
    summary: summarizeFindings(findings),
    findings,
    ingredientAliasCollisionSummary: summarizeIngredientAliasCollisions(ingredientAliasCollisions),
    ingredientAliasCollisions,
  };
}

function formatFindingHuman(finding) {
  const details = [
    `code=${finding.code}`,
    `entity=${finding.entityType}`,
    `id=${finding.entityId}`,
    finding.entityName && `name=${JSON.stringify(finding.entityName)}`,
    finding.lifecycle && `lifecycle=${finding.lifecycle}`,
    finding.field && `field=${finding.field}`,
    finding.relationshipRole && `role=${finding.relationshipRole}`,
    finding.optional !== undefined && `optional=${finding.optional}`,
    finding.ingredientId && `ingredientId=${finding.ingredientId}`,
    finding.ingredientName && `ingredientName=${JSON.stringify(finding.ingredientName)}`,
    `reason=${finding.reason}`,
  ].filter(Boolean);
  return `  ${details.join(' ')}`;
}

function formatHumanReport(report) {
  const lines = [
    `[catalog-audit] database=${report.database} mode=read-only`,
    `[catalog-audit] recipes=${report.counts.recipes} substitutions=${report.counts.substitutions} ingredients=${report.counts.ingredients}`,
    '[catalog-audit] observation=non-transactional; rerun before remediation',
    '',
  ];
  for (const severity of ['ERROR', 'WARNING', 'INFO']) {
    const findings = report.findings.filter((finding) => finding.severity === severity);
    const documents = new Set(findings.map((finding) => `${finding.entityType}:${finding.entityId}`)).size;
    lines.push(`${severity} (${findings.length} findings / ${documents} documents)`);
    if (findings.length === 0) lines.push('  none');
    else lines.push(...findings.map(formatFindingHuman));
    lines.push('');
  }
  const collisionSummary = report.ingredientAliasCollisionSummary;
  lines.push(
    `INGREDIENT ALIAS COLLISIONS (${collisionSummary.total} collisions / ` +
    `${collisionSummary.affectedIngredients} ingredients)`
  );
  for (const type of ALIAS_COLLISION_TYPES) {
    lines.push(`  ${type}=${collisionSummary.byType[type]}`);
  }
  if (report.ingredientAliasCollisions.length === 0) lines.push('  none');
  else {
    for (const collision of report.ingredientAliasCollisions) {
      lines.push(`  value=${JSON.stringify(collision.normalizedValue)} type=${collision.collisionType}`);
      for (const participant of collision.participants) {
        const sourceIndex = participant.source === 'alias' ? ` sourceIndex=${participant.sourceIndex}` : '';
        lines.push(
          `    ingredientId=${participant.ingredientId} canonicalName=${JSON.stringify(participant.canonicalName)} ` +
          `status=${participant.status} source=${participant.source} ` +
          `sourceValue=${JSON.stringify(participant.sourceValue)}${sourceIndex}`
        );
      }
    }
  }
  lines.push('');
  lines.push(
    `SUMMARY errors=${report.summary.errors} warnings=${report.summary.warnings} info=${report.summary.info} ` +
    `affectedDocuments=${report.summary.affectedDocuments}`
  );
  return lines.join('\n');
}

function formatJsonReport(report) {
  return JSON.stringify(report, null, 2);
}

function formatJsonFailure() {
  return JSON.stringify({
    tool: TOOL_NAME,
    schemaVersion: SCHEMA_VERSION,
    readOnly: true,
    ok: false,
    error: {
      code: 'AUDIT_EXECUTION_FAILED',
      message: 'Catalog consistency audit could not complete.',
    },
  }, null, 2);
}

function determineExitCode(report) {
  return report.summary.errors > 0 ? 1 : 0;
}

async function runCatalogAudit({ collections, databaseName }) {
  const snapshot = await readCatalogSnapshot(collections);
  return classifyCatalogSnapshot(snapshot, databaseName);
}

function loadEnvironmentQuietly(loadEnvironment) {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return loadEnvironment();
  } finally {
    console.log = originalLog;
  }
}

async function runCatalogAuditCommand({
  argv = process.argv.slice(2),
  loadEnvironment = loadEnv,
  connect = connectAuditDatabase,
  disconnect = disconnectAuditDatabase,
  getCollections = () => ({
    recipeCollection: Recipe.collection,
    substitutionCollection: Substitution.collection,
    ingredientCollection: Ingredient.collection,
  }),
  formatHuman = formatHumanReport,
  formatJson = formatJsonReport,
} = {}) {
  const { json } = parseArgs(argv);
  const env = loadEnvironmentQuietly(loadEnvironment);
  let connectionAttempted = false;
  try {
    connectionAttempted = true;
    const connectionResult = await connect(env.mongodbUri, AUDIT_CONNECTION_OPTIONS);
    const connection = connectionResult?.connection || mongoose.connection;
    const report = await runCatalogAudit({
      collections: getCollections(),
      databaseName: connection?.name || '(unknown)',
    });
    const output = json ? formatJson(report) : formatHuman(report);
    return { exitCode: determineExitCode(report), output, report };
  } finally {
    if (connectionAttempted) await disconnect();
  }
}

async function executeCatalogAuditCli({
  argv = process.argv.slice(2),
  stdout = process.stdout,
  stderr = process.stderr,
  runCommand = runCatalogAuditCommand,
} = {}) {
  const json = argv.includes('--json');
  try {
    const result = await runCommand({ argv });
    stdout.write(`${result.output}\n`);
    return result.exitCode;
  } catch {
    if (json) stdout.write(`${formatJsonFailure()}\n`);
    else stderr.write('[catalog-audit] Catalog consistency audit could not complete.\n');
    return 2;
  }
}

if (require.main === module) {
  executeCatalogAuditCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = {
  TOOL_NAME,
  SCHEMA_VERSION,
  AUDIT_CONNECTION_OPTIONS,
  ALIAS_COLLISION_TYPES,
  RECIPE_PROJECTION,
  SUBSTITUTION_PROJECTION,
  INGREDIENT_PROJECTION,
  InvalidArgumentsError,
  parseArgs,
  classifyPublicationStatus,
  classifyActivity,
  ingredientKey,
  ingredientLookupValue,
  buildPublishedValidationInput,
  collectReferencedIngredientIds,
  readCatalogSnapshot,
  classifyRecipe,
  classifySubstitution,
  sortFindings,
  summarizeFindings,
  normalizeIngredientName,
  classifyIngredientAliasCollisions,
  summarizeIngredientAliasCollisions,
  classifyCatalogSnapshot,
  formatHumanReport,
  formatJsonReport,
  formatJsonFailure,
  determineExitCode,
  runCatalogAudit,
  runCatalogAuditCommand,
  executeCatalogAuditCli,
};
