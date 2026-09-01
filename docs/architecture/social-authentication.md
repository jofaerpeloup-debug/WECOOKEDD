# Social authentication foundation (B4.0)

B4.0 establishes provider-neutral identity storage and local-password
compatibility. It does **not** expose social login, provider linking, OAuth or
OIDC verification, provider UI, challenges, or provider-backed WeCooked
sessions.

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

### B4.1 Google

Do not assume the selected native Google library can bind a WeCooked nonce into
the resulting ID token. Verify that behavior against the current library source
before implementing B4.1. If cryptographic nonce binding is supported, retain
the planned server-issued challenge. If it is not, redesign replay protection
around the provider-supported flow rather than shipping an unbound challenge.

B4.1 must not create social users through an update/upsert path that bypasses
the new-document authentication-method invariant. Continue using explicit
document creation through the reviewed `createSocialUser`/create path unless a
separately reviewed implementation proves equivalent validation and ownership
guarantees.

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
