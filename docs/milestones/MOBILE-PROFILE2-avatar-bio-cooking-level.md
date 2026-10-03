# MOBILE-PROFILE2 — Avatar, Bio and Cooking Level

## 1. Status and authority

- Audit input: **MOBILE-PARITY-AUDIT2 COMPLETE**
- Contract freeze: **COMPLETE**
- Implementation: **COMPLETE**
- Independent review findings: **FIXED**
- Closure review: **PASS**
- Focused tests: **395/395 PASS**
- Provider/device/database runtime: **DEFERRED — NOT RUN — NOT CLAIMED PASS**
- Baseline: `main` at `15cdb5328548631f679b275ede03b3725f01c500`

This contract is frozen against `/AGENTS.md`,
`docs/milestones/MOBILE-PARITY-AUDIT2-final-product-parity-audit.md`, and the
live User, upload, Community, Profile, Account Details, authentication-state,
and mobile API-client paths at the baseline above. MongoDB and the
authenticated API remain authoritative. No database, implementation, index,
branch, dependency, remote, or stash is changed by this freeze.

## 2. Frozen product boundary

MOBILE-PROFILE2 adds one real owner profile identity slice:

- an optional avatar managed only through dedicated upload/reset endpoints;
- an owner-editable bio;
- an owner-editable cooking level; and
- an avatar-bearing, field-allowlisted Community author projection.

`GET /api/v1/users/me` remains the owner hydration endpoint. Profile and
Account Details continue to read the authenticated `user` held by
`AuthContext`; writes continue through the shared authenticated API client and
then reconcile only the authoritative server response for the same still
authenticated user. No local profile store, mock record, client-generated
asset identity, or public-profile feature is introduced.

## 3. Frozen User schema and self serializer

Add exactly these profile fields to `User`:

```js
bio: {
  type: String,
  trim: true,
  maxlength: 500,
  default: ''
}
cookingLevel: {
  type: String,
  enum: ['beginner', 'intermediate', 'advanced'],
  default: 'beginner'
}
avatar: {
  url: required HTTPS String when avatar is present,
  assetId: required non-empty String when avatar is present
} | null
avatarRevision: non-negative integer, default 0
```

`avatar` is a private persistence subdocument. Both leaves are present or the
whole value is `null`; partial avatar state is invalid. `assetId` and
`avatarRevision` are internal lifecycle metadata and are never serialized.
The public name `avatarUrl` is derived from `avatar.url` and is `null` when no
managed avatar exists.

The existing owner/self serializer used by authenticated registration, login,
social-login/link, `GET /users/me`, and self mutations adds exactly:

```js
{
  // existing owner fields remain unchanged
  avatarUrl: string | null,
  bio: string,
  cookingLevel: 'beginner' | 'intermediate' | 'advanced'
}
```

`bio` and `cookingLevel` are owner-only. They must remain absent from admin
user summaries, Community authors, reviews, audit records, and every other
cross-user projection. `avatar`, `assetId`, and `avatarRevision` remain absent
from every API response, including the owner response.

## 4. Frozen `PATCH /api/v1/users/me` contract

The existing authenticated route, envelope, response status, strict unknown-
field rejection, field-by-field `$set`, and preference semantics remain
unchanged. Its strict body allowlist becomes:

```js
{
  name?: string,                         // existing trimmed 1..100
  bio?: string,                          // trimmed 0..500; '' clears
  cookingLevel?: 'beginner' | 'intermediate' | 'advanced',
  preferences?: {                        // existing contract unchanged
    dietaryPreferences?: string[],
    allergies?: string[],
    notifications?: { enabled: boolean }
  }
}
```

At least one top-level field is required. Omitted fields remain untouched.
The client cannot mutate `avatar`, `avatarUrl`, `assetId`, `avatarRevision`,
`userId`, `id`, email, role, status, verification state, auth identities,
timestamps, or any other field through this endpoint. Those keys receive the
existing `400 VALIDATION_ERROR`. Successful mutation returns `200` with the
authoritative owner serializer as `{ user }` in the standard success envelope.

## 5. Dedicated avatar API contract

### `POST /api/v1/users/me/avatar`

Middleware order is frozen:

`authenticate -> dedicated per-user avatar upload limiter -> multipart parser -> controller`

Authentication must finish before multer or any other multipart parser reads
the request body. The limiter is keyed only by `req.auth.userId`, has its own
counter, and permits **10 upload attempts per authenticated user per 15
minutes**. It does not share a budget with auth, recipe upload, import,
ingredient-resolution, or Assistant routes. Rejection uses the existing safe
`429 RATE_LIMIT_EXCEEDED` envelope.

