# Authentication & session security

This document covers what Phase 2 (`feat/auth-sessions`) actually implements
in `apps/api`: local email/password authentication, access JWTs, and opaque
refresh-token sessions. See [docs/architecture/backend.md](./backend.md) for
the layered request-flow/module conventions this feature follows.

## Modules

- `src/modules/users/` — the `User` model plus a repository/service/
  controller/routes/serializer for account data.
- `src/modules/sessions/` — the `Session` model plus a repository/service for
  refresh-token sessions. Sessions are their own collection, not embedded in
  `User`.
- `src/modules/auth/` — orchestrates registration, login, refresh, and
  logout. `AuthService` calls `UserService` and `SessionService` only; it
  never imports `User.model.js` or `Session.model.js` directly, matching the
  module-boundary rule in `backend.md`.

## Password storage

- Passwords are hashed with **bcrypt** (`bcryptjs`) via
  `src/shared/security/password.js`. bcrypt generates a unique random salt
  per hash automatically — there is no separate `salt` field in the `User`
  schema.
- The work factor is `BCRYPT_ROUNDS` (env-configured, default `12`), read in
  one place rather than hard-coded per call site.
- Only the resulting hash is ever persisted, in `User.passwordHash`, which
  is declared `select: false` so it is excluded from normal queries. The
  only code path that loads it is `UserRepository.findByEmailWithPassword`,
  used exclusively by login/credential verification.
- Passwords and password hashes are never logged.
- bcrypt only considers the first 72 bytes of its input; anything beyond
  that is silently ignored by the algorithm itself. Both registration and
  login reject passwords whose UTF-8 byte length exceeds 72 bytes at the
  validation layer, and `comparePassword` independently refuses (returns
  `false` without calling bcrypt) any input over that limit as a defensive
  second check — so an over-limit password can never be silently truncated
  into matching a shorter one it isn't equal to. Passwords are not trimmed.
- `User.passwordHash` is required only when `authProviders` includes
  `"local"` (Mongoose conditional `required`), so the schema does not block
  a future Google-only account from existing without a password. Local
  registration is unaffected — it always sets `authProviders: ["local"]`
  and always provides a hash. Google login itself is not implemented.

## Access tokens (JWT)

- Short-lived JWTs signed with `jsonwebtoken` (`src/shared/security/access-token.js`),
  algorithm `HS256`, using a validated `JWT_ACCESS_SECRET` (minimum 32
  characters, no insecure default) and `JWT_ACCESS_TTL` (default `15m`).
- Payload is intentionally minimal:
  ```json
  { "sub": "<userId>", "role": "<role>", "sessionId": "<sessionId>" }
  ```
  It never carries `passwordHash`, preferences, or other profile data —
  anything beyond identity/role/session is looked up fresh from MongoDB when
  needed.
- Tokens carry a fixed `issuer`/`audience` (`wecooked-api` / `wecooked-client`)
  checked on verification.

## Refresh tokens (opaque sessions)

- Refresh tokens are **not** JWTs and are **not** passwords. They are
  high-entropy random values generated with Node's built-in `crypto.randomBytes`
  (`src/shared/security/refresh-token.js`), base64url-encoded, and returned
  to the client once as the raw token.
- Only a **SHA-256 digest** of the token (`crypto.createHash('sha256')`) is
  stored, in `Session.refreshTokenHash`. SHA-256 (not bcrypt) is appropriate
  here because refresh tokens are already high-entropy random secrets, not
  low-entropy human passwords — there is nothing for a work-factor/salt to
  protect against. The raw token is never persisted or logged.
- `Session.expiresAt` is the **absolute** expiration of the refresh session
  for Phase 2 — rotating a token does not extend it. It is backed by a
  MongoDB TTL index (`expireAfterSeconds: 0`), so MongoDB removes the
  document itself once it passes.

## Refresh rotation

`POST /api/v1/auth/refresh` (`AuthService.refresh`) runs in two deliberately
ordered steps:

1. A **non-mutating** lookup of the active session by the current token's
   hash (`SessionService.findActiveSessionByRefreshToken`), then a check
   that the session's user still exists and is `active`. Neither of these
   has a side effect, so if the user lookup fails (not found, suspended, or
   a transient DB error), the caller's existing refresh token is untouched
   and still usable on retry — rotating first and checking the user
   afterward would risk burning the client's only valid token on a lookup
   failure and leaving them with neither a working old token nor a
   delivered new one.
