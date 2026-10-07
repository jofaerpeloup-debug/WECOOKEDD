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
  'dietaryTags',
  'ingredientId',
  'maxPrepTimeMinutes',
  'totalTimeBucket',
  'page',
  'limit',
  'sort',
];
const NUTRITION_KEYS = Object.freeze([
  'schemaVersion', 'basis', 'caloriesKcal', 'proteinGrams',
  'carbohydrateGrams', 'fatGrams', 'sugarGrams', 'fiberGrams',
]);
const NUTRIENT_KEYS = NUTRITION_KEYS.slice(2);

function malformedNutritionError() {
  const error = new Error('This recipe has malformed authoritative nutrition data.');
  error.code = 'RECIPE_NUTRITION_MALFORMED';
  return error;
}

export function parseRecipeNutrition(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw malformedNutritionError();
  const expected = [...NUTRITION_KEYS].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw malformedNutritionError();
  }
  if (value.schemaVersion !== 1 || value.basis !== 'perServing') throw malformedNutritionError();
  if (NUTRIENT_KEYS.some((key) => (
    typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0
  ))) throw malformedNutritionError();
  return {
    schemaVersion: 1,
    basis: 'perServing',
    caloriesKcal: value.caloriesKcal,
    proteinGrams: value.proteinGrams,
    carbohydrateGrams: value.carbohydrateGrams,
    fatGrams: value.fatGrams,
    sugarGrams: value.sugarGrams,
    fiberGrams: value.fiberGrams,
  };
}

export function parseRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) return recipe;
  return { ...recipe, nutrition: parseRecipeNutrition(recipe.nutrition) };
}

function buildQuery(params) {
  const query = {};
  for (const key of LIST_PARAM_KEYS) {
    const value = params[key];
    if (value === undefined || value === null || value === '') continue;
    if (key === 'dietaryTags' && Array.isArray(value)) {
      if (value.length > 0) query[key] = value.join(',');
      continue;
    }
    query[key] = value;
  }
  return query;
}

/**
 * GET /api/v1/recipes
 * @param {{
 *   search?: string, region?: string, category?: string, difficulty?: string,
 *   dietaryTag?: string, dietaryTags?: string[]|string, ingredientId?: string,
 *   maxPrepTimeMinutes?: number, totalTimeBucket?: 'under-15'|'15-to-30'|'31-to-60'|'over-60',
 *   page?: number, limit?: number,
 *   sort?: 'titleAsc'|'titleDesc'|'newest'|'oldest'|'prepTimeAsc'|'prepTimeDesc',
 * }} [params]
 * @returns {Promise<{ recipes: object[], pagination: { page, limit, total, totalPages } | null }>}
 *   `recipes` are public PublicRecipe objects (id, never _id). The backend
 *   already applies its non-admin "usable" filter to each page.
 */
export function listRecipes(params = {}) {
  return api.get('/recipes', { query: buildQuery(params) }).then((data) => ({
    // Array.map is deliberate: one malformed present nutrition member rejects
    // the whole response, so callers can never render a valid-looking subset.
    recipes: Array.isArray(data && data.recipes) ? data.recipes.map(parseRecipe) : [],
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
  return api.get(`/recipes/${encodeURIComponent(recipeId)}`).then((data) => parseRecipe(data.recipe));
}
