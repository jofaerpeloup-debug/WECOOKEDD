function stringOrNull(value) {
  return value == null ? null : String(value);
}

function metadataString(value) {
  return typeof value === 'string' ? value : null;
}

function serializeMetadata(eventType, metadata) {
  switch (eventType) {
    case 'admin.user.status_changed':
      return {
        fromStatus: metadataString(metadata?.fromStatus),
        toStatus: metadataString(metadata?.toStatus),
      };
    case 'admin.staff.moderator_approved':
      return {
        applicationId: stringOrNull(metadata?.applicationId),
        fromRole: metadataString(metadata?.fromRole),
        toRole: metadataString(metadata?.toRole),
      };
    case 'admin.staff.application_rejected':
      return { applicationId: stringOrNull(metadata?.applicationId) };
    case 'admin.staff.moderator_demoted':
      return {
        fromRole: metadataString(metadata?.fromRole),
        toRole: metadataString(metadata?.toRole),
      };
    default:
      return {};
  }
}

function toAuditLog(auditLog) {
  return {
    id: String(auditLog._id),
    eventType: auditLog.eventType,
    actorUserId: String(auditLog.actorUserId),
    actorRole: auditLog.actorRole,
    targetType: auditLog.targetType,
    targetId: String(auditLog.targetId),
    outcome: auditLog.outcome,
    reasonCode: auditLog.reasonCode ?? null,
    metadata: serializeMetadata(auditLog.eventType, auditLog.metadata),
    createdAt: auditLog.createdAt,
  };
}

module.exports = { toAuditLog };
