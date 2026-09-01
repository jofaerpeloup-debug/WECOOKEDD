# Admin Users backend API (Phase A)

Backend-only slice: adds admin user-management endpoints to `apps/api`. It is
the prerequisite for the separate Phase B work that migrates the admin app's
Users tab off Firestore. **No frontend was touched in this slice.**

> **B1 update (sole-admin role immutability).** `PATCH /api/v1/users/:userId`
> no longer accepts `role` — the writable body is now `{ status }` only. `role`
> stays fully readable (in every response, and as a `GET /api/v1/users` filter)
> but is not mutable by any runtime application API. See
> [§ Role is read-only](#role-is-read-only-b1) below; the sections further down
> are annotated where B1 changed them.

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
  `authIdentities`, `preferences` / `allergies` / `dietaryPreferences` (user-
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

### Body (strict Zod schema — `user.validation.js#updateUserSchema`) — B1

```
{ status: 'active' | 'suspended' }
```

- `.strict()`, and `status` is **required**. Every other field is a
  `400 VALIDATION_ERROR` — explicitly including `role` (see below), and
  `name`, `email`, `password`, `passwordHash`, `emailVerified`, `preferences`,
  `allergies`, `authIdentities`, legacy `authProviders`, `createdAt`,
  `updatedAt`, `_id`, `id`.
- A body that carries `role` (with or without a valid `status`) is rejected
  **before the controller runs** — the `status` change in such a request is
  never applied.
- **No admin profile editing in this slice.** Name moderation, if ever
  required, is a separate, separately-justified change.

<a id="role-is-read-only-b1"></a>

### Role is read-only (B1)

`role` (`user | admin`) is a valid `User` field and is:

- **returned** in every admin user response (`toAdminUserSummary` — unchanged),
- **usable as a filter**: `GET /api/v1/users?role=user|admin` (`listUsersSchema`
  keeps `role`).

It is **not writable** by any runtime application API:

- Registration hard-defaults `role: 'user'` and its body is `.strict()` — a
  client cannot set `role` (unchanged since Phase A).
- `PATCH /api/v1/users/me` never accepted `role`.
- `PATCH /api/v1/users/:userId` no longer accepts `role` (B1).
- `adminUpdateUser` additionally builds a **status-only `$set`** — it never
  forwards `patch` verbatim — so a direct in-process caller that passes a
  `role` key still cannot write it (defense in depth; the `role` key is
  silently dropped, and a patch with no writable field is a
  `400 VALIDATION_ERROR`).

There is therefore **no generic promote/demote capability** and no runtime path
that can create a second admin. Role mutation is not supported by any runtime
application API; any exceptional maintenance is outside the application
workflow. A future dedicated "transfer admin ownership" feature is a separate,
out-of-scope design.

### Response

`200 { success: true, data: { user: toAdminUserSummary(updated) } }` — same
safe projection as the list (still carries `role`).

## Self-protection

Enforced in the service (frontend disabled controls are not sufficient). When
`req.auth.userId === :userId`:

| Attempt | Result |
| --- | --- |
| `status` → anything other than `active` | `403` `ADMIN_CANNOT_MODIFY_SELF` |
| `status: 'active'` on self (harmless no-op) | allowed |

`ADMIN_CANNOT_MODIFY_SELF` (`403` — the `FORBIDDEN` family) now covers only the
self-suspension case. Self-demotion is no longer a case at all: **B1** removed
`role` from the writable body, so an admin cannot change anyone's role,
themselves included, and a `role` key is a `400 VALIDATION_ERROR` before the
self-check is reached.

### Last active admin

**Not implemented, and no longer needed for the demotion case.**

- **B1** removed the only runtime role-mutation path: there is no promote or
  demote through the application, so no runtime flow can reduce the admin
  count. The "two admins concurrently demoting each other → zero active admins"
  race that Phase A documented **no longer exists** — there is no demote
  operation to race.
- Self-suspension protection still keeps ≥ 1 *active* admin in every
  non-concurrent sequence: a PATCH by admin *X* suspending admin *Y* requires
  *X* to still be an active admin (re-checked from the DB by
  `authenticate`/`authorize`), and *X* cannot suspend *X*.
- The only residual path to zero *active* admins is two admins **concurrently
  suspending each other**. A count-before-update check is two non-atomic
  operations and does not close that race; this deployment is standalone
  MongoDB (no multi-document transactions). No `LAST_ADMIN` guard,
  transactions, locks, or Mongo unique-index trick were introduced — the
  senior review concluded the surface is not worth the near-zero real
  protection.

Recovery from that residual (or from a lost sole admin) is an exceptional
maintenance operation outside the normal application workflow — there is no
admin-provisioning or ownership-transfer endpoint. A future dedicated
"transfer admin ownership" feature is a separate, out-of-scope design.

## Session ↔ status transition ordering (security-critical)

Cross-module revocation goes through `SessionService.revokeAllSessionsForUser`
**only**. The users module does not import the `Session` model or repository.
`revokeAllSessionsForUser` already existed — no change to `SessionService` was
needed.

| Transition | Order | Rationale |
| --- | --- | --- |
| **active → suspended** | 1. atomically persist `status: 'suspended'` and clear B3 reset credentials &nbsp; 2. revoke all sessions | Once `suspended` is committed, `login` throws `AUTH_ACCOUNT_SUSPENDED`, `refresh` refuses to rotate, and a pre-suspension reset token cannot spring back after reactivation. If revocation throws, the error propagates but the user **stays suspended** with the reset credential cleared — **no rollback**. |
| **suspended → active** | 1. revoke all sessions &nbsp; 2. only then persist `status: 'active'` | A user must never regain a session that an earlier failed suspension (or a login race) left unrevoked. This runs while the user is still `suspended`, so nothing can mint a session in parallel. If revocation throws, the error propagates and the user is **NOT reactivated** (stays `suspended`). |
| **active → active** | no session action | Harmless no-op; a healthy user keeps their session. |

(Pre-B1 this table also had `role-only` and `combined role + status` rows.
Since B1, `status` is the only writable field, so those cases no longer exist.)

A `status: 'suspended'` PATCH on an already-suspended user also clears reset
credentials and re-runs the revoke—a cheap, idempotent mop-up if an earlier
suspension's session sweep had failed. The `$unset` is server-owned; the strict
B1 request body remains `{ status }`, and role immutability is unchanged.

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
| Self-promotion / any promotion | ❌ registration is `.strict()` and hard-codes `role:"user"`; `PATCH /users/me` never accepted `role`; `PATCH /users/:userId` no longer accepts `role` (B1) and the service writes a status-only `$set` |
| Existing auth middleware weakened | ❌ not touched |

**Verdict: no IDOR/BOLA, no privilege-escalation path.** The one residual risk
(concurrent mutual admin *suspension* → availability only) is documented above.
Since B1 there is no runtime role-mutation path at all.

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
| Validation | `user.validation.js` | strict query & body/param schemas; sort allow-list; `status`-only writable PATCH body (B1) |
| Controller | `user.controller.js` | HTTP in/out + pagination envelope only — no rules |
| Service | `user.service.js` | self-protection, writable-field allow-list (status-only `$set`), status-transition logic, `SessionService` orchestration, filter/sort/skip construction, `USER_NOT_FOUND` |
| Repository | `user.repository.js` | `findMany` / `countByFilter` / `updateById` — query mechanics only |
| Serializer | `user.serializer.js` | `toAdminUserSummary` — explicit safe projection |

No DI container, repository interfaces, factories, CQRS, or event bus were
added (consistent with `backend.md`).

## Phase B (separate)

The admin frontend migration (Firestore `users` → these endpoints:
`userApi.js`, `userOptions.js`, `UsersTab.jsx`, removal of the Firestore user
helpers) is a **separate PR** and is not part of this slice.
