const { asyncHandler } = require('../../shared/http/async-handler');
const { sendSuccess } = require('../../shared/http/response');
const analyticsService = require('./analytics.service');

const getOverview = asyncHandler(async (req, res) => {
  const periodEndUtc = new Date();
  const data = await analyticsService.getOverview(req.auth, periodEndUtc);
  sendSuccess(res, data);
});

module.exports = { getOverview };
