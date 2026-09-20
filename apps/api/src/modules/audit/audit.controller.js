const auditService = require('./audit.service');
const { toAuditLog } = require('./audit.serializer');
const { sendSuccess } = require('../../shared/http/response');
const { asyncHandler } = require('../../shared/http/async-handler');

function toPagination({ page, limit, total }) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

const listAuditLogs = asyncHandler(async (req, res) => {
  const result = await auditService.list(req.validated.query);

  sendSuccess(res, {
    auditLogs: result.items.map(toAuditLog),
    pagination: toPagination(result),
  });
});

module.exports = { listAuditLogs };
