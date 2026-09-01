# Self-Profile & Preferences — Backend API (Phase A)

Status: implemented on `feat/api-self-profile-preferences` (not yet merged).
Companion slice: **Phase B** (mobile migration) — not started, boundary noted at the end.

## Purpose

The `User` schema already stores `name` and `preferences` (dietary preferences,
allergies, a single notifications toggle), and `GET /api/v1/users/me` already
returns them. There was no way for a signed-in user to **write** their own
profile data — the admin `PATCH /api/v1/users/:userId` is role/status only and
admin-gated. Phase A adds exactly that missing self-write path and nothing else.

## Endpoint

```
PATCH /api/v1/users/me
```

### Middleware (in order)

```
authenticate
validate(updateCurrentUserSchema)
userController.updateCurrentUser
```

No `authorize('admin')`. Any **active** authenticated user — ordinary or admin —
may edit their own `name`/`preferences`. Admin role/status management stays
exclusively on `PATCH /api/v1/users/:userId`.

### Route ordering (required)

Declared **before** `PATCH /:userId` in `user.routes.js`:

```
GET   /me
PATCH /me      <-- new
GET   /
PATCH /:userId
```

If `PATCH /me` were declared after `PATCH /:userId`, the `:userId` param route
would capture `me`: a normal user would hit `authorize('admin')` and get
`403 FORBIDDEN`; an admin would reach the ObjectId param validator and get
`400 VALIDATION_ERROR` ("Invalid id."). A route test asserts a `role: 'user'`
caller receives `200` from `PATCH /users/me`, which fails if the ordering
regresses.

## Ownership / IDOR

