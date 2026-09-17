import { api } from './apiClient.js';

export function listRecipes(params = {}) {
  const {
    search, region, category, difficulty, dietaryTag, ingredientId,
    maxPrepTimeMinutes, status, sort, page, limit,
  } = params;
  return api.get('/recipes', { query: {
    search, region, category, difficulty, dietaryTag, ingredientId,
    maxPrepTimeMinutes, status, sort, page, limit,
  } }).then((data) => ({ recipes: data.recipes || [], pagination: data.pagination || null }));
}

/** Always use this fresh detail snapshot when entering edit or read-only detail. */
export function getRecipe(id) {
  return api.get(`/recipes/${encodeURIComponent(id)}`).then((data) => data.recipe);
}

/** The only Staff Portal creation path: create a title-only Draft. */
export function createDraft(body) {
  return api.post('/recipes/drafts', { body }).then((data) => data.recipe);
}

/** Strict partial content update; expectedUpdatedAt belongs in patch. */
export function updateRecipe(id, patch) {
  return api.patch(`/recipes/${encodeURIComponent(id)}`, { body: patch }).then((data) => data.recipe);
}

export function publishRecipe(id, body) {
  return api.post(`/recipes/${encodeURIComponent(id)}/publish`, { body }).then((data) => data.recipe);
}

export function archiveRecipe(id, expectedUpdatedAt) {
  const body = expectedUpdatedAt ? { expectedUpdatedAt } : {};
  return api.post(`/recipes/${encodeURIComponent(id)}/archive`, { body }).then((data) => data.recipe);
}

export function restoreRecipe(id, expectedUpdatedAt) {
  const body = expectedUpdatedAt ? { expectedUpdatedAt } : {};
  return api.post(`/recipes/${encodeURIComponent(id)}/restore`, { body }).then((data) => data.recipe);
}

export function uploadRecipeImage(file) {
  const body = new FormData();
  body.append('image', file);
  return api.post('/admin/uploads/recipe-image', { body }).then((data) => data.image);
}
