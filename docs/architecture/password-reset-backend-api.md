# Password reset backend API (Phase B3)

Backend-only forgot-password/reset-password flow for `apps/api`, using Resend
for transactional email. No Admin or Mobile UI is included.

## Endpoints

### `POST /api/v1/auth/forgot-password`

Strict body:

```json
{ "email": "user@example.com" }
```

The email is trimmed and lowercased. A dedicated in-memory IP limiter allows 5
requests per 15 minutes. Every well-formed request returns the same response:

```json
{ "success": true, "data": { "passwordResetRequested": true } }
```

Only active accounts with a present, nonempty password hash receive a
token/email. Missing, suspended, and social-only users—and storage or provider
failures—remain indistinguishable at the HTTP boundary. Responses have a 750 ms
minimum duration. Internal failure logging contains no email, token, reset URL,
provider response body, or API key.

#### Enumeration timing residual

The 750 ms floor limits basic timing differences, but email delivery is
synchronously awaited. Resend/provider latency above that floor can therefore
make eligible requests statistically slower than ineligible requests. This is
an accepted residual under the current synchronous, no-queue architecture.

### `POST /api/v1/auth/reset-password`

Strict body:

```json
{
  "token": "<43-character-base64url>",
  "newPassword": "..."
}
```

No email, user id, client type, redirect, or `confirmPassword` is accepted.
`newPassword` reuses the registration/change policy: at least 8 characters,
at most 72 UTF-8 bytes, no trimming, and no composition requirement.

Success is:

```json
{ "success": true, "data": { "passwordReset": true } }
```

No user or access/refresh token is returned. Invalid, expired, consumed,
replaced, or now-ineligible credentials all produce `400
AUTH_PASSWORD_RESET_TOKEN_INVALID` with the same safe message.

## Token storage and lookup

`User` owns two default-excluded fields:

- `passwordResetTokenHash`: unique sparse SHA-256 digest;
- `passwordResetExpiresAt`: absolute expiry.

The raw token is 32 CSPRNG bytes encoded as 43 unpadded base64url characters.
It is never stored. There is deliberately no TTL index: MongoDB TTL cleanup on
the User collection would delete the entire user document. Expired fields are
inert and are overwritten by a later forgot request or removed by a password
replacement.

The reset repository operation uses one `findOneAndUpdate` that matches the
digest, future expiry, active status, and an existing nonempty string password
hash. It does not consult `authIdentities`. That same update sets the new bcrypt
hash and unsets both reset fields.
MongoDB document atomicity means only one concurrent request can consume a
given token.

## Global password-replacement invariant

Every successful password replacement uses the same private repository update
shape:

```js
{
  $set: { passwordHash },
  $unset: {
    passwordResetTokenHash: 1,
    passwordResetExpiresAt: 1
  }
}
```

Authenticated `change-password` calls `replacePasswordById`; reset-password
uses the conditional `resetPasswordByTokenHash`. There is no repository method
that changes only `passwordHash`. Consequently, a reset token issued before a
successful authenticated password change cannot overwrite the new password.

After either atomic password replacement, AuthService revokes every session.
If session revocation fails, the new password and token invalidation remain
committed and the request surfaces as generic 500; no transaction or rollback
is attempted.

## Suspension

Any write setting `status: "suspended"` also unsets both reset fields in the
same User update, then performs the existing all-session sweep. Reactivation
still revokes sessions before setting `status: "active"`. A reset credential
therefore cannot become usable again after reactivation. B1 role immutability
is unchanged: the API still accepts `status` only and never writes `role`.

## Email and configuration

`shared/email/email.service.js` is the application boundary. It uses native
Node fetch to call Resend with bearer authentication, a user agent, timeout,
and per-send idempotency key. Automated tests mock this boundary and never make
network calls.

Email contains minimal WeCooked-branded text and HTML, the expiry, and
ignore-if-not-requested guidance. The reset token is placed in the configured
universal page's URL fragment (`#token=...`), so it is not transmitted in an
ordinary HTTP request for the page.

Required configuration:

- `RESEND_API_KEY` (sending-only key recommended)
- `EMAIL_FROM` (verified sender)
- `PASSWORD_RESET_URL` (fixed absolute URL; HTTPS required in production)
- `PASSWORD_RESET_TTL_MINUTES` (5–60, default 30)

Real `.env` values are operational secrets and are never committed.

### Development environment migration

Local development environments created before B3 must add `RESEND_API_KEY`,
`EMAIL_FROM`, and `PASSWORD_RESET_URL` to their local `apps/api/.env` before
`npm run dev --workspace=apps/api` will start successfully. They may optionally
set `PASSWORD_RESET_TTL_MINUTES`. Use the placeholders in
`apps/api/.env.example`; do not commit real values or credentials.

Production intentionally fails fast when required email configuration is
missing. Automated tests use synthetic configuration and never require real
Resend credentials.