The request is `multipart/form-data` with exactly one file part named `image`,
no text fields, no second file, and no JSON body. Identity and storage data are
never request fields. Success returns `200` with `{ user }`, using the same
authoritative owner serializer as `GET /users/me`.

### `DELETE /api/v1/users/me/avatar`

This route requires authentication and accepts no body, multipart data, query,
asset id, URL, or user id. It resets only the authenticated user's avatar.
Reset is idempotent from the product perspective: resetting an already-empty
avatar is a successful `200` and still participates in the atomic revision
ordering described below. Success returns `200` with `{ user }`.

Both routes return `401 AUTH_SESSION_INVALID` if the authenticated User
disappears before the atomic persistence step. A lost avatar revision race
returns a safe `409 AVATAR_UPDATE_CONFLICT`; the client may invite an explicit
retry but must not silently replay an upload.

## 6. Avatar security and image-processing contract

The avatar path is separate from the moderator recipe-image endpoint. It may
reuse the configured image provider and narrow shared primitives, but recipe
upload authorization, response shape, and lifecycle must not change.

The server enforces all of the following before an avatar becomes public:

- accept JPEG (`.jpg`/`.jpeg`, `image/jpeg`), PNG (`.png`, `image/png`), or
  WebP (`.webp`, `image/webp`) only;
- cap the raw multipart file at **5 MiB**;
- require extension, declared MIME type, detected magic bytes, and successful
  full image decode to agree;
- reject malformed/truncated input, polyglot/non-image content, animated or
  multi-page input, any decoded width or height above **8192 pixels**, and any
  decoded image above **25,000,000 pixels**;
- normalize orientation, crop to a centered square, resize to **512 × 512**,
  strip EXIF/ICC/XMP and all other source metadata, and encode a fresh static
  WebP output;
- upload only that newly encoded buffer; never expose the original upload or
  a provider URL that can address the original upload;
- generate the provider public identity and immutable asset identity on the
  server with non-guessable randomness; and
- accept only a validated provider result with a non-empty immutable asset id,
  an HTTPS delivery URL, and the expected sanitized WebP format.

No client-supplied avatar URL, asset id, provider public id, transformation,
folder, user id, filename-derived identity, or ownership field is accepted.
File names are validation input only. SVG, GIF, HEIC/HEIF, BMP, TIFF, PDF,
video, data URLs, remote URLs, and base64 JSON are rejected.

Stable safe error families are:

- `400 AVATAR_FILE_REQUIRED`
- `400 AVATAR_FILE_MULTIPLE`
- `400 AVATAR_FILE_UNSUPPORTED`
- `400 AVATAR_FILE_INVALID`
- `413 AVATAR_FILE_TOO_LARGE`
- `429 RATE_LIMIT_EXCEEDED`
- `502 AVATAR_UPLOAD_FAILED`
- `503 AVATAR_UPLOADS_NOT_CONFIGURED`
- `409 AVATAR_UPDATE_CONFLICT`

Provider messages, credentials, signatures, storage paths, internal asset ids,
library errors, stack traces, and persistence details must never enter the
response. Logs use fixed safe messages and no uploaded bytes or secrets.

## 7. Atomic replace, reset, and cleanup contract

Every upload/reset operates on an observed `{ avatar, avatarRevision }`
snapshot. The repository persistence step is one compare-and-set query scoped
by the authenticated `_id` and the observed revision. Legacy missing revision
is treated exactly as revision `0`. A winning operation increments the revision
once and returns the post-write User.

Upload order is frozen:

1. authenticate, rate-limit, parse, validate, decode, sanitize, and upload a
   new server-identified asset;
2. compare-and-set the new private avatar pair and increment the revision;
3. if persistence fails or loses the revision race, synchronously attempt to
   delete only the newly uploaded asset and return failure; and
4. only after a successful compare-and-set, best-effort delete the old asset
   captured by that winning snapshot.

Reset compare-and-sets `avatar: null` and increments the revision, then
best-effort deletes only the old asset captured by its winning snapshot. A
losing upload/reset must never delete the snapshot asset, because another
operation may still own it. Cleanup is addressed only by immutable provider
asset id, never by URL.

