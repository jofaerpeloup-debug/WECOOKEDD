const mongoose = require('mongoose');
const { ROLES, STATUSES } = require('../users/user.model');

const EVENT_TYPES = Object.freeze([
  'admin.user.status_changed',
  'admin.staff.moderator_approved',
  'admin.staff.application_rejected',
  'admin.staff.moderator_demoted',
]);
const TARGET_TYPES = Object.freeze(['user', 'moderator_application']);
const OUTCOMES = Object.freeze(['success', 'partial_failure']);
const REASON_CODES = Object.freeze(['SESSION_REVOCATION_FAILED']);

// This is the complete Phase 2 metadata vocabulary. Event-specific key sets
// are enforced by AuditService before a document reaches the repository.
const auditMetadataSchema = new mongoose.Schema(
  {
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ModeratorApplication',
    },
    fromStatus: { type: String, enum: STATUSES },
    toStatus: { type: String, enum: STATUSES },
    fromRole: { type: String, enum: ROLES },
    toRole: { type: String, enum: ROLES },
  },
  { _id: false, strict: 'throw' }
);

const auditLogSchema = new mongoose.Schema(
  {
    eventType: { type: String, enum: EVENT_TYPES, required: true },
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    actorRole: { type: String, enum: ROLES, required: true },
    targetType: { type: String, enum: TARGET_TYPES, required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
    outcome: { type: String, enum: OUTCOMES, required: true },
    reasonCode: { type: String, enum: REASON_CODES },
    metadata: { type: auditMetadataSchema },
  },
  {
    strict: 'throw',
    timestamps: { createdAt: true, updatedAt: false },
  }
);

auditLogSchema.index(
  { createdAt: -1, _id: -1 },
  { name: 'audit_log_newest_first' }
);

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

module.exports = AuditLog;
module.exports.EVENT_TYPES = EVENT_TYPES;
module.exports.TARGET_TYPES = TARGET_TYPES;
module.exports.OUTCOMES = OUTCOMES;
module.exports.REASON_CODES = REASON_CODES;
