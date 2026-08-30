# Admin Users backend API (Phase A)

Backend-only slice: adds admin user-management endpoints to `apps/api`. It is
the prerequisite for the separate Phase B work that migrates the admin app's
Users tab off Firestore. **No frontend was touched in this slice.**

See [backend.md](./backend.md) for the layered request-flow conventions and
[authentication-security.md](./authentication-security.md) for the
auth/session model this builds on. Prior analysis: the read-only audit, the
senior architecture/security review, and the session-status follow-up (all
concluded before implementation).

Data path:

```
Admin (Phase B)  ->  REST  ->  authenticate -> authorize('admin') -> validate
                              -> user.controller -> user.service
                              -> user.repository -> User model
                              -> user.serializer (toAdminUserSummary)
```

## Endpoint surface (locked)

Only two endpoints. `GET /api/v1/users/:userId` was **deliberately not added** —
the list serializer already returns the complete user record, so a
single-resource read adds nothing the Phase B edit UI needs (same decision as
the Recipes / Substitutions slices).

| Method | Route | Auth | Admin |
| --- | --- | --- | --- |
| `GET` | `/api/v1/users` | required | required |
| `PATCH` | `/api/v1/users/:userId` | required | required |

`GET /api/v1/users/me` is unchanged and still `authenticate`-only. It is
declared before `/:userId` so it can never be shadowed.

### Middleware order

`authenticate` → `authorize('admin')` → `validate(schema)` → controller. This
matches every existing mutating route. `authorize('admin')` is on the route
itself (unlike `GET /ingredients` / `GET /recipes`, readable by any
authenticated user) — listing and mutating users is admin-only. A non-admin
therefore gets `403 FORBIDDEN` before any query/body parsing.

## Admin authorization

- Caller authority is `req.auth.role`, set by `authenticate` from a **fresh
  MongoDB read of the `User`** on every request — never from the JWT claim.
- A role change takes effect on the target's very next request with no session
  action, because `authenticate` reloads role/status from the database each
  call. A demoted admin holding a still-valid access token that claims
  `role: "admin"` is rejected with `403 FORBIDDEN`.
- `:userId` is **target identity only**. It is never a source of authority and
  is never treated as an ownership claim. The self-check compares
  `req.auth.userId` (authenticated) against the validated `:userId`.

## `GET /api/v1/users`

### Query (strict Zod schema — `user.validation.js#listUsersSchema`)

| Param | Rule | Default |
| --- | --- | --- |
| `page` | integer ≥ 1 (coerced) | `1` |
| `limit` | integer 1–100 (coerced) | `20` |
| `search` | trimmed string, 1–100 chars | — |
| `role` | `user` \| `admin` (the actual `User` role enum) | — |
| `status` | `active` \| `suspended` (the actual `User` status enum) | — |
| `sort` | `newest` \| `oldest` \| `nameAsc` \| `nameDesc` (explicit allow-list) | `newest` |

`.strict()` → any unknown parameter (`?isActive`, `?sortBy`, `?limit[]`) is a
`400 VALIDATION_ERROR`.

### Search & sort

- `search` matches **name or email only**, case-insensitive substring. The
  value is passed through `escapeRegex` before `new RegExp(...)`, so regex
  metacharacters are literal — no ReDoS, no injected pattern syntax. The
  filter is assembled field-by-field in the service; nothing from the request
  is ever spread into a Mongo query object, so a Mongo operator cannot be
  injected.
- `sort` maps to a fixed sort object with `_id` as a **deterministic
  tiebreaker** (`newest → { createdAt: -1, _id: -1 }`, etc.), so pagination is
  stable even when the primary key is equal across documents.

### Response (existing envelope + pagination convention)

```jsonc
{
  "success": true,
  "data": {
    "users": [ /* toAdminUserSummary */ ],
    "pagination": { "page": 1, "limit": 20, "total": 137, "totalPages": 7 }
  }
}
```