This revision rule is mandatory for upload/upload, upload/reset, and
reset/reset overlap. A losing upload cleans up its own new asset. A winner may
clean up only the exact predecessor it atomically replaced. Because asset
identities are server-generated and never reusable by a client, a predecessor
cannot later become active again. Cleanup failure is logged safely and must not
roll back a successful database mutation, leak internals, or delete/rewrite
the final active asset.

## 8. Safe Community public-author contract

The only cross-user author shape for both Community posts and comments is:

```js
{ id, name, avatarUrl }
```

`avatarUrl` is either the sanitized managed HTTPS delivery URL or `null`.
User bulk lookup must project only `_id`, `name`, and `avatar.url`; the user
service maps those fields into a new object, and the Community serializer
again constructs the exact public-author shape field-by-field. It must never
spread a User object or expose bio, cooking level, email, preferences, role,
status, auth identities, verification state, asset id, revision, timestamps,
or arbitrary schema fields. A missing/deleted author remains `author: null`.

There is no public User endpoint and no author navigation in this milestone.

## 9. Frozen mobile behavior

`ProfileScreen` displays the authenticated user's real `avatarUrl`, bio, and
cooking level. A missing avatar keeps the current accessible initial fallback;
a blank bio is rendered honestly without invented copy or data. Cooking-level
labels are presentation mappings of the three server enum values only.

`AccountDetailScreen` replaces the unavailable avatar/bio controls with:

- photo-library selection only (no camera flow in this milestone);
- current-avatar preview with accessible initial fallback;
- explicit replace/upload progress, safe failure guidance, and retry;
- confirmed reset when an avatar exists;
- an editable bio capped at 500 characters with a visible count; and
- a single-select Beginner / Intermediate / Advanced cooking-level control.

Image-picker cancellation is a no-op. Client size/type checks are UX hints
only; server validation remains authoritative. Multipart contains only the
picker file under `image`; it never sends identity, URL, asset id, or provider
data. The shared client must recognize `FormData`, omit a manual `Content-Type`
so React Native supplies the boundary, retain bearer auth and the one bounded
refresh/retry, and preserve existing JSON calls unchanged.

Profile save, avatar upload, and avatar reset are pessimistic and mutually
single-flight on Account Details. No success UI, local avatar change, form
clear, navigation, or AuthContext reconciliation occurs until a valid server
success arrives. Failure preserves the current authoritative avatar and
unsaved bio/name/preferences. Accepted responses pass through the existing
same-user `syncUser` guard. Account change, sign-out, superseding operation,
or unmount invalidates continuations and finalizers so stale work cannot alter
the next account, navigate, alert, or clear a newer pending state.

`CommunityScreen` renders post and comment author avatars from
`author.avatarUrl`, with the current initial fallback for `null`/missing
authors. It does not derive avatars from names, emails, local files, or owner
state and does not add public-profile navigation.

## 10. Migration and default behavior

No database mutation or bulk migration is required or authorized. New Users
persist the schema defaults. Existing documents with absent fields are read as:

```js
{
  avatarUrl: null,
  bio: '',
  cookingLevel: 'beginner'
}
```

An absent persisted `avatarRevision` is treated as `0` by both serialization
and the first compare-and-set predicate; the first successful avatar mutation
persists the incremented revision. Normal profile edits may persist only the
explicit supplied profile leaves and must not perform opportunistic backfills.
Rollback-safe legacy reads therefore require no pre-deploy data rewrite.

## 11. Exact production allowlist

Only these production/configuration files may change during implementation:

- `package-lock.json`
- `apps/api/package.json`
- `apps/api/.env.example`
- `apps/api/src/config/env.js`
- `apps/api/src/middleware/rate-limiter.js`
- `apps/api/src/modules/users/user.model.js`
- `apps/api/src/modules/users/user.validation.js`
- `apps/api/src/modules/users/user.serializer.js`
- `apps/api/src/modules/users/user.repository.js`
- `apps/api/src/modules/users/user.service.js`
- `apps/api/src/modules/users/user.controller.js`
- `apps/api/src/modules/users/user.routes.js`
- `apps/api/src/modules/uploads/upload.middleware.js`
- `apps/api/src/modules/uploads/avatar-image.service.js` (new)
- `apps/api/src/modules/uploads/cloudinary-image.provider.js`
- `apps/api/src/modules/community/community.serializer.js`
- `apps/mobile/package.json`
- `apps/mobile/app.config.js`
- `apps/mobile/src/api/client.js`
- `apps/mobile/src/api/profileService.js`
- `apps/mobile/src/api/communityService.js`
- `apps/mobile/src/screens/ProfileScreen.js`
- `apps/mobile/src/screens/AccountDetailScreen.js`
- `apps/mobile/src/screens/CommunityScreen.js`

