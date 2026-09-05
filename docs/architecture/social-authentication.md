# Social authentication (B4.0 foundation + B4.1 Google backend + B4.3A linking)

B4.0 established provider-neutral identity storage and local-password
compatibility. B4.1 adds the backend-only Google credential, challenge, login,
and explicit-link paths. B4.3A adds the account-linking foundation: server-
enforced challenge intent, authenticated user binding for link challenges,
public linked-identity state, and read-only startup index verification. Mobile
provider UI and token acquisition remain B4.2 scope. Google is never WeCooked's
session or authorization authority.

## Google login vs. account linking

These are two distinct flows and must not be conflated.

**Google login / first-time Google account creation** (`POST /social/google`)
is for a caller who may not have a WeCooked account yet. When the verified
`google` + `sub` pair already owns an account, that account signs in. When it
owns none, a NEW WeCooked account is provisioned and the Google identity becomes
its authentication identity automatically. This creation path is intentional and
is **not** B4.3 account linking; it requires no WeCooked registration email
verification.

**Account linking** (`POST /social/google/link`) applies only when a WeCooked
user ALREADY exists and is ALREADY authenticated — for example a password
account whose owner signs in with email/password and then explicitly chooses to
link Google. The identity is attached to that SAME user and the current session
is untouched. Linking never creates a user, never merges two users, never
mutates role/status/email/passwordHash, and never issues, rotates, or replaces
tokens.

**Email equality is never account ownership.** A password account
`maria@gmail.com` and a Google token claiming `maria@gmail.com` are not
evidence of the same person. The login endpoint returns the generic
`AUTH_ACCOUNT_LINK_REQUIRED` for that collision and the link endpoint does not
consult email at all. There is no email-based auto-linking, no account merging,
and no automatic conversion of a password account into a Google-linked account.

## B4.1/B4.3A Google request flow

The API exposes these endpoints under `/api/v1/auth`:

- `POST /social/challenge` with the strict body `{ "provider": "google" }`
  — a **login-intent** challenge; deliberately unauthenticated.
- `POST /social/challenge/link` with the same strict body **and** an
  authenticated WeCooked session — a **link-intent** challenge.
- `POST /social/google` with `{ "idToken", "challengeId" }`.
- `POST /social/google/link` with the same body and an authenticated WeCooked
  session.

A challenge contains 32 random bytes encoded as an unpadded, 43-character
base64url nonce and expires exactly five minutes after issue. The raw nonce is
returned once. Only its lowercase SHA-256 digest, provider, intent, expiry, and
(for a link challenge) the bound user id are stored in the dedicated
`SocialAuthChallenge` collection. Its TTL index is cleanup only; authorization
depends on a single atomic `findOneAndDelete` matching `_id`, `provider`,
`intent`, the user binding, `nonceHash`, and `expiresAt > now`.

### Challenge intent and user binding

`intent` is server-owned and never a request field. The two intents are not
interchangeable in either direction:

- A **login** challenge stores no user field at all. `googleLogin` consumes with
  `intent: 'login'` and `userId: { $exists: false }`, so a link challenge — which
  always carries a real bound user id — can never satisfy it.
- A **link** challenge is account-management state. Requesting one requires
  authentication, and the binding is the caller's authoritative database user id
  taken from `req.auth.userId` (DB-verified by `authenticate`). `googleLink`
  consumes with `intent: 'link'` and that same authenticated id, so a challenge
  issued for User A cannot be consumed while authenticated as User B, and a
  login challenge cannot be consumed by the link endpoint.

The client never supplies, and cannot spoof, the binding: both challenge routes
use the same `.strict()` `{ provider }` schema, so a `userId` (or `intent`) key
in the body is a 400 `VALIDATION_ERROR`. The response shape is identical for
both intents — `{ challengeId, nonce, expiresAt }` — so neither the intent nor
the bound user is echoed back.

A dedicated authenticated route is used rather than optional authentication on
one generic `/social/challenge`: making authentication optional there would put
the binding decision behind a request-shape branch on the endpoint that must
stay usable with no account at all.

Every failure mode — wrong intent, foreign binding, expired, replayed, wrong
nonce — is a single no-match producing one sanitized
`400 AUTH_SOCIAL_CHALLENGE_INVALID`, so nothing about another account's
challenge state leaks. Nonce hashing, the five-minute TTL, one-time atomic
consumption, strict validation, rate limiting, authoritative DB role/status
checks, and the no-token/no-nonce logging rule are all unchanged.

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

## Public linked-identity state

`toPublicUser` carries an `authIdentities` array so the client can show which
providers are linked. Every response built with that serializer includes it —
`GET /users/me`, `PATCH /users/me`, `POST /social/google/link`, and the
register / login / Google-login session responses:

```js
authIdentities: [{ provider: 'google', linkedAt: Date }]
```

It is built field-by-field from `provider` + `linkedAt` only. The
provider-stable `subject` is the durable authentication identity and is **never**
public, even though it sits on the same embedded document. A password-only
account serializes `[]`. `toAdminUserSummary` is unchanged and still omits
identity data entirely — an admin has no need for another user's linked
providers.

## Startup index verification

`src/config/required-indexes.js` verifies, at startup and read-only, that the
unique auth-identity index actually exists in the shape the cross-document
uniqueness guarantee depends on. `server.js` calls it after `connectDatabase`
and before the HTTP listener; a failure aborts startup with a loud, actionable
message.

Verification is exact, not by name: the required index
`uniq_auth_identity_provider_subject` must be keyed
`{ 'authIdentities.provider': 1, 'authIdentities.subject': 1 }` **in that
order**, be `unique: true`, and carry the partial filter requiring both
`authIdentities.provider` and `authIdentities.subject` to exist. A name match
alone would silently accept an index enforcing something else. Partial-filter
comparison ignores key order only; key-specification comparison does not.

It uses `listIndexes` and nothing else: the verifier never calls `createIndex`,
`dropIndex`, or any repair path for `uniq_auth_identity_provider_subject`.
Creation of that index remains owned solely by
`npm run migrate:auth-identities -- --apply`, and the User schema deliberately
does not declare it (see "Identity model"), so Mongoose's index synchronisation
does not build it either. Operators must run the migration to create it. An
unreadable catalogue (including a not-yet-created collection) also stops startup
rather than being assumed safe.

Scope note: this is a guarantee about the auth-identity index specifically, not
a claim that startup creates no indexes at all. Mongoose's default `autoIndex`
behaviour still manages the other schema-declared indexes (email,
password-reset digest, the challenge TTL index); ownership of those was not
audited or migrated in B4.3A and is unchanged.

## Rate and error contract

Challenge, Google login, link-by-IP, and link-by-authenticated-user limits are
respectively 30, 20, 20, and 10 attempts per 15 minutes. The link-challenge
route reuses the 30/15min challenge IP limiter and adds its own 10/15min
per-authenticated-user limiter — its own budget rather than a share of the link
exchange's, since one link attempt spends exactly one challenge and one
exchange. Link middleware order (both the link challenge and the link exchange)
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
and the removed legacy `authProviders` input. The only identity data any
serializer emits is the owner's own provider + `linkedAt` (see "Public
linked-identity state"); subjects are never serialized.

Startup verifies this index read-only (see "Startup index verification") but
still never creates it.

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
