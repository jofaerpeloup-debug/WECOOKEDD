const AuditLog = require('./audit-log.model');

function create(event) {
  return AuditLog.create(event);
}

module.exports = { create };
