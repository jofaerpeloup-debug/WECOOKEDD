const mongoose = require('mongoose');
const { loadEnv } = require('../src/config/env');
const { disconnectDatabase } = require('../src/config/database');
const { RECIPE_REGIONS, RECIPE_CATEGORIES } = require('@wecooked/contracts');

const CONNECTION_OPTIONS = Object.freeze({ autoIndex: false, autoCreate: false });
const REGION_MAPPINGS = Object.freeze({
  tondo: 'national-capital-region',
  bicol: 'bicol-region',
  mangaldan: 'ilocos-region',
});
const CATEGORY_UNSETS = Object.freeze(['fine-dining-restaurant', 'medium']);
const APPROVED_DATABASES = Object.freeze({
  development: 'wecooked-dev',
  production: 'wecooked-production',
});
const LEGACY_LIMITS = Object.freeze({
  development: Object.freeze({
    region: Object.freeze({ tondo: 1, bicol: 0, mangaldan: 0 }),
    category: Object.freeze({ 'fine-dining-restaurant': 0, medium: 0 }),
  }),
  production: Object.freeze({
    region: Object.freeze({ tondo: 0, bicol: 1, mangaldan: 1 }),
    category: Object.freeze({ 'fine-dining-restaurant': 1, medium: 1 }),
  }),
});
function parseArgs(argv) {
  const allowed = new Set(['--apply', '--environment=development', '--environment=production']);
  if (argv.some((arg) => !allowed.has(arg)) || new Set(argv).size !== argv.length) {
    throw new Error('Usage: node scripts/migrate-recipe-metadata-v1.js --environment=<development|production> [--apply]');
  }
  const environments = argv.filter((arg) => arg.startsWith('--environment='));
  if (environments.length !== 1) {
    throw new Error('Exactly one explicit --environment=<development|production> is required.');
  }
  return { environment: environments[0].slice('--environment='.length), apply: argv.includes('--apply') };
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function dispositionFor(doc) {
  const set = {};
  const unset = {};
  if (hasOwn(REGION_MAPPINGS, doc.region)) set.region = REGION_MAPPINGS[doc.region];
  if (CATEGORY_UNSETS.includes(doc.category)) unset.category = '';
  return { set, unset };
}

function summarize(docs) {
  const summary = {
    documents: docs.length,
    regionLegacy: 0,
    categoryLegacy: 0,
    regionCanonical: 0,
    categoryCanonical: 0,
    regionUnsupported: 0,
    categoryUnsupported: 0,
    missingRegion: 0,
    missingCategory: 0,
    changeCandidates: 0,
    legacyRegionCounts: { tondo: 0, bicol: 0, mangaldan: 0 },
    legacyCategoryCounts: { 'fine-dining-restaurant': 0, medium: 0 },
  };
  for (const doc of docs) {
    const disposition = dispositionFor(doc);
    if (!hasOwn(doc, 'region') || doc.region == null) summary.missingRegion += 1;
    else if (hasOwn(REGION_MAPPINGS, doc.region)) {
      summary.regionLegacy += 1;
      summary.legacyRegionCounts[doc.region] += 1;
    }
    else if (RECIPE_REGIONS.includes(doc.region)) summary.regionCanonical += 1;
    else summary.regionUnsupported += 1;
    if (!hasOwn(doc, 'category') || doc.category == null) summary.missingCategory += 1;
    else if (CATEGORY_UNSETS.includes(doc.category)) {
      summary.categoryLegacy += 1;
      summary.legacyCategoryCounts[doc.category] += 1;
    }
    else if (RECIPE_CATEGORIES.includes(doc.category)) summary.categoryCanonical += 1;
    else summary.categoryUnsupported += 1;
    if (Object.keys(disposition.set).length || Object.keys(disposition.unset).length) summary.changeCandidates += 1;
  }
  return summary;
}

function applyBlockers(summary, environment) {
  const blockers = [];
  if (summary.regionUnsupported) blockers.push(`unsupported region values=${summary.regionUnsupported}`);
  if (summary.categoryUnsupported) blockers.push(`unsupported category values=${summary.categoryUnsupported}`);
  const limits = LEGACY_LIMITS[environment];
  if (limits) {
    for (const [value, count] of Object.entries(summary.legacyRegionCounts)) {
      if (count > limits.region[value]) blockers.push(`unexpected region ${value} count=${count} maximum=${limits.region[value]}`);
    }
    for (const [value, count] of Object.entries(summary.legacyCategoryCounts)) {
      if (count > limits.category[value]) blockers.push(`unexpected category ${value} count=${count} maximum=${limits.category[value]}`);
    }
  }
  return blockers;
}

async function readMetadata(collection) {
  return collection.find({}, { projection: { region: 1, category: 1 } }).toArray();
}

async function readMetadataById(collection, id) {
  return collection.findOne({ _id: id }, { projection: { region: 1, category: 1 } });
}

function assertDatabaseBinding(environment, databaseName) {
  const expected = APPROVED_DATABASES[environment];
  if (!expected || databaseName !== expected) {
    throw new Error(
      `Refusing database mismatch: environment=${environment} requires database=${expected || '<unsupported>'}, connected=${databaseName || '<unknown>'}.`,
    );
  }
}

function reachesTargetState(doc, disposition) {
  if (!doc) return false;
  if (hasOwn(disposition.set, 'region') && doc.region !== disposition.set.region) return false;
  if (hasOwn(disposition.unset, 'category') && doc.category != null) return false;
  return true;
}

function candidateState(beforeDocs, afterDocs) {
  const afterById = new Map(afterDocs.map((doc) => [String(doc._id), doc]));
  let applied = 0;
  let pending = 0;
  for (const doc of beforeDocs) {
    const disposition = dispositionFor(doc);
    if (!Object.keys(disposition.set).length && !Object.keys(disposition.unset).length) continue;
    if (reachesTargetState(afterById.get(String(doc._id)), disposition)) applied += 1;
    else pending += 1;
  }
  return { applied, pending };
}

function finalPostconditionFailures(beforeDocs, afterDocs, summary) {
  const failures = [];
  if (summary.regionLegacy) failures.push(`legacy region values remain=${summary.regionLegacy}`);
  if (summary.categoryLegacy) failures.push(`legacy category values remain=${summary.categoryLegacy}`);
  if (summary.regionUnsupported) failures.push(`unsupported region values=${summary.regionUnsupported}`);
  if (summary.categoryUnsupported) failures.push(`unsupported category values=${summary.categoryUnsupported}`);
  const state = candidateState(beforeDocs, afterDocs);
  if (state.pending) failures.push(`targeted records not in frozen target state=${state.pending}`);
  return { failures, ...state };
}

function reportFor({ apply, environment, databaseName, before, after, blockers, matched, changed, conflicts, applied, pending }) {
  return {
    mode: apply ? 'apply' : 'dry-run', environment, databaseName,
    matched, changed, skipped: before.documents - before.changeCandidates,
    conflicts, applied, pending, blocked: blockers.length > 0, blockers, before, after,
  };
}

async function runMigration({ collection, apply = false, environment, databaseName, logger = console }) {
  // Binding is checked before even the preflight read, and therefore before
  // any possible write, so an environment selection can never target another
  // database merely because its URI was misconfigured.
  assertDatabaseBinding(environment, databaseName);
  const beforeDocs = await readMetadata(collection);
  const before = summarize(beforeDocs);
  const blockers = applyBlockers(before, environment);
  logger.log(`[migrate-recipe-metadata-v1] mode=${apply ? 'APPLY' : 'DRY_RUN'} environment=${environment} database=${databaseName}`);
  logger.log(`[migrate-recipe-metadata-v1] before=${JSON.stringify(before)}`);
  if (apply && blockers.length) {
    throw new Error(`Migration preflight blocked before writes: ${blockers.join('; ')}`);
  }

  if (!apply) {
    const report = reportFor({
      apply, environment, databaseName, before, after: before, blockers,
      matched: before.changeCandidates, changed: 0, conflicts: 0,
      applied: 0, pending: before.changeCandidates,
    });
    logger.log(`[migrate-recipe-metadata-v1] after=${JSON.stringify(before)} matched=${report.matched} changed=0 skipped=${report.skipped} conflicts=0 applied=0 pending=${report.pending}`);
    return report;
  }

  let changed = 0;
  let conflicts = 0;
  try {
    for (const doc of beforeDocs) {
      const disposition = dispositionFor(doc);
      const { set, unset } = disposition;
      if (!Object.keys(set).length && !Object.keys(unset).length) continue;
      const update = {};
      if (Object.keys(set).length) update.$set = set;
      if (Object.keys(unset).length) update.$unset = unset;
      const filter = { _id: doc._id };
      if (hasOwn(set, 'region')) filter.region = doc.region;
      if (hasOwn(unset, 'category')) filter.category = doc.category;
      const result = await collection.updateOne(filter, update);
      if (result?.acknowledged !== false && result?.matchedCount === 1 && result?.modifiedCount === 1) {
        changed += 1;
        continue;
      }

      // A stale exact predicate is acceptable only when a fresh read proves
      // another actor already established this candidate's exact frozen state.
      const current = await readMetadataById(collection, doc._id);
      if (reachesTargetState(current, disposition)) {
        conflicts += 1;
        continue;
      }
      throw new Error(
        `Targeted write failed for recipe ${doc._id}: matchedCount=${result?.matchedCount ?? '<missing>'} modifiedCount=${result?.modifiedCount ?? '<missing>'}.`,
      );
    }

    const afterDocs = await readMetadata(collection);
    const after = summarize(afterDocs);
    const final = finalPostconditionFailures(beforeDocs, afterDocs, after);
    if (final.failures.length) {
      throw new Error(`Migration final postcondition failed: ${final.failures.join('; ')}`);
    }
    const report = reportFor({
      apply, environment, databaseName, before, after, blockers,
      matched: before.changeCandidates, changed, conflicts,
      applied: final.applied, pending: final.pending,
    });
    logger.log(`[migrate-recipe-metadata-v1] after=${JSON.stringify(after)} matched=${report.matched} changed=${changed} skipped=${report.skipped} conflicts=${conflicts} applied=${report.applied} pending=${report.pending}`);
    return report;
  } catch (error) {
    let afterDocs = [];
    let after = null;
    let state = { applied: 0, pending: before.changeCandidates };
    try {
      afterDocs = await readMetadata(collection);
      after = summarize(afterDocs);
      state = candidateState(beforeDocs, afterDocs);
    } catch {
      // Preserve the original write/final-scan failure. The absence of a
      // readable after-state is itself reported rather than masking it.
    }
    const report = reportFor({
      apply, environment, databaseName, before, after, blockers,
      matched: before.changeCandidates, changed, conflicts,
      applied: state.applied, pending: state.pending,
    });
    error.migrationReport = report;
    logger.log(`[migrate-recipe-metadata-v1] FAILED applied=${report.applied} pending=${report.pending} state=${JSON.stringify(after)}`);
    throw error;
  }
}

async function runMigrationCommand({
  argv = process.argv.slice(2), loadEnvironment = loadEnv,
  connect = (uri) => mongoose.connect(uri, CONNECTION_OPTIONS),
  disconnect = disconnectDatabase, logger = console,
} = {}) {
  const args = parseArgs(argv);
  const env = loadEnvironment();
  if (env.nodeEnv !== args.environment) {
    throw new Error(`Refusing environment mismatch: requested ${args.environment}, configured ${env.nodeEnv}.`);
  }
  let connected = false;
  try {
    const connectionResult = await connect(env.mongodbUri);
    connected = true;
    const connection = connectionResult?.connection || mongoose.connection;
    return await runMigration({ collection: connection.collection('recipes'), ...args, databaseName: connection.name, logger });
  } finally {
    if (connected) await disconnect();
  }
}

if (require.main === module) {
  runMigrationCommand().catch((error) => {
    console.error(`[migrate-recipe-metadata-v1] failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  CONNECTION_OPTIONS, REGION_MAPPINGS, CATEGORY_UNSETS, APPROVED_DATABASES, LEGACY_LIMITS,
  parseArgs, dispositionFor, summarize, applyBlockers, assertDatabaseBinding,
  reachesTargetState, finalPostconditionFailures, runMigration, runMigrationCommand,
};
