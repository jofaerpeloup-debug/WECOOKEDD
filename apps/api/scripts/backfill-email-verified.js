const { loadEnv } = require('../src/config/env');
const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const User = require('../src/modules/users/user.model');

/**
 * One-time, idempotent backfill for the pre-existing-user email-verification
 * migration policy: grandfather every password-bearing account created before
 * an operator-supplied cutoff as already verified.
 *
 * Deliberately narrow, matching the User schema's own eligibility predicates
 * (see setPasswordResetTokenForEligibleUser / setEmailVerificationTokenForUser
 * in user.repository.js): only documents with
 *   - createdAt strictly before the cutoff (post-cutoff registrations are
 *     NEVER touched, regardless of how long this script exists or how many
 *     times it is rerun)
 *   - a usable passwordHash (provider-only/Google-only accounts are excluded —
 *     they already carry their own, provider-verified emailVerified state and
 *     must not be touched by this script)
 *   - emailVerified not already true (a rerun changes nothing further —
 *     idempotent by construction)
 * are matched. The eligibility filter is expressed entirely as a MongoDB query
 * — passwordHash is never read into process memory or logged, only tested for
 * existence/type/non-emptiness inside the query itself.
 *
 * Safety:
 *   - dry-run by default; only --apply performs a write
 *   - requires an explicit --cutoff=<ISO-8601> from the operator (no default
 *     cutoff is ever assumed)
 *   - reports the eligible/modified count; never logs a document, an email, or
 *     a password hash
 */

function eligibleFilter(cutoff) {
  return {
    createdAt: { $lt: cutoff },
    passwordHash: { $exists: true, $type: 'string', $ne: '' },
    emailVerified: { $ne: true },
  };
}

function parseArgs(argv) {
  let cutoffRaw;
  let apply = false;

  for (const arg of argv) {
    if (arg === '--apply') {
      apply = true;
    } else if (arg.startsWith('--cutoff=')) {
      cutoffRaw = arg.slice('--cutoff='.length);
    } else {
      throw new Error(
        'Usage: node scripts/backfill-email-verified.js --cutoff=<ISO-8601> [--apply]'
      );
    }
  }

  if (!cutoffRaw) {
    throw new Error(
      'Usage: node scripts/backfill-email-verified.js --cutoff=<ISO-8601> [--apply]\n' +
        '  --cutoff is required: an explicit ISO-8601 timestamp, e.g. --cutoff=2026-09-13T00:00:00.000Z'
    );
  }

  const cutoff = new Date(cutoffRaw);
  if (Number.isNaN(cutoff.getTime())) {
    throw new Error(`Invalid --cutoff value: "${cutoffRaw}" is not a parseable date.`);
  }

  return { cutoff, apply };
}

function logReport(logger, { apply, cutoff, eligible, modified }) {
  logger.log(`[backfill-email-verified] mode=${apply ? 'apply' : 'dry-run'}`);
  logger.log(`[backfill-email-verified] cutoff=${cutoff.toISOString()}`);
  logger.log(`[backfill-email-verified] eligible=${eligible}`);
  if (apply) {
    logger.log(`[backfill-email-verified] modified=${modified}`);
  }
}

/**
 * Pure-ish core: takes a Mongo-collection-shaped object so tests can drive it
 * without a real database, mirroring migrateCollection in
 * migrate-auth-identities.js.
 */
async function runBackfill({ collection, cutoff, apply = false, logger = console }) {
  const filter = eligibleFilter(cutoff);
  const eligible = await collection.countDocuments(filter);

  if (!apply) {
    logReport(logger, { apply, cutoff, eligible });
    return { applied: false, eligible };
  }

  const result = await collection.updateMany(filter, { $set: { emailVerified: true } });
  const modified = result.modifiedCount ?? 0;
  logReport(logger, { apply, cutoff, eligible, modified });
  return { applied: true, eligible, modified };
}

async function runBackfillCommand({
  argv = process.argv.slice(2),
  loadEnvironment = loadEnv,
  connect = connectDatabase,
  disconnect = disconnectDatabase,
  getCollection = () => User.collection,
  logger = console,
} = {}) {
  const { cutoff, apply } = parseArgs(argv);
  const env = loadEnvironment();
  let connected = false;
  try {
    await connect(env.mongodbUri);
    connected = true;
    return await runBackfill({ collection: getCollection(), cutoff, apply, logger });
  } finally {
    if (connected) {
      await disconnect();
    }
  }
}

if (require.main === module) {
  runBackfillCommand().catch((error) => {
    console.error(`[backfill-email-verified] failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  eligibleFilter,
  parseArgs,
  runBackfill,
  runBackfillCommand,
};
