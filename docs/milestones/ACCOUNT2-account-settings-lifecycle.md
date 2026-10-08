# ACCOUNT2 — Account Settings Lifecycle v1

**Phase:** Contract amendment — session generation

**Baseline:** `origin/main` = `291b3ee487c4c06d773261969826023fb687c033`

**Status:** Frozen; implementation is separately authorized.

This document persists the approved ACCOUNT2 v1 contract. It authorizes no production or test implementation, migration, package change, commit, or push.

## 1. Email-change lifecycle

1. Security displays the authoritative current email from `GET /api/v1/users/me`.
2. Email change is available only to an active account with a local password, including a password account that also has linked social identities.
3. The user submits `newEmail` and `currentPassword`.
4. The API:
   - normalizes email using the existing trim/lowercase/email rules;
   - verifies the current password using the existing password comparison path;
   - rejects the current email and an already-registered email;
   - creates a random, domain-separated email-change token;
   - stores only its digest, pending email, and expiry;
   - replaces any previous pending request for that user;
   - sends the verification link to the pending address;
   - sends a security notice to the current address.
5. Until verification succeeds:
   - `user.email` remains unchanged;
   - login continues using the current email;
   - `emailVerified` remains unchanged;
   - pending email is not an identity, login address, or public value.
6. Token lifetime reuses `EMAIL_VERIFICATION_TTL_MINUTES`, currently defaulting to 1,440 minutes.
7. Verification atomically matches an unexpired digest, changes `email`, sets `emailVerified: true`, and clears:
   - pending email-change fields;
   - the consumed email-change token;
   - any old ordinary email-verification token.
8. The current email's unique index is authoritative at commit time. If another account won the address meanwhile, verification fails with `409 USER_EMAIL_ALREADY_EXISTS`, invalidates that pending request, and requires a new request.
9. Successful verification atomically advances `User.sessionGeneration`, making every session from an earlier generation stale, including the verifier device. The mobile client clears local credentials and returns to Login.
10. The old address receives a completion notice. Mail-delivery failure is logged and never rolls back an already-committed identity change.
11. Verification tokens are one-use. Replay, expiry, malformed tokens, replaced requests, and cancelled requests all return the same `400 AUTH_EMAIL_CHANGE_TOKEN_INVALID`.
12. Cancellation clears only the matching user's pending email-change fields. It does not change the current email or sessions.

Provider-only accounts receive `AUTH_EMAIL_CHANGE_PASSWORD_UNAVAILABLE`. ACCOUNT2 does not invent provider reauthentication.

## 2. Deactivation lifecycle

- Deactivation is reversible account-access deactivation, not deletion.
- `POST /auth/deactivate` requires an authenticated active session and the exact confirmation string `DEACTIVATE`.
- The winning database write:
  - sets `deactivatedAt`;
  - clears pending email change, password-reset, and ordinary email-verification credentials;
  - atomically advances `sessionGeneration`.
- That generation advance invalidates every session from an earlier generation. Any later physical cleanup is bounded to stale generations and is not part of the validity decision.
- `authenticate` and refresh independently reject any user with `deactivatedAt` and any session whose effective security generation does not exactly equal the user's effective current generation, so failed, incomplete, or delayed cleanup cannot preserve access.
- Mobile clears local credentials and returns to Login after success.
- While deactivated:
  - refresh and authenticated endpoints fail;
  - the email remains reserved;
  - stored profile/preferences/content remain;
  - existing public posts, recipes, comments, or attribution are not deleted or hidden;
  - no retention or permanent-deletion claim is made.
- A successful normal sign-in is the explicit reactivation action:
  - password login uses the current email/password;
  - Google login uses an already-linked Google identity;
  - the API atomically clears the observed `deactivatedAt` under the observed generation, then issues a new session bound to the exact committed current generation.
- Suspension overrides reactivation. A suspended account cannot reactivate itself.
- Login/deactivation races use observed-state compare-and-set behavior:
  - a login that observed an active account cannot survive a later deactivation;
  - a login that observed the deactivated state may reactivate only that exact state;
  - a later deactivation advances the generation and invalidates the provisional session before it can be returned or continued.
