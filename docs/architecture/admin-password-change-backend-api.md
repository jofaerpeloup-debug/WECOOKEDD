# Password change — backend API (Phase B2)

Backend-only slice on `feat/api-auth-change-password`. Adds one authenticated
endpoint that lets a local-auth user change their own password entirely through
`apps/api` — no Firebase. The sole Admin is its first consumer (the admin app
migrates to it in a later Phase C), but the endpoint itself is a general
self-service credential operation.

**No frontend was touched in this slice.** `apps/admin/**` and `apps/mobile/**`
are unchanged.

See [backend.md](./backend.md) for the layered request-flow conventions and
[authentication-security.md](./authentication-security.md) for the auth/session
model this builds on.

## Scope

In: backend change-password only.

Out: forgot password, reset password, email delivery, Admin signup removal,
Firebase Auth retirement, Admin email change, Admin self-delete, ownership
transfer, role mutation, registration role behavior, a stronger *global*
password policy, HttpOnly-cookie refresh transport, CSRF redesign.

## Endpoint

```
POST /api/v1/auth/change-password
```

### Middleware order (locked)

```
authenticate
→ authRateLimiter
→ validate(changePasswordSchema)
→ authController.changePassword
```

`authenticate` runs **before** `authRateLimiter` deliberately: an
invalid/expired/revoked session fails auth first and never consumes the
limiter budget. Only genuine authenticated attempts are rate-limited — the
real threat is an attacker with a stolen access token brute-forcing
`currentPassword`.

`authRateLimiter` is the **existing** shared limiter instance from
`auth.routes.js` (20 requests / 15 min / IP), the same one behind
`login` / `register` / `refresh`. No new limiter, no new dependency, no
changed values.

## Identity

The subject is **`req.auth.userId`** only — the canonical `String(user._id)`
that `authenticate` derives from the session (`session.userId`, itself
cross-checked against the token's `sub`). There is no `:userId` path param and
the request body is `.strict()`, so no `email`, `userId`, `role`, or token
claim can redirect the operation. Zero IDOR surface.

## Request body

```jsonc
{
  "currentPassword": "string",   // required
  "newPassword": "string"        // required
}
```

`changePasswordSchema` (`auth.validation.js`) composes the **existing** password
schemas — no duplicated byte-length logic:

| Field | Schema reused | Rules |
|---|---|---|
| `currentPassword` | `loginPasswordSchema` | min 1 char, ≤ 72 UTF-8 bytes, **no trim**. No 8-char minimum — an existing password may predate that policy and must still be enterable. The byte cap keeps an over-long value from ever reaching `comparePassword`. |
| `newPassword` | `newPasswordSchema` | min 8 chars, ≤ 72 UTF-8 bytes, **no trim**, **no complexity**. Same rule as registration, so register / change / any future reset share one policy. |

`.strict()` on the body → any extra key (`confirmPassword`, `email`, `userId`,
`role`, `$set`, `__proto__`, …) is a `400 VALIDATION_ERROR`, not a
silently-dropped field. An empty body is a `400` (both fields required).

**No `confirmPassword` in the backend API** — that stays a frontend-only check.

### Password policy decision

The existing backend policy (min 8 / ≤ 72 bytes / no complexity) is kept for
B2. The admin UI's current `checkPasswordRules` (mixed case, digit, symbol,
name/email exclusion) is a **Firebase-era client-side check** that has never
been enforced by `apps/api`. Adopting it — globally or Admin-only — is out of
scope: a global change breaks the registration contract for mobile users, and
an Admin-only validator is a second maintained policy for exactly one account.
Whether WeCooked wants a stronger *global* password policy (length bump,
breach-list, zxcvbn) is a separate future slice with its own existing-account
migration story.

## Behaviour (locked order)

