const mealPlanRepository = require('./meal-plan.repository');
const recipeService = require('../recipes/recipe.service');
const { AppError } = require('../../shared/errors/app-error');

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

async function moveEntry(userId, entryId, { dateKey, expectedUpdatedAt }) {
  let entry;
  try {
    entry = await mealPlanRepository.moveByIdAndUser(
      entryId,
      userId,
      dateKey,
      expectedUpdatedAt
    );
  } catch (err) {
    if (err && err.code === DUPLICATE_KEY_ERROR_CODE) throw duplicateEntryError();
    throw err;
  }

  if (!entry) {
    const existing = await mealPlanRepository.findByIdAndUser(entryId, userId);
    if (!existing) throw entryNotFoundError();
    if (existing.dateKey !== dateKey || !hasExpectedVersion(existing, expectedUpdatedAt)) {
      throw staleEntryError();
    }
    entry = existing;
  }

  const recipe = await recipeService.findUsableRecipeById(entry.recipeId);
  return { entry, recipe };
}

async function removeEntry(userId, entryId) {
  const deleted = await mealPlanRepository.deleteByIdAndUser(entryId, userId);
  if (!deleted) throw entryNotFoundError();
  return deleted;
}

async function clearRange(userId, startDate, endDate) {
  const result = await mealPlanRepository.deleteByUserAndRange(userId, startDate, endDate);
  return { deletedCount: result.deletedCount ?? 0 };
}

module.exports = { createEntry, listEntries, moveEntry, removeEntry, clearRange };
