const mongoose = require('mongoose');
const Session = require('./session.model');

function createSession({ userId, refreshTokenHash, expiresAt, securityGeneration }) {
  const sessionId = new mongoose.Types.ObjectId();
  return Session.findOneAndUpdate(
    { _id: sessionId },
    {
      $setOnInsert: { userId, refreshTokenHash, expiresAt, securityGeneration },
      $currentDate: { securityIssuedAt: true },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
}

function findActiveById(id) {
  return Session.findOne({ _id: id, revokedAt: null, expiresAt: { $gt: new Date() } });
}

function findActiveByIdsForUser(ids, userId, securityGeneration, now) {
  const generationFilter = [{ securityGeneration }];
  if (securityGeneration === 0) generationFilter.push({ securityGeneration: { $exists: false } });
  return Session.find({
    _id: { $in: ids },
    userId,
    revokedAt: null,
    expiresAt: { $gt: now },
    $or: generationFilter,
  }).select('_id userId');
}

// Non-mutating lookup by refresh-token hash, used to check the owning user
// before committing to a rotation — deliberately separate from rotateByHash
// so a pre-flight check never has a side effect.
function findActiveByHash(hash) {
  return Session.findOne({ refreshTokenHash: hash, revokedAt: null, expiresAt: { $gt: new Date() } });
}

/**
 * Atomically replaces the current refresh-token digest with a new one, but
 * only if the current digest still matches an active, unexpired session.
 * MongoDB's findOneAndUpdate is atomic per-document, so of two concurrent
 * requests presenting the same token, only the first can match — the
 * second finds nothing (the hash has already changed) and returns null.
 */
function rotateByHash({ currentHash, newHash, now }) {
  return Session.findOneAndUpdate(
    { refreshTokenHash: currentHash, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { refreshTokenHash: newHash, lastUsedAt: now } },
    { returnDocument: 'after' }
  );
}

function revokeById(id, now) {
  return Session.findOneAndUpdate(
    { _id: id, revokedAt: null },
    { $set: { revokedAt: now } },
    { returnDocument: 'after' }
  );
}

async function revokeAllForUserBeforeGeneration(userId, securityGeneration, now) {
  const result = await Session.updateMany(
    {
      userId,
      revokedAt: null,
      expiresAt: { $gt: now },
      $or: [
        { securityGeneration: { $lt: securityGeneration } },
        { securityGeneration: { $exists: false } },
      ],
    },
    { $set: { revokedAt: now } }
  );
  return result.modifiedCount;
}

module.exports = {
  createSession,
  findActiveById,
  findActiveByIdsForUser,
  findActiveByHash,
  rotateByHash,
  revokeById,
  revokeAllForUserBeforeGeneration,
};
