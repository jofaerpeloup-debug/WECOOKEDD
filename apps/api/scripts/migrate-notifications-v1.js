const { loadEnv } = require('../src/config/env');
const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const User = require('../src/modules/users/user.model');
const Notification = require('../src/modules/notifications/notification.model');
const { NOTIFICATION_REQUIRED_INDEXES } = require('../src/config/required-indexes');

const LEAVES = Object.freeze(['enabled', 'push', 'email', 'suggestions', 'digest', 'reminders']);
const DEFAULTS = Object.freeze({ push: true, email: true, suggestions: true, digest: false, reminders: true });

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function analyzePreference(raw, present = raw !== undefined) {
  if (present && (!raw || typeof raw !== 'object' || Array.isArray(raw))) {
    return { malformed: true, present, reason: 'non-object' };
  }
  const source = raw || {};
  if (Object.keys(source).some((key) => !LEAVES.includes(key))) {
    return { malformed: true, present, reason: 'unknown-field' };
  }
  if (LEAVES.some((key) => own(source, key) && typeof source[key] !== 'boolean')) {
    return { malformed: true, present, reason: 'non-boolean' };
  }
  if (own(source, 'enabled') && own(source, 'push') && source.enabled !== source.push) {
    return { malformed: true, present, reason: 'contradictory-alias' };
  }

  const push = own(source, 'push') ? source.push : own(source, 'enabled') ? source.enabled : DEFAULTS.push;
  const target = {
    enabled: push,
    push,
    email: own(source, 'email') ? source.email : DEFAULTS.email,
    suggestions: own(source, 'suggestions') ? source.suggestions : DEFAULTS.suggestions,
    digest: own(source, 'digest') ? source.digest : DEFAULTS.digest,
    reminders: own(source, 'reminders') ? source.reminders : DEFAULTS.reminders,
  };
  const canonical = Object.keys(source).length === LEAVES.length
    && LEAVES.every((key) => own(source, key) && source[key] === target[key]);
  return { malformed: false, present, source, target, canonical };
}

function notificationValue(document) {
  const preferences = document?.preferences;
  const present = !!preferences && own(preferences, 'notifications');
  return { present, raw: present ? preferences.notifications : undefined };
}

function observedPredicate(id, analysis) {
  const clauses = [{ _id: id }];
  if (!analysis.present) {
    clauses.push({ 'preferences.notifications': { $exists: false } });
  } else {
    for (const key of LEAVES) {
      const path = `preferences.notifications.${key}`;
      clauses.push(own(analysis.source, key)
        ? { [path]: analysis.source[key] }
        : { [path]: { $exists: false } });
    }
  }
  return { $and: clauses };
}

function sameKey(actual, required) {
  const entries = Object.entries(actual.key || {});
  return entries.length === required.key.length
    && required.key.every(([field, direction], index) => (
      entries[index]?.[0] === field && entries[index]?.[1] === direction
    ));
}

function exactIndex(actual, required) {
  return actual.name === required.name
    && sameKey(actual, required)
    && (actual.unique === true) === required.unique
    && (actual.partialFilterExpression ?? null) === null
    && (actual.expireAfterSeconds ?? null) === (required.expireAfterSeconds ?? null)
    && actual.sparse !== true;
}

function analyzeIndexes(indexes) {
  const states = [];
  const blockers = [];
  for (const required of NOTIFICATION_REQUIRED_INDEXES) {
    const byName = indexes.find((index) => index.name === required.name);
    const byKey = indexes.find((index) => sameKey(index, required));
    if (byName && !exactIndex(byName, required)) blockers.push(required.name);
    else if (byKey && !exactIndex(byKey, required)) blockers.push(required.name);
    else states.push({ required, exists: !!byName });
  }
  return { states, blockers };
}

async function listIndexes(collection) {
  try {
    return await collection.listIndexes().toArray();
  } catch (error) {
    if (error?.code === 26 || error?.codeName === 'NamespaceNotFound') return [];
    throw error;
  }
}

async function preflight(userCollection, notificationCollection) {
  const [documents, indexes] = await Promise.all([
    userCollection.find({}, { projection: { _id: 1, 'preferences.notifications': 1 } }).toArray(),
    listIndexes(notificationCollection),
  ]);
  const users = documents.map((document) => {
    const value = notificationValue(document);
    return { id: document._id, analysis: analyzePreference(value.raw, value.present) };
  });
  return { users, indexes: analyzeIndexes(indexes) };
}

function reportFor(scan, apply) {
  const malformed = scan.users.filter(({ analysis }) => analysis.malformed).length;
  const canonical = scan.users.filter(({ analysis }) => analysis.canonical).length;
  const candidates = scan.users.length - malformed - canonical;
  const missingIndexes = scan.indexes.states.filter(({ exists }) => !exists).length;
  return {
    mode: apply ? 'apply' : 'dry-run',
    scanned: scan.users.length,
    canonical,
    candidates,
    malformed,
    blockers: malformed + scan.indexes.blockers.length,
    matched: 0,
    changed: 0,
    conflicts: 0,
    indexesCreated: 0,
    pending: candidates + missingIndexes,
    indexes: {
      exact: NOTIFICATION_REQUIRED_INDEXES.length - missingIndexes - scan.indexes.blockers.length,
      missing: missingIndexes,
      drifted: scan.indexes.blockers.length,
    },
  };
}

