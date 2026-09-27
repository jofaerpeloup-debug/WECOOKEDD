const cookHistoryRepository = require('./cook-history.repository');
const recipeService = require('../recipes/recipe.service');
const { AppError } = require('../../shared/errors/app-error');

const SORT_MAP = {
  newest: { completedAt: -1 },
  oldest: { completedAt: 1 },
};

const EMPTY_STATS = { totalCooks: 0, uniqueRecipesCooked: 0 };

function recipeNotFoundError() {
  return new AppError('Recipe not found.', { statusCode: 404, code: 'RECIPE_NOT_FOUND' });
}

// Same cross-module rule Favorites/Reviews follow: recipe eligibility is
// resolved through RecipeService only, never the Recipe model/repository
// directly. A nonexistent or archived/unusable recipe reads as
// RECIPE_NOT_FOUND either way — a cook-history event can never be recorded
// against a recipe an ordinary user couldn't otherwise see.
async function ensureUsableRecipe(recipeId) {
  const recipe = await recipeService.findUsableRecipeById(recipeId);
  if (!recipe) {
    throw recipeNotFoundError();
  }
  return recipe;
}

// Records one intentional CookMode completion for the authenticated user.
// Ownership (userId) and completion time (completedAt, via the model's
// default) are never accepted from the caller — see cook-history.validation.js
// for the strict allowlist upstream. Each call always creates a new event;
// cooking the same recipe again later is expected and produces a second,
// independent row (no uniqueness to violate, unlike Favorite/Review).
async function recordCompletion(userId, { recipeId, servings }) {
  const recipe = await ensureUsableRecipe(recipeId);

  const doc = { userId, recipeId: recipe._id };
  if (servings !== undefined) doc.servings = servings;

  const entry = await cookHistoryRepository.create(doc);
  return { entry, recipe };
}

// Paginated history for the authenticated user only — the filter is always
// { userId }, never derived from a client-supplied id. Mirrors Favorites:
// an entry whose Recipe has since become archived/unusable is omitted from
// the presented list (the underlying event is never deleted, never
// fabricated recipe details either).
async function listHistory({ userId, page, limit, sort }) {
  const filter = { userId };
  const skip = (page - 1) * limit;

  const [entries, total] = await Promise.all([
    cookHistoryRepository.findMany({ filter, sort: SORT_MAP[sort], skip, limit }),
    cookHistoryRepository.countByFilter(filter),
  ]);

  const resolved = await Promise.all(
    entries.map(async (entry) => ({
      entry,
      recipe: await recipeService.findUsableRecipeById(entry.recipeId),
    }))
  );
  const items = resolved.filter((row) => row.recipe !== null);

  return { items, total, page, limit };
}

// Stats always reflect the full event log, regardless of whether a cooked
// recipe has since become archived — a past completion happened and stays
// true even if the recipe is no longer browsable today.
async function getStats(userId) {
  const row = await cookHistoryRepository.aggregateStats(userId);
  if (!row) return EMPTY_STATS;
  return { totalCooks: row.totalCooks, uniqueRecipesCooked: row.uniqueRecipesCooked };
}

// Reusable server-authoritative eligibility predicate. Both the status route
// and review creation use the same repository query, always scoped to the
// authenticated user and the canonical recipe _id resolved by their caller.
async function hasCompletedRecipe(userId, recipeId) {
  return Boolean(await cookHistoryRepository.existsForUserAndRecipe(userId, recipeId));
}

// Backs the RecipeDetail "Cooked" pill: has THIS user ever completed THIS
// recipe, at least once? Pure existence/boolean — never a count, never
// another user's state (userId is always the authenticated caller, passed
// in by the controller). Same recipe-eligibility gate as every other
// cook-history endpoint, so a nonexistent/archived recipeId reads as
// RECIPE_NOT_FOUND rather than a fabricated `hasCooked: false` for a
// recipeId that was never valid to begin with.
async function getRecipeStatus(userId, recipeId) {
  const recipe = await ensureUsableRecipe(recipeId);
  const hasCooked = await hasCompletedRecipe(userId, recipe._id);
  return { hasCooked };
}

module.exports = {
  recordCompletion,
  listHistory,
  getStats,
  hasCompletedRecipe,
  getRecipeStatus,
};
