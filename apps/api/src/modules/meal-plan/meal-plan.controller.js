const mealPlanService = require('./meal-plan.service');
const { toPublicMealPlanEntry } = require('./meal-plan.serializer');
const { sendSuccess } = require('../../shared/http/response');
const { asyncHandler } = require('../../shared/http/async-handler');

const listEntries = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.validated.query;
  const items = await mealPlanService.listEntries(req.auth.userId, startDate, endDate);
  sendSuccess(res, { mealPlan: items.map(toPublicMealPlanEntry) });
});

const createEntry = asyncHandler(async (req, res) => {
  const result = await mealPlanService.createEntry(req.auth.userId, req.validated.body);
  sendSuccess(res, { mealPlanEntry: toPublicMealPlanEntry(result) }, 201);
});

const removeEntry = asyncHandler(async (req, res) => {
  await mealPlanService.removeEntry(req.auth.userId, req.validated.params.entryId);
  sendSuccess(res, { deleted: true });
});

const clearRange = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.validated.query;
  const result = await mealPlanService.clearRange(req.auth.userId, startDate, endDate);
  sendSuccess(res, result);
});

module.exports = { listEntries, createEntry, removeEntry, clearRange };