- Permanent deletion, anonymization, content removal, and retention-policy changes remain out of scope.

## 3. Dietary Preferences

Ordered preset chips, stored using these exact display strings:

1. `Vegetarian`
2. `Vegan`
3. `Pescatarian`
4. `Gluten-Free`
5. `Dairy-Free`
6. `Halal`
7. `Kosher`

Presets are mobile editing conveniences, not an API enum or recipe taxonomy.

Custom behavior:

- Users can add, edit, and remove custom values.
- Selecting a preset appends its canonical value when absent; deselecting removes the matching value.
- Existing values not matching a preset remain visible, editable, removable, and preserved on save.
- Hydration never rewrites unknown values.
- No comma splitting: one submitted custom entry is one array value.

## 4. Allergies & Ingredients to Avoid

This remains a separate `preferences.allergies` array. Ordered presets:

1. `Peanuts`
2. `Tree Nuts`
3. `Milk`
4. `Eggs`
5. `Wheat`
6. `Gluten`
7. `Soy`
8. `Fish`
9. `Shellfish`
10. `Sesame`

These are user-entered avoidance notes only. Selection does not certify medical diagnosis, ingredient completeness, cross-contamination protection, or recipe safety.

Unknown legacy values receive the same preservation and editing behavior as dietary preferences.

## 5. Validation and deduplication

For each array independently:

- Maximum 20 stored entries.
- Maximum 50 characters per trimmed entry.
- Empty or whitespace-only entries are invalid.
- Leading/trailing whitespace is removed.
- Internal whitespace and original spelling are otherwise preserved.
- No Unicode normalization or taxonomy aliasing.
- Deduplication key is `trimmedValue.toLowerCase()`.
- First occurrence and its spelling win; order is preserved.
- Editing into an existing comparison key is rejected as `Already added`.
- Presets and custom values share the same 20-entry cap.
- The API applies the same normalization/deduplication as mobile.
- `[]` explicitly clears that array; omission leaves it unchanged.
- PATCH continues using independent dot paths so changing one preference array cannot replace its sibling fields.
- Concurrent whole-array writes remain last accepted write wins.

## 6. API/mobile contract

| Endpoint | Strict body | Result |
| --- | --- | --- |
| `POST /api/v1/auth/email-change` | `{ newEmail, currentPassword }` | `{ pendingEmailChange: { email, expiresAt } }` |
| `POST /api/v1/auth/email-change/cancel` | `{}` | `{ pendingEmailChange: null }` |
| `POST /api/v1/auth/email-change/verify` | `{ token }` | `{ emailChanged: true }`; all prior sessions revoked |
| `POST /api/v1/auth/deactivate` | `{ confirmation: "DEACTIVATE" }` | `{ deactivated: true }`; all sessions revoked |
| `GET /api/v1/users/me` | — | Existing self user plus `pendingEmailChange` or `null` |
| `PATCH /api/v1/users/me` | Existing preference shape | Both arrays remain free-form normalized `string[]` values |
| Existing password/session endpoints | Unchanged | Reused without parallel implementations |

Mobile placement:

- Account Details keeps current-email display and links email security work to Security.
- Security owns email change/cancel status, existing Change Password, existing Sign Out All Devices, and Deactivate Account.
- A dedicated `wecooked://verify-email-change?token=…` screen consumes email-change tokens in either auth stack.
- Token values remain transient route state and are never logged or stored.
- Dietary and avoidance chips remain in Account Details.
- Profile labels become "Dietary Preferences" and "Allergies & Ingredients to Avoid."

## 7. Auth, session, and race invariants

