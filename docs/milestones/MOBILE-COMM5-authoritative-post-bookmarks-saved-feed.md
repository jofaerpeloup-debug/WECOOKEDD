# MOBILE-COMM5 — Authoritative Post Bookmarks and Saved Community Feed

**Phase:** CLOSURE PASS — READY FOR FINALIZATION

**Status:** IMPLEMENTATION, INDEPENDENT REVIEW, AND CLOSURE COMPLETE — RUNTIME GATES DEFERRED

**Audit baseline:** `main @ 7eb9bcc781ee6a1585e500507c31e6f9207337de`

**Audit authority:** `docs/milestones/MOBILE-COMM5-read-only-contract-audit.md`

**Roadmap authority:** `docs/milestones/MOBILE-PARITY-AUDIT2-final-product-parity-audit.md`

**Verdict:** `MOBILE-COMM5 CLOSURE PASS — READY FOR FINALIZATION (LIVE-MONGO + DEVICE RUNTIME DEFERRED)`

This document freezes exactly the audited MOBILE-COMM5 milestone. Implementation must preserve `Route → authentication/validation → controller → service → repository → Mongoose → MongoDB` and must stop before changing any production or test file outside the exact allowlists below.

## 1. Milestone path

`docs/milestones/MOBILE-COMM5-authoritative-post-bookmarks-saved-feed.md`

## 2. Frozen schema/index contract

Add a first-class `CommunityPostBookmark` relation inside the Community module:

```js
{
  userId: ObjectId<User>,          // required
  postId: ObjectId<CommunityPost>  // required
}
```

- Persist `createdAt` only. There are no mutable fields and no `updatedAt`.
- Enforce one relation for each authenticated owner/post pair with the physical unique compound index:

```js
{ userId: 1, postId: 1 } // unique
```

- Add the post-deletion cleanup index:

```js
{ postId: 1 }
```

- Preserve the existing `CommunityPost` `{ createdAt: -1, _id: -1 }` index.
- Bookmark `createdAt` is not a Saved-feed ordering key.
- Do not add denormalized bookmark arrays, bookmark counts, cached Booleans, migrations, or backfills.
- Do not persist bookmark state on `User`, `CommunityPost`, the device, `AsyncStorage`, or `CommunityContext`.

## 3. Frozen API contract

### Bookmark

`POST /api/v1/community/posts/:postId/bookmarks`

- Authentication runs first.
- `postId` must be a strict valid ObjectId. Only an empty body and empty query are accepted.
- The actor is exclusively `req.auth.userId`.
- Any authenticated active user may bookmark any existing visible Community post, including their own.
- Success: `200 { success: true, data: { bookmarked: true } }`.
- Repeated POST requests and concurrent duplicate-key attempts are idempotent success.
- Missing or deleted post: `404 COMMUNITY_POST_NOT_FOUND`.
- Recheck post existence after insertion. If deletion won the race, delete the new relation and return the same 404.
- Never return relation IDs, owner IDs, timestamps, database errors, or duplicate-key/index details.

### Unbookmark

`DELETE /api/v1/community/posts/:postId/bookmarks`

- Authentication, strict ObjectId validation, and empty body/query rules match POST.
- Delete by the authenticated user/post pair.
- Success: `200 { success: true, data: { bookmarked: false } }`.
- Repeated DELETE requests are idempotent.
- Do not require the post to remain present so an orphaned relation can be cleaned up.

Malformed IDs remain `400 VALIDATION_ERROR`.

## 4. Frozen Saved-feed contract

`GET /api/v1/community/posts/saved?page=1&limit=20`

- Authentication is required and results are owner-scoped exclusively to `req.auth.userId`.
- `page` is an integer at least 1 and defaults to `1`.
- `limit` is an integer from 1 through 100 and defaults to `20`.
- Join the viewer's bookmark relations to currently existing Community posts before calculating page results and totals.
- Sort deterministically by post chronology:

```js
{ createdAt: -1, _id: -1 }
```

- Never order by bookmark creation time.
- Return the existing feed envelope:

```js
{
  posts: [...],
  pagination: { page, limit, total, totalPages }
}
```

