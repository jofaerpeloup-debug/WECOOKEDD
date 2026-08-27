// Substitution feature service — the single authoritative data path for
// substitution business data:
//
//   SubstitutionsTab / useSubstitutions
//     -> substitutionApi
//     -> apiClient (shared)
//     -> Express REST API (/api/v1/substitutions)
//     -> MongoDB
//
// Reads require authentication; mutations require an admin backend user (both
// enforced by the API). DELETE is a soft archive (isActive -> false). The
// public JSON uses `id` (not `_id`) and inlines each referenced ingredient as
// `{ id, name }` — internal ingredient fields (isActive, normalizedName, …)
// are never exposed. Components never see a raw Mongo id typed by hand: the
// source/substitute pickers resolve names to ids via ingredientApi.
//
// Contract reference: docs/architecture/ingredients-substitutions.md and
// docs/architecture/admin-substitutions-integration.md.

import { api } from './apiClient.js';

/**
 * GET /api/v1/substitutions
 * @param {{
 *   sourceIngredientId?: string,
 *   substituteIngredientId?: string,
 *   context?: string,
 *   status?: 'active' | 'inactive' | 'all',
 *   sort?: 'newest' | 'oldest',
 *   page?: number,
 *   limit?: number,
 * }} params
 *   status: "active" (default) | "inactive" | "all" — "inactive"/"all" are admin-only.
 * @returns {Promise<{ substitutions: object[], pagination: object|null }>}
 */
export function listSubstitutions(params = {}) {
  const { sourceIngredientId, substituteIngredientId, context, status, sort, page, limit } = params;
  return api
    .get('/substitutions', {
      query: { sourceIngredientId, substituteIngredientId, context, status, sort, page, limit },
    })
    .then((data) => ({
      substitutions: data.substitutions || [],
      pagination: data.pagination || null,
    }));
}

// GET /api/v1/substitutions/:id exists on the backend but is intentionally not
// wrapped here — the list serializer already inlines every field the table and
// the edit modal render, so this slice never needs a single-resource read.

/**
 * POST /api/v1/substitutions (admin only)
 * @param {{
 *   sourceIngredientId: string,
 *   substituteIngredientId: string,
 *   ratio: { sourceAmount: number, substituteAmount: number },
 *   contexts?: string[],
 *   notes?: string,
 * }} input
 *   Both ratio amounts must be finite numbers greater than zero. source and
 *   substitute must be different, active ingredients.
 */
export function createSubstitution({
  sourceIngredientId,
  substituteIngredientId,
  ratio,
  contexts = [],
  notes,
}) {
  const body = { sourceIngredientId, substituteIngredientId, ratio, contexts };
  // `notes` is optional in the backend schema (a strict body) — only include
  // it when the admin actually entered something.
  if (notes) body.notes = notes;
  return api.post('/substitutions', { body }).then((data) => data.substitution);
}

/**
 * PATCH /api/v1/substitutions/:id (admin only)
 * @param {string} id
 * @param {{
 *   sourceIngredientId?: string,
 *   substituteIngredientId?: string,
 *   ratio?: { sourceAmount: number, substituteAmount: number },
 *   contexts?: string[],
 *   notes?: string,
 *   isActive?: boolean,
 * }} patch
 *   Only the changed fields should be passed — an empty patch is rejected by
 *   the API. Set isActive:true to restore an archived substitution (the API
 *   re-checks that both ingredients are still active first).
 */
export function updateSubstitution(id, patch) {
  return api
    .patch(`/substitutions/${encodeURIComponent(id)}`, { body: patch })
    .then((data) => data.substitution);
}

/**
 * DELETE /api/v1/substitutions/:id (admin only) — soft archive, not a physical
 * delete. Returns the archived substitution (isActive: false).
 */
export function archiveSubstitution(id) {
  return api.del(`/substitutions/${encodeURIComponent(id)}`).then((data) => data.substitution);
}

/** Convenience wrapper over updateSubstitution for restoring an archived record. */
export function restoreSubstitution(id) {
  return updateSubstitution(id, { isActive: true });
}