The mutation target is **only** `req.auth.userId`, which `authenticate` derives
from the session (`session.userId`, DB-verified against the token's `sub`) and
sets as `String(user._id)` — canonical, never client-influenced. There is no
`:userId` path param and no `userId` body key (the strict schema rejects one),
so no request field can redirect the write. Zero IDOR surface.

Suspended / revoked principals never reach the controller — `authenticate`
returns `401 AUTH_SESSION_INVALID` first (`user.status !== 'active'`).

## Request body

```jsonc
{
  "name": "string",                 // optional
  "preferences": {                   // optional
    "dietaryPreferences": ["string"], // optional
    "allergies": ["string"],          // optional
    "notifications": {                // optional
      "enabled": true                 // REQUIRED when `notifications` is present
    }
  }
}
```

### Strict allow-list

The `body`, `preferences`, and `notifications` objects are all Zod `.strict()`.
Any other key is a `400 VALIDATION_ERROR`, not a silently-dropped field. This
blocks self-mutation of `role`, `status`, `email`, `emailVerified`,
`passwordHash`, `authIdentities`, legacy `authProviders`, `_id`, `id`,
`createdAt`, `updatedAt`, and
rejects operator/prototype shapes (`$set`, `__proto__`, `{ "$ne": null }`, …).

The outer wrapper (`z.object({ body })`) is deliberately **not** `.strict()` —
the `validate` middleware always hands the schema `{ body, params, query }`.

### Name validation

`z.string().trim().min(1).max(100)` — identical to `registerSchema` and the
model's `maxlength: 100`. Internal whitespace is preserved (no collapsing); no
Unicode normalization (neither the model nor registration does either).

### Preference entry limits (validation layer only)

| Rule | Value |
|---|---|
| max `dietaryPreferences` entries | 20 |
| max `allergies` entries | 20 |
| per-entry length | 1..50 chars, after `.trim()` |
| empty / whitespace-only entry | rejected |
| non-string entry | rejected |

Preference values stay **free-form strings** — no controlled vocabulary, no
taxonomy. The caps are an API-boundary policy; the Mongoose schema is left as a
permissive `[String]` store, so the constants
(`MAX_PREFERENCE_ENTRIES`, `MAX_PREFERENCE_ENTRY_LENGTH`) live in
`user.validation.js`, not `user.model.js`. `user.model.js` is not modified.

### Duplicates

Not deduplicated and not rejected. `["Vegan", "Vegan", "vegan"]` is stored
verbatim (after per-entry trim). What the client sends is what `GET` returns.

### Empty arrays

`{ "preferences": { "allergies": [] } }` is **valid** and means "clear all
allergies".

### Structural no-ops (rejected `400`)

- `{}`
- `{ "preferences": {} }`
- `{ "preferences": { "notifications": {} } }` (`enabled` is required when
  `notifications` is present)

Presence is checked by object key, never truthiness — `enabled: false` is a
valid update.

## Merge semantics (critical)

The service (`updateOwnProfile`) builds a **dot-pathed `$set`** field-by-field
from named fields only:

```js
$set: {
  "name": ...,
  "preferences.dietaryPreferences": ...,
  "preferences.allergies": ...,
  "preferences.notifications.enabled": ...,
}
```

Only the leaves the request supplied are added. It never does `{ $set: patch }`
or `{ $set: patch.preferences }` — a whole-subdocument `$set` of `preferences`
would replace the entire sub-document and wipe the sibling keys the request
didn't mention (Mongoose sub-schema defaults would backfill them). So:

- `PATCH { preferences: { allergies: ["Peanuts"] } }` →
  `$set: { "preferences.allergies": ["Peanuts"] }` — `dietaryPreferences` and
  `notifications.enabled` untouched.
- `PATCH { preferences: { notifications: { enabled: false } } }` →
  `$set: { "preferences.notifications.enabled": false }` — arrays untouched.

### Array semantics

A supplied array (including `[]`) **replaces** that array wholesale. An omitted
array is never added to `$set` and is left as stored. No append, no union, no
merge.

## Repository

Reuses `userRepository.updateById(id, { $set })` unchanged —
`findByIdAndUpdate(id, update, { new: true, runValidators: true })`. No new
repository method. `runValidators` re-applies the model's `name` maxlength and
the `preferences` path casts. `new: true` returns the authoritative post-update
document.

## Response

```
200
{ "success": true, "data": { "user": <toPublicUser(updated)> } }
```

Same serializer and envelope as `GET /users/me`. `toPublicUser` returns the
updated `preferences` and never exposes `passwordHash`, `authIdentities`, `__v`,
session data, or tokens. `user.serializer.js` is not modified.

Same-value patches are accepted and return `200` with the authoritative user
(no change-detection logic).

## Errors

| Situation | Status / code |
|---|---|
| bad / empty / unknown / over-limit body | `400 VALIDATION_ERROR` (+ `details[]`) |
| missing / malformed / expired token | `401 AUTH_TOKEN_MISSING` / `AUTH_TOKEN_INVALID` |
| revoked session, suspended user, **or the authenticated user was deleted before the write** (`updateById` → `null`) | `401 AUTH_SESSION_INVALID` |
| rate limit | `429 RATE_LIMIT_EXCEEDED` (global limiter; no per-route limiter) |
| DB / unexpected | `500 INTERNAL_SERVER_ERROR` (generic message, logged) |

The "user vanished mid-request" case reuses `AUTH_SESSION_INVALID` — the same
semantic `getCurrentUser` already uses when the authenticated principal no
longer maps to a live user. No new error code was added.

## Session / auth effects

**None.** `name` and `preferences` are not JWT claims (the access token carries
only `sub`, `role`, `sessionId`) and participate in no authorization check
(`authenticate` reloads `role`/`status` from MongoDB every request regardless).
Updating them issues no new access token, rotates no refresh token, revokes no
session, and forces no re-login. `updateOwnProfile` does not import or call
`SessionService`.

## Out of scope (Phase A)

- **Email change** — needs ownership re-confirmation, a verification flow, and
  an email-delivery capability the stack does not have.
- **Password change** — needs current-password verification and its own
  endpoint / error semantics.
- **Account deletion**, `emailVerified` mutation.
- **`role` / `status`** — admin-only, unchanged on `PATCH /:userId`.
- **Avatar** — no schema field exists.
- **Granular notification categories** — the schema has a single
  `notifications.enabled` boolean; per-channel toggles would be a schema
  expansion decided on its own merits.
- Any controlled dietary/allergy vocabulary; any dedupe.

## Phase B boundary (mobile — not implemented)

Phase B migrates `ProfileScreen`, `AccountDetailScreen`, and `NotificationsScreen`
to source identity from `useAuth().user` and persist via `PATCH /users/me`:

- `name` — writable
- `email` — read-only display (change deferred)
- `preferences.dietaryPreferences` / `preferences.allergies` — writable
- `preferences.notifications.enabled` — the **single** master toggle wired to
  REST; the other four `mockData.notificationSettings` toggles stay local-only /
  "coming soon" (no backend field — do not expand Phase A for placeholder UI)
- avatar — stays a placeholder (no backend field)
- `SecurityScreen` (password / 2FA) — out of scope
- remove the `wecooked:profile` AsyncStorage load/save and `mockData.chef`
  reads from those screens only; keep `chef` where `CommunityScreen` /
  `CommunityContext` still use it

The `PATCH /users/me` response shape equals `GET /users/me`, so `AuthContext`
can set `user` directly from the response or call `refreshUser()`.

## Files (Phase A)

Modified: `user.validation.js`, `user.controller.js`, `user.service.js`,
`user.routes.js`, `test/user-validation.test.js`, `test/user-routes.test.js`,
`test/user-service.test.js`.
Unchanged: `user.model.js`, `user.repository.js`, `user.serializer.js`,
`routes/v1.routes.js`, and all of `auth/`, `sessions/`, `middleware/`, `shared/`.
New: this document.

Regression: 619 → 659 tests passing.
