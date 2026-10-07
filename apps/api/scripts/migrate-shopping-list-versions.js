const mongoose = require('mongoose');
const { loadEnv } = require('../src/config/env');

const COLLECTION_NAME = 'shoppinglists';
const MIGRATION_CONNECTION_OPTIONS = Object.freeze({
  autoIndex: false,
  autoCreate: false,
});
const APPROVED_DATABASES = Object.freeze({
  development: 'wecooked-dev',
  test: 'wecooked-shop4-mig1-test',
  production: 'wecooked-production',
});
const MISSING_VERSION_FILTER = Object.freeze({
  __v: Object.freeze({ $exists: false }),
});
const VERSION_ZERO_UPDATE = Object.freeze({
  $set: Object.freeze({ __v: 0 }),
});
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function parseArgs(argv) {
  const allowed = new Set([
    '--apply',
    '--environment=development',
    '--environment=test',
    '--environment=production',
  ]);
  if (argv.some((argument) => !allowed.has(argument)) || new Set(argv).size !== argv.length) {
    throw new Error(
      'Usage: node scripts/migrate-shopping-list-versions.js --environment=<development|test|production> [--apply]'
    );
  }

  const environments = argv.filter((argument) => argument.startsWith('--environment='));
  if (environments.length !== 1) {
    throw new Error('Exactly one explicit --environment=<development|test|production> is required.');
  }

  return {
    environment: environments[0].slice('--environment='.length),
    apply: argv.includes('--apply'),
  };
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function decimal128IsNonNegativeSafeInteger(value) {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:E([+-]?\d+))?$/.exec(value.toString());
  if (!match) return false;

  const sign = match[1];
  const fraction = match[3] || '';
  let coefficient = BigInt(`${match[2]}${fraction}`);
  let exponent = BigInt(match[4] || '0') - BigInt(fraction.length);

  if (sign === '-' && coefficient !== 0n) return false;

  while (exponent < 0n) {
    if (coefficient % 10n !== 0n) return false;
    coefficient /= 10n;
    exponent += 1n;
  }

  while (exponent > 0n) {
    if (coefficient > MAX_SAFE_INTEGER_BIGINT / 10n) return false;
    coefficient *= 10n;
    exponent -= 1n;
  }

  return coefficient <= MAX_SAFE_INTEGER_BIGINT;
}

function isValidVersionValue(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0;
  }
  if (typeof value === 'bigint') {
    return value >= 0n && value <= MAX_SAFE_INTEGER_BIGINT;
  }

  const { Int32, Long, Double, Decimal128, Timestamp } = mongoose.mongo;
  if (value instanceof Int32) {
    return Number.isSafeInteger(value.value) && value.value >= 0;
  }
  // BSON Timestamp extends Long in the driver but is not a numeric BSON value.
  if (value instanceof Timestamp) return false;
  if (Long.isLong(value)) {
    const exact = value.toBigInt();
    return exact >= 0n && exact <= MAX_SAFE_INTEGER_BIGINT;
  }
  if (value instanceof Double) {
    return Number.isSafeInteger(value.value) && value.value >= 0;
  }
  if (value instanceof Decimal128) {
    return decimal128IsNonNegativeSafeInteger(value);
  }
  return false;
}

function classifyDocument(document) {
  if (!hasOwn(document, '__v')) return 'missing';
  return isValidVersionValue(document.__v) ? 'valid' : 'invalid';
}

function invalidValueType(value) {
  if (value === null) return 'null';
  if (typeof value !== 'object') return typeof value;
  return value._bsontype || value.constructor?.name || 'object';
}

function summarizeDocuments(documents) {
  const summary = {
    scanned: documents.length,
    missing: 0,
    valid: 0,
    invalid: 0,
    invalidDocuments: [],
  };

  for (const document of documents) {
    const classification = classifyDocument(document);
    summary[classification] += 1;
    if (classification === 'invalid') {
      summary.invalidDocuments.push({
        id: document._id?.toHexString?.() || document._id,
        type: invalidValueType(document.__v),
      });
    }
  }
  return summary;
}

async function scanVersions(collection) {
  const documents = await collection.find(
    {},
    {
      projection: { _id: 1, __v: 1 },
      promoteValues: false,
      promoteLongs: false,
    }
  ).toArray();
  return summarizeDocuments(documents);
}

function assertDatabaseBinding(environment, databaseName) {
  const expected = APPROVED_DATABASES[environment];
  if (!expected || databaseName !== expected) {
    throw new Error(
      `Refusing database mismatch: environment=${environment || '<missing>'} requires database=${expected || '<unsupported>'}, connected=${databaseName || '<unknown>'}.`
    );
  }
}

function reportFor({ apply, environment, databaseName, before, after, matched, modified }) {
  const postStateKnown = after !== null && after !== undefined;
  return {
    mode: apply ? 'apply' : 'dry-run',
    environment,
    databaseName,
    before,
    after,
    matched,
    modified,
    applied: postStateKnown ? before.missing - after.missing : null,
    pending: postStateKnown ? after.missing : null,
    blocked: postStateKnown ? after.invalid > 0 : null,
  };
}

