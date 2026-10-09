const crypto = require('crypto');
const repository = require('./push-installation.repository');
const sessionService = require('../sessions/session.service');
const userRepository = require('../users/user.repository');
const { toPublicInstallation } = require('./push-installation.serializer');
const { AppError } = require('../../shared/errors/app-error');

const MAX_DELIVERY_TARGETS = 500;

function hashCredential(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function sameDigest(left, right) {
  const a = Buffer.from(left || '', 'hex');
  const b = Buffer.from(right || '', 'hex');
  return a.length === 32 && b.length === 32 && crypto.timingSafeEqual(a, b);
}

function error(code, message = 'Push installation request could not be completed.') {
  const statusCode = code === 'PUSH_INSTALLATION_NOT_FOUND' ? 404 : 409;
  return new AppError(message, { statusCode, code });
}

function duplicateKeyCode(err) {
  if (err?.code !== 11000) return null;
  return Object.hasOwn(err.keyPattern || {}, 'expoPushToken')
    ? 'PUSH_INSTALLATION_TOKEN_CONFLICT'
    : 'PUSH_INSTALLATION_GENERATION_CONFLICT';
}

function samePayload(row, { recipientId, sessionId, platform, expoPushToken }) {
  return String(row.recipientId) === String(recipientId)
    && String(row.sessionId) === String(sessionId)
    && row.platform === platform
    && row.expoPushToken === expoPushToken
    && row.status === 'active'
    && row.unregisteredAt == null;
}

async function register({ installationId, recipientId, sessionId, platform, expoPushToken, bindingCredential, bindingGeneration }) {
  const credentialHash = hashCredential(bindingCredential);
  let existing = await repository.findByInstallationIdWithSecrets(installationId);
  if (!existing) {
    try {
      const created = await repository.createInstallation({
        installationId, bindingCredentialHash: credentialHash, recipientId, sessionId,
        provider: 'expo', platform, expoPushToken, bindingGeneration, status: 'active', unregisteredAt: null,
      });
      return toPublicInstallation(created);
    } catch (err) {
      const code = duplicateKeyCode(err);
      if (code === 'PUSH_INSTALLATION_TOKEN_CONFLICT') throw error(code);
      if (!code) throw err;
      // A concurrent creator may have won on installationId. Re-read and
      // apply the same credential/generation/idempotence rules below rather
      // than turning an exact retry into a false conflict.
      existing = await repository.findByInstallationIdWithSecrets(installationId);
      if (!existing) throw error('PUSH_INSTALLATION_GENERATION_CONFLICT');
    }
  }

  if (!sameDigest(existing.bindingCredentialHash, credentialHash)) throw error('PUSH_INSTALLATION_NOT_FOUND');
  if (bindingGeneration < existing.bindingGeneration) throw error('PUSH_INSTALLATION_STALE');
  if (bindingGeneration === existing.bindingGeneration) {
    if (samePayload(existing, { recipientId, sessionId, platform, expoPushToken })) {
      return toPublicInstallation(existing);
    }
    throw error('PUSH_INSTALLATION_GENERATION_CONFLICT');
  }

  try {
    const updated = await repository.updateAuthorized({
      installationId,
      credentialHash,
      expectedGeneration: existing.bindingGeneration,
      values: {
        recipientId, sessionId, platform, expoPushToken, bindingGeneration,
        status: 'active', unregisteredAt: null,
      },
    });
    if (!updated) throw error('PUSH_INSTALLATION_GENERATION_CONFLICT');
    return toPublicInstallation(updated);
  } catch (err) {
    const code = duplicateKeyCode(err);
    if (code) throw error(code);
    throw err;
  }
}

async function unregister({ installationId, recipientId, sessionId, bindingCredential, bindingGeneration }) {
  const credentialHash = hashCredential(bindingCredential);
  const existing = await repository.findByInstallationIdWithSecrets(installationId);
  const owned = existing
    && String(existing.recipientId) === String(recipientId)
    && String(existing.sessionId) === String(sessionId)
    && sameDigest(existing.bindingCredentialHash, credentialHash);
  if (!owned) throw error('PUSH_INSTALLATION_NOT_FOUND');
  if (bindingGeneration < existing.bindingGeneration) throw error('PUSH_INSTALLATION_STALE');
  if (bindingGeneration === existing.bindingGeneration) {
    if (existing.status === 'unregistered') return { unregistered: true, bindingGeneration };
    throw error('PUSH_INSTALLATION_GENERATION_CONFLICT');
  }
  const updated = await repository.unregisterAuthorized({
    installationId, recipientId, sessionId, credentialHash,
    expectedGeneration: existing.bindingGeneration, generation: bindingGeneration, now: new Date(),
  });
  if (!updated) throw error('PUSH_INSTALLATION_GENERATION_CONFLICT');
  return { unregistered: true, bindingGeneration: updated.bindingGeneration };
}

async function selectDeliveryTargets(notification) {
  const recipientId = String(notification.recipientId);
  const user = await userRepository.findById(recipientId);
  if (
    !user
    || user.status !== 'active'
    || user.deactivatedAt
    || user.preferences?.notifications?.push !== true
  ) return [];
  const securityGeneration = Number.isInteger(user.sessionGeneration) && user.sessionGeneration >= 0
    ? user.sessionGeneration
    : 0;
  const rows = await repository.findActiveForRecipient(recipientId, MAX_DELIVERY_TARGETS);
  const activeSessions = await sessionService.getActiveSessionsByIdsForUser(
    [...new Set(rows.map((row) => String(row.sessionId)))],
    recipientId,
    securityGeneration
  );
  const eligibleSessionIds = new Set(activeSessions.map((session) => String(session._id)));
  const seen = new Set();
  const targets = [];
  for (const row of rows) {
    if (!eligibleSessionIds.has(String(row.sessionId)) || !row.expoPushToken || seen.has(row.expoPushToken)) continue;
    seen.add(row.expoPushToken);
    targets.push({ token: row.expoPushToken, platform: row.platform });
  }
  return targets;
}

async function unregisterExactToken(token) {
  await repository.unregisterExactToken(token, new Date());
}

module.exports = { MAX_DELIVERY_TARGETS, hashCredential, sameDigest, register, unregister, selectDeliveryTargets, unregisterExactToken };