2. Only once that check passes does it call the **atomic** rotation
   (`SessionRepository.rotateByHash`) — a single `findOneAndUpdate`
   conditioned on the *current* token's hash, `revokedAt: null`, and
   `expiresAt` still in the future.

MongoDB's per-document atomicity means that if two requests race with the
same refresh token, only one `findOneAndUpdate` can match and rewrite the
document — the other finds nothing (since the hash has already changed) and
receives `AUTH_REFRESH_TOKEN_INVALID`, even though both may have passed the
non-mutating pre-check. This is one-time-use rotation, not full
token-family reuse-detection; a later hardening phase may add reuse
detection if needed.

## Session revocation

- `POST /api/v1/auth/logout` revokes only the session named in the caller's
  own verified access token (`req.auth.sessionId`) — never a client-supplied
  session/user id.
- `POST /api/v1/auth/logout-all` revokes every active session belonging to
  the authenticated user (including the current one) and reports how many
  were revoked. "Active" here means `revokedAt: null` **and** `expiresAt`
  still in the future, so a session that's expired but not yet removed by
  the TTL index doesn't inflate the reported count.
- Revocation sets `Session.revokedAt`; a revoked session immediately fails
  both the refresh-rotation filter and the authentication-middleware check
  below — no waiting for token expiry.

## Password change

`POST /api/v1/auth/change-password` (Phase B2 —
`feat/api-auth-change-password`) lets an authenticated local-auth user change
their own password through `apps/api`, with no Firebase involvement. Full
detail in
[docs/architecture/admin-password-change-backend-api.md](./admin-password-change-backend-api.md);
the security-relevant points:

- Middleware order is `authenticate` → `authRateLimiter` (the existing shared
  auth limiter) → `validate(changePasswordSchema)` → controller. Auth runs
  before the limiter so an invalid session never consumes the budget.
- The subject is `req.auth.userId` only — never an email or a body field.
  `currentPassword` is verified against the authoritative
  `User.passwordHash` (loaded by the new
  `UserRepository.findByIdWithPassword`, the by-id counterpart of
  `findByEmailWithPassword`) using the existing `comparePassword`.
- `newPassword` reuses the registration policy unchanged (min 8, ≤ 72 bytes,
  no complexity). A `newPassword` equal to `currentPassword` is rejected.
- The new hash and invalidation of every outstanding password-reset credential
  are persisted atomically **before** all of the user's sessions are revoked
  (`SessionService.revokeAllSessionsForUser`) — the current session
  included, so the caller must sign in again. Persist-before-revoke keeps a
  concurrent login with the old password from minting a surviving session;
  if the revoke fails after the persist, the password change stands (no
  rollback) and surfaces as `500`.
- The success response is `{ passwordChanged: true }` — no user object, no
  new tokens, no `passwordHash`. A wrong current password is `400
  AUTH_CURRENT_PASSWORD_INVALID` (not `401`, which the admin client would
  transparently refresh-retry).

## Password reset

`POST /api/v1/auth/forgot-password` and `POST /api/v1/auth/reset-password`
implement the B3 backend reset flow. Reset tokens are 32-byte opaque secrets;
only SHA-256 digests and absolute expiries are stored on `User`. Forgot-password
returns one generic response for every eligible/ineligible email and uses a
dedicated 5-per-15-minute IP limiter plus a minimum response floor.

Reset-password conditionally matches an active, unexpired digest and atomically
sets the new bcrypt hash while unsetting the digest/expiry. Every successful
password replacement—including authenticated change-password—uses that same
set-password/unset-reset-fields update invariant, then revokes all sessions.
Suspension also clears reset credentials in the same status write, preventing a
pre-suspension token from reviving after reactivation. Full contract:
[password-reset-backend-api.md](./password-reset-backend-api.md).

## Authentication middleware

`src/middleware/authenticate.middleware.js` expects `Authorization: Bearer
<access-token>` and, on every request:

