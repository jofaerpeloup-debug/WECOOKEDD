import { api } from './client';

function normalizeEntry(raw) {
  const entry = raw || {};
  return {
    id: entry.id ?? null,
    dateKey: entry.dateKey ?? null,
    recipeId: entry.recipeId ?? null,
    isAvailable: entry.isAvailable === true,
    recipe: entry.recipe || null,
    createdAt: entry.createdAt ?? null,
    updatedAt: entry.updatedAt ?? null,
  };
}

export function getMealPlan(startDate, endDate) {
  return api.get('/meal-plan', { query: { startDate, endDate } }).then((data) =>
    Array.isArray(data?.mealPlan) ? data.mealPlan.map(normalizeEntry) : []
  );
}

export function createMealPlanEntry({ dateKey, recipeId }) {
  return api.post('/meal-plan', { body: { dateKey, recipeId } }).then((data) => normalizeEntry(data?.mealPlanEntry));
}

export function removeMealPlanEntry(entryId) {
  return api.del(`/meal-plan/${encodeURIComponent(entryId)}`).then((data) => data?.deleted === true);
}

export function clearMealPlanRange(startDate, endDate) {
  return api.del('/meal-plan', { query: { startDate, endDate } }).then((data) => ({ deletedCount: Number(data?.deletedCount) || 0 }));
}
