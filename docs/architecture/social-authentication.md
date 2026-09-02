# Social authentication (B4.0 foundation + B4.1 Google backend)

B4.0 established provider-neutral identity storage and local-password
compatibility. B4.1 adds the backend-only Google credential, challenge, login,
and explicit-link paths. Mobile provider UI and token acquisition remain B4.2
scope. Google is never WeCooked's session or authorization authority.

## B4.1 Google request flow

The API exposes these endpoints under `/api/v1/auth`:

- `POST /social/challenge` with the strict body `{ "provider": "google" }`.
- `POST /social/google` with `{ "idToken", "challengeId" }`.
- `POST /social/google/link` with the same body and an authenticated WeCooked
  session.

A challenge contains 32 random bytes encoded as an unpadded, 43-character
base64url nonce and expires exactly five minutes after issue. The raw nonce is
returned once. Only its lowercase SHA-256 digest, provider, and expiry are
stored in the dedicated `SocialAuthChallenge` collection. Its TTL index is
cleanup only; authorization depends on a single atomic `findOneAndDelete`
matching `_id`, `provider`, `nonceHash`, and `expiresAt > now`.

The Google credential is verified before challenge consumption, so an invalid
credential cannot burn a valid challenge. After signature and claim
verification, the signed `nonce` is hashed and used in that exact atomic match.
Once consumed, any later account or database failure requires a fresh
challenge.

## Google verification boundary

The provider adapter lazily loads `jose` and maintains one process-wide remote
JWKS resolver for Google's fixed `https://www.googleapis.com/oauth2/v3/certs`
endpoint. It accepts only `RS256`, Google's two documented issuer forms, and
audiences from the server-owned `GOOGLE_OAUTH_CLIENT_IDS` allow-list. That
variable contains approved Web/server Google OAuth client IDs only, normally
one shared backend audience at first; multiple values support safe rotation or
intentional environment/deployment needs. It does not normally contain Android
or iOS platform OAuth client IDs. Verification requires `sub`, `exp`, `iat`,
and `nonce`, applies at most 60 seconds of clock tolerance, lets `jose` enforce
`nbf` when present, and independently validates the stable subject, issued-at
time, and exact WeCooked nonce format.

No client can select an audience, issuer, JWKS URL, identity, role, or status.
No Google token, authorization code, raw nonce, claims object, email, subject,
or JWK payload is persisted or logged. Provider failures are collapsed to
sanitized `AUTH_SOCIAL_CREDENTIAL_INVALID` or `AUTH_PROVIDER_UNAVAILABLE`
errors before they reach central logging.

## Account policy

The durable identity is the verified pair `google` + Google `sub`; email is
profile/contact data only. Existing linked users sign in by that pair and
Google claim changes never overwrite their WeCooked name or email. A first
social account requires a usable Google email with literal
`email_verified === true`; otherwise provisioning returns
`AUTH_SOCIAL_EMAIL_REQUIRED`. Any existing WeCooked account with the same
normalized email returns the generic `AUTH_ACCOUNT_LINK_REQUIRED`; email never
auto-links.

Only an authenticated, active, role=`user` principal can explicitly link
Google, and the target is always `req.auth.userId`. Linking does not require
email equality, mutate profile/password/role/status, or issue/rotate sessions.
The same identity on the same user is idempotent; ownership by another user and
a different Google identity already on the target are distinct safe conflicts.
Admins cannot Google-login or link. Suspended identity owners receive no
session.

Social account creation uses explicit creation, never upsert. The B4.0 unique
identity index and provider-guarded atomic link remain the database authority.
On `E11000`, AuthService reloads identity ownership first, then email occupancy;
only a recognized concurrent winner is recovered, and unexplained duplicates
fail closed. Successful login reuses the ordinary WeCooked SessionService and
access-token issuer unchanged.

## Rate and error contract

Challenge, Google login, link-by-IP, and link-by-authenticated-user limits are
respectively 30, 20, 20, and 10 attempts per 15 minutes. Link middleware order
is IP limiter, authentication, user limiter, strict validation, controller.
Stable B4.1 errors are:

- `400 AUTH_SOCIAL_CHALLENGE_INVALID`
- `401 AUTH_SOCIAL_CREDENTIAL_INVALID`
- `403 AUTH_ACCOUNT_SUSPENDED`
- `403 AUTH_SOCIAL_LOGIN_UNAVAILABLE`
- `409 AUTH_ACCOUNT_LINK_REQUIRED`
- `409 AUTH_SOCIAL_IDENTITY_IN_USE`
- `409 AUTH_SOCIAL_PROVIDER_ALREADY_LINKED`
- `422 AUTH_SOCIAL_EMAIL_REQUIRED`
- `503 AUTH_PROVIDER_UNAVAILABLE`