async function scanAfterFailure(collection) {
  try {
    return await scanVersions(collection);
  } catch {
    return null;
  }
}

async function runMigration({
  collection,
  apply = false,
  environment,
  databaseName,
  logger = console,
}) {
  // This assertion deliberately precedes the first collection read.
  assertDatabaseBinding(environment, databaseName);

  const before = await scanVersions(collection);
  logger.log(
    `[shopping-list-versions] mode=${apply ? 'apply' : 'dry-run'} environment=${environment} database=${databaseName} preflight=${JSON.stringify(before)}`
  );

  if (!apply) {
    const report = reportFor({
      apply,
      environment,
      databaseName,
      before,
      after: before,
      matched: 0,
      modified: 0,
    });
    logger.log(`[shopping-list-versions] report=${JSON.stringify(report)}`);
    return report;
  }

  if (before.invalid > 0) {
    const report = reportFor({
      apply,
      environment,
      databaseName,
      before,
      after: before,
      matched: 0,
      modified: 0,
    });
    throw Object.assign(
      new Error(`Migration preflight blocked before writes: invalid present __v values=${before.invalid}.`),
      { migrationReport: report }
    );
  }

  let result;
  try {
    result = await collection.updateMany(MISSING_VERSION_FILTER, VERSION_ZERO_UPDATE);
  } catch (error) {
    const after = await scanAfterFailure(collection);
    error.migrationReport = reportFor({
      apply,
      environment,
      databaseName,
      before,
      after,
      matched: null,
      modified: null,
    });
    logger.log(`[shopping-list-versions] FAILED report=${JSON.stringify(error.migrationReport)}`);
    throw error;
  }

  const matched = result?.matchedCount;
  const modified = result?.modifiedCount;
  let after;
  try {
    after = await scanVersions(collection);
  } catch (error) {
    error.migrationReport = reportFor({
      apply,
      environment,
      databaseName,
      before,
      after: null,
      matched,
      modified,
    });
    logger.log(`[shopping-list-versions] FAILED report=${JSON.stringify(error.migrationReport)}`);
    throw error;
  }
  const report = reportFor({
    apply,
    environment,
    databaseName,
    before,
    after,
    matched,
    modified,
  });

  const failures = [];
  if (result?.acknowledged !== true) failures.push('raw update was not acknowledged');
  if (matched !== before.missing) {
    failures.push(`matched=${matched ?? '<missing>'} expected=${before.missing}`);
  }
  if (modified !== before.missing) {
    failures.push(`modified=${modified ?? '<missing>'} expected=${before.missing}`);
  }
  if (after.missing !== 0) failures.push(`postcheck missing=${after.missing}`);
  if (after.invalid !== 0) failures.push(`postcheck invalid=${after.invalid}`);

  if (failures.length > 0) {
    throw Object.assign(
      new Error(`Migration apply failed: ${failures.join('; ')}.`),
      { migrationReport: report }
    );
  }

  logger.log(`[shopping-list-versions] report=${JSON.stringify(report)}`);
  return report;
}

async function runMigrationCommand({
  argv = process.argv.slice(2),
  loadEnvironment = loadEnv,
  connect = (uri, options) => mongoose.connect(uri, options),
  disconnect = () => mongoose.disconnect(),
  logger = console,
} = {}) {
  const args = parseArgs(argv);
  const env = loadEnvironment();
  if (env.nodeEnv !== args.environment) {
    throw new Error(
      `Refusing environment mismatch: requested ${args.environment}, configured ${env.nodeEnv}.`
    );
  }

  let connected = false;
  try {
    const connectionResult = await connect(env.mongodbUri, MIGRATION_CONNECTION_OPTIONS);
    connected = true;
    const connection = connectionResult?.connection || mongoose.connection;
    return await runMigration({
      collection: connection.collection(COLLECTION_NAME),
      ...args,
      databaseName: connection.name,
      logger,
    });
  } finally {
    if (connected) await disconnect();
  }
}

if (require.main === module) {
  runMigrationCommand().catch((error) => {
    if (error.migrationReport) {
      console.error(`[shopping-list-versions] report=${JSON.stringify(error.migrationReport)}`);
    }
    console.error(`[shopping-list-versions] failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  COLLECTION_NAME,
  MIGRATION_CONNECTION_OPTIONS,
  APPROVED_DATABASES,
  MISSING_VERSION_FILTER,
  VERSION_ZERO_UPDATE,
  parseArgs,
  decimal128IsNonNegativeSafeInteger,
  isValidVersionValue,
  classifyDocument,
  summarizeDocuments,
  scanVersions,
  assertDatabaseBinding,
  runMigration,
  runMigrationCommand,
};