1. `authenticate` — verify session + user, attach `req.auth`.
2. `authRateLimiter`, then `validate(changePasswordSchema)`.
3. `userService.changePassword({ userId, currentPassword, newPassword })`:
   - `userRepository.findByIdWithPassword(userId)` — the by-id counterpart of
     `findByEmailWithPassword`, the only other path that opts back into the
     `select: false` `passwordHash`. `null` → `401 AUTH_SESSION_INVALID`
     (deleted between `authenticate` and this read).
   - Local-auth guard: `authProviders` must include `"local"` **and**
     `passwordHash` must be present, else `400 AUTH_PASSWORD_CHANGE_UNAVAILABLE`
     (a future Google-only account has no password to change; also stops
     `bcrypt.compare` choking on an undefined hash).
   - `comparePassword(currentPassword, user.passwordHash)` — the **existing**
     primitive, not re-implemented. `false` → `400 AUTH_CURRENT_PASSWORD_INVALID`.
   - Same-password guard: `newPassword === currentPassword` → `400
     NEW_PASSWORD_SAME_AS_CURRENT`. Plaintext equality is exact here because
     the current password is already confirmed against the hash — no second
     bcrypt compare, and there is no password-history system.
   - `hashPassword(newPassword)` — the **existing** primitive
     (`BCRYPT_ROUNDS`, default 12).
   - `userRepository.updatePasswordHashById(userId, newHash)` — a dedicated
     single-field write (`updateOne` + `$set: { passwordHash }`), **not** the
     generic `updateById` (which returns the whole document and runs broad
     validators). `matchedCount === 0` → `401 AUTH_SESSION_INVALID`
     (deleted between the lookup and the write).
4. `authService.changePassword` then calls
   `sessionService.revokeAllSessionsForUser(userId)` — the **existing** method,
   already used by `logout-all` and `adminUpdateUser`.
5. Return `{ passwordChanged: true }`.

### Persist before revoke (locked)

The new hash is persisted **before** the all-sessions sweep. Persisting first
kills the old password, so a concurrent login racing with the old credentials
cannot mint a session that outlives the change. This matches the dominant
codebase precedent (`adminUpdateUser` active → suspended persists status, then
revokes).

**Residual, documented:** if `revokeAllSessionsForUser` throws *after* the hash
is persisted, the password change still stands (no rollback) and the failure
surfaces as `500 INTERNAL_SERVER_ERROR`. `revokeAllForUser` is a single
`updateMany`, so a failure there means the session store is unreachable — a
monitored operational event, not a silent security hole. Recovery: the user
logs in with the new password and calls `POST /api/v1/auth/logout-all`. No
transaction, `passwordChangedAt`, or session-version field was introduced —
consistent with `backend.md` (standalone MongoDB, no multi-document
transactions) and out of scope for B2.

## Session policy (locked)

**All sessions for the user are revoked, the current one included.** The caller
must sign in again.

`revokeAllSessionsForUser` sets `Session.revokedAt`, and both
`authenticate` (`SessionRepository.findActiveById`) and refresh rotation
(`findActiveByHash`) filter on `revokedAt: null`. So:

- the current **access token** fails `authenticate` on its very next request →
  `401 AUTH_SESSION_INVALID`;
- the current **refresh token** can no longer rotate → `401
  AUTH_REFRESH_TOKEN_INVALID`.

Route tests assert both. No new access or refresh token is issued in the
success response.

## Response

```
200
{ "success": true, "data": { "passwordChanged": true } }
```

Minimal, matching `logout`'s `{ loggedOut: true }` and `logout-all`'s
`{ revokedCount }`. **No user object, no tokens, no `passwordHash`.** The
`findByIdWithPassword` document never leaves `userService.changePassword`; the
serializers are not involved and are unchanged.

## Errors

| Situation | Status / code |
|---|---|
| missing/unknown/over-limit field, empty body, extra key | `400 VALIDATION_ERROR` (+ `details[]`) |
| wrong current password | `400 AUTH_CURRENT_PASSWORD_INVALID` |
| new password equals current | `400 NEW_PASSWORD_SAME_AS_CURRENT` |
| account has no local password (Google-only / missing hash) | `400 AUTH_PASSWORD_CHANGE_UNAVAILABLE` |
| missing / malformed / expired access token | `401 AUTH_TOKEN_MISSING` / `AUTH_TOKEN_INVALID` |
| revoked session, suspended user, or the authenticated user was deleted mid-request | `401 AUTH_SESSION_INVALID` |
| rate limit | `429 RATE_LIMIT_EXCEEDED` |
| session-store failure during the post-persist revoke, or any other unexpected error | `500 INTERNAL_SERVER_ERROR` (generic message, logged) |

