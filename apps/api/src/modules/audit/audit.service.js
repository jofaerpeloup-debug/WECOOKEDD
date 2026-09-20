const mongoose = require('mongoose');
const auditLogRepository = require('./audit-log.repository');
const { ROLES, STATUSES } = require('../users/user.model');

const EVENT_DEFINITIONS = Object.freeze({
  'admin.user.status_changed': Object.freeze({
    targetType: 'user',
    metadataKeys: Object.freeze(['fromStatus', 'toStatus']),
    outcomes: Object.freeze(['success', 'partial_failure']),
  }),
  'admin.staff.moderator_approved': Object.freeze({
    targetType: 'user',
    metadataKeys: Object.freeze(['applicationId', 'fromRole', 'toRole']),
    outcomes: Object.freeze(['success']),
  }),
  'admin.staff.application_rejected': Object.freeze({
    targetType: 'moderator_application',
    metadataKeys: Object.freeze(['applicationId']),
    outcomes: Object.freeze(['success']),
  }),
  'admin.staff.moderator_demoted': Object.freeze({
    targetType: 'user',
    metadataKeys: Object.freeze(['fromRole', 'toRole']),
    outcomes: Object.freeze(['success']),
  }),
});

const INPUT_KEYS = Object.freeze([
  'eventType',
  'actorUserId',
  'actorRole',
  'targetType',
  'targetId',
  'outcome',
  'reasonCode',
  'metadata',
]);

function hasExactKeys(value, allowedKeys, requiredKeys = allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value);
  return (
    actualKeys.every((key) => allowedKeys.includes(key)) &&
    requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function hasValidMetadataValues(eventType, metadata, targetId, outcome) {
  switch (eventType) {
    case 'admin.user.status_changed':
      return (
        STATUSES.includes(metadata.fromStatus) &&
        STATUSES.includes(metadata.toStatus) &&
        metadata.fromStatus !== metadata.toStatus &&
        (outcome !== 'partial_failure' ||
          (metadata.fromStatus === 'active' && metadata.toStatus === 'suspended'))
      );
    case 'admin.staff.moderator_approved':
      return (
        mongoose.Types.ObjectId.isValid(metadata.applicationId) &&
        metadata.fromRole === 'user' &&
        metadata.toRole === 'moderator'
      );
    case 'admin.staff.application_rejected':
      return (
        mongoose.Types.ObjectId.isValid(metadata.applicationId) &&
        String(metadata.applicationId) === String(targetId)
      );
    case 'admin.staff.moderator_demoted':
      return metadata.fromRole === 'moderator' && metadata.toRole === 'user';
    default:
      return false;
  }
}

function buildEvent(input) {
  const requiredInputKeys = INPUT_KEYS.filter((key) => key !== 'reasonCode');
  if (!hasExactKeys(input, INPUT_KEYS, requiredInputKeys)) {
    throw new TypeError('Invalid audit event contract.');
  }

  const definition = EVENT_DEFINITIONS[input.eventType];
  if (!definition) throw new TypeError('Unsupported audit event type.');
  if (!mongoose.Types.ObjectId.isValid(input.actorUserId)) {
    throw new TypeError('Invalid audit actor.');
  }
  if (!ROLES.includes(input.actorRole)) throw new TypeError('Invalid audit actor role.');
  if (!mongoose.Types.ObjectId.isValid(input.targetId)) {
    throw new TypeError('Invalid audit target.');
  }
  if (input.targetType !== definition.targetType) {
    throw new TypeError('Invalid audit target type.');
  }
  if (!definition.outcomes.includes(input.outcome)) {
    throw new TypeError('Invalid audit outcome.');
  }
  if (!hasExactKeys(input.metadata, definition.metadataKeys)) {
    throw new TypeError('Invalid audit metadata.');
  }
  if (!hasValidMetadataValues(input.eventType, input.metadata, input.targetId, input.outcome)) {
    throw new TypeError('Invalid audit metadata values.');
  }

  const partialFailure = input.outcome === 'partial_failure';
  if (partialFailure !== (input.reasonCode === 'SESSION_REVOCATION_FAILED')) {
    throw new TypeError('Invalid audit reason code.');
  }

  const event = {
    eventType: input.eventType,
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    targetType: input.targetType,
    targetId: input.targetId,
    outcome: input.outcome,
    metadata: {},
  };
  if (input.reasonCode !== undefined) event.reasonCode = input.reasonCode;
  for (const key of definition.metadataKeys) {
    event.metadata[key] = input.metadata[key];
  }
  return event;
}

// Audit writes are best-effort relative to their completed business mutation.
// Contract and persistence failures are both contained here; the diagnostic is
// deliberately fixed text and never includes the event payload or caught error.
async function record(input) {
  try {
    return await auditLogRepository.create(buildEvent(input));
  } catch {
    console.error('[audit] audit event was not recorded');
    return null;
  }
}

async function list({
  eventType,
  actorUserId,
  targetType,
  targetId,
  outcome,
  from,
  to,
  page,
  limit,
}) {
  const filter = {};
  if (eventType) filter.eventType = eventType;
  if (actorUserId) filter.actorUserId = actorUserId;
  if (targetType) filter.targetType = targetType;
  if (targetId) filter.targetId = targetId;
  if (outcome) filter.outcome = outcome;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lte = to;
  }

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    auditLogRepository.findMany({ filter, skip, limit }),
    auditLogRepository.countByFilter(filter),
  ]);

  return { items, total, page, limit };
}

module.exports = { record, list };
