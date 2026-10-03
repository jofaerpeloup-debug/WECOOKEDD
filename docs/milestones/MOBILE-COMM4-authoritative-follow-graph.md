# MOBILE-COMM4 — Authoritative Follow Graph and Following Community Feed

**Phase:** FINALIZE FOR PR
**Status:** IMPLEMENTATION COMPLETE — INDEPENDENT REVIEW FINDINGS FIXED — CLOSURE PASS
**Audit baseline:** `main @ 76e62fb8d1b2e9b41ec77fc754b243c950714286`
**Audit authority:** `docs/milestones/MOBILE-COMM4-read-only-contract-audit.md`
**Roadmap authority:** `docs/milestones/MOBILE-PARITY-AUDIT2-final-product-parity-audit.md`
**Verdict:** `MOBILE-COMM4 FINALIZED — READY TO MERGE (LIVE-MONGO + DEVICE RUNTIME DEFERRED)`

This document freezes exactly the audited MOBILE-COMM4 milestone. Implementation must preserve the existing `Route → validation/authentication → controller → service → repository → Mongoose → MongoDB` architecture and must stop before changing any production or test file outside the allowlists below.

## 1. Frozen schema and index contract

Add a first-class `CommunityFollow` relation inside the Community module:

```js
{
  followerId: ObjectId<User>,     // required
  followedUserId: ObjectId<User>  // required
}
```

- Persist `createdAt` only. There are no mutable fields and no `updatedAt`.
- Model and service validation both reject equal canonical follower and followed-user IDs.
- Enforce one directed relation with the physical unique compound index:

```js
{ followerId: 1, followedUserId: 1 } // unique
```

- Add the Following-feed access index to `CommunityPost`:

```js
{ authorId: 1, createdAt: -1, _id: -1 }
```

- Preserve the existing global `{ createdAt: -1, _id: -1 }` post index.
- Do not add a reverse follow index, denormalized follow arrays, cached counts, migrations, or backfills.
- Do not change `User` schema or persist follow state on users, posts, or devices.

## 2. Frozen API contract

### Follow

`POST /api/v1/community/users/:userId/follow`

- Authentication is required and the actor is only `req.auth.userId`.
- `userId` must be a strict valid ObjectId. No body or query fields are accepted.
- Success: `200 { success: true, data: { following: true } }`.
- Repeated POST requests and duplicate-key races are idempotent success.
- Self-follow: `400 COMMUNITY_SELF_FOLLOW_NOT_ALLOWED`.
- Missing or deleted target: `404 COMMUNITY_FOLLOW_TARGET_NOT_FOUND`.
- After insertion, recheck target existence. If target deletion won the race, remove the relation and return the same safe 404.

### Unfollow

`DELETE /api/v1/community/users/:userId/follow`

- Authentication, actor derivation, strict ObjectId validation, and empty body/query rules match POST.
- Success: `200 { success: true, data: { following: false } }`.
- Repeated DELETE requests are idempotent.
- Remove the authenticated actor/target pair without requiring the target to exist so orphaned relations can be cleaned up.

Malformed IDs remain `400 VALIDATION_ERROR`. Authentication failures retain existing codes. Unexpected database/index details and duplicate-key information must never reach clients. No public follow-list endpoint is added.

## 3. Frozen Following-feed contract

`GET /api/v1/community/posts/following?page=1&limit=20`

- Authentication is required; only the caller's authoritative follow relations are used.
- `page` is an integer at least 1 and defaults to 1.
- `limit` is an integer from 1 through 100 and defaults to 20.
- Resolve followed IDs in one repository query, intersect them with currently existing users, then query and count posts using those author IDs.
- Exclude missing/deleted targets and their posts. An empty follow graph returns an empty valid page.
- Sort deterministically by `{ createdAt: -1, _id: -1 }`.
- Return the existing feed envelope:

```js
{
  posts: [...],
  pagination: { page, limit, total, totalPages }
}
```

- Offset-pagination semantics remain aligned with the global feed.
- Follow-state changes invalidate and reset Following pagination. Cross-device follow changes become visible on refresh.
- The existing authenticated `GET /api/v1/community/posts` remains the chronological global All feed.

Every post is serialized as the exact allowlisted shape:

```js
{
  id,
  caption,
  createdAt,
  author: { id, name, avatarUrl } | null,
  recipeAttachment,
  likeCount,
  likedByCurrentUser,
  commentCount,
  isOwner,
  isFollowingAuthor
}
```

- `isFollowingAuthor` is always Boolean and is `false` for the viewer's own or a missing author.
- Obtain viewer follow metadata in bulk; do not introduce per-post queries.
- Comments retain the PROFILE2 author shape and gain no follow metadata.
- Never serialize relation IDs/documents, `CommunityFollow` timestamps, email, bio, cooking level, preferences, role, status, auth identities, or avatar asset metadata.
- No follower or following counts are exposed.

