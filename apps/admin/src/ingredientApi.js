// Ingredient feature service — the single authoritative data path for
// ingredient business data:
//
//   IngredientsTab / useIngredients
//     -> ingredientApi
//     -> apiClient (shared)
//     -> Express REST API (/api/v1/ingredients)
//     -> MongoDB
//
// Reads require authentication; staff/all reads and mutations are capability-
// gated by the API. DELETE is a soft archive (isActive -> false). The
// public JSON uses `id` (not `_id`); internal fields (normalizedName, _id,
// __v) are never sent.

import { api } from './apiClient.js';

/**
 * GET /api/v1/ingredients
 * @param {{ search?, category?, allergen?, status?, sort?, page?, limit? }} params
 *   status: "active" (default) | "inactive" | "all" — "inactive"/"all" require catalog.read_all.
 * @returns {Promise<{ ingredients: object[], pagination: object|null }>}
 */
export function listIngredients(params = {}) {
  const { search, category, allergen, status, sort, page, limit } = params;
  return api
    .get('/ingredients', {
      query: { search, category, allergen, status, sort, page, limit },
    })
    .then((data) => ({
      ingredients: data.ingredients || [],
      pagination: data.pagination || null,
    }));
}

/** POST /api/v1/ingredients/resolve (catalog.write, read-only resolver) */
export function resolveIngredients(lines) {
  return api
    .post('/ingredients/resolve', { body: { lines } })
    .then((data) => data.resolutions || []);
}

/** GET /api/v1/ingredients/:id */
export function getIngredient(id) {
  return api.get(`/ingredients/${encodeURIComponent(id)}`).then((data) => data.ingredient);
}

/**
 * POST /api/v1/ingredients (catalog.write)
 * @param {{ name: string, aliases?: string[], category: string, allergenTags?: string[] }} input
 */
export function createIngredient({ name, aliases = [], category, allergenTags = [] }) {
  return api
    .post('/ingredients', { body: { name, aliases, category, allergenTags } })
    .then((data) => data.ingredient);
}

/**
 * PATCH /api/v1/ingredients/:id (catalog.write)
 * @param {string} id
 * @param {{ name?, aliases?, category?, allergenTags?, isActive? }} patch
 *   Only the changed fields should be passed — an empty patch is rejected by
 *   the API. Set isActive:true to restore an archived ingredient.
 */
export function updateIngredient(id, patch) {
  return api
    .patch(`/ingredients/${encodeURIComponent(id)}`, { body: patch })
    .then((data) => data.ingredient);
}

/**
 * DELETE /api/v1/ingredients/:id (catalog.write) — soft archive, not a physical
 * delete. Returns the archived ingredient (isActive: false).
 */
export function archiveIngredient(id) {
  return api.del(`/ingredients/${encodeURIComponent(id)}`).then((data) => data.ingredient);
}

/** Convenience wrapper over updateIngredient for restoring an archived record. */
export function restoreIngredient(id) {
  return updateIngredient(id, { isActive: true });
}
