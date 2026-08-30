// User feature service — the single authoritative data path for admin
// user-management business data:
//
//   UsersTab / useUsers
//     -> userApi
//     -> apiClient (shared)
//     -> Express REST API (/api/v1/users)
//     -> MongoDB
//
// Admin-only: GET /api/v1/users and PATCH /api/v1/users/:userId both require an
// admin backend user (enforced by the API — authorize('admin') on the route).
// The serializer returns `id` (never `_id`) and a deliberately narrow shape:
// { id, name, email, role, status, emailVerified, createdAt, updatedAt } — no
// preferences / allergies (user-private, not relevant to role/status
// management). PATCH accepts ONLY { role?, status? }; every other field is a
// 400 VALIDATION_ERROR. There is no create, no delete, and no GET-by-id.
//
// Contract reference: docs/architecture/admin-users-backend-api.md and
// docs/architecture/admin-users-integration.md. There is ZERO Firestore
// involvement in this path.

import { api } from './apiClient.js';

// page / limit must reach the backend as finite positive integers or not at
// all. The list query schema coerces with `z.coerce.number().int().min(1)`, so
// a stray NaN (Number(undefined), Number('')) becomes NaN and the API answers
// 400 VALIDATION_ERROR. Anything that is not a positive integer is dropped here
// so the backend default (page 1 / limit 20) applies instead.
function toPosInt(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

/**
 * GET /api/v1/users (admin only)
 * @param {{
 *   search?: string,
 *   role?: 'user' | 'admin',
 *   status?: 'active' | 'suspended',
 *   sort?: 'newest' | 'oldest' | 'nameAsc' | 'nameDesc',
 *   page?: number | string,
 *   limit?: number | string,
 * }} params
 * @returns {Promise<{ users: object[], pagination: object|null }>}
 *   pagination: { page, limit, total, totalPages }
 */
export function listUsers(params = {}) {
  const { search, role, status, sort, page, limit } = params;
  return api
    .get('/users', {
      query: {
        // apiClient's buildUrl drops undefined / null / '' — so the empty-string
        // "All" sentinel for search / role / status, and an omitted sort, are
        // simply not sent.
        search,
        role,
        status,
        sort,
        page: toPosInt(page),
        limit: toPosInt(limit),
      },
    })
    .then((data) => ({
      users: data.users || [],
      pagination: data.pagination || null,
    }));
}

/**
 * PATCH /api/v1/users/:userId (admin only)
 * @param {string} userId
 * @param {{ role?: 'user' | 'admin', status?: 'active' | 'suspended' }} patch
 *   Strict body — at least one of role / status, nothing else. The backend owns
 *   every policy decision: self-demotion / self-suspension is
 *   403 ADMIN_CANNOT_MODIFY_SELF, and suspend / reactivate session revocation
 *   ordering is handled server-side.
 * @returns {Promise<object>} the updated user summary
 */
export function updateUser(userId, patch) {
  return api
    .patch(`/users/${encodeURIComponent(userId)}`, { body: patch })
    .then((data) => data.user);
}

// Convenience wrappers over updateUser. Account status only — Admin Users V1
// deliberately does not expose role mutation, so no promote/demote wrapper
// exists here even though `updateUser` (and the backend PATCH) still accept
// `role`.
export const suspendUser = (userId) => updateUser(userId, { status: 'suspended' });
export const reactivateUser = (userId) => updateUser(userId, { status: 'active' });