- `total` counts existing saved posts, not orphan relations.
- Deleted posts disappear without tombstones. Ordinary post deletion removes their bookmark relations.
- A post with a missing author follows the existing `author: null` contract.
- A post with an unavailable recipe attachment remains saved and visible with the existing unavailable-recipe presentation.
- Refresh exposes cross-device bookmark changes.
- Bookmark eligibility changes invalidate Saved pagination. The client must not invent replacement rows or totals.

## 5. Frozen serialization contract

Every Community post has this exact allowlisted shape:

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
  isFollowingAuthor,
  bookmarkedByCurrentUser
}
```

- `bookmarkedByCurrentUser` is always Boolean and comes only from the authenticated viewer's relation.
- Every Saved row has `bookmarkedByCurrentUser: true`.
- A newly created post has `bookmarkedByCurrentUser: false`.
- Resolve bookmark metadata in bulk per page for All, Following, and Saved; do not introduce per-card queries.
- Comments gain no bookmark metadata.
- Never serialize bookmark records, bookmark IDs/timestamps, bookmark counts, user IDs beyond the approved public-author ID, or private User fields.
- Mobile strictly validates the Boolean, Saved envelope, and mutation response. A malformed 2xx response is unavailable, never empty data or mutation success.

## 6. Frozen mobile contract

- Add `FEED_SAVED`, `listSavedCommunityPosts`, and `setCommunityPostBookmarked`.
- Render exactly `All`, `Following`, and `Saved`; `All` remains the default. Saved is a Community mode, not a separate screen or the existing saved-recipes screen.
- Show a bookmark control at the far right of every valid post action row in every mode.
- Unsaved state uses an outline bookmark icon with accessible name `Bookmark post`.
- Saved state uses a filled bookmark icon, selected state, and accessible name `Remove bookmark`.
- Show no bookmark count.
- Saved empty-state title: `No saved posts yet`.
- Saved empty-state guidance: `Tap the bookmark icon on a post to find it here later.`
- Preserve the composer and existing card interactions in Saved.
- Bookmark mutations are pessimistic and single-flight per post ID using tokenized `pendingBookmarksRef` entries.
- In All or Following, confirmed mutation updates only the matching visible post from the authoritative Boolean and preserves rows, pagination, likes, comments, and follow state.
- Confirmed unbookmark in Saved performs a guarded page-one Saved reload so the card disappears and pagination is refilled authoritatively.
- A save started in another mode that resolves while Saved is active also triggers a guarded Saved reload.
- Mutation failure preserves the card, bookmark state, mode, and pagination and shows safe guidance.
- Creating a post while Saved is active does not insert it because a newly created post is not bookmarked.
- Switching mode clears comments, cancels ownership of the prior feed operation, resets rows/pagination, and requests fresh page one.
- Follow changes do not affect Saved eligibility. Following still reloads after follow-state changes. Bookmark changes do not affect Following eligibility.
- Feed reads are owned by account, mode, generation, mutation version, and operation token.
- Bookmark continuations are owned by authenticated account, mounted generation, and the exact per-post mutation token.
- A stale initial read invalidated by confirmed mutation refetches while its operation remains owned; it cannot strand loading or pagination state.
- Account change clears pending bookmark ownership, resets to All, and prevents old-account responses or alerts, including when the new account mutates the same post ID.
- Unmounted continuations perform no state update, alert, reload, or token cleanup belonging to a later operation.

## 7. Frozen security rules

- The authenticated principal is the only bookmark owner. Client-supplied user IDs, actors, relation IDs, counts, timestamps, roles, and state are rejected or structurally excluded.
- Bookmark relations are private. Do not expose who bookmarked a post, bookmark lists, or bookmark counts to authors or other users.
- Admins receive no override or cross-user Saved access.
- All currently supported active authenticated roles have identical bookmark permissions.
- Bookmarking grants no access beyond the existing authenticated Community feed.
- Do not introduce a private-profile, blocking, moderation, ranking, or notification policy.
- Missing and concurrently deleted targets return the same safe post-not-found result.
- Duplicate-key, database, and index details never cross the API boundary.
- Post deletion cleans likes, comments, and bookmarks. A save/delete race must not leave an orphan.

## 8. Exact production allowlist

- `apps/api/src/modules/community/community-post-bookmark.model.js` — new
- `apps/api/src/modules/community/community-bookmark.repository.js` — new
- `apps/api/src/modules/community/community.repository.js`
- `apps/api/src/modules/community/community.validation.js`
- `apps/api/src/modules/community/community.service.js`
- `apps/api/src/modules/community/community.serializer.js`
- `apps/api/src/modules/community/community.controller.js`
- `apps/api/src/modules/community/community.routes.js`
- `apps/mobile/src/api/communityService.js`
- `apps/mobile/src/screens/CommunityScreen.js`

No User model, navigation, `AuthContext`, context/provider, storage, package, configuration, migration, notification, ranking, or other screen changes are permitted. `communityErrors.js` reuses `COMMUNITY_POST_NOT_FOUND` and is not in scope. Any required expansion must stop for a new audit decision.

## 9. Exact test allowlist

- `apps/api/test/community-model.test.js`
- `apps/api/test/community-repository.test.js`
- `apps/api/test/community-routes.test.js`
- `apps/api/test/community-bookmark-mongo.test.js` — new isolated live-Mongo gate
- `apps/mobile/__tests__/communityService.test.js`
- `apps/mobile/__tests__/communityStaticAudit.test.js`
- `apps/mobile/__tests__/communityInteraction.test.js`

The static audit currently rejects bookmark/Saved additions as COMM6 scope. Update it deliberately within this allowlist while retaining all COMM3, COMM4, and COMM6 invariants.

## 10. Frozen verification gates

### Backend automated proof

- Prove exact schema fields, createdAt-only timestamps, unique owner/post index, and reverse post-cleanup index.
- Prove authentication before validation, strict path/body/query rejection, server actor derivation, own-post bookmarking, missing/deleted-post handling, repeated save/unsave idempotency, and safe duplicate-key handling.
- Prove post-deletion race cleanup and ordinary post deletion removing every bookmark relation.
- Prove Saved isolation between users.
- Use reverse bookmark-creation times to prove ordering still follows post `createdAt/_id`.
- Prove stable pagination, exact existing-post totals, empty pages, deleted-post omission, unavailable recipes, and missing authors.
- Prove bulk bookmark metadata for All, Following, and Saved without per-post queries.
- Prove the exact serializer allowlist and absence of relation documents, IDs, timestamps, counts, and private User fields.

### Mobile automated proof

- Prove the exact Saved endpoint, encoded bookmark IDs, bodyless mutations, and absence of identity/count fields.
- Strictly reject missing, non-Boolean, contradictory, extra-key, malformed-post, and malformed-pagination 2xx responses.
- Use mounted interactions to prove three-mode switching, loading, retry, refresh, pagination, and the exact Saved empty state.
- Prove outline/filled icons, accessibility names/state, and the authoritative Boolean on All, Following, and Saved cards.
- Prove pessimistic mutation, per-post duplicate-tap suppression, independent mutations for different posts, and failure preservation.
- Prove confirmed unbookmark in Saved causes an authoritative page-one reload with replacement-row pagination.
- Prove saving in All/Following does not change feed membership and resolving after switching to Saved reloads the current mode.
- Prove creating a post in Saved does not insert it.
- Prove late responses from every prior mode cannot populate the current mode.
- Use visibly corrupting stale payloads to prove a feed response begun before bookmark success cannot restore stale bookmark state, rows, or pagination.
- Prove an old-account mutation resolving for the same post ID cannot update UI, alert, reload, or clear the new account's token.
- Prove successful and failed continuations after unmount do nothing.
- Removing any account, mode, generation, mutation-version, operation-token, or unmount guard must make its race test fail.
- Preserve all existing comments, likes, follows, CTA, deletion, pagination, and prior race coverage.

### Required isolated live-Mongo gate

- Run `apps/api/test/community-bookmark-mongo.test.js` only against a dedicated isolated non-production MongoDB database.
- Build and inspect the real physical indexes.
- Prove concurrent saves for one authenticated owner/post pair create exactly one relation row and return safe idempotent API behavior.
- Prove both required physical indexes exist.
- Mocked duplicate errors, Mongoose schema metadata, source assertions, and ordinary unit tests do not satisfy this gate.
- Never point this test at or mutate production data.
- Physical uniqueness/concurrent-save behavior may be reported `PASS` only after the isolated gate runs successfully.
- Any later deferral must be an explicit project decision and must retain the unverified-risk statement.

### Closure gates

- Run focused backend and mobile suites followed by relevant Community regression coverage.
- Run the exact static/scope audit across both production and test allowlists.
- Run `git diff --check`, inspect exact diff/stat/status including new files, and complete an independent read-only adversarial review.
- Device/emulator, accessibility, live API, and database runtime gates must be reported accurately as passed or deferred. Automated tests do not substitute for runtime proof.

## 11. Deferred scope

- Server-ranked Trending and `For You` feeds.
- Notifications and notification producers.
- Ranking and recommendation work.
- Public profiles and author/profile navigation.
- Community image uploads or new Community media persistence.
- Public bookmark lists, bookmark counts, social bookmark activity, or bookmark analytics.
- Private-profile, blocking, and new moderation policy.
- New navigation screens or routes, packages, configuration, global contexts/providers, storage, User schema changes, migrations, or backfills.
- Changes to the existing saved-recipes screen.

Bookmark and Saved Community behavior itself is not deferred.

## 12. Contract-freeze blockers (historical)

- No contract-freeze blocker.
- No tests, builds, device runtime, or database operations were run during the read-only audit or this contract freeze.
- Implementation closure cannot claim physical uniqueness/concurrent-save `PASS` until the isolated non-production live-Mongo gate runs successfully.
- This contract freeze changes only this milestone document. It authorizes no implementation, database mutation, staging, commit, push, branch, dependency, or stash operation.
- Pre-existing untracked files remain untouched. The protected Cook Mode stash remains present and untouched.

## 13. Verdict

**MOBILE-COMM5 CONTRACT FROZEN — READY FOR IMPLEMENTATION**

## 14. Final implementation and closure evidence (2026-10-04)

The implementation is complete. Independent review findings were addressed through mutation-resistant test hardening, and the subsequent closure review passed. No suites were rerun during this evidence-only finalization update.

- Independent review findings: **FIXED**.
- Closure review: **PASS**.
- Backend regression: **64/64 PASS**.
- Mobile regression: **119/119 PASS**.
- Scope verification: **PASS**.
- `git diff --check`: **PASS**.
- Production database: **NOT USED**.
- The unique `{ userId: 1, postId: 1 }` index requirement remains unchanged.
- The `{ postId: 1 }` cleanup index requirement remains unchanged.
- The concurrent-save uniqueness requirement remains unchanged.
- `apps/api/test/community-bookmark-mongo.test.js` remains in place.
- Production implementation remains unchanged by this evidence update.

## 15. Deferred live-Mongo verification

**LIVE-MONGO GATE: DEFERRED BY PROJECT DECISION — NOT PASSED — NOT CLAIMED AS PASS.**

Reason: `COMMUNITY_BOOKMARK_MONGO_URI` is not configured. The isolated gate therefore could not connect to a non-production test database. Production MongoDB was not configured or used.

This deferral does not weaken or remove the unique `{ userId: 1, postId: 1 }` index requirement, the `{ postId: 1 }` cleanup index requirement, the concurrent-save uniqueness requirement, the isolated live-Mongo test file, or the production implementation.

## 16. Remaining risk

The real MongoDB physical indexes and concurrent-save uniqueness behavior have not been verified in an isolated live database. Automated schema, repository, route, mobile, and static/scope evidence does not substitute for that runtime proof. Physical index creation and concurrent-save uniqueness therefore remain unverified and must not be reported as passed.

Device/emulator visual, touch, accessibility, live-API, and deployed-runtime verification were not run and remain deferred. Automated test results do not claim those runtime gates as passed.

## 17. Current blockers and deferred gates

- Implementation: **COMPLETE**.
- Independent review findings: **FIXED**.
- Closure review: **PASS**.
- Live-Mongo: **DEFERRED BY PROJECT DECISION — NOT PASSED — NOT CLAIMED AS PASS**.
- Device/runtime: **DEFERRED — NOT RUN — NOT CLAIMED AS PASS**.
- No blocker prevents PR finalization under these explicit deferrals.

## 18. Current verdict

**MOBILE-COMM5 CLOSURE PASS — READY FOR FINALIZATION**
**(LIVE-MONGO + DEVICE RUNTIME DEFERRED)**