Validation and limiter failures continue to use `VALIDATION_ERROR` and
`RATE_LIMIT_EXCEEDED`.

## Authentication capabilities

The two capabilities have separate, source-of-truth fields:

- **Local password capability** is a present, nonempty `User.passwordHash`.
- **Social capability** is an entry in `User.authIdentities` containing a
  provider-stable subject.

`authIdentities` never implies that a local password exists. B2 change-password
and B3 forgot/reset-password use only the selected/stored password hash.
Social-only accounts have no fake, random, or hidden local password.

## Identity model

Each identity is embedded in its User:

```js
{
  provider: 'google' | 'apple' | 'facebook',
  subject: '<provider-stable-subject>',
  linkedAt: Date
}
```

`local` is not a social provider. Subjects are trimmed, nonempty, and limited
to 255 characters. A User may have identities from different providers but at
most one identity for each provider.

The named unique partial multikey index
`uniq_auth_identity_provider_subject` covers:

```js
{ 'authIdentities.provider': 1, 'authIdentities.subject': 1 }
```

It prevents one provider/subject pair from being owned by two User documents.
MongoDB unique multikey indexes do not reject duplicate entries inside the same
document, so model validation rejects repeated providers and the atomic link
repository predicate requires that the target does not already contain that
provider. Identity lookup uses `$elemMatch` so provider and subject always come
from the same embedded entry.

The Mongoose User schema deliberately does not declare this index. The explicit
auth-identity migration is its sole creator, so ordinary API startup cannot
create it before migration preflight has proved that existing ownership data is
safe. The application-level model and repository protections apply regardless
of whether the database index has been created; the index adds cross-document
enforcement after a successful migration apply.

The provider-neutral repository primitives do not make identities publicly
writable. Registration and user-update validation reject both `authIdentities`
and the removed legacy `authProviders` input, and current serializers omit
identity records.

## Legacy migration

Run from `apps/api`:

```text
npm run migrate:auth-identities
npm run migrate:auth-identities -- --apply
```

The first command is a read-only dry run. Only the exact `--apply` flag permits
mutation. The command is not part of server startup and never synthesizes a
subject, identity, email, password, or password hash.

Preflight reads the raw MongoDB collection so it can inspect the removed
`authProviders` field. It aborts all mutation for unknown legacy values,
social-provider markers without a durable identity, local legacy accounts
without a usable hash, invalid identity arrays, or cross-document identity
collisions. A successful apply unsets only `authProviders` and ensures the
named unique partial index. Output contains aggregate counts, not PII.

Apply performs `updateMany` and `createIndex` as separate, non-transactional
operations. Both operations are idempotent. If the process fails after one of
them succeeds, rerun the dry run, review its report, and rerun with `--apply`;
the command safely resumes from the resulting partial state.

Legacy local documents remain readable before migration: local behavior is
derived from the stored hash and field-by-field serializers do not expose the
legacy field. A historical `authProviders: ['google']` record without a stable
subject is deliberately not converted.

## Future slice gates

### B4.2 Google Mobile

B4.1 deliberately defines a library-independent credential contract: Mobile
must obtain a fresh, interactive Google ID token whose signed `nonce` claim is
exactly the raw WeCooked nonce for that attempt. B4.2 must use a free,
currently supported native/provider mechanism. Android still needs its Android
OAuth client for package/signing identity, while the Web/server client ID is
supplied as `serverClientId`; the resulting ID token's `aud`, verified by B4.1,
is that Web/server client ID. iOS likewise needs its iOS OAuth client for
bundle/app identity, while the Web/server client ID is supplied as
`serverClientID`; its resulting ID-token audience is also the Web/server ID.
Only those accepted Web/server audiences belong in `GOOGLE_OAUTH_CLIENT_IDS`.
Platform OAuth client IDs bind native applications to Google but never become
WeCooked authorization authority. Direct Expo AuthSession's Google provider is
not the selected cross-platform production path, and the paid Universal Google
Sign-In library is neither required nor selected. No native bridge or Mobile
token-acquisition flow is implemented in B4.1, and Firebase is not used.

### B4.3 Apple

Apple code may be developed and tested later, but production/store social
account creation remains disabled until B4.5 completes the provider lifecycle
and revocation design. Exchanging an authorization code and then discarding the
Apple refresh token is not a production-complete lifecycle. B4.5 must implement
encrypted token-at-rest storage or another Apple-compliant revocation strategy
before public enablement.

### B4.4 Facebook

Revalidate the current Meta protocol, SDK credential shape, and dashboard
requirements when B4.4 begins. No Facebook-specific protocol assumption or
configuration is part of B4.0.
