const service = require('./assistant-history.service');
const { sendSuccess } = require('../../shared/http/response');
const { asyncHandler } = require('../../shared/http/async-handler');

const create = asyncHandler(async (req, res) => {
  const result = await service.create({ userId: req.auth.userId, ...req.validated.body });
  service.guardConversation(result.conversation);
  sendSuccess(res, { conversation: result.conversation }, result.created ? 201 : 200);
});
const list = asyncHandler(async (req, res) => {
  const result = await service.list({ userId: req.auth.userId, ...req.validated.query });
  sendSuccess(res, service.guardList(result, req.auth.userId));
});
const open = asyncHandler(async (req, res) => {
  const result = await service.open({ userId: req.auth.userId, ...req.validated.params, ...req.validated.query });
  service.guardConversation(result.conversation);
  sendSuccess(res, result);
});
const remove = asyncHandler(async (req, res) => {
  const result = await service.remove({ userId: req.auth.userId, ...req.validated.params });
  sendSuccess(res, result);
});

const send = asyncHandler(async (req, res) => {
  const result = await service.send({ userId: req.auth.userId, ...req.validated.params, ...req.validated.body });
  service.guardConversation(result.conversation);
  sendSuccess(res, result);
});

module.exports = { create, list, open, remove, send };
