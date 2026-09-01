const { loadEnv } = require('../src/config/env');
const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const User = require('../src/modules/users/user.model');

const SOCIAL_AUTH_PROVIDERS = new Set(['google', 'apple', 'facebook']);
const LEGACY_AUTH_PROVIDERS = new Set(['local', 'google']);
const MAX_SUBJECT_LENGTH = 255;

const AUTH_IDENTITY_INDEX_SPEC = Object.freeze({
  'authIdentities.provider': 1,
  'authIdentities.subject': 1,
});

const AUTH_IDENTITY_INDEX_OPTIONS = Object.freeze({
  name: 'uniq_auth_identity_provider_subject',
  unique: true,
  partialFilterExpression: {
    'authIdentities.provider': { $exists: true },
    'authIdentities.subject': { $exists: true },
  },
});

function hasUsablePasswordHash(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateAuthIdentities(value) {
  if (value == null) {
    return { valid: true, identities: [] };
  }
  if (!Array.isArray(value)) {
    return { valid: false, identities: [] };
  }

  const providers = new Set();
  const identities = [];
  for (const identity of value) {
    const provider = identity?.provider;
    const subject = identity?.subject;
    const linkedAt = identity?.linkedAt;
    if (
      !SOCIAL_AUTH_PROVIDERS.has(provider) ||
      typeof subject !== 'string' ||
      subject.trim().length === 0 ||
      subject.trim().length > MAX_SUBJECT_LENGTH ||
      providers.has(provider) ||
      !linkedAt ||
      Number.isNaN(new Date(linkedAt).getTime())
    ) {
      return { valid: false, identities: [] };
    }
    providers.add(provider);
    identities.push({ provider, subject: subject.trim() });
  }

  return { valid: true, identities };
}

function analyzeDocuments(documents) {
  const counts = {
    documents: documents.length,
    legacyFieldDocuments: 0,
    localLegacyDocuments: 0,
    socialLegacyWithoutSubject: 0,
    unknownLegacyProvider: 0,
    localWithoutPasswordHash: 0,
    invalidAuthIdentities: 0,
    duplicateIdentityOwnership: 0,
    noUsableAuthMethod: 0,
  };
  const identityOwners = new Map();

  for (const document of documents) {
    const identityResult = validateAuthIdentities(document.authIdentities);
    if (!identityResult.valid) {
      counts.invalidAuthIdentities += 1;
      continue;
    }

    for (const identity of identityResult.identities) {
      const key = `${identity.provider}\u0000${identity.subject}`;
      const owner = String(document._id);
      if (identityOwners.has(key) && identityOwners.get(key) !== owner) {
        counts.duplicateIdentityOwnership += 1;
      } else {
        identityOwners.set(key, owner);
      }
    }

    const hasPassword = hasUsablePasswordHash(document.passwordHash);
    const hasIdentities = identityResult.identities.length > 0;
    const hasLegacyField = Object.prototype.hasOwnProperty.call(document, 'authProviders');
    if (hasLegacyField) {
      counts.legacyFieldDocuments += 1;
      const providers = document.authProviders;
      if (!Array.isArray(providers)) {
        counts.unknownLegacyProvider += 1;
      } else {
        if (providers.length === 0 && hasPassword) {
          counts.localLegacyDocuments += 1;
        }

        const uniqueProviders = new Set(providers);
        if (
          uniqueProviders.size !== providers.length ||
          providers.some((provider) => !LEGACY_AUTH_PROVIDERS.has(provider))
        ) {
          counts.unknownLegacyProvider += 1;
        }

        if (providers.includes('local')) {
          counts.localLegacyDocuments += 1;
          if (!hasPassword) {
            counts.localWithoutPasswordHash += 1;
          }
        }

        for (const provider of providers.filter((entry) => entry !== 'local')) {
          if (!identityResult.identities.some((identity) => identity.provider === provider)) {
            counts.socialLegacyWithoutSubject += 1;
            break;
          }
        }
      }
    }

    if (!hasPassword && !hasIdentities) {
      counts.noUsableAuthMethod += 1;
    }
  }

  const blockerCount =
    counts.socialLegacyWithoutSubject +
    counts.unknownLegacyProvider +
    counts.localWithoutPasswordHash +
    counts.invalidAuthIdentities +
    counts.duplicateIdentityOwnership +
    counts.noUsableAuthMethod;

  return { counts, blockerCount };
}

function logReport(logger, report, apply) {
  logger.log(`[auth-identities] mode=${apply ? 'apply' : 'dry-run'}`);
  for (const [name, value] of Object.entries(report.counts)) {
    logger.log(`[auth-identities] ${name}=${value}`);
  }
}

async function migrateCollection({ collection, apply = false, logger = console }) {
  const documents = await collection
    .find(
      {},
      {
        projection: {
          _id: 1,
          authProviders: 1,
          authIdentities: 1,
          passwordHash: 1,
        },
      }
    )
    .toArray();
  const report = analyzeDocuments(documents);
  logReport(logger, report, apply);

  if (report.blockerCount > 0) {
    throw new Error(
      `Auth identity migration preflight failed with ${report.blockerCount} blocking finding(s).`
    );
  }

  if (!apply) {
    return { ...report, applied: false };
  }

  const unsetResult = await collection.updateMany(
    { authProviders: { $exists: true } },
    { $unset: { authProviders: '' } }
  );
  await collection.createIndex(AUTH_IDENTITY_INDEX_SPEC, AUTH_IDENTITY_INDEX_OPTIONS);

  return {
    ...report,
    applied: true,
    legacyFieldsRemoved: unsetResult.modifiedCount ?? 0,
  };
}

function parseApplyFlag(argv) {
  if (argv.length === 0) {
    return false;
  }
  if (argv.length === 1 && argv[0] === '--apply') {
    return true;
  }
  throw new Error('Usage: npm run migrate:auth-identities -- [--apply]');
}

async function runMigrationCommand({
  argv = process.argv.slice(2),
  loadEnvironment = loadEnv,
  connect = connectDatabase,
  disconnect = disconnectDatabase,
  getCollection = () => User.collection,
  logger = console,
} = {}) {
  const apply = parseApplyFlag(argv);
  const env = loadEnvironment();
  let connected = false;
  try {
    await connect(env.mongodbUri);
    connected = true;
    return await migrateCollection({ collection: getCollection(), apply, logger });
  } finally {
    if (connected) {
      await disconnect();
    }
  }
}

if (require.main === module) {
  runMigrationCommand().catch((error) => {
    console.error(`[auth-identities] failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  AUTH_IDENTITY_INDEX_SPEC,
  AUTH_IDENTITY_INDEX_OPTIONS,
  analyzeDocuments,
  migrateCollection,
  parseApplyFlag,
  runMigrationCommand,
};
