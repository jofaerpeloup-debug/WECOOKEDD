# MOBILE-COMM4 — Read-Only Contract Audit

**Status:** COMPLETE
**Baseline:** `main @ 76e62fb8d1b2e9b41ec77fc754b243c950714286`
**Teammate reference:** `4ffd47d176afcfb1f23ffa1be079f01791fae92e`
**Recommended milestone:** `MOBILE-COMM4 — Authoritative Follow Graph and Following Community Feed`
**Verdict:** `MOBILE-COMM4 AUDIT COMPLETE — READY FOR CONTRACT FREEZE`

> Repository-persisted audit authority for use across separate Codex/ChatGPT accounts.
> The contract-freeze phase should reference this file instead of relying on chat memory.

1. Architecture decision

- Add a first-class `CommunityFollow` relation inside the Community module. Do not store follow arrays or counters on `User`, posts, or the device.
- Preserve `Route → validation/authentication → controller → service → repository → Mongoose`.
- Keep the existing authenticated chronological feed at `GET /api/v1/community/posts`.
- Add `GET /api/v1/community/posts/following`.
- Add viewer-specific `isFollowingAuthor` to every serialized post.
- Reuse PROFILE2’s `{ id, name, avatarUrl }` public-author projection.
- No public follow-list endpoint is required.

2. Teammate-visible requirements

- Show an accessible `Follow`/`Following` button on posts whose author exists and is not the authenticated user.
- Update every visible card from the same author after confirmed mutation.
- Add an honest two-mode selector: `All` and `Following`. `All` remains the current chronological global feed; it must not be mislabeled as ranked `For You`.
- Following empty state:
  - Title: `Not following anyone yet`
  - Guidance: `Tap Follow on a post's author to see their cooking here.`
- Preserve the existing composer, avatars, likes, comments, recipes, refresh, and pagination.
- Do not render dead Saved, Trending, or For You controls.
- The pinned Profile UI shows Recipes saved, Collections, and Cooked—not follower/following counts. Counts are not required.

3. Follow API contract

`POST /api/v1/community/users/:userId/follow`

- Authenticated; actor is only `req.auth.userId`.
- Strict valid ObjectId path; no body or query fields.
- `200 { success: true, data: { following: true } }`.
- Repeated POST and duplicate-key races are idempotent success.
- Self-follow: `400 COMMUNITY_SELF_FOLLOW_NOT_ALLOWED`.
- Missing/deleted target: `404 COMMUNITY_FOLLOW_TARGET_NOT_FOUND`.
- After inserting, recheck target existence; if deletion won the race, remove the relation and return the same 404.

`DELETE /api/v1/community/users/:userId/follow`

- Same authentication and strict input rules.
- `200 { success: true, data: { following: false } }`.
- Repeated DELETE is idempotent.
- It removes the actor/target pair without requiring the target to still exist, allowing orphan cleanup.

Malformed IDs remain `400 VALIDATION_ERROR`; auth failures retain existing codes.

4. Schema/index decision

New `CommunityFollow`:

```js
{
  followerId: ObjectId<User>,     // required
  followedUserId: ObjectId<User>  // required
}
```

- `createdAt` only; no mutable fields or `updatedAt`.
- Service and model validation reject equal canonical IDs.
- Unique compound index:

```js
{ followerId: 1, followedUserId: 1 } // unique
```

- Add to `CommunityPost`:

```js
{ authorId: 1, createdAt: -1, _id: -1 }
```

- Keep the existing global `{ createdAt: -1, _id: -1 }` index.
- No reverse follow index, denormalized arrays, cached counts, migration, or backfill.

5. Following feed contract

`GET /api/v1/community/posts/following?page=1&limit=20`

- Authenticated; only the caller’s follow relations are used.
- `page`: integer ≥ 1, default 1.
- `limit`: integer 1–100, default 20.
- Resolve followed IDs in one repository query, intersect them with currently existing Users, then query/count posts using those author IDs.
- Missing/deleted targets and their posts are excluded; an empty graph returns an empty valid page.
- Order is deterministic: `{ createdAt: -1, _id: -1 }`.
- Response matches the existing feed envelope:

```js
{
  posts: [...],
  pagination: { page, limit, total, totalPages }
}
```

- Follow-state changes invalidate/reset Following pagination. Cross-device changes become visible on refresh.
- Offset-pagination semantics remain consistent with the current global feed.

6. Serialization/privacy rules

Each post remains an exact allowlisted object:

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

