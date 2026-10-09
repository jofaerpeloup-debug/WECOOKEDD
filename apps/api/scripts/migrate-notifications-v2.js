const { loadEnv } = require('../src/config/env');
const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const PushInstallation = require('../src/modules/push-installations/push-installation.model');
const { PUSH_INSTALLATION_REQUIRED_INDEXES } = require('../src/config/required-indexes');

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function same(value, expected) {
  return JSON.stringify(canonicalize(value ?? null)) === JSON.stringify(canonicalize(expected ?? null));
}

function sameKey(actual, required) {
  const entries = Object.entries(actual || {});
  return entries.length === required.key.length
    && required.key.every(([field, direction], index) => entries[index]?.[0] === field && entries[index]?.[1] === direction);
}

function exactIndex(actual, required) {
  return actual.name === required.name
    && sameKey(actual.key, required)
    && (actual.unique === true) === required.unique
    && same(actual.partialFilterExpression, required.partialFilterExpression)
    && (actual.expireAfterSeconds ?? null) === required.expireAfterSeconds
    && actual.sparse !== true;
}

function analyzeIndexes(existing) {
  const blockers = [];
  const states = PUSH_INSTALLATION_REQUIRED_INDEXES.map((required) => {
    const sameName = existing.find((index) => index.name === required.name);
    const sameKeys = existing.filter((index) => sameKey(index.key, required));
    if (sameName && !exactIndex(sameName, required)) blockers.push(required.name);
    if (sameKeys.some((index) => !exactIndex(index, required))) blockers.push(required.name);
    return { required, exists: !!sameName && exactIndex(sameName, required) };
  });
  return { states, blockers: [...new Set(blockers)] };
}

async function preflight(collection) {
  let indexes;
  try {
    indexes = await collection.listIndexes().toArray();
  } catch (error) {
    if (error?.code === 26 || error?.codeName === 'NamespaceNotFound') indexes = [];
    else throw error;
  }
  return analyzeIndexes(indexes);
}

async function migrateCollection({ collection, apply = false, logger = console }) {
  const scan = await preflight(collection);
  const missing = scan.states.filter(({ exists }) => !exists);
  const report = {
    mode: apply ? 'apply' : 'dry-run',
    blockers: scan.blockers.length,
    indexesCreated: 0,
    pending: missing.length,
    exact: PUSH_INSTALLATION_REQUIRED_INDEXES.length - missing.length - scan.blockers.length,
    missing: missing.map(({ required }) => required.name),
    drifted: scan.blockers,
  };
  if (report.blockers) throw Object.assign(new Error('Push installation index preflight failed.'), { report });
  if (!apply) {
    logger.log(`[notifications-v2] ${JSON.stringify(report)}`);
    return report;
  }
  for (const { required } of missing) {
    await collection.createIndex(Object.fromEntries(required.key), {
      name: required.name,
      ...(required.unique ? { unique: true } : {}),
      ...(required.partialFilterExpression ? { partialFilterExpression: required.partialFilterExpression } : {}),
    });
    report.indexesCreated += 1;
  }
  const finalState = await preflight(collection);
  if (finalState.blockers.length || finalState.states.some(({ exists }) => !exists)) {
    throw Object.assign(new Error('Push installation index postcondition failed.'), { report });
  }
  report.pending = 0;
  report.exact = PUSH_INSTALLATION_REQUIRED_INDEXES.length;
  report.missing = [];
  logger.log(`[notifications-v2] ${JSON.stringify(report)}`);
  return report;
}

function parseCommandFlags(argv) {
  if (argv.some((argument) => argument !== '--apply') || new Set(argv).size !== argv.length) {
    throw new Error('Usage: npm run migrate:notifications-v2 -- [--apply]');
  }
  return { apply: argv.includes('--apply') };
}

function databaseName(uri) {
  const match = uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/i);
  return match ? decodeURIComponent(match[1]) : '';
}

function assertCommandTarget(env, { apply = false } = {}) {
  const name = databaseName(env.mongodbUri);
  if (env.nodeEnv === 'production' || /prod/i.test(name)) {
    throw new Error('Refusing push installation migration access to a production identity.');
  }
  if (!name) throw new Error('Refusing push installation migration without an explicit database binding.');
  if (apply && !/^wecooked[-_]notif2[-_](?:test|isolated)(?:[-_][a-z0-9]+)*$/i.test(name)) {
    throw new Error('Refusing push installation migration apply without an isolated non-production database binding.');
  }
}

async function runMigrationCommand({
  argv = process.argv.slice(2), loadEnvironment = loadEnv, connect = connectDatabase,
  disconnect = disconnectDatabase, collection = PushInstallation.collection, logger = console,
} = {}) {
  const flags = parseCommandFlags(argv);
  const env = loadEnvironment();
  assertCommandTarget(env, flags);
  let connected = false;
  try {
    await connect(env.mongodbUri, env.nodeEnv);
    connected = true;
    return await migrateCollection({ collection, apply: flags.apply, logger });
  } finally {
    if (connected) await disconnect();
  }
}

if (require.main === module) {
  runMigrationCommand().catch((error) => {
    console.error(`[notifications-v2] failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { sameKey, exactIndex, analyzeIndexes, preflight, migrateCollection, parseCommandFlags, databaseName, assertCommandTarget, runMigrationCommand };