1. Verifies the JWT signature/expiry/issuer/audience.
2. Validates that the token's `sessionId` and `sub` claims are well-formed
   Mongo ObjectIds — rejected immediately as `AUTH_SESSION_INVALID` if not,
   without touching the database.
3. Loads the `Session` named by the token's `sessionId` and confirms it is
   still active (`revokedAt: null`) and unexpired.
4. Confirms that session's `userId` matches the token's `sub` claim
   (`String(session.userId) === String(payload.sub)`) — a token is only
   honored for the same user the session was actually issued to, so a
   validly-signed token cannot be paired with a session it doesn't own to
   impersonate someone else.
5. Loads the `User` via the session's own (already-verified) `userId` and
   confirms `status === 'active'`.
6. Attaches `req.auth = { userId, role, sessionId }` — never `passwordHash`
   or any other profile field.

Role/status are re-checked against **current** MongoDB state on every
request rather than trusted from the JWT, so a revoked session or a
suspended account loses API access immediately, and a role change would
take effect on the next request — the JWT's own claims are only used to
locate the session/user to check.

Only the specific, expected failure conditions above (missing/malformed
token, malformed id, missing/foreign/expired session, missing/inactive
user) are translated into a safe `401` with a stable code
(`AUTH_TOKEN_MISSING`, `AUTH_TOKEN_INVALID`, or `AUTH_SESSION_INVALID`).
A genuine repository/database failure (e.g. MongoDB unreachable or timing
out) is **not** caught and reinterpreted as an auth failure — it is an
ordinary `Error`, not an `AppError`, so it propagates to the central error
handler and surfaces as `500 INTERNAL_SERVER_ERROR`, the same as any other
unexpected failure elsewhere in the API.

## Authorization middleware

`src/middleware/authorize.middleware.js` exports `authorize(...roles)`,
which checks `req.auth.role` against an allow-list and returns `403
FORBIDDEN` otherwise. It is deliberately minimal — no permission matrix, no
RBAC framework — and relies entirely on `authenticate` having already run.
No admin-only endpoint exists yet in Phase 2; the middleware is
unit-tested directly.

## Suspended accounts

- Login for a suspended account fails with `403 AUTH_ACCOUNT_SUSPENDED` and
  does not create a session.
- A user suspended after already having active sessions loses API access on
  their next authenticated request, because `authenticate` re-checks
  `status` against MongoDB on every call.

## Rate limiting

`POST /auth/register`, `/auth/login`, and `/auth/refresh` sit behind a
stricter rate limiter (via the existing `createRateLimiter` factory) than
the app-wide baseline, since they are the endpoints most attractive for
credential stuffing and account enumeration. Limited requests return the
existing standard `429 RATE_LIMIT_EXCEEDED` envelope.

## Secrets & configuration

`JWT_ACCESS_SECRET`, `JWT_ACCESS_TTL`, `REFRESH_TOKEN_TTL_DAYS`, and
`BCRYPT_ROUNDS` are validated centrally in `src/config/env.js` alongside the
Phase 1 variables. `JWT_ACCESS_SECRET` has no committed default and must be
at least 32 characters — the server refuses to start without a
sufficiently strong one configured.

## What's temporary vs. future work

- **Phase 2 JSON refresh-token transport is temporary.** `register` and
  `login` return `refreshToken` directly in the JSON body, which is
  acceptable for backend/mobile-client testing right now but is not the
  final browser story.
- **Future browser (admin) integration** is expected to move refresh-token
  transport to an `HttpOnly`, `Secure` cookie instead of the JSON body.
  Token/session creation already lives in `SessionService`/`AuthService`,
  independent of the HTTP transport, specifically so that change can be made
  without redesigning session logic — only the controller/route layer
  should need to change.
- **Google authentication is not implemented.** `User.authProviders` allows
  `"google"` as a schema value so the field doesn't need a breaking change
  later, but no Google OAuth flow, account linking, or verification exists
  yet.
- Email verification delivery remains out of scope. Password **reset** was out
  of scope for Phase 2 and is now implemented by Phase B3 as documented above.
  Password **change** for an authenticated user is now implemented — see
  [§ Password change](#password-change) above (Phase B2). Admin-only
  endpoints were added later (see
  [admin-users-backend-api.md](./admin-users-backend-api.md)).