### Serialized user shape — `user.serializer.js#toAdminUserSummary`

```jsonc
{
  "id": "665f…",            // String(_id) — never exposed as _id
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "role": "user",
  "status": "active",
  "emailVerified": false,
  "createdAt": "2026-01-02T03:04:05.000Z",
  "updatedAt": "2026-02-02T03:04:05.000Z"
}
```

- **Never serialized:** `passwordHash` (model `select: false`; no admin-users
  query opts back in — the digest is not even in the result set),
  `authProviders`, `preferences` / `allergies` / `dietaryPreferences` (user-
  private, no bearing on role/status management — data minimisation), `__v`,
  `_id`.
- The projection is built field-by-field, so a raw Mongoose document with
  extra fields still cannot leak them.
- `toPublicUser` (used by `GET /users/me` and the auth responses) is
  unchanged and still returns `preferences` — that is the caller's own data,
  which is correct for the self view.

## `PATCH /api/v1/users/:userId`

Pure administrative-authority endpoint. It cannot mutate any user-owned
profile data.

### Path

`:userId` — strict `ObjectId` validation (`shared/validation/object-id.js`).
Malformed → `400 VALIDATION_ERROR`.

### Body (strict Zod schema — `user.validation.js#updateUserSchema`)

```
{ role?: 'user' | 'admin', status?: 'active' | 'suspended' }
```

- `.strict()` + at-least-one-field. Every other field is a
  `400 VALIDATION_ERROR`, explicitly including `name`, `email`, `password`,
  `passwordHash`, `emailVerified`, `preferences`, `allergies`,
  `authProviders`, `createdAt`, `updatedAt`, `_id`, `id`.
- **No admin profile editing in this slice.** Name moderation, if ever
  required, is a separate, separately-justified change.

### Response

`200 { success: true, data: { user: toAdminUserSummary(updated) } }` — same
safe projection as the list.

## Self-protection

Enforced in the service (frontend disabled controls are not sufficient). When
`req.auth.userId === :userId`:

| Attempt | Result |
| --- | --- |
| `role` → anything other than `admin` | `403` `ADMIN_CANNOT_MODIFY_SELF` |
| `status` → anything other than `active` | `403` `ADMIN_CANNOT_MODIFY_SELF` |
| `role: 'admin'` / `status: 'active'` on self (harmless no-op) | allowed |

One stable code (`ADMIN_CANNOT_MODIFY_SELF`, `403` — the `FORBIDDEN` family)
covers both the self-demotion and the self-suspension case.

### Last active admin

**Not implemented.** The senior review concluded a `LAST_ADMIN` guard adds
test/code surface for near-zero real protection:

- Self-protection already keeps ≥ 1 active admin in every non-concurrent
  sequence — any PATCH by admin *X* on admin *Y* requires *X* to still be an
  active admin (re-checked from the DB by `authenticate`/`authorize` on that
  request), and *X* cannot remove *X*.
- The only residual path to zero active admins is two admins **concurrently**
  demoting/suspending each other. A count-before-update check is two
  non-atomic operations and does **not** close that race, and this deployment
  is standalone MongoDB (no multi-document transactions).

Residual limitation, documented rather than papered over: concurrent mutual
demotion of the last two admins can leave zero active admins. Recovery is a
direct database update — the same channel that provisions admins in the first
place (there is no admin-provisioning endpoint). No transactions / locks /
Redis were introduced.

## Session ↔ status transition ordering (security-critical)

Cross-module revocation goes through `SessionService.revokeAllSessionsForUser`
**only**. The users module does not import the `Session` model or repository.
`revokeAllSessionsForUser` already existed — no change to `SessionService` was
needed.

