import { api } from './apiClient.js';

export const AUDIT_EVENT_TYPES = Object.freeze([
  'admin.user.status_changed',
  'admin.staff.moderator_approved',
  'admin.staff.application_rejected',
  'admin.staff.moderator_demoted',
]);

export const AUDIT_TARGET_TYPES = Object.freeze(['user', 'moderator_application']);
export const AUDIT_OUTCOMES = Object.freeze(['success', 'partial_failure']);
export const AUDIT_ACTOR_ROLES = Object.freeze(['user', 'moderator', 'admin']);

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RECORD_KEYS = Object.freeze([
  'actorRole',
  'actorUserId',
  'createdAt',
  'eventType',
  'id',
  'metadata',
  'outcome',
  'reasonCode',
  'targetId',
  'targetType',
]);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  const actualKeys = Object.keys(value).sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index]);
}

function isObjectId(value) {
  return typeof value === 'string' && OBJECT_ID_PATTERN.test(value);
}

function isSerializedTimestamp(value) {
  if (typeof value !== 'string' || !ISO_TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isStringOrNull(value) {
  return typeof value === 'string' || value === null;
}

function validMetadata(eventType, metadata) {
  switch (eventType) {
    case 'admin.user.status_changed':
      return hasExactKeys(metadata, ['fromStatus', 'toStatus'])
        && isStringOrNull(metadata.fromStatus)
        && isStringOrNull(metadata.toStatus);
    case 'admin.staff.moderator_approved':
      return hasExactKeys(metadata, ['applicationId', 'fromRole', 'toRole'])
        && isStringOrNull(metadata.applicationId)
        && isStringOrNull(metadata.fromRole)
        && isStringOrNull(metadata.toRole);
    case 'admin.staff.application_rejected':
      return hasExactKeys(metadata, ['applicationId'])
        && isStringOrNull(metadata.applicationId);
    case 'admin.staff.moderator_demoted':
      return hasExactKeys(metadata, ['fromRole', 'toRole'])
        && isStringOrNull(metadata.fromRole)
        && isStringOrNull(metadata.toRole);
    default:
      return false;
  }
}

function validAuditRecord(record) {
  if (!hasExactKeys(record, RECORD_KEYS)) return false;
  if (!isObjectId(record.id) || !isSerializedTimestamp(record.createdAt)) return false;
  if (!AUDIT_EVENT_TYPES.includes(record.eventType)) return false;
  if (!isObjectId(record.actorUserId) || !AUDIT_ACTOR_ROLES.includes(record.actorRole)) return false;
  if (!AUDIT_TARGET_TYPES.includes(record.targetType) || !isObjectId(record.targetId)) return false;
  if (!AUDIT_OUTCOMES.includes(record.outcome)) return false;
  if (record.reasonCode !== null && record.reasonCode !== 'SESSION_REVOCATION_FAILED') return false;
  if ((record.outcome === 'partial_failure') !== (record.reasonCode === 'SESSION_REVOCATION_FAILED')) {
    return false;
  }
  return validMetadata(record.eventType, record.metadata);
}

function validPagination(pagination, auditLogs) {
  if (!hasExactKeys(pagination, ['limit', 'page', 'total', 'totalPages'])) return false;
  if (!Number.isSafeInteger(pagination.page) || pagination.page < 1) return false;
  if (!Number.isSafeInteger(pagination.limit) || pagination.limit < 1 || pagination.limit > 100) {
    return false;
  }
  if (!Number.isSafeInteger(pagination.total) || pagination.total < 0) return false;
  if (!Number.isSafeInteger(pagination.totalPages) || pagination.totalPages < 0) return false;
  if (pagination.totalPages !== Math.ceil(pagination.total / pagination.limit)) return false;
  return auditLogs.length <= pagination.limit && auditLogs.length <= pagination.total;
}

export function validateAuditLogResponse(data) {
  if (!hasExactKeys(data, ['auditLogs', 'pagination'])) {
    throw new Error('Invalid audit log response.');
  }
  if (!Array.isArray(data.auditLogs)) {
    throw new Error('Invalid audit log response.');
  }
  if (!data.auditLogs.every(validAuditRecord) || !validPagination(data.pagination, data.auditLogs)) {
    throw new Error('Invalid audit log response.');
  }
  return data;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

export function buildAuditLogQuery(params = {}) {
  const {
    eventType,
    actorUserId,
    targetType,
    targetId,
    outcome,
    from,
    to,
    page,
    limit,
  } = params;

  return {
    eventType: eventType || undefined,
    actorUserId: actorUserId || undefined,
    targetType: targetType || undefined,
    targetId: targetId || undefined,
    outcome: outcome || undefined,
    from: from || undefined,
    to: to || undefined,
    page: positiveInteger(page),
    limit: positiveInteger(limit),
  };
}

/**
 * GET /api/v1/admin/audit-logs
 *
 * The shared API client owns authentication, refresh, base-URL configuration,
 * and error normalization. This feature never fetches audit data directly.
 */
export function listAuditLogs(params = {}, request = api.get) {
  return request('/admin/audit-logs', { query: buildAuditLogQuery(params) })
    .then(validateAuditLogResponse);
}
