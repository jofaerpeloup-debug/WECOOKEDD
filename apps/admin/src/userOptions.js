// Frontend-safe mirror of the backend user enums used by the admin Users tab.
//
// Source of truth:
//   apps/api/src/modules/users/user.model.js       (ROLES, STATUSES)
//   apps/api/src/modules/users/user.validation.js   (SORT_VALUES)
//
// Keep these in sync with the backend — GET /api/v1/users rejects any value it
// does not recognise with a 400 VALIDATION_ERROR. When packages/contracts
// starts carrying public API contracts, this belongs there (same note as
// ingredientOptions.js / substitutionOptions.js).

// role filter — the empty value means "no role filter" (param omitted).
export const USER_ROLE_FILTERS = [
  { value: '', label: 'All roles' },
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
];

// status filter — the empty value means "no status filter" (param omitted).
// The backend status enum is active | suspended (there is no "inactive").
export const USER_STATUS_FILTERS = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
];

// sort maps to the backend `sort` list query param — a fixed named set, never
// raw Mongo sort syntax. Default (omitted) is 'newest' server-side.
export const USER_SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'nameAsc', label: 'Name (A–Z)' },
  { value: 'nameDesc', label: 'Name (Z–A)' },
];

export const ROLE_LABELS = { user: 'User', admin: 'Admin' };
export const STATUS_LABELS = { active: 'Active', suspended: 'Suspended' };