- `isFollowingAuthor` is always Boolean; false for self or missing authors.
- Comments retain the PROFILE2 author shape and gain no follow metadata.
- Never serialize relation IDs/documents, email, bio, cooking level, preferences, role, status, auth identities, avatar asset metadata, or timestamps from `CommunityFollow`.
- No follower/following counts.
- Mobile must strictly validate both feed variants, pagination, public authors, `isFollowingAuthor`, and follow responses. Malformed 2xx responses are unavailable—not empty data or success.

7. Mobile changes

- Add `All`/`Following` mode state and route each mode to its server endpoint.
- Switching mode clears comments, invalidates the previous feed operation, resets page state, and performs a fresh page-one read.
- Follow mutations are pessimistic and single-flight per author ID.
- Pending operations use tokenized `Map` entries keyed by author ID.
- Success updates all matching cards from the authoritative Boolean.
- Unfollowing from Following triggers a guarded page-one reload instead of guessing pagination totals.
- Creating the viewer’s own post while Following is selected must not insert that ineligible post into the Following feed.
- Failure preserves cards, mode, pagination, and follow state and shows safe guidance.
- Missing/self authors never render a follow control.

8. Security/ownership rules

- Authentication precedes validation/controller execution.
- Client-supplied follower IDs, actors, counts, roles, or relation state are rejected or ignored by construction.
- Active authenticated users—including existing supported roles—have identical follow permissions; admins receive no override.
- `User.status` currently controls authentication, not Community content takedown. COMM4 must not invent a status-based visibility policy for only one feed.
- No private-profile, block, or content-moderation model exists. Following is only a subset of the already authenticated global feed and grants no additional data access.
- Missing and deleted targets use the same safe not-found result.
- Unexpected database/index details and duplicate-key information never reach clients.

9. Exact production allowlist

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

No User, navigation, AuthContext, package, configuration, migration, notification, or other screen changes are expected. Any expansion requires a new audit decision.

10. Exact test allowlist

- `apps/api/test/community-model.test.js`
- `apps/api/test/community-repository.test.js`
- `apps/api/test/community-routes.test.js`
- `apps/api/test/community-follow-mongo.test.js` — new isolated live-Mongo gate
- `apps/mobile/__tests__/communityService.test.js`
- `apps/mobile/__tests__/communityStaticAudit.test.js`
- `apps/mobile/__tests__/communityInteraction.test.js`

11. Tests required

Backend:

- Exact schema fields, self-follow validation, unique compound index, and author/feed index.
- Authentication, strict path/body/query rejection, and actor derivation.
- Self, missing, deleted, repeated follow/unfollow, and duplicate-key behavior.
- Target-deletion race cleans the inserted relation.
- Following feed isolation, empty graph, deleted targets, multi-author ordering, exact totals, page bounds, and stable tie-breaks.
- Bulk viewer follow metadata without per-post queries.
- Poisoned User fixtures proving the exact PROFILE2 public-author allowlist.
- No counts or persistence metadata serialized.
- Isolated real-Mongo proof that concurrent duplicate follows produce one row and that declared physical indexes support the required uniqueness. Mock-only evidence is insufficient for this gate.

Mobile:

- Exact endpoints, encoded IDs, no body/identity fields, and strict response validation.
- Mounted All/Following switching, pagination, refresh, empty/error/retry states.
- Pessimistic follow/unfollow, duplicate-tap suppression, failure preservation, and all-cards-by-author reconciliation.
- Unfollow-driven Following reload and own-post exclusion while Following is active.
- A late All response must not populate Following, and vice versa.
- A feed response begun before follow mutation must be unable to restore stale follow state, rows, or pagination.
- An old-account mutation resolving after account switch—including the same author ID—must not update UI, alert, or clear the new account’s pending token.
- Unmounted continuations must do nothing.
- Race fixtures must contain visibly corrupting stale payloads so removing any generation, owner, mutation-version, or operation-token guard makes the test fail.
- Preserve all existing COMM3 comment/like/feed race coverage.

12. Blockers

- No audit blocker.
- The pinned commit was absent from the active repository’s object database but was available and inspected directly in the separate `WECOOKEDD` checkout at exact SHA `4ffd47d176afcfb1f23ffa1be079f01791fae92e`.
- No tests, builds, database operations, or runtime checks were run during this read-only audit.
- Implementation closure must not claim physical uniqueness/concurrency PASS unless the isolated live-Mongo gate is actually run.
- Baseline remained `main @ 76e62fb8d1b2e9b41ec77fc754b243c950714286`; tracked diff remained empty, pre-existing untracked files remained untouched, and the Cook Mode stash was not inspected or changed.

13. Recommended milestone title

**MOBILE-COMM4 — Authoritative Follow Graph and Following Community Feed**

14. Verdict

**MOBILE-COMM4 AUDIT COMPLETE — READY FOR CONTRACT FREEZE**