The dependency additions are limited to an API image decoder/transformer
capable of enforcing this contract and Expo's compatible photo-library picker.
No unrelated upgrade, deduplication, or lockfile regeneration is allowed. No
route-mount, navigation, AuthContext, theme, recipe-upload contract, database
bootstrap, migration script, or provider replacement is expected. If another
production file proves necessary, implementation must stop and justify the
exact allowlist expansion before changing it.

## 12. Exact test allowlist and mutation-resistant proof

Only these test files may change during implementation:

- `apps/api/test/env.test.js`
- `apps/api/test/rate-limiter.test.js`
- `apps/api/test/user-model.test.js`
- `apps/api/test/user-validation.test.js`
- `apps/api/test/user-repository.test.js`
- `apps/api/test/user-service.test.js`
- `apps/api/test/user-routes.test.js`
- `apps/api/test/avatar-image-upload.test.js` (new)
- `apps/api/test/avatar-image-lifecycle.test.js` (new)
- `apps/api/test/cloudinary-image-provider.test.js`
- `apps/api/test/community-routes.test.js`
- `apps/mobile/__tests__/clientMultipart.test.js` (new)
- `apps/mobile/__tests__/profileService.test.js` (new)
- `apps/mobile/__tests__/profileStaticAudit.test.js`
- `apps/mobile/__tests__/accountDetailsStaticAudit.test.js`
- `apps/mobile/__tests__/profileInteraction.test.js` (new)
- `apps/mobile/__tests__/communityService.test.js`
- `apps/mobile/__tests__/communityStaticAudit.test.js`
- `apps/mobile/__tests__/communityInteraction.test.js`

Backend tests must use real decodable fixtures, not header-only fake images,
and prove authentication happens before multipart consumption; limiter
isolation/keying; exact multipart limits; MIME/extension/magic/decode agreement;
truncation, animation, dimension and pixel rejection; metadata stripping;
512-square WebP output; server-generated identity; safe provider-result
validation; strict PATCH/body rejection; defaults; owner-only serialization;
and the exact public-author allowlist.

Lifecycle tests must deterministically interleave upload/upload, upload/reset,
reset/upload, lost compare-and-set, provider failure, persistence failure, and
cleanup failure. They must fail if a loser deletes the observed predecessor,
if a failed persistence does not attempt cleanup of its new asset, if a winner
deletes its newly active asset, or if any overlap can delete the final active
asset. Assertions that merely inspect source text or call order without
discriminating the final database/provider ownership state are insufficient.

Mobile transport tests must prove JSON behavior is unchanged, multipart omits
manual `Content-Type`, auth refresh retries remain bounded, and request bodies
contain only the frozen fields. Mounted interaction tests must prove real
picker cancel/upload/reset/save behavior, pessimistic state, failure
preservation, single-flight operation ownership, same-account reconciliation,
stale account/unmount suppression, accessible initial fallback, and Community
post/comment avatar rendering. Static presence checks alone are insufficient.

## 13. Explicit deferred and out-of-scope scope

- Standalone public profiles or author-profile navigation
- Bio or cooking level in any public/cross-user projection
- Follows, followers, Following feed, bookmarks, Saved/Trending/For You feeds
- Badges, streaks, rankings, reputation, or fabricated profile statistics
- Camera capture, avatar gallery, crop editor, filters, animated avatars, or
  arbitrary remote-avatar URLs
- Recipe/post/comment image uploads or recipe-image lifecycle changes
- Email change, password/security changes, MFA, role/status management
- Notification preferences, inbox, push delivery, or Community notifications
- Admin avatar/profile editing or moderation tooling
- New navigation routes, theme redesign, local profile persistence, mocks, or
  AsyncStorage domain authority
- Bulk database migration/backfill or database mutation during freeze
- CDN/provider migration, background orphan sweeper, or multi-provider storage
- Cook Mode work or any inspection/modification of its protected stash
- Staging, commit, push, deployment, emulator/device, or live-provider runtime

## 14. Final evidence and verdict

Implementation is complete. Independent review findings were fixed, closure
review passed, and the focused automated result is **395/395 PASS**.

Provider, authenticated device, and database runtime remain deferred. They were
not run and are not claimed as passing.

**MOBILE-PROFILE2 FINALIZED — READY TO MERGE (RUNTIME DEFERRED)**
