const assistantService = require('./assistant.service');
const { sendSuccess } = require('../../shared/http/response');
const { asyncHandler } = require('../../shared/http/async-handler');

const chat = asyncHandler(async (req, res) => {
  const reply = await assistantService.chat(req.body.messages);
  sendSuccess(res, { reply });
});

module.exports = { chat };
