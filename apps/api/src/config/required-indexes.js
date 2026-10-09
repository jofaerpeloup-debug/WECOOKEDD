const User = require('../modules/users/user.model');
const ModeratorApplication = require('../modules/moderator-applications/moderator-application.model');
const Notification = require('../modules/notifications/notification.model');
const PushInstallation = require('../modules/push-installations/push-installation.model');

/**
 * Read-only startup verification of the security-relevant database indexes the
 * API refuses to run without.
 *
 * Scope of the guarantee, stated precisely: THIS MODULE never creates, drops,
 * repairs, or rebuilds the required auth-identity index. It only reads the live
 * index catalogue and refuses to start when the shape the application's
 * cross-document uniqueness guarantee depends on is missing or has drifted.
 * `scripts/migrate-auth-identities.js` remains the sole creator of
 * `uniq_auth_identity_provider_subject`, and the User schema deliberately does
 * not declare it (locked by the "the User schema does not declare the
 * migration-owned auth identity index" test in test/user-model.test.js), so
 * Mongoose's index synchronisation never builds it either. Operators create it
 * by running the migration.
 *
 * This is NOT a claim that application startup performs no index creation at
 * all: Mongoose's default autoIndex behaviour still manages the other,
 * schema-declared indexes (email, password-reset digest, the challenge TTL
 * index). Ownership of those is out of scope here and unchanged.
 *
 * The check is deliberately exact rather than by-name: an index called
 * `uniq_auth_identity_provider_subject` that is non-unique, keyed in the wrong
 * order, or carrying a different partial filter enforces something other than
 * "one provider+subject pair belongs to at most one User", and a name match
 * alone would silently accept it.
 */
const REQUIRED_INDEXES = Object.freeze([
  Object.freeze({
    name: 'uniq_auth_identity_provider_subject',
    // Ordered key specification. Order is part of the index's identity, so it
    // is expressed as pairs rather than an object literal and compared
    // positionally below.
    key: Object.freeze([
      Object.freeze(['authIdentities.provider', 1]),
      Object.freeze(['authIdentities.subject', 1]),
    ]),
    unique: true,
    partialFilterExpression: Object.freeze({
      'authIdentities.provider': { $exists: true },
      'authIdentities.subject': { $exists: true },
    }),
  }),
]);

const MODERATOR_APPLICATION_REQUIRED_INDEXES = Object.freeze([
  Object.freeze({
    name: 'uniq_pending_moderator_application_per_user',
    key: Object.freeze([Object.freeze(['userId', 1])]),
    unique: true,
    partialFilterExpression: Object.freeze({ status: 'pending' }),
  }),
  Object.freeze({
    name: 'moderator_application_queue',
    key: Object.freeze([
      Object.freeze(['status', 1]),
      Object.freeze(['createdAt', -1]),
      Object.freeze(['_id', -1]),
    ]),
    unique: false,
    partialFilterExpression: null,
  }),
]);

const NOTIFICATION_REQUIRED_INDEXES = Object.freeze([
  Object.freeze({
    name: 'notification_inbox_page',
    key: Object.freeze([
      Object.freeze(['recipientId', 1]),
      Object.freeze(['archivedAt', 1]),
      Object.freeze(['createdAt', -1]),
      Object.freeze(['_id', -1]),
    ]),
    unique: false,
    partialFilterExpression: null,
    expireAfterSeconds: null,
  }),
  Object.freeze({
    name: 'notification_unread_count',
    key: Object.freeze([
      Object.freeze(['recipientId', 1]),
      Object.freeze(['archivedAt', 1]),
      Object.freeze(['readAt', 1]),
    ]),
    unique: false,
    partialFilterExpression: null,
    expireAfterSeconds: null,
  }),
  Object.freeze({
    name: 'uniq_notification_recipient_event',
    key: Object.freeze([
      Object.freeze(['recipientId', 1]),
      Object.freeze(['eventKey', 1]),
    ]),
    unique: true,
    partialFilterExpression: null,
    expireAfterSeconds: null,
  }),
  Object.freeze({
    name: 'notification_expiry_ttl',
    key: Object.freeze([Object.freeze(['expiresAt', 1])]),
    unique: false,
    partialFilterExpression: null,
    expireAfterSeconds: 0,
  }),
]);