### Why wrong-current-password is `400`, not `401`

The admin API client (`apiClient.js`) transparently refresh-retries **any**
`401`. A `401` on a wrong-password typo would trigger a spurious
`POST /auth/refresh` (which succeeds — the session is fine), rotate the refresh
token, replay the attempt, and 401 again — doubling the rate-limiter cost per
typo. `400` avoids that. A distinct code (not `AUTH_INVALID_CREDENTIALS`, which
is login's) lets a future frontend flag the current-password field.

## Repository additions (`user.repository.js`)

| Function | Purpose |
|---|---|
| `findByIdWithPassword(id)` | `User.findById(id).select('+passwordHash')` — by-id credential lookup for authenticated self-service. `findByEmailWithPassword` (login's only path) is unchanged. |
| `updatePasswordHashById(id, passwordHash)` | `User.updateOne({ _id: id }, { $set: { passwordHash } })` — writes **only** `passwordHash`, returns only the write result. Never used for anything else. |

`user.model.js` is **not** modified — the `passwordHash` field and its
`select: false` / conditional `required` already exist.

## Rate limiting

Reuses the existing `authRateLimiter` (20 / 15 min / IP). It is now also
exported from `auth.routes.js` as `module.exports.authRateLimiter` — used only
by the route test suite to reset the shared per-IP counter between the many
authenticated attempts it exercises; app code still consumes the default
router export.

## CSRF

**Not applicable.** The admin app sends the access token as an
`Authorization: Bearer` header from JS memory (refresh token mirrored to
`sessionStorage`) — no cookies, so no cross-site request can carry the
credential. If refresh transport later moves to an `HttpOnly; Secure` cookie
(the stated future direction in `authentication-security.md`), CSRF protection
for every state-changing endpoint — this one included — must be revisited.

## Phase C frontend contract (not implemented here)

The admin Settings "Change password" form currently calls Firebase
(`reauthenticateWithCredential` + `updatePassword`). Phase C should:

- call `api.post('/auth/change-password', { body: { currentPassword, newPassword } })`;
- on `200`, treat the session as gone: `clearTokens()` and return to the Auth
  screen with *"Password changed. Please sign in again."* (all sessions,
  including the current one, are revoked). If Phase C omits this, the client
  self-heals — the next call `401`s, the refresh retry `401`s, and the existing
  `onSessionExpired` path clears the session anyway;
- keep `confirmNewPassword` as a frontend-only check (never sent);
- align the shown rule list to the backend (`≥ 8 characters`) instead of the
  Firebase-era composition rules, which the backend does not enforce;
- map `AUTH_CURRENT_PASSWORD_INVALID` → current-password field,
  `NEW_PASSWORD_SAME_AS_CURRENT` → new-password field, `VALIDATION_ERROR` →
  `details[]`;
- remove only the Firebase password path — leave the other Firebase account
  flows (reset, email change, verification, delete) for their own phases.

## Files (B2)

Modified: `apps/api/src/modules/auth/auth.routes.js`,
`auth.controller.js`, `auth.service.js`, `auth.validation.js`,
`apps/api/src/modules/users/user.repository.js`, `user.service.js`,
`apps/api/test/auth-validation.test.js`, `auth-service.test.js`,
`auth-routes.test.js`, `user-service.test.js`,
`docs/architecture/authentication-security.md`.

New: this document.

Unchanged: `user.model.js`, `user.serializer.js`, `user.controller.js`, all of
`sessions/`, `middleware/`, `shared/security/`, `packages/contracts/`,
every `apps/admin/**` and `apps/mobile/**` file, and all B1 role/status
behavior (`updateUserSchema`, `adminUpdateUser` role immutability, `ROLES`,
registration role defaulting).

Regression: **659 → 699** backend tests passing.