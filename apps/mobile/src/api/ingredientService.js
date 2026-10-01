// Ingredient feature service for the mobile app — a read-only canonical
// ingredient lookup, used by the Shopping List manual-add picker:
//
//   IngredientPickerModal
//     -> ingredientService
//     -> api (src/api/client.js — shared, UNCHANGED)
//     -> Express REST API (/api/v1/ingredients)
//     -> MongoDB
//
// Reads require authentication; the shared client attaches the bearer token and
// performs one transparent refresh+retry. This module never calls `fetch`,
// never touches the token store, never sends `status` (the backend defaults it
// to "active" and 403s a non-admin caller that asks for archived), and never
// creates/edits an ingredient — mobile is strictly read-only against the
// Ingredient domain. There are NO local/free-text ingredients: every id handed
// to the Shopping List comes from this endpoint.
//
// Contract reference: apps/api/src/modules/ingredients/ingredient.validation.js
// (listIngredientsSchema) and docs/architecture/mobile-shopping-list-manual-add.md.

import { api } from './client';

// The backend caps `limit` at 100 and defaults it to 20; the picker only needs
// a short first page of matches.
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;

function normalizeIngredient(raw) {
  const r = raw || {};
  return {
    id: r.id != null ? String(r.id) : null,
    name: typeof r.name === 'string' ? r.name : '',
    category: typeof r.category === 'string' ? r.category : null,
    aliases: Array.isArray(r.aliases) ? r.aliases.filter((a) => typeof a === 'string') : [],
  };
}

function ingredientSearchQuery({ search, limit = DEFAULT_SEARCH_LIMIT } = {}) {
  const query = {};

  const trimmed = typeof search === 'string' ? search.trim() : '';
  if (trimmed) query.search = trimmed;

  const safeLimit = Number.isFinite(limit)
    ? Math.min(Math.max(1, Math.trunc(limit)), MAX_SEARCH_LIMIT)
    : DEFAULT_SEARCH_LIMIT;
  query.limit = safeLimit;

  return query;
}

function malformedIngredientSearchResponse() {
  return new Error('The Ingredient search response was malformed.');
}

function normalizeStrictIngredient(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw malformedIngredientSearchResponse();
  }

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!id || !name) {
    throw malformedIngredientSearchResponse();
  }

  return {
    id,
    name,
    category: typeof raw.category === 'string' ? raw.category : null,
    aliases: Array.isArray(raw.aliases)
      ? raw.aliases.filter((alias) => typeof alias === 'string')
      : [],
  };
}

/**
 * GET /api/v1/ingredients
 * Canonical ingredient search. The backend matches `search` as an
 * escaped, case-insensitive substring against name OR aliases and returns
 * ACTIVE ingredients only for a normal user, so every result is safe to add.
 *
 * `search` is trimmed here; a blank/whitespace-only query is NOT sent (the
 * backend rejects `search=""` with 400) — callers should skip the call
 * entirely for an empty query, but this is a safety net.
 *
 * @param {{ search?: string, limit?: number }} [params]
 * @returns {Promise<{ ingredients: Array<{ id: string|null, name: string, category: string|null, aliases: string[] }>, pagination: { page, limit, total, totalPages } | null }>}
 */
export function searchIngredients({ search, limit = DEFAULT_SEARCH_LIMIT } = {}) {
  const query = ingredientSearchQuery({ search, limit });

  return api.get('/ingredients', { query }).then((data) => ({
    ingredients: Array.isArray(data && data.ingredients)
      ? data.ingredients.map(normalizeIngredient).filter((i) => i.id && i.name)
      : [],
    pagination: (data && data.pagination) || null,
  }));
}

/**
 * DISC4's fail-closed canonical search boundary. Unlike the legacy helper
 * above, this rejects a successful response unless it contains the real
 * Ingredient array and every candidate has a nonblank public string id and
 * name. Rejecting the whole payload prevents malformed records from being
 * misrepresented as a legitimate empty search result.
 */
export function searchIngredientsStrict({ search, limit = DEFAULT_SEARCH_LIMIT } = {}) {
  const query = ingredientSearchQuery({ search, limit });

  return api.get('/ingredients', { query }).then((data) => {
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.ingredients)) {
      throw malformedIngredientSearchResponse();
    }

    return {
      ingredients: data.ingredients.map(normalizeStrictIngredient),
      pagination: data.pagination || null,
    };
  });
}
