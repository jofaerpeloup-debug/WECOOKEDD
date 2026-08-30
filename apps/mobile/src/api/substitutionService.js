// Substitution feature service for the mobile app — a READ-ONLY "what can I use
// instead of this ingredient?" lookup, consumed only by the API Recipe Detail
// ingredient rows:
//
//   ApiRecipeDetail ingredient row
//     -> SubstitutionsSheet
//     -> substitutionService.getSubstitutesFor(sourceIngredientId)
//     -> api (src/api/client.js — shared, UNCHANGED)
//     -> Express REST API (GET /api/v1/substitutions)
//     -> MongoDB
//
// Reads require authentication; the shared client attaches the bearer access
// token and performs one transparent refresh+retry. This module never calls
// `fetch`, never touches the token store, and is strictly read-only against the
// Substitution domain — there is no create/update/archive wrapper.
//
// It NEVER sends:
//   - `status`  — the backend defaults it to "active" and 403s a non-admin that
//                 asks for "inactive"/"all", so archived rows are already hidden.
//   - `userId` / any ownership field — substitutions are global catalog data
//                 with no owner, and the backend body/query schema is `.strict()`.
//
// The relationship is DIRECTED: `?sourceIngredientId=X` returns the rows whose
// source is X — i.e. "things you can use instead of X" — which is exactly the
// recipe use case. The reverse direction (`substituteIngredientId=X`) is a
// different query and is not used here.
//
// `ratio` (ratio.sourceAmount / ratio.substituteAmount) IS present in the raw
// backend response but is deliberately DROPPED in `normalizeSubstitution`: the
// backend attaches no replacement-unit semantics to it, so surfacing it could
// mislead a user into assuming an unsupported "1 cup X = 0.75 cup Y" quantity
// equivalence. See docs/architecture/mobile-substitutions-integration.md.
//
// Contract reference: docs/architecture/ingredients-substitutions.md and
// docs/architecture/mobile-substitutions-integration.md. Zero Firestore involvement.

import { ApiError, api } from './client';

// The backend caps `limit` at 100 and defaults it to 20. A single canonical
// ingredient realistically has only a handful of substitutes (the unique
// {source, substitute} index caps the count at ingredientCount - 1), so ONE
// page of 100 covers V1 with no pagination logic and sidesteps the documented
// `pagination.total` overcount — the UI renders the returned array, never `total`.
const FETCH_LIMIT = 100;

// A 24-character hex string: the exact shape of a Mongo ObjectId as serialized
// by every WeCooked API response. API Recipe ingredient ids always arrive in
// this shape; legacy/mock recipe ids ("r4") and mock swap ids ("s1") never do.
// This is the last line of defense on top of the call-site guards — a
// non-canonical id must NEVER reach GET /api/v1/substitutions.
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export function isCanonicalIngredientId(value) {
  return typeof value === 'string' && OBJECT_ID_RE.test(value.trim());
}

function missingIdError() {
  return new ApiError('A valid ingredient is required to look up substitutes.', {
    kind: 'api',
    code: 'VALIDATION_ERROR',
    status: 400,
    details: [
      { field: 'sourceIngredientId', message: 'A canonical ingredient id is required.' },
    ],
  });
}

// Maps one raw PublicSubstitution to the minimal shape the sheet renders.
// `ratio` is intentionally not carried through (see the header note).
function normalizeSubstitution(raw) {
  const r = raw || {};
  const sub = r.substituteIngredient || null;
  const id = sub && sub.id != null ? String(sub.id) : null;
  const name = sub && typeof sub.name === 'string' ? sub.name : '';

  return {
    id: r.id != null ? String(r.id) : null,
    substitute: id && name ? { id, name } : null,
    notes: typeof r.notes === 'string' && r.notes.trim() ? r.notes.trim() : null,
    contexts: Array.isArray(r.contexts)
      ? r.contexts.filter((c) => typeof c === 'string' && c.trim()).map((c) => c.trim())
      : [],
  };
}

/**
 * GET /api/v1/substitutions?sourceIngredientId=<id>&limit=100
 *
 * "What can I use instead of this ingredient?" — a directed, server-filtered
 * lookup keyed on canonical Ingredient identity, never on ingredient name text.
 *
 * @param {string} sourceIngredientId  a canonical backend Ingredient id (24-hex
 *   ObjectId string, exactly as it appears in a PublicRecipe ingredient row).
 *   REQUIRED. A missing / blank / non-canonical value REJECTS with an ApiError
 *   (code VALIDATION_ERROR) and issues NO request — an unfiltered
 *   GET /api/v1/substitutions must never happen.
 * @returns {Promise<{ substitutes: Array<{
 *   id: string | null,
 *   substitute: { id: string, name: string } | null,
 *   notes: string | null,
 *   contexts: string[],
 * }> }>}
 *   The backend already excludes archived substitutions and any relation whose
 *   source OR substitute ingredient is archived for a non-admin caller; this
 *   also drops any row missing a usable substitute ingredient, defensively.
 */
export function getSubstitutesFor(sourceIngredientId) {
  const trimmed = typeof sourceIngredientId === 'string' ? sourceIngredientId.trim() : '';
  if (!isCanonicalIngredientId(trimmed)) {
    return Promise.reject(missingIdError());
  }

  return api
    .get('/substitutions', { query: { sourceIngredientId: trimmed, limit: FETCH_LIMIT } })
    .then((data) => ({
      substitutes: Array.isArray(data && data.substitutions)
        ? data.substitutions.map(normalizeSubstitution).filter((s) => s.substitute)
        : [],
    }));
}