// Collections feature service for the mobile app — the single data path for
// the authenticated user's own recipe Collections (distinct from Favorites,
// which keeps its own favoriteService.js):
//
//   CollectionsProvider (src/context/CollectionsContext.js)
//     -> collectionService
//     -> api (src/api/client.js — shared, UNCHANGED)
//     -> Express REST API (/api/v1/collections)
//     -> MongoDB
//
// Every call requires authentication; the shared client already attaches the
// bearer access token and performs one transparent refresh+retry. This module
// never calls `fetch`, never touches the token store, and NEVER sends a
// userId/ownerId — ownership is always derived from the authenticated backend
// identity (req.auth.userId). A client-supplied userId is rejected by the
// backend's strict Zod schema anyway. Zero AsyncStorage/mock involvement.

import { api } from './client';

// The only query keys the backend membership-list endpoint implements
// (collection.validation.js#listCollectionRecipesSchema — a STRICT schema,
// so any other key is a 400 VALIDATION_ERROR).
const LIST_RECIPES_PARAM_KEYS = ['page', 'limit', 'sort'];

function buildQuery(params) {
  const query = {};
  for (const key of LIST_RECIPES_PARAM_KEYS) {
    const value = params[key];
    if (value === undefined || value === null || value === '') continue;
    query[key] = value;
  }
  return query;
}

/**
 * GET /api/v1/collections
 * @returns {Promise<{ collections: object[] }>}
 *   Each collection is `{ id, name, description, recipeCount, coverImageUrls,
 *   createdAt, updatedAt }`. `coverImageUrls` holds only real recipe image
 *   URLs (never fabricated) and is `[]` for an empty collection.
 */
export function listCollections() {
  return api.get('/collections').then((data) => ({
    collections: Array.isArray(data && data.collections) ? data.collections : [],
  }));
}

/**
 * POST /api/v1/collections
 * @param {{ name: string, description?: string }} input
 * @returns {Promise<object>} the created collection `{ id, name, description,
 *   createdAt, updatedAt }`. Throws ApiError VALIDATION_ERROR (400) for an
 *   empty/too-long name or an over-length description.
 */
export function createCollection({ name, description }) {
  const body = { name };
  if (description) body.description = description;
  return api.post('/collections', { body }).then((data) => data.collection);
}

/**
 * GET /api/v1/collections/:collectionId
 * @param {string} collectionId
 * @returns {Promise<object>} the collection's metadata. Throws ApiError
 *   COLLECTION_NOT_FOUND (404) when it doesn't exist or isn't owned by the
 *   caller — the backend never distinguishes the two (BOLA-safe).
 */
export function getCollection(collectionId) {
  return api.get(`/collections/${encodeURIComponent(collectionId)}`).then((data) => data.collection);
}

/**
 * DELETE /api/v1/collections/:collectionId
 * @param {string} collectionId
 * @returns {Promise<{ deleted: true }>} Throws ApiError COLLECTION_NOT_FOUND
 *   (404) when it doesn't exist or isn't owned by the caller.
 */
export function deleteCollection(collectionId) {
  return api.del(`/collections/${encodeURIComponent(collectionId)}`);
}

/**
 * GET /api/v1/collections/:collectionId/recipes
 * @param {string} collectionId
 * @param {{ page?: number, limit?: number, sort?: 'newest'|'oldest' }} [params]
 * @returns {Promise<{
 *   recipes: object[],
 *   pagination: { page: number, limit: number, total: number, totalPages: number } | null,
 * }>}
 *   Each entry is `{ id, recipe: { id, title, region, category, difficulty,
 *   prepTimeMinutes, cookTimeMinutes, imageUrl }, createdAt }` — the nested
 *   recipe is a SUMMARY, never a full PublicRecipe. The backend omits any
 *   membership whose recipe has become archived/unusable, but
 *   `pagination.total`/`totalPages` are computed before that filter.
 */
export function listCollectionRecipes(collectionId, params = {}) {
  return api
    .get(`/collections/${encodeURIComponent(collectionId)}/recipes`, { query: buildQuery(params) })
    .then((data) => ({
      recipes: Array.isArray(data && data.recipes) ? data.recipes : [],
      pagination: (data && data.pagination) || null,
    }));
}

/**
 * POST /api/v1/collections/:collectionId/recipes
 * @param {string} collectionId
 * @param {string} recipeId  backend Recipe id.
 * @returns {Promise<object>} the created membership `{ id, recipe, createdAt }`.
 *   Throws ApiError:
 *     - COLLECTION_NOT_FOUND (404) — collection unknown / not owned by caller
 *     - RECIPE_NOT_FOUND (404) — recipe unknown / archived / unusable
 *     - COLLECTION_RECIPE_ALREADY_EXISTS (409) — already in this collection
 *       (idempotent: treat as added — see collectionErrors.js)
 */
export function addRecipeToCollection(collectionId, recipeId) {
  return api
    .post(`/collections/${encodeURIComponent(collectionId)}/recipes`, { body: { recipeId } })
    .then((data) => data.recipe);
}

/**
 * DELETE /api/v1/collections/:collectionId/recipes/:recipeId
 * @param {string} collectionId
 * @param {string} recipeId
 * @returns {Promise<{ deleted: true }>} Throws ApiError COLLECTION_RECIPE_NOT_FOUND
 *   (404) when the recipe isn't in the collection (idempotent: treat as
 *   removed), or COLLECTION_NOT_FOUND (404) when the collection isn't owned
 *   by the caller.
 */
export function removeRecipeFromCollection(collectionId, recipeId) {
  return api.del(`/collections/${encodeURIComponent(collectionId)}/recipes/${encodeURIComponent(recipeId)}`);
}
