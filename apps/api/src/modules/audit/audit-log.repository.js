const AuditLog = require('./audit-log.model');

function create(event) {
  return AuditLog.create(event);
}

function findMany({ filter, skip, limit }) {
  return AuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit);
}

function countByFilter(filter) {
  return AuditLog.countDocuments(filter);
}

module.exports = { create, findMany, countByFilter };
