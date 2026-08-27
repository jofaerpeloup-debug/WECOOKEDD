// Frontend-safe mirror of the backend substitution enums and limits.
//
// Source of truth:
//   apps/api/src/modules/substitutions/substitution.model.js
//     (MAX_CONTEXTS, MAX_CONTEXT_LENGTH, MAX_NOTES_LENGTH)
//   apps/api/src/modules/substitutions/substitution.validation.js
//     (status / sort enums, ratio rules)
//
// Keep these in sync with the backend — the API rejects any value it does not
// recognise with a 400 VALIDATION_ERROR. When packages/contracts starts
// carrying public API contracts, this belongs there (same note as
// ingredientOptions.js).

// status maps to the backend `status` list query param. "inactive" and "all"
// are admin-only server-side — fine here because the whole dashboard is
// admin-gated.
export const SUBSTITUTION_STATUS_FILTERS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Archived' },
  { value: 'all', label: 'All' },
];

// sort maps to the backend `sort` list query param. The ingredient-only
// nameAsc/nameDesc values are NOT valid here (substitutions have no name).
export const SUBSTITUTION_SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
];

// Mirrors substitution.model.js. Used only for client-side UX validation —
// the backend remains authoritative.
export const MAX_CONTEXTS = 10;
export const MAX_CONTEXT_LENGTH = 40;
export const MAX_NOTES_LENGTH = 500;