- All protected identity comes from `req.auth.userId`; no body-supplied user ID or email establishes ownership.
- Password comparison is timing-safe and rate-limited.
- Raw tokens never enter MongoDB, mobile storage, logs, analytics, or API responses.
- Latest email-change request wins for one user.
- Verification uses digest-and-expiry compare-and-set; only one concurrent verifier succeeds.
- Verification cannot clear a newer pending request.
- Email uniqueness is rechecked by the existing authoritative unique index at commit.
- `User.sessionGeneration` is a non-negative integer with default `0`. A legacy User document missing the field has effective generation `0`.
- `Session.securityGeneration` is a non-negative integer. Every new session persists the exact effective `User.sessionGeneration` observed from the authoritative user write/read that permits issuance.
- A legacy Session document missing `securityGeneration` has effective generation `0`; it is valid only while the user's effective current generation is also `0` and all other session/account checks pass.
- Authentication middleware, refresh, rotation, and every session continuation accept a session only when its effective `securityGeneration` exactly equals the user's effective current `sessionGeneration`. A mismatch fails as an invalid session and no replacement token or continuation is issued.
- Every operation whose contract invalidates all sessions atomically increments `User.sessionGeneration` in the winning authoritative User write. The value never decreases or resets.
- Email-change verification and deactivation perform their state mutation, credential cleanup, and generation increment in the same atomic User write. Password change, password reset, Sign Out All Devices, and any other existing all-session invalidation path use the same generation authority.
- An active-to-suspended status transition atomically advances the target user's generation. Admin suspension recovery and deactivated-account reactivation compare against the observed status/deactivation state and generation; recovery never restores an older generation, and any newly issued session binds to the committed current generation.
- Physical session deletion is best-effort storage cleanup only. A cleanup may delete only generations proven stale relative to the generation committed by its triggering write; a delayed cleanup must not delete a session at that committed generation or any later generation.
- Existing `Session.createdAt` behavior remains unchanged as non-security metadata. `securityIssuedAt` may remain informational, but neither field, a mutation timestamp, nor cleanup timing controls invalidation or continuation.
- Same-millisecond writes and application/Mongo clock skew are irrelevant to session validity; generation comparison is the sole session-security ordering authority.
- Login's post-session fence must include the observed email, deactivation state, and session generation, in addition to the existing exact password-hash fence.
- No replacement token is issued after email-change verification or deactivation.
- Preference data remains account-private: excluded from admin summaries, public profiles, recipes, recommendation inputs, notifications, analytics, and search/filter queries.

## 8. Exact implementation allowlist

### Production files

```text
apps/api/.env.example
apps/api/src/config/env.js
apps/api/src/middleware/authenticate.middleware.js
apps/api/src/middleware/rate-limiter.js
apps/api/src/modules/auth/auth.controller.js
apps/api/src/modules/auth/auth.routes.js
apps/api/src/modules/auth/auth.service.js
apps/api/src/modules/auth/auth.validation.js
apps/api/src/modules/sessions/session.model.js
apps/api/src/modules/sessions/session.repository.js
apps/api/src/modules/sessions/session.service.js
apps/api/src/modules/users/user.model.js
apps/api/src/modules/users/user.repository.js
apps/api/src/modules/users/user.serializer.js
apps/api/src/modules/users/user.service.js
apps/api/src/modules/users/user.validation.js
apps/api/src/shared/email/email.service.js
apps/api/src/shared/email/email.templates.js
apps/api/src/shared/security/email-change-token.js
apps/mobile/src/account/accountPreferences.js
apps/mobile/src/api/authService.js
apps/mobile/src/api/errorMessages.js
apps/mobile/src/context/AuthContext.js
apps/mobile/src/navigation/RootNavigator.js
apps/mobile/src/screens/AccountDetailScreen.js
apps/mobile/src/screens/ProfileScreen.js
apps/mobile/src/screens/SecurityScreen.js
apps/mobile/src/screens/VerifyEmailChangeScreen.js
apps/mobile/src/screens/HelpCenterScreen.js
apps/mobile/src/screens/PrivacyScreen.js
```

### Test files

