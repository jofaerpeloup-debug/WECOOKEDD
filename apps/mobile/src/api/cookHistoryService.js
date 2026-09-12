// Cook History feature service for the mobile app — the single data path for
// the authenticated user's real server-backed cook completions:
//
//   CookModeScreen (Finish) / CookHistoryContext (Profile "Cooked" stat)
//     / RecipeDetailScreen (Cooked pill)
//     -> cookHistoryService
//     -> api (src/api/client.js — shared, UNCHANGED)
//     -> Express REST API (/api/v1/cook-history, /api/v1/cook-history/stats,
//        /api/v1/cook-history/recipes/:recipeId/status)
//     -> MongoDB
//
// Every call requires authentication; the shared client already attaches the
// bearer access token and performs one transparent refresh+retry (that retry
// only ever fires after a 401, i.e. before the original request reached the
// controller — it can never itself create a duplicate cook-history event).
// This module never calls `fetch`, never touches the token store, and NEVER
// sends a userId or completedAt — ownership and completion time are always
// derived from the authenticated backend identity / server clock. A
// client-supplied one is rejected by the backend's strict Zod schema anyway.

import { api } from './client';

/**
 * POST /api/v1/cook-history
 * @param {{ recipeId: string, servings?: number }} params  recipeId is a
 *   backend Recipe id (Mongo ObjectId string); servings, if provided, must be
 *   the real currently-selected CookMode servings count — a positive whole
 *   number.
 * @returns {Promise<object>} the created cook-history event
 *   `{ id, recipe, servings, completedAt }`.
 *   Throws ApiError RECIPE_NOT_FOUND (404) when the recipe is unknown,
 *   archived, or unusable.
 */
export function recordCompletion({ recipeId, servings }) {
  const body = { recipeId };
  if (servings !== undefined) body.servings = servings;
  return api.post('/cook-history', { body }).then((data) => data.cookHistory);
}

/**
 * GET /api/v1/cook-history/stats
 * @returns {Promise<{ totalCooks: number, uniqueRecipesCooked: number }>}
 *   Always a real, server-computed count — zeroed rather than omitted when
 *   the user has no history yet, never fabricated.
 */
export function getStats() {
  return api.get('/cook-history/stats').then((data) => data.stats);
}

/**
 * GET /api/v1/cook-history/recipes/:recipeId/status
 * @param {string} recipeId  backend Recipe id (Mongo ObjectId string).
 * @returns {Promise<{ hasCooked: boolean }>}  boolean existence only — has
 *   the current user EVER completed this recipe at least once. Never a
 *   count, never another user's state.
 *   Throws ApiError RECIPE_NOT_FOUND (404) when the recipe is unknown,
 *   archived, or unusable.
 */
export function getRecipeStatus(recipeId) {
  return api.get(`/cook-history/recipes/${encodeURIComponent(recipeId)}/status`);
}
