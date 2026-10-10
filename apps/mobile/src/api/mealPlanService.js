import { api } from './client';

function normalizeEntry(raw) {
  const entry = raw || {};
  return {
    id: entry.id ?? null,
    ownerId: entry.ownerId ?? null,
    dateKey: entry.dateKey ?? null,
    recipeId: entry.recipeId ?? null,
    isAvailable: entry.isAvailable === true,
    recipe: entry.recipe || null,
    createdAt: entry.createdAt ?? null,
    updatedAt: entry.updatedAt ?? null,
    reminder: entry.reminder ?? null,
    reminderRevision: entry.reminderRevision ?? 0,
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

export function moveMealPlanEntry(entryId, { dateKey, expectedUpdatedAt }) {
  return api
    .patch(`/meal-plan/${encodeURIComponent(entryId)}`, { body: { dateKey, expectedUpdatedAt } })
    .then((data) => normalizeEntry(data?.mealPlanEntry));
}

export function removeMealPlanEntry(entryId, expectedUpdatedAt) {
  return api.del(`/meal-plan/${encodeURIComponent(entryId)}`, { body: { expectedUpdatedAt } }).then((data) => data?.deleted === true);
}

export function clearMealPlanRange(startDate, endDate, expectedEntries) {
  return api.del('/meal-plan', { query: { startDate, endDate }, body: { expectedEntries } }).then((data) => ({ deletedCount: data?.deletedCount }));
}

const ID = /^[0-9a-f]{24}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ZONE = /^(?:[A-Za-z_]+\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)*|UTC)$/;
function canonicalInstant(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}
function realDateKey(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const candidate = new Date(0);
  candidate.setUTCHours(0, 0, 0, 0);
  candidate.setUTCFullYear(year, month - 1, day);
  return candidate.toISOString().slice(0, 10) === value;
}
function knownZone(value) {
  if (typeof value !== 'string' || !ZONE.test(value)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; }
}
export function validCompleteEntry(item, startDate, endDate) {
  return !!item && typeof item === 'object' && !Array.isArray(item) && ID.test(item.id)
    && ID.test(item.ownerId)
    && ID.test(item.recipeId) && realDateKey(item.dateKey)
    && (!startDate || (item.dateKey >= startDate && item.dateKey <= endDate))
    && canonicalInstant(item.createdAt) && canonicalInstant(item.updatedAt)
    && typeof item.isAvailable === 'boolean'
    && (item.isAvailable ? item.recipe?.id === item.recipeId : item.recipe === null)
    && Number.isSafeInteger(item.reminderRevision) && item.reminderRevision >= 0
    && Object.prototype.hasOwnProperty.call(item, 'reminder')
    && (item.reminder === null || (!!item.reminder && typeof item.reminder === 'object'
      && Object.keys(item.reminder).sort().join('|') === 'fireAt|localTime|timeZone'
      && TIME.test(item.reminder.localTime) && knownZone(item.reminder.timeZone)
      && canonicalInstant(item.reminder.fireAt) && Date.parse(item.reminder.fireAt) % 1000 === 0));
}

export async function getMealPlanHorizon(startDate, endDate) {
  const data = await api.get('/meal-plan', { query: { startDate, endDate } });
  if (!Array.isArray(data?.mealPlan)) throw new Error('Meal plan horizon is incomplete.');
  const ids = new Set();
  for (const item of data.mealPlan) {
    if (!validCompleteEntry(item, startDate, endDate) || ids.has(item.id)) throw new Error('Meal plan horizon is malformed.');
    ids.add(item.id);
  }
  return data.mealPlan;
}

export async function getMealPlanEntry(entryId) {
  const data = await api.get(`/meal-plan/${encodeURIComponent(entryId)}`);
  if (!validCompleteEntry(data?.mealPlanEntry) || data.mealPlanEntry.id !== entryId) throw new Error('Meal plan entry is incomplete.');
  return data.mealPlanEntry;
}

export async function putMealPlanReminder(entryId, body) {
  const data = await api.request(`/meal-plan/${encodeURIComponent(entryId)}/reminder`, { method: 'PUT', body });
  if (!validCompleteEntry(data?.mealPlanEntry)) throw new Error('Reminder response is incomplete.');
  return data.mealPlanEntry;
}

export async function deleteMealPlanReminder(entryId, body) {
  const data = await api.del(`/meal-plan/${encodeURIComponent(entryId)}/reminder`, { body });
  if (!validCompleteEntry(data?.mealPlanEntry)) throw new Error('Reminder response is incomplete.');
  return data.mealPlanEntry;
}
