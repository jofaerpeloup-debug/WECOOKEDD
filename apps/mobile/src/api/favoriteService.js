// Favorites feature service for the mobile app — the single data path for the
// authenticated user's saved (favorite) recipes:
//
//   FavoritesProvider (src/context/FavoritesContext.js)
//     -> favoriteService
//     -> api (src/api/client.js — shared, UNCHANGED)
//     -> Express REST API (/api/v1/favorites)
//     -> MongoDB
//
// Every call requires authentication; the shared client already attaches the
// bearer access token and performs one transparent refresh+retry. This module
// never calls `fetch`, never touches the token store, and NEVER sends a userId
// — ownership is always derived from the authenticated backend identity
// (req.auth.userId). A client-supplied userId is rejected by the backend's
// strict Zod schema anyway.
//
// Contract reference: docs/architecture/favorites-shopping-list.md and
// docs/architecture/mobile-favorites-integration.md. Zero Firestore involvement.

import { api } from './client';

// The only query keys the backend list endpoint implements
// (favorite.validation.js#listFavoritesSchema — a STRICT schema, so any other
// key, notably `userId`, is a 400 VALIDATION_ERROR).
const LIST_PARAM_KEYS = ['page', 'limit', 'sort'];

function buildQuery(params) {
  const query = {};
  for (const key of LIST_PARAM_KEYS) {
    const value = params[key];
    if (value === undefined || value === null || value === '') continue;
    query[key] = value;
  }
  return query;
}

/**
 * GET /api/v1/favorites
 * @param {{ page?: number, limit?: number, sort?: 'newest'|'oldest' }} [params]
 * @returns {Promise<{
 *   favorites: object[],
 *   pagination: { page: number, limit: number, total: number, totalPages: number } | null,
 * }>}
 *   Each favorite is `{ id, recipe: { id, title, region, category, difficulty,
 *   prepTimeMinutes, cookTimeMinutes, imageUrl }, createdAt }`. The nested
 *   recipe is a SUMMARY — never a full PublicRecipe (no description / servings /
 *   ingredients / instructions).
 *
 *   The backend already omits any favorite whose recipe has become archived or
 *   unusable, but `pagination.total` / `totalPages` are computed BEFORE that
 *   filter — they can overcount, and a page can come back shorter than `limit`
 *   (or empty) without being the last page.
 */
export function listFavorites(params = {}) {
  return api.get('/favorites', { query: buildQuery(params) }).then((data) => ({
    favorites: Array.isArray(data && data.favorites) ? data.favorites : [],
    pagination: (data && data.pagination) || null,
  }));
}

/**
 * POST /api/v1/favorites/:recipeId
 * @param {string} recipeId  backend Recipe id (Mongo ObjectId string) — never a
 *   legacy mock id like "r4" (which the backend rejects as 400 VALIDATION_ERROR).
 * @returns {Promise<object>} the created favorite `{ id, recipe, createdAt }`.
 *   Throws ApiError:
 *     - FAVORITE_ALREADY_EXISTS (409) — already saved (idempotent: treat as saved)
 *     - RECIPE_NOT_FOUND       (404) — recipe unknown / archived / unusable
 */
export function addFavorite(recipeId) {
  return api.post(`/favorites/${encodeURIComponent(recipeId)}`).then((data) => data.favorite);
}

/**
 * DELETE /api/v1/favorites/:recipeId
 * @param {string} recipeId  backend Recipe id. Removal is keyed by recipeId,
 *   not by a favorite id, so the client never needs to track favorite ids.
 * @returns {Promise<{ deleted: true }>} Throws ApiError FAVORITE_NOT_FOUND (404)
 *   when the caller has no such favorite (idempotent: treat as unsaved).
 */
export function removeFavorite(recipeId) {
  return api.del(`/favorites/${encodeURIComponent(recipeId)}`);
}
