// Recipe feature service — the single authoritative data path for recipe
// business data:
//
//   RecipesTab / useRecipes
//     -> recipeApi
//     -> apiClient (shared)
//     -> Express REST API (/api/v1/recipes)
//     -> MongoDB
//
// Reads require authentication; staff/all reads and mutations are capability-
// gated by the API. DELETE is a soft archive (isActive -> false). The
// public JSON uses `id` (never `_id`) and inlines each referenced canonical
// ingredient as `{ id, name }` (or null when the ref no longer resolves) —
// internal ingredient fields (isActive, normalizedName, …) are never exposed.
// Components never type a raw Mongo id: the ingredient-usage picker resolves
// names to public ids via ingredientApi.
//
// Contract reference: docs/architecture/recipes.md and
// docs/architecture/admin-recipes-integration.md. There is ZERO Firestore
// involvement in this path.

import { api } from './apiClient.js';
import { TO_TASTE_UNIT } from './recipeOptions.js';

/**
 * GET /api/v1/recipes
 * @param {{
 *   search?: string,
 *   region?: string,
 *   category?: string,
 *   difficulty?: string,
 *   dietaryTag?: string,
 *   ingredientId?: string,
 *   maxPrepTimeMinutes?: number,
 *   status?: 'active' | 'inactive' | 'all',
 *   sort?: 'titleAsc' | 'titleDesc' | 'newest' | 'oldest' | 'prepTimeAsc' | 'prepTimeDesc',
 *   page?: number,
 *   limit?: number,
 * }} params
 *   status: "active" (default) | "inactive" | "all" — "inactive"/"all" require catalog.read_all.
 *   region / category: canonical slugs (e.g. "central-luzon", "main-dish").
 * @returns {Promise<{ recipes: object[], pagination: object|null }>}
 */
export function listRecipes(params = {}) {
  const {
    search, region, category, difficulty, dietaryTag, ingredientId,
    maxPrepTimeMinutes, status, sort, page, limit,
  } = params;
  return api
    .get('/recipes', {
      query: {
        search, region, category, difficulty, dietaryTag, ingredientId,
        maxPrepTimeMinutes, status, sort, page, limit,
      },
    })
    .then((data) => ({
      recipes: data.recipes || [],
      pagination: data.pagination || null,
    }));
}

// GET /api/v1/recipes/:id exists on the backend but is intentionally not wrapped
// here — the list serializer already returns the complete recipe (every field
// the table and the edit modal render), so this slice never needs a
// single-resource read. Same choice as substitutionApi.js.

/**
 * Shapes one ingredient-usage row into the exact embedded-entry contract the
 * backend accepts (`recipe.validation.js#recipeIngredientUsageSchema`, a
 * `.strict()` object):
 *   { ingredientId, unit, optional, quantity?, note? }
 * - `quantity` is included ONLY for a measurable unit (finite number > 0); for
 *   `toTaste` it is omitted entirely (the backend rejects a `toTaste` entry
 *   that carries a quantity, and normalizes an omitted/null one to "absent").
 * - `note` is included only when non-empty.
 */
export function toIngredientUsagePayload(row) {
  const entry = {
    ingredientId: row.ingredientId,
    unit: row.unit,
    optional: Boolean(row.optional),
  };
  if (row.unit !== TO_TASTE_UNIT) {
    entry.quantity = Number(row.quantity);
  }
  const note = (row.note ?? '').trim();
  if (note) entry.note = note;
  return entry;
}

/**
 * POST /api/v1/recipes (catalog.write)
 * @param {{
 *   title: string, description: string, difficulty: string,
 *   region?: string, category?: string,
 *   prepTimeMinutes: number, cookTimeMinutes: number, servings: number,
 *   ingredients: object[], instructions: string[],
 *   dietaryTags?: string[], imageUrl?: string|null, imageAssetId?: string|null,
 * }} input
 *   `ingredients` entries must already be in the `toIngredientUsagePayload`
 *   shape. Every referenced ingredient must exist and be active. `region` /
 *   `category` are optional canonical slugs — omitted entirely when blank
 *   (the API rejects an empty string).
 */
export function createRecipe({
  title,
  description,
  region,
  category,
  difficulty,
  prepTimeMinutes,
  cookTimeMinutes,
  servings,
  ingredients,
  instructions,
  dietaryTags = [],
  imageUrl = null,
  imageAssetId = null,
}) {
  const body = {
    title,
    description,
    difficulty,
    prepTimeMinutes,
    cookTimeMinutes,
    servings,
    ingredients,
    instructions,
    dietaryTags,
    imageUrl,
    imageAssetId,
  };
  if (region) body.region = region;
  if (category) body.category = category;
  return api.post('/recipes', { body }).then((data) => data.recipe);
}

/**
 * PATCH /api/v1/recipes/:id (catalog.write)
 * @param {string} id
 * @param {object} patch
 *   Strict partial update. Only the changed fields should be passed — an empty
 *   patch is rejected by the API. A provided `ingredients` / `instructions` /
 *   `dietaryTags` array REPLACES the stored one wholesale; an omitted key
 *   leaves the stored value untouched. Set `isActive: true` to restore an
 *   archived recipe (the API re-validates every stored ingredient reference
 *   first).
 */
export function updateRecipe(id, patch) {
  return api
    .patch(`/recipes/${encodeURIComponent(id)}`, { body: patch })
    .then((data) => data.recipe);
}

/**
 * DELETE /api/v1/recipes/:id (catalog.write) — soft archive, not a physical
 * delete. Returns the archived recipe (isActive: false).
 */
export function archiveRecipe(id) {
  return api.del(`/recipes/${encodeURIComponent(id)}`).then((data) => data.recipe);
}

/** Convenience wrapper over updateRecipe for restoring an archived record. */
export function restoreRecipe(id) {
  return updateRecipe(id, { isActive: true });
}

/** POST /api/v1/admin/uploads/recipe-image (recipe_image.upload, multipart field `image`). */
export function uploadRecipeImage(file) {
  const body = new FormData();
  body.append('image', file);
  return api
    .post('/admin/uploads/recipe-image', { body })
    .then((data) => data.image);
}
