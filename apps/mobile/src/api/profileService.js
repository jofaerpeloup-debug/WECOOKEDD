// Self-profile write path for the mobile app — the single place the signed-in
// user's own `name` / `preferences` are persisted:
//
//   ProfileScreen / AccountDetailScreen / NotificationsScreen
//     -> profileService.updateProfile
//     -> api (src/api/client.js — shared, UNCHANGED)
//     -> Express REST API (PATCH /api/v1/users/me)
//     -> MongoDB
//
// The call requires authentication; the shared client already attaches the
// bearer access token and performs one transparent refresh+retry. This module
// never calls `fetch`, never touches the token store, and never sends a userId
// — the backend derives ownership from the authenticated identity and its
// strict Zod schema rejects `id` / `email` / `role` / `status` outright.
//
// Reads stay in authService (`fetchCurrentUser` -> `GET /users/me`); this
// module is write-only. Contract: docs/architecture/self-profile-backend-api.md
// and docs/architecture/mobile-self-profile-integration.md.

import { api } from './client';

/**
 * PATCH /api/v1/users/me
 * @param {{
 *   name?: string,
 *   preferences?: {
 *     dietaryPreferences?: string[],
 *     allergies?: string[],
 *     notifications?: { enabled: boolean },
 *   },
 * }} patch  A pre-built, allow-listed body. Only the leaves present are
 *   written; a supplied array (including `[]`) replaces that array wholesale;
 *   an omitted leaf is left untouched by the backend.
 * @returns {Promise<object>} the authoritative updated public user — the same
 *   shape `GET /users/me` returns (`toPublicUser`). The shared client already
 *   unwraps the `{ success, data }` envelope, so this reads `data.user`.
 */
export function updateProfile(patch) {
  return api.patch('/users/me', { body: patch }).then((data) => data.user);
}