```text
apps/api/test/auth-link-url.test.js
apps/api/test/auth-routes.test.js
apps/api/test/auth-service.test.js
apps/api/test/auth-validation.test.js
apps/api/test/authenticate-middleware.test.js
apps/api/test/email-change-token.test.js
apps/api/test/email-service.test.js
apps/api/test/session-repository.test.js
apps/api/test/session-service.test.js
apps/api/test/user-model.test.js
apps/api/test/user-repository.test.js
apps/api/test/user-routes.test.js
apps/api/test/user-service.test.js
apps/api/test/user-validation.test.js
apps/mobile/__tests__/account2PreferencesInteraction.test.js
apps/mobile/__tests__/accountDetailsStaticAudit.test.js
apps/mobile/__tests__/authServiceVerification.test.js
apps/mobile/__tests__/deepLinkScreensStaticAudit.test.js
apps/mobile/__tests__/navigationShellStaticAudit.test.js
apps/mobile/__tests__/profileInteraction.test.js
apps/mobile/__tests__/profileService.test.js
apps/mobile/__tests__/profileStaticAudit.test.js
apps/mobile/__tests__/resetPasswordAuthTransitionAudit.test.js
apps/mobile/__tests__/securityStaticAudit.test.js
```

Any production or test file outside these lists requires a contract amendment.
The session-generation design requires no new production or test paths; the allowlists above remain exact and unchanged.

## 9. Migration and index requirements

Additive User fields:

- `pendingEmail`
- `pendingEmailChangeTokenHash` with `select: false`
- `pendingEmailChangeExpiresAt`
- `deactivatedAt`
- `sessionGeneration: non-negative integer`, default `0`

Additive Session field:

- `securityGeneration: non-negative integer`

Requirements:

- No document migration or backfill, including no User-generation or Session-generation backfill.
- Existing Users missing `sessionGeneration` and existing sessions missing `securityGeneration` each have effective generation `0`.
- A legacy generation-0 session remains subject to every existing token, expiry, account-status, and deactivation check; it becomes stale immediately when the user's generation advances above `0`.
- Missing lifecycle fields otherwise mean no pending change and active/not-deactivated.
- Preserve the existing `email` unique index.
- Add a schema-declared unique sparse index on `pendingEmailChangeTokenHash`.
- Do not index `pendingEmail`.
- Do not create a TTL index on a User timestamp—it would delete the entire User document.
- No preference migration, taxonomy conversion, data cleanup, or index is authorized.
- No device metadata or unrelated session feature is authorized.
- Production must verify the new digest index exists before release if production disables automatic index creation.

## 10. Blockers and gates

There is no remaining product or contract blocker.

Implementation/release gates, not contract blockers:

- focused mutation-resistant request/replacement/verification race tests;
- deactivation/login/session-generation, suspension/recovery, and delayed-cleanup race tests;
- real Mongo duplicate-email and index verification;
- provider delivery tests without secret/token leakage;
- authenticated and unauthenticated deep-link testing on Android and iOS;
- physical accessibility testing for chips, custom editing, destructive confirmation, and errors;
- privacy-copy verification removing the current unsupported personalization claims.

The fields do not automatically filter recipes, influence recommendations, or establish allergy-safe recipes. Any such use requires a separate contract.

## 11. Closure record

- Implementation is complete.
- Final independent re-review: **PASS**.
- API verification: **438/438 PASS**.
- Mobile compatibility verification: **178/178 PASS**.
- Combined automated verification: **616/616 PASS**.
- `git diff --check`: **PASS**.
- wecooked-dev generation/race verification: **PASS**.
- wecooked-dev `pendingEmailChangeTokenHash` unique sparse index: **PASS**.
- Existing `email_1` index: unchanged.
- No migration or backfill is required. No production database action, deployment, migration, or release was performed.

## 12. Deferred gates and production status

### Physical runtime

**DEFERRED BY PROJECT DECISION — NOT PASSED — NOT CLAIMED AS PASS**

Future gate: **QA-RUNTIME1**.

### Provider delivery

**DEFERRED BY PROJECT DECISION — NOT PASSED — NOT CLAIMED AS PASS**

No controlled test inbox/provider-observation path was available.

Future gate: **RELEASE1 pre-deployment verification**.

### Production

- `wecooked-production` was untouched.
- Production provisioning of the `pendingEmailChangeTokenHash` index remains a **PROD-DB-ALIGN1** / release gate.
- Production Brevo delivery verification remains mandatory before deployment.

## Closure verdict

**ACCOUNT2 CLOSURE PASS — READY FOR FINALIZATION COMMIT**

## Prior contract verdict

**ACCOUNT2 SESSION-GENERATION AMENDMENT FROZEN — READY FOR FIX**
