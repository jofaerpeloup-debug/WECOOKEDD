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
  'excludeRecipeId',
  'page',
  'limit',
  'sort',
];
const NUTRITION_KEYS = Object.freeze([
  'schemaVersion', 'basis', 'caloriesKcal', 'proteinGrams',
  'carbohydrateGrams', 'fatGrams', 'sugarGrams', 'fiberGrams',
]);
const NUTRIENT_KEYS = NUTRITION_KEYS.slice(2);
export const SMART_COLLECTION_DEFINITIONS = Object.freeze([
  Object.freeze({ key: 'quick-meals', name: 'Quick Meals' }),
  Object.freeze({ key: 'balanced-meals', name: 'Balanced Meals' }),
  Object.freeze({ key: 'weekend-cooking', name: 'Weekend Cooking' }),
  Object.freeze({ key: 'dinner-ideas', name: 'Dinner Ideas' }),
  Object.freeze({ key: 'breakfast', name: 'Breakfast' }),
]);
const SMART_COLLECTION_BY_KEY = new Map(SMART_COLLECTION_DEFINITIONS.map((entry) => [entry.key, entry]));

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

function malformedSmartCollectionError() {
  const error = new Error('The smart collection response was malformed.');
  error.code = 'SMART_COLLECTION_RESPONSE_MALFORMED';
  return error;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function parseSmartCollectionIdentity(value, expectedKey) {
  if (!hasExactKeys(value, ['key', 'name'])) throw malformedSmartCollectionError();
  const definition = SMART_COLLECTION_BY_KEY.get(value.key);
  if (!definition || definition.name !== value.name || (expectedKey && value.key !== expectedKey)) {
    throw malformedSmartCollectionError();
  }
  return { key: definition.key, name: definition.name };
}

function parseSmartCollectionSummary(value, expected) {
  if (!hasExactKeys(value, ['key', 'name', 'recipeCount', 'coverImageUrls'])) {
    throw malformedSmartCollectionError();
  }
  const identity = parseSmartCollectionIdentity({ key: value.key, name: value.name }, expected.key);
  if (!Number.isSafeInteger(value.recipeCount) || value.recipeCount < 0 || !Array.isArray(value.coverImageUrls)
    || value.coverImageUrls.length > 4
    || value.coverImageUrls.some((url) => typeof url !== 'string' || !url.startsWith('https://'))) {
    throw malformedSmartCollectionError();
  }
  return { ...identity, recipeCount: value.recipeCount, coverImageUrls: [...value.coverImageUrls] };
}

function parseSmartPagination(value, requestedPage, requestedLimit) {
  if (!hasExactKeys(value, ['page', 'limit', 'total', 'totalPages'])) throw malformedSmartCollectionError();
  const { page, limit, total, totalPages } = value;
  if (!Number.isSafeInteger(page) || page !== requestedPage
    || !Number.isSafeInteger(limit) || limit !== requestedLimit
    || !Number.isSafeInteger(total) || total < 0
    || !Number.isSafeInteger(totalPages) || totalPages !== Math.ceil(total / limit)) {
    throw malformedSmartCollectionError();
  }
  return { page, limit, total, totalPages };
}

export function listSmartCollections() {
  return api.get('/recipes/smart-collections').then((data) => {
    if (!hasExactKeys(data, ['smartCollections']) || !Array.isArray(data.smartCollections)
      || data.smartCollections.length !== SMART_COLLECTION_DEFINITIONS.length) {
      throw malformedSmartCollectionError();
    }
    return {
      smartCollections: data.smartCollections.map((value, index) => (
        parseSmartCollectionSummary(value, SMART_COLLECTION_DEFINITIONS[index])
      )),
    };
  });
}

export function getSmartCollection(groupKey, { page = 1, limit = 20 } = {}) {
  if (!SMART_COLLECTION_BY_KEY.has(groupKey)
    || !Number.isSafeInteger(page) || page < 1
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return Promise.reject(malformedSmartCollectionError());
  }
  return api.get(`/recipes/smart-collections/${encodeURIComponent(groupKey)}`, {
    query: { page, limit },
  }).then((data) => {
    if (!hasExactKeys(data, ['smartCollection', 'recipes', 'pagination']) || !Array.isArray(data.recipes)) {
      throw malformedSmartCollectionError();
    }
    const smartCollection = parseSmartCollectionIdentity(data.smartCollection, groupKey);
    const pagination = parseSmartPagination(data.pagination, page, limit);
    const expectedPageLength = Math.max(
      0,
      Math.min(limit, pagination.total - ((page - 1) * limit))
    );
    if (data.recipes.length !== expectedPageLength) {
      throw malformedSmartCollectionError();
    }
    const recipes = data.recipes.map((recipe) => {
      if (!isRecord(recipe) || typeof recipe.id !== 'string' || !recipe.id) throw malformedSmartCollectionError();
      return parseRecipe(recipe);
    });
    if (new Set(recipes.map(({ id }) => id)).size !== recipes.length) throw malformedSmartCollectionError();
    return { smartCollection, recipes, pagination };
  });
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
 *   excludeRecipeId?: string,
 *   page?: number, limit?: number,
 *   sort?: 'titleAsc'|'titleDesc'|'newest'|'oldest'|'prepTimeAsc'|'prepTimeDesc'|'relevance'|'topRated',
 * }} [params]
 * @returns {Promise<{ recipes: object[], pagination: { page, limit, total, totalPages } | null }>}
 *   `recipes` are public PublicRecipe objects (id, never _id). The backend
 *   already applies its non-admin "usable" filter before total and paging.
 */
function isPagination(value) {
  return !!value
    && Number.isInteger(value.page)
    && value.page >= 1
    && Number.isInteger(value.limit)
    && value.limit >= 1
    && Number.isInteger(value.total)
    && value.total >= 0
    && Number.isInteger(value.totalPages)
    && value.totalPages === Math.ceil(value.total / value.limit);
}

function isRatingSummary(value) {
  return !!value
    && typeof value.averageRating === 'number'
    && Number.isFinite(value.averageRating)
    && value.averageRating >= 1
    && value.averageRating <= 5
    && Number.isInteger(value.ratingCount)
    && value.ratingCount > 0;
}

function isRankedRecipe(value) {
  return !!value && typeof value.id === 'string' && /^[a-f\d]{24}$/i.test(value.id);
}

function rankedResponseError() {
  const error = new Error('The ranked recipe response was unavailable.');
  error.code = 'INVALID_RANKED_RECIPE_RESPONSE';
  return error;
}

export function listRecipes(params = {}) {
  return api.get('/recipes', { query: buildQuery(params) }).then((data) => {
    const ranked = params.sort === 'relevance' || params.sort === 'topRated';
    if (ranked && (!Array.isArray(data?.recipes) || !isPagination(data?.pagination))) {
      throw rankedResponseError();
    }
    if (ranked && data.recipes.some((recipe) => !isRankedRecipe(recipe))) {
      throw rankedResponseError();
    }
    if (params.sort === 'topRated' && data.recipes.some((recipe) => !isRatingSummary(recipe.ratingSummary))) {
      throw rankedResponseError();
    }
    return {
      // Every present nutrition value must validate before a list can render.
      recipes: Array.isArray(data && data.recipes) ? data.recipes.map(parseRecipe) : [],
      pagination: (data && data.pagination) || null,
    };
  });
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