function setDocument(target) {
  return {
    $set: Object.fromEntries(
      LEAVES.map((key) => [`preferences.notifications.${key}`, target[key]])
    ),
  };
}

async function migrateCollections({ userCollection, notificationCollection, apply = false, logger = console }) {
  const initial = await preflight(userCollection, notificationCollection);
  const report = reportFor(initial, apply);
  if (report.blockers > 0) {
    throw Object.assign(new Error(`Notification migration preflight failed with ${report.blockers} blocker(s).`), { report });
  }
  if (!apply) {
    logger.log(`[notifications-v1] ${JSON.stringify(report)}`);
    return report;
  }

  for (const { id, analysis } of initial.users) {
    if (analysis.canonical) continue;
    const result = await userCollection.updateOne(observedPredicate(id, analysis), setDocument(analysis.target));
    report.matched += result.matchedCount ?? 0;
    report.changed += result.modifiedCount ?? 0;
    if ((result.matchedCount ?? 0) === 0) {
      const current = await userCollection.findOne(
        { _id: id },
        { projection: { _id: 1, 'preferences.notifications': 1 } }
      );
      const value = notificationValue(current);
      const reread = analyzePreference(value.raw, value.present);
      if (reread.malformed || !reread.canonical) {
        report.conflicts += 1;
        throw Object.assign(new Error('Notification preference changed during migration.'), { report });
      }
    }
  }

  const afterPreferences = await preflight(userCollection, notificationCollection);
  if (afterPreferences.users.some(({ analysis }) => analysis.malformed || !analysis.canonical)) {
    throw Object.assign(new Error('Notification preference postcondition failed.'), { report });
  }
  if (afterPreferences.indexes.blockers.length > 0) {
    throw Object.assign(new Error('Notification index state changed during migration.'), { report });
  }

  for (const { required, exists } of afterPreferences.indexes.states) {
    if (exists) continue;
    await notificationCollection.createIndex(Object.fromEntries(required.key), {
      name: required.name,
      ...(required.unique ? { unique: true } : {}),
      ...(required.expireAfterSeconds !== null
        ? { expireAfterSeconds: required.expireAfterSeconds }
        : {}),
    });
    report.indexesCreated += 1;
  }

  const finalState = await preflight(userCollection, notificationCollection);
  if (
    finalState.users.some(({ analysis }) => analysis.malformed || !analysis.canonical)
    || finalState.indexes.blockers.length > 0
    || finalState.indexes.states.some(({ exists }) => !exists)
  ) {
    throw Object.assign(new Error('Notification migration final postcondition failed.'), { report });
  }
  report.pending = 0;
  report.indexes = { exact: NOTIFICATION_REQUIRED_INDEXES.length, missing: 0, drifted: 0 };
  logger.log(`[notifications-v1] ${JSON.stringify(report)}`);
  return report;
}

function parseApplyFlag(argv) {
  if (argv.length === 0) return false;
  if (argv.length === 1 && argv[0] === '--apply') return true;
  throw new Error('Usage: npm run migrate:notifications-v1 -- [--apply]');
}

function databaseName(uri) {
  const match = uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/i);
  return match ? decodeURIComponent(match[1]) : '';
}

function assertApplyTarget(env) {
  const name = databaseName(env.mongodbUri);
  const sharedIdentity = /(?:^|[-_])(?:prod|production|dev|development)(?:[-_]|$)/i;
  const isolatedNotif1Test = /^wecooked[-_]notif1[-_](?:test|isolated)(?:[-_][a-z0-9]+)*$/i;
  if (
    env.nodeEnv === 'production'
    || !name
    || sharedIdentity.test(name)
    || !isolatedNotif1Test.test(name)
  ) {
    throw new Error('Refusing notification migration apply without an isolated non-production database binding.');
  }
}

async function runMigrationCommand({
  argv = process.argv.slice(2),
  loadEnvironment = loadEnv,
  connect = connectDatabase,
  disconnect = disconnectDatabase,
  getCollections = () => ({
    userCollection: User.collection,
    notificationCollection: Notification.collection,
  }),
  logger = console,
} = {}) {
  const apply = parseApplyFlag(argv);
  const env = loadEnvironment();
  if (apply) assertApplyTarget(env);
  let connected = false;
  try {
    await connect(env.mongodbUri, env.nodeEnv);
    connected = true;
    return await migrateCollections({ ...getCollections(), apply, logger });
  } finally {
    if (connected) await disconnect();
  }
}

if (require.main === module) {
  runMigrationCommand().catch((error) => {
    console.error(`[notifications-v1] failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  LEAVES,
  DEFAULTS,
  analyzePreference,
  observedPredicate,
  sameKey,
  exactIndex,
  analyzeIndexes,
  preflight,
  migrateCollections,
  parseApplyFlag,
  databaseName,
  assertApplyTarget,
  runMigrationCommand,
};
