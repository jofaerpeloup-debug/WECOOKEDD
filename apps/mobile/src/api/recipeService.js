// Recipe feature service for the mobile app — the single data path for
// generic Recipe discovery + Recipe detail business data:
//
//   DashboardScreen / DiscoverScreen / RecipeDetailScreen
//     -> recipeService
//     -> api (src/api/client.js — shared, unchanged)
//     -> Express REST API (/api/v1/recipes)
//     -> MongoDB
//
// Reads require authentication; the shared client already attaches the bearer
// access token and performs one transparent refresh+retry. This module never
// calls `fetch`, never touches the token store, and never wraps a Recipe
// mutation — mobile is read-only against the Recipe domain.
//
// Contract reference: docs/architecture/recipes.md and
// docs/architecture/mobile-recipes-integration.md. Zero Firestore involvement.

import { api } from './client';

// Only the query keys the backend list endpoint actually implements
// (recipe.validation.js#listRecipesSchema). `status` is deliberately NOT here:
// the backend defaults it to "active" and rejects "inactive"/"all" for a
// non-admin caller with 403 — the mobile app must never send it.
const LIST_PARAM_KEYS = [
  'search',
  'region',
  'category',
  'difficulty',
  'dietaryTag',
  'ingredientId',
  'maxPrepTimeMinutes',
  'page',
  'limit',
  'sort',
];

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
 * GET /api/v1/recipes
 * @param {{
 *   search?: string, region?: string, category?: string, difficulty?: string,
 *   dietaryTag?: string, ingredientId?: string, maxPrepTimeMinutes?: number,
 *   page?: number, limit?: number,
 *   sort?: 'titleAsc'|'titleDesc'|'newest'|'oldest'|'prepTimeAsc'|'prepTimeDesc',
 * }} [params]
 * @returns {Promise<{ recipes: object[], pagination: { page, limit, total, totalPages } | null }>}
 *   `recipes` are public PublicRecipe objects (id, never _id). The backend
 *   already applies its non-admin "usable" filter to each page.
 */
export function listRecipes(params = {}) {
  return api.get('/recipes', { query: buildQuery(params) }).then((data) => ({
    recipes: Array.isArray(data && data.recipes) ? data.recipes : [],
    pagination: (data && data.pagination) || null,
  }));
}

/**
 * GET /api/v1/recipes/:recipeId
 * @param {string} recipeId  backend Recipe id (Mongo ObjectId string) — never a
 *   legacy mock id like "r4".
 * @returns {Promise<object>} the authoritative PublicRecipe.
 *   Throws ApiError with code RECIPE_NOT_FOUND (404) when the recipe is unknown,
 *   archived, or unusable for a non-admin caller.
 */
export function getRecipe(recipeId) {
  return api.get(`/recipes/${encodeURIComponent(recipeId)}`).then((data) => data.recipe);
}