## 4. Frozen mobile contract

- `CommunityScreen` exposes exactly two modes: `All` and `Following`.
- `All` remains the default chronological global feed and must not be labeled as ranked `For You`.
- Route each mode to its server endpoint. Switching mode clears comments, invalidates the prior feed operation, resets pagination, and starts a fresh page-one request.
- Preserve the composer, avatars, likes, comments, recipe attachments, refresh, and pagination behavior.
- Show an accessible `Follow`/`Following` control only for an existing author other than the authenticated user. Missing/self authors never show it.
- Follow mutations are pessimistic and single-flight per author ID.
- Own pending mutations with tokenized `Map` entries keyed by author ID. Duplicate taps for that author are suppressed without blocking other authors.
- A confirmed response updates every visible card by that author from the authoritative Boolean.
- Unfollowing while in Following performs a guarded page-one reload; the client must not guess rows or totals.
- Creating the viewer's post while Following is active must not insert that ineligible post into the Following feed.
- Mutation failure preserves cards, mode, pagination, and follow state and presents safe guidance.
- A late All response cannot populate Following and a late Following response cannot populate All.
- A feed read begun before a follow mutation cannot restore stale follow state, rows, or pagination.
- An old-account mutation resolving after account switch, including for the same author ID, cannot update UI, show an alert, or clear the new account's pending token.
- Unmounted continuations do nothing. Generation, authenticated-owner, mutation-version, and operation-token ownership must guard state and finalizers.
- Strictly validate both feed variants, pagination, PROFILE2 public authors, `isFollowingAuthor`, and follow responses. A malformed 2xx response is unavailable, never empty data or mutation success.
- Following empty state title: `Not following anyone yet`.
- Following empty state guidance: `Tap Follow on a post's author to see their cooking here.`
- Do not render Saved, Trending, or For You controls.

## 5. Frozen security and ownership rules

- Authentication runs before validation and controller execution.
- Client-supplied follower IDs, actors, counts, roles, or relation state are rejected or structurally impossible to use as authority.
- All active authenticated users, including currently supported roles, have identical follow permissions. Admins have no override.
- `User.status` continues to govern authentication only; COMM4 does not invent a feed-specific takedown policy.
- No private-profile, block, or content-moderation model is introduced. Following is a subset of the existing authenticated global feed and grants no additional access.
- Missing and deleted targets receive the same safe not-found result.
- Public author serialization stays exactly `{ id, name, avatarUrl }`; raw User and relation documents never cross the API boundary.

## 6. Exact production allowlist

- `apps/api/src/modules/community/community-follow.model.js` — new
- `apps/api/src/modules/community/community-follow.repository.js` — new
- `apps/api/src/modules/community/community-post.model.js`
- `apps/api/src/modules/community/community.repository.js`
- `apps/api/src/modules/community/community.validation.js`
- `apps/api/src/modules/community/community.service.js`
- `apps/api/src/modules/community/community.serializer.js`
- `apps/api/src/modules/community/community.controller.js`
- `apps/api/src/modules/community/community.routes.js`
- `apps/mobile/src/api/communityService.js`
- `apps/mobile/src/api/communityErrors.js`
- `apps/mobile/src/screens/CommunityScreen.js`

No User, navigation, `AuthContext`, package, configuration, migration, notification, or other screen changes are permitted. Any required expansion must stop for a new audit decision.

## 7. Exact test allowlist

- `apps/api/test/community-model.test.js`
- `apps/api/test/community-repository.test.js`
- `apps/api/test/community-routes.test.js`
- `apps/api/test/community-follow-mongo.test.js` — new isolated live-Mongo gate
- `apps/mobile/__tests__/communityService.test.js`
- `apps/mobile/__tests__/communityStaticAudit.test.js`
- `apps/mobile/__tests__/communityInteraction.test.js`

## 8. Verification gates

### Backend automated proof

- Prove exact schema fields, absence of mutable/timestamp extras, self-follow validation, the unique compound follow index, and the author/feed post index.
- Prove authentication, strict path/body/query rejection, server actor derivation, self/missing/deleted target behavior, repeat follow/unfollow idempotency, safe duplicate-key handling, and cleanup when target deletion wins the insertion race.
- Prove Following isolation, empty graphs, deleted targets, multi-author deterministic ordering, exact totals, page bounds, and stable `_id` tie-breaks.
- Prove bulk viewer follow metadata without per-post queries.
- Use poisoned User fixtures to prove the exact PROFILE2 author allowlist and absence of counts, relation data, and persistence metadata.

### Mobile automated proof

- Prove exact endpoints and encoded IDs, no body/identity fields, and strict success/feed validation.
- Use mounted interactions to prove All/Following switching, pagination, refresh, empty/error/retry behavior, pessimistic per-author single-flight mutations, duplicate-tap suppression, failure preservation, all-card reconciliation, guarded unfollow reload, and own-post exclusion in Following.
- Prove mode, generation, owner/account, mutation-version, operation-token, and unmount ownership with visibly corrupting stale fixtures. Removing any guard must make its race test fail.
- Preserve all COMM3 comment, like, feed, and race coverage.

### Required isolated live-Mongo gate

- Run `apps/api/test/community-follow-mongo.test.js` only against a dedicated isolated non-production MongoDB database.
- Build and inspect the real physical indexes.
- Prove concurrent duplicate follow attempts result in exactly one relation row and safe idempotent API behavior.
- Mocked duplicate errors, Mongoose schema metadata, source assertions, and ordinary unit tests do not satisfy this gate.
- Never point this test at or mutate production data.
- Physical uniqueness/concurrency may be reported `PASS` only after recording the isolated database identity and a successful result.

### Closure gates

- Run focused backend and mobile suites, followed by relevant Community regression coverage.
- Run the exact static/scope audit across both production and test allowlists.
- Run `git diff --check`, inspect exact diff/stat/status including new files, and complete an independent read-only adversarial review.
- Device/emulator, accessibility, and other runtime gates must be reported accurately as passed or deferred; automated tests do not substitute for them.

## 9. Deferred scope

- Public profiles and author-profile navigation.
- Public follower/following lists and follower/following counts.
- Post bookmarks and Saved feed (`MOBILE-COMM5`).
- Avatar/recipe CTA/final-card work (`MOBILE-COMM6`) except preserving current behavior.
- Server-ranked Trending and For You feeds (`MOBILE-COMM7`).
- Community notification inbox, push delivery, and follow/like/comment notification producers (`MOBILE-NOTIF1` through `MOBILE-NOTIF3`).
- Blocks, mutes, private-account approvals, recommendations, rankings, and suggested users.
- New packages, navigation routes, global providers/contexts, authentication changes, User schema changes, migrations, and backfills.
- Device/emulator runtime, visual polish, gestures, and accessibility runtime may remain deferred, but must not be claimed as passed unless actually verified.

## 10. Blockers

- No blocker prevents independent code review from starting.
- The isolated live-Mongo verification remains required to claim physical-index and concurrent duplicate-follow verification as passed, but it is deferred by project decision and is not an implementation-completion blocker.
- Approved non-production Atlas credentials cannot create the required test collection/index, and local MongoDB is unavailable.

## 11. Freeze constraints

- This evidence-update phase makes no production or test implementation change and authorizes no staging, commit, push, branch, dependency, database, or stash operation.
- Production data must not be mutated.
- The protected Cook Mode stash must not be inspected, applied, dropped, or changed.

## 12. Contract-freeze verdict (historical)

**MOBILE-COMM4 CONTRACT FROZEN — READY FOR IMPLEMENTATION**

## 13. Closure evidence update (2026-10-04)

The implementation is complete, all independent review findings are fixed, and the closure verdict is **PASS**. No full suite was rerun during this evidence-only update.

- Backend: **54/54 PASS**.
- Mobile regression: **84/84 PASS**.
- Focused fix tests: **68/68 PASS**.
- Exact **20-path scope audit: PASS**.
- `git diff --check`: **PASS**.
- Production database: **NOT USED**.
- The compound unique index requirement remains unchanged.
- The concurrent duplicate-follow correctness requirement remains unchanged.
- `apps/api/test/community-follow-mongo.test.js` remains in place.
- Production implementation remains unchanged by this update.

## 14. Deferred live-Mongo verification

**LIVE-MONGO GATE: DEFERRED BY PROJECT DECISION — NOT PASSED — NOT CLAIMED AS PASS.**

Reason: approved non-production Atlas credentials cannot create the required test collection/index, and local MongoDB is unavailable. The isolated live-Mongo gate was not run against production, and production data was not used or mutated.

This deferral does not weaken or remove the physical compound unique-index requirement, the concurrent duplicate-follow correctness requirement, the isolated live-Mongo test file, or the production implementation.

## 15. Remaining risk

The real MongoDB physical index and concurrent duplicate-follow behavior have not been verified in an isolated live database. Automated schema, repository, route, mobile, and static/scope evidence does not substitute for that runtime proof. Physical uniqueness and concurrent duplicate-follow behavior therefore remain unverified and must not be reported as passed.

## 16. Current blockers

- Implementation: **COMPLETE**.
- Independent review findings: **FIXED**.
- Closure: **PASS**.
- Device/runtime verification: **DEFERRED**.
- Claiming the live-Mongo gate as passed: **BLOCKED** until an approved isolated non-production MongoDB environment permits creation and inspection of the required collection/index and the concurrent-follow test passes.

## 17. Current verdict

**MOBILE-COMM4 FINALIZED — READY TO MERGE**
**(LIVE-MONGO + DEVICE RUNTIME DEFERRED)**