const PUSH_INSTALLATION_REQUIRED_INDEXES = Object.freeze([
  Object.freeze({
    name: 'uniq_push_installation_id',
    key: Object.freeze([Object.freeze(['installationId', 1])]),
    unique: true,
    partialFilterExpression: null,
    expireAfterSeconds: null,
  }),
  Object.freeze({
    name: 'uniq_active_expo_push_token',
    key: Object.freeze([Object.freeze(['provider', 1]), Object.freeze(['expoPushToken', 1])]),
    unique: true,
    partialFilterExpression: Object.freeze({ status: 'active', expoPushToken: { $type: 'string' } }),
    expireAfterSeconds: null,
  }),
  Object.freeze({
    name: 'push_installation_recipient_delivery',
    key: Object.freeze([
      Object.freeze(['recipientId', 1]),
      Object.freeze(['status', 1]),
      Object.freeze(['sessionId', 1]),
    ]),
    unique: false,
    partialFilterExpression: null,
    expireAfterSeconds: null,
  }),
]);

// Key order is meaningful for an index key specification but NOT for the
// partial filter expression, so filters are compared through a recursively
// key-sorted canonical form.
function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = canonicalize(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function sameFilter(actual, expected) {
  return JSON.stringify(canonicalize(actual)) === JSON.stringify(canonicalize(expected));
}

function describeKey(key) {
  return `{ ${key.map(([field, direction]) => `${field}: ${direction}`).join(', ')} }`;
}

function indexVerificationError(collectionName, name, reason) {
  if (collectionName === ModeratorApplication.collection.collectionName) {
    return new Error(
      `Required index "${name}" on collection "${collectionName}" ${reason}. ` +
        'Provision the schema-declared ModeratorApplication indexes before restarting. ' +
        'This verifier never creates, repairs, or drops indexes.'
    );
  }
  if (collectionName === Notification.collection.collectionName) {
    return new Error(
      `Required index "${name}" on collection "${collectionName}" ${reason}. ` +
        'Run "npm run migrate:notifications-v1" and then the explicit --apply form ' +
        'against an approved non-production database. This verifier never creates, repairs, or drops indexes.'
    );
  }
  if (collectionName === PushInstallation.collection.collectionName) {
    return new Error(
      `Required index "${name}" on collection "${collectionName}" ${reason}. ` +
        'Run "npm run migrate:notifications-v2" and then the explicit --apply form ' +
        'against an approved isolated non-production database. This verifier never creates, repairs, or drops indexes.'
    );
  }
  return new Error(
    `Required index "${name}" on collection "${collectionName}" ${reason}. ` +
      'Run "npm run migrate:auth-identities" (dry run) and then ' +
      '"npm run migrate:auth-identities -- --apply" from apps/api. ' +
      'This check never creates or repairs the auth-identity index — the ' +
      'migration is its only creator.'
  );
}

// `key` comes back from MongoDB as a document, so its property order is the
// index's declared key order.
function assertKeyOrder(collectionName, required, actual) {
  const actualEntries = Object.entries(actual.key || {});
  const matches =
    actualEntries.length === required.key.length &&
    required.key.every(
      ([field, direction], position) =>
        actualEntries[position][0] === field && actualEntries[position][1] === direction
    );

  if (!matches) {
    throw indexVerificationError(
      collectionName,
      required.name,
      `must be keyed exactly ${describeKey(required.key)} in that order, found ` +
        `${describeKey(actualEntries)}`
    );
  }
}

function assertIndex(collectionName, required, existing) {
  const actual = existing.find((index) => index.name === required.name);
  if (!actual) {
    throw indexVerificationError(collectionName, required.name, 'is missing');
  }

  assertKeyOrder(collectionName, required, actual);

  if ((actual.unique === true) !== required.unique) {
    throw indexVerificationError(
      collectionName,
      required.name,
      `must be unique: ${required.unique}, found unique: ${actual.unique === true}`
    );
  }

  const actualFilter = actual.partialFilterExpression ?? null;
  if (!sameFilter(actualFilter, required.partialFilterExpression)) {
    throw indexVerificationError(
      collectionName,
      required.name,
      `must carry the partial filter ${JSON.stringify(required.partialFilterExpression)}, found ` +
        `${JSON.stringify(actualFilter)}`
    );
  }

  const actualExpiry = actual.expireAfterSeconds ?? null;
  const requiredExpiry = required.expireAfterSeconds ?? null;
  if (actualExpiry !== requiredExpiry) {
    throw indexVerificationError(
      collectionName,
      required.name,
      `must carry expireAfterSeconds: ${requiredExpiry}, found: ${actualExpiry}`
    );
  }

  if (actual.sparse === true) {
    throw indexVerificationError(collectionName, required.name, 'must not be sparse');
  }
}

/**
 * Reads the live index catalogue and throws on the first missing or malformed
 * required index. Uses listIndexes only — no write ever reaches MongoDB from
 * here. `collection` is injectable so tests can drive it without a database.
 */
async function verifyCollectionIndexes(collection, requiredIndexes) {
  const collectionName = collection.collectionName;

  let existing;
  try {
    existing = await collection.listIndexes().toArray();
  } catch (error) {
    // A missing collection (NamespaceNotFound) means the index cannot exist
    // either, and a genuine read failure leaves us unable to prove the shape.
    // Both must stop startup rather than be assumed safe.
    throw new Error(
      `Could not read indexes on collection "${collectionName}": ${error.message}. ` +
        'Startup requires a verified auth identity index.'
    );
  }

  for (const required of requiredIndexes) {
    assertIndex(collectionName, required, existing);
  }

  return requiredIndexes.length;
}

async function verifyRequiredIndexes(options = {}) {
  const collection = options.collection ?? User.collection;
  const logger = options.logger ?? console;
  // Existing unit callers inject only the User collection. Preserve that
  // focused seam; production startup (no injected collection) verifies both.
  const moderatorApplicationCollection =
    options.moderatorApplicationCollection ??
    (Object.hasOwn(options, 'collection') ? null : ModeratorApplication.collection);
  const notificationCollection =
    options.notificationCollection ??
    (Object.hasOwn(options, 'collection') ? null : Notification.collection);
  const pushInstallationCollection =
    options.pushInstallationCollection ??
    (Object.hasOwn(options, 'collection') ? null : PushInstallation.collection);

  let verified = await verifyCollectionIndexes(collection, REQUIRED_INDEXES);
  if (moderatorApplicationCollection) {
    verified += await verifyCollectionIndexes(
      moderatorApplicationCollection,
      MODERATOR_APPLICATION_REQUIRED_INDEXES
    );
  }
  if (notificationCollection) {
    verified += await verifyCollectionIndexes(notificationCollection, NOTIFICATION_REQUIRED_INDEXES);
  }
  if (pushInstallationCollection) {
    verified += await verifyCollectionIndexes(
      pushInstallationCollection,
      PUSH_INSTALLATION_REQUIRED_INDEXES
    );
  }

  logger.log(
    moderatorApplicationCollection || notificationCollection || pushInstallationCollection
      ? `[database] verified ${verified} required index(es) across security-critical collections`
      : `[database] verified ${verified} required index(es) on "${collection.collectionName}"`
  );
}

module.exports = {
  REQUIRED_INDEXES,
  MODERATOR_APPLICATION_REQUIRED_INDEXES,
  NOTIFICATION_REQUIRED_INDEXES,
  PUSH_INSTALLATION_REQUIRED_INDEXES,
  verifyCollectionIndexes,
  verifyRequiredIndexes,
};