| Transition | Order | Rationale |
| --- | --- | --- |
| **active → suspended** | 1. persist `status: 'suspended'` &nbsp; 2. revoke all sessions | Once `suspended` is committed, `login` throws `AUTH_ACCOUNT_SUSPENDED` and `refresh` refuses to rotate, so the sweep is race-free. If revocation throws, the error propagates but the user **stays suspended** (current `User.status` is authoritative for `authenticate`/`refresh` regardless) — **no rollback**. |
| **suspended → active** | 1. revoke all sessions &nbsp; 2. only then persist `status: 'active'` | A user must never regain a session that an earlier failed suspension (or a login race) left unrevoked. This runs while the user is still `suspended`, so nothing can mint a session in parallel. If revocation throws, the error propagates and the user is **NOT reactivated** (stays `suspended`). |
| **active → active** | no session action | Harmless no-op; a healthy user keeps their session. |
| **role-only change** | no session action | Effective on the next request via `authenticate`'s live DB read. |
| **combined role + status** | same rules, keyed on the previous status and the target status; role and status are written in one `$set` | Ordering stays correct whether the status is going up or down. |

A `status: 'suspended'` PATCH on an already-suspended user also re-runs the
revoke — a cheap, idempotent mop-up if an earlier suspension's revoke had
failed.

Access tokens need no separate blocklist: once a session's `revokedAt` is
set, any outstanding JWT for that session fails `authenticate` on its next use
within one request cycle.

## IDOR / BOLA / privilege-escalation

| Check | Result |
| --- | --- |
| Caller authority from authenticated DB-backed `req.auth.role` only | ✅ |
| Normal user can list or mutate users | ❌ `403 FORBIDDEN` (route-level `authorize('admin')`) |
| `:userId` used as an ownership/authority signal | ❌ target identity only |
| Client-supplied ownership field | ❌ none accepted (`.strict()` body) |
| Malformed target id | `400 VALIDATION_ERROR` |
| Valid but missing target id | `404 USER_NOT_FOUND` |
| Self-promotion without admin authorization | ❌ registration is `.strict()` and hard-codes `role:"user"`; there is no `PATCH /users/me`; `PATCH /users/:userId` requires `authorize('admin')` |
| Existing auth middleware weakened | ❌ not touched |

**Verdict: no IDOR/BOLA, no privilege-escalation path.** The one residual risk
(concurrent mutual admin demotion → availability only) is documented above.

## Error codes

Reuses existing conventions. New codes: `USER_NOT_FOUND` (404, mirrors
`INGREDIENT_NOT_FOUND` / `RECIPE_NOT_FOUND`) and `ADMIN_CANNOT_MODIFY_SELF`
(403). Everything else is existing: `VALIDATION_ERROR`, `FORBIDDEN`,
`AUTH_TOKEN_MISSING` / `AUTH_TOKEN_INVALID` / `AUTH_SESSION_INVALID`,
`AUTH_REFRESH_TOKEN_INVALID`, `RATE_LIMIT_EXCEEDED`, `INTERNAL_SERVER_ERROR`.
Raw Mongo/Mongoose internals are never exposed — a revocation-store failure
surfaces as the generic `500 INTERNAL_SERVER_ERROR`.

## Layering

| Layer | File | Responsibility |
| --- | --- | --- |
| Route | `user.routes.js` | verb+path → `authenticate` → `authorize('admin')` → `validate` → controller |
| Validation | `user.validation.js` | strict query & body/param schemas; sort allow-list |
| Controller | `user.controller.js` | HTTP in/out + pagination envelope only — no rules |
| Service | `user.service.js` | self-protection, status-transition logic, `SessionService` orchestration, filter/sort/skip construction, `USER_NOT_FOUND` |
| Repository | `user.repository.js` | `findMany` / `countByFilter` / `updateById` — query mechanics only |
| Serializer | `user.serializer.js` | `toAdminUserSummary` — explicit safe projection |

No DI container, repository interfaces, factories, CQRS, or event bus were
added (consistent with `backend.md`).

## Phase B (separate)

The admin frontend migration (Firestore `users` → these endpoints:
`userApi.js`, `userOptions.js`, `UsersTab.jsx`, removal of the Firestore user
helpers) is a **separate PR** and is not part of this slice.
