const mealPlanRepository = require('./meal-plan.repository');
const recipeService = require('../recipes/recipe.service');
const { AppError } = require('../../shared/errors/app-error');
const { resolveReminder } = require('./meal-plan-time');

const DUPLICATE_KEY_ERROR_CODE = 11000;

function recipeNotFoundError() {
  return new AppError('Recipe not found.', { statusCode: 404, code: 'RECIPE_NOT_FOUND' });
}

function duplicateEntryError() {
  return new AppError('This recipe is already planned for that date.', {
    statusCode: 409,
    code: 'MEAL_PLAN_ENTRY_ALREADY_EXISTS',
  });
}

function entryNotFoundError() {
  return new AppError('Meal plan entry not found.', {
    statusCode: 404,
    code: 'MEAL_PLAN_ENTRY_NOT_FOUND',
  });
}

function staleEntryError() {
  return new AppError('This meal plan entry changed. Refresh your meal plan and try again.', {
    statusCode: 409,
    code: 'MEAL_PLAN_ENTRY_STALE',
  });
}

function hasExpectedVersion(entry, expectedUpdatedAt) {
  return entry.updatedAt instanceof Date
    && entry.updatedAt.getTime() === new Date(expectedUpdatedAt).getTime();
}

async function createEntry(userId, { dateKey, recipeId }) {
  const recipe = await recipeService.findUsableRecipeById(recipeId);
  if (!recipe) throw recipeNotFoundError();

  try {
    const entry = await mealPlanRepository.create({ userId, dateKey, recipeId });
    return { entry, recipe };
  } catch (err) {
    if (err && err.code === DUPLICATE_KEY_ERROR_CODE) throw duplicateEntryError();
    throw err;
  }
}

async function listEntries(userId, startDate, endDate) {
  const entries = await mealPlanRepository.findByUserAndRange(userId, startDate, endDate);
  return Promise.all(
    entries.map(async (entry) => ({
      entry,
      recipe: await recipeService.findUsableRecipeById(entry.recipeId),
    }))
  );
}

async function getEntry(userId, entryId) {
  const entry = await mealPlanRepository.findByIdAndUser(entryId, userId);
  if (!entry) throw entryNotFoundError();
  return { entry, recipe: await recipeService.findUsableRecipeById(entry.recipeId) };
}

async function classifyMiss(userId, entryId) {
  if (!(await mealPlanRepository.findByIdAndUser(entryId, userId))) throw entryNotFoundError();
  throw staleEntryError();
}

function observedRevision(entry) { return entry.reminderRevision ?? 0; }
function assertVersion(entry, expectedUpdatedAt, expectedReminderRevision) {
  if (!hasExpectedVersion(entry, expectedUpdatedAt) ||
      (expectedReminderRevision !== undefined && observedRevision(entry) !== expectedReminderRevision)) throw staleEntryError();
}

function nextRevision(entry) {
  const current = observedRevision(entry);
  if (!Number.isSafeInteger(current) || current === Number.MAX_SAFE_INTEGER) {
    throw new AppError('Reminder revision cannot advance.', { statusCode: 409, code: 'MEAL_PLAN_ENTRY_STALE' });
  }
  return current + 1;
}

async function putReminder(userId, entryId, body) {
  const entry = await mealPlanRepository.findByIdAndUser(entryId, userId);
  if (!entry) throw entryNotFoundError();
  assertVersion(entry, body.expectedUpdatedAt, body.expectedReminderRevision);
  const reminder = resolveReminder(entry.dateKey, body.localTime, body.timeZone);
  const old = entry.reminder;
  if (old && old.localTime === reminder.localTime && old.timeZone === reminder.timeZone &&
      new Date(old.fireAt).getTime() === reminder.fireAt.getTime()) {
    return { entry, recipe: await recipeService.findUsableRecipeById(entry.recipeId) };
  }
  const changed = await mealPlanRepository.updateObserved(entry, userId, { reminder, reminderRevision: nextRevision(entry) });
  if (!changed) return classifyMiss(userId, entryId);
  return { entry: changed, recipe: await recipeService.findUsableRecipeById(changed.recipeId) };
}

async function deleteReminder(userId, entryId, body) {
  const entry = await mealPlanRepository.findByIdAndUser(entryId, userId);
  if (!entry) throw entryNotFoundError();
  assertVersion(entry, body.expectedUpdatedAt, body.expectedReminderRevision);
  if (!entry.reminder) return { entry, recipe: await recipeService.findUsableRecipeById(entry.recipeId) };
  const changed = await mealPlanRepository.updateObserved(entry, userId, { reminder: null, reminderRevision: nextRevision(entry) });
  if (!changed) return classifyMiss(userId, entryId);
  return { entry: changed, recipe: await recipeService.findUsableRecipeById(changed.recipeId) };
}

async function moveEntry(userId, entryId, { dateKey, expectedUpdatedAt }) {
  const observed = await mealPlanRepository.findByIdAndUser(entryId, userId);
  if (!observed) throw entryNotFoundError();
  assertVersion(observed, expectedUpdatedAt);
  if (observed.dateKey === dateKey) return { entry: observed, recipe: await recipeService.findUsableRecipeById(observed.recipeId) };
  const fields = { dateKey };
  let reminderTurnedOff = false;
  if (observed.reminder) {
    try {
      fields.reminder = resolveReminder(dateKey, observed.reminder.localTime, observed.reminder.timeZone);
    } catch (error) {
      if (error.code !== 'MEAL_PLAN_REMINDER_TIME_INVALID') throw error;
      fields.reminder = null;
      reminderTurnedOff = true;
    }
    fields.reminderRevision = nextRevision(observed);
  }
  let entry;
  try {
    entry = await mealPlanRepository.updateObserved(observed, userId, fields);
  } catch (err) {
    if (err && err.code === DUPLICATE_KEY_ERROR_CODE) throw duplicateEntryError();
    throw err;
  }

  if (!entry) return classifyMiss(userId, entryId);

  const recipe = await recipeService.findUsableRecipeById(entry.recipeId);
  return { entry, recipe, reminderTurnedOff };
}

async function removeEntry(userId, entryId, { expectedUpdatedAt }) {
  const deleted = await mealPlanRepository.deleteByIdAndUser(entryId, userId, expectedUpdatedAt);
  if (!deleted) return classifyMiss(userId, entryId);
  return deleted;
}

async function clearRange(userId, startDate, endDate, expectedEntries) {
  let result;
  try { result = await mealPlanRepository.deleteByUserAndRange(userId, startDate, endDate, expectedEntries); }
  catch (error) {
    if (error.code === 'MEAL_PLAN_ENTRY_STALE' || error.code === 112 || error.code === 251 || error.hasErrorLabel?.('TransientTransactionError')) throw staleEntryError();
    throw error;
  }
  return { deletedCount: result.deletedCount ?? 0 };
}

module.exports = { createEntry, listEntries, getEntry, putReminder, deleteReminder, moveEntry, removeEntry, clearRange };
