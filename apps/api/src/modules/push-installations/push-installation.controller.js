const service = require('./push-installation.service');
const { sendSuccess } = require('../../shared/http/response');
const { asyncHandler } = require('../../shared/http/async-handler');

const put = asyncHandler(async (req, res) => {
  const installation = await service.register({
    installationId: req.params.installationId,
    recipientId: req.auth.userId,
    sessionId: req.auth.sessionId,
    ...req.body,
  });
  sendSuccess(res, { installation });
});

const remove = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.unregister({
    installationId: req.params.installationId,
    recipientId: req.auth.userId,
    sessionId: req.auth.sessionId,
    ...req.body,
  }));
});

module.exports = { put, remove };
