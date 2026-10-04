# MOBILE-COMM5 — Read-Only Contract Audit

**Status:** COMPLETE
**Baseline:** `main @ 7eb9bcc781ee6a1585e500507c31e6f9207337de`
**Teammate reference:** `4ffd47d176afcfb1f23ffa1be079f01791fae92e`
**Recommended milestone:** `MOBILE-COMM5 — Authoritative Post Bookmarks and Saved Community Feed`
**Verdict:** `MOBILE-COMM5 AUDIT COMPLETE — READY FOR CONTRACT FREEZE`

> Repository-persisted audit authority for use across separate Codex/ChatGPT accounts.
> The contract-freeze phase should reference this file instead of relying on chat memory.

## 1. Architecture decision

- Add a first-class `CommunityPostBookmark` relation inside the Community module.
- Preserve `Route → authentication/validation → controller → service → repository → Mongoose → MongoDB`.
- MongoDB is authoritative. Do not use `AsyncStorage`, `CommunityContext`, client-maintained bookmark sets, cached counts, or bookmark arrays on User/Post.
- Add:
  - `POST /api/v1/community/posts/:postId/bookmarks`
  - `DELETE /api/v1/community/posts/:postId/bookmarks`
  - `GET /api/v1/community/posts/saved`
- Extend every Community post with viewer-specific `bookmarkedByCurrentUser`.
- Build Saved pages through a server-side join/intersection between the authenticated viewer’s bookmark relations and existing posts. Sorting, pagination, and totals remain server-owned.

## 2. Teammate-visible requirements

- The pinned teammate product shows a bookmark control at the far right of every post action row.
- Unsaved state: outline bookmark icon, accessible name `Bookmark post`.
- Saved state: filled bookmark icon, selected state, accessible name `Remove bookmark`.
- There is no visible bookmark count.
- The teammate’s `Saved` feed contains only bookmarked posts and preserves their existing post-feed order; saving time does not reorder them.
- Unsaving from Saved removes the post after confirmed success.
- Exact empty state:
  - Title: `No saved posts yet`
  - Guidance: `Tap the bookmark icon on a post to find it here later.`
- The composer and existing card interactions remain visible in Saved.
- Because `For You` and `Trending` are out of scope and COMM4 froze the honest global label, the live selector becomes exactly `All`, `Following`, `Saved`, with `All` remaining default.
- No separate navigation screen is required; Saved is a Community feed mode, distinct from the existing saved-recipes screen.

## 3. Bookmark API contract

### `POST /api/v1/community/posts/:postId/bookmarks`

- Authentication runs first.
- Strict valid ObjectId path; empty body and query only.
- Actor is exclusively `req.auth.userId`.
- Any authenticated active user may bookmark any existing visible Community post, including their own.
- Success: `200 { success: true, data: { bookmarked: true } }`.
- Repeated POST and concurrent duplicate-key attempts are idempotent success.
- Missing/deleted post: `404 COMMUNITY_POST_NOT_FOUND`.
- After insertion, recheck post existence. If deletion won the race, delete the new relation and return the same 404.
- Never return relation IDs, owner IDs, timestamps, or database errors.

### `DELETE /api/v1/community/posts/:postId/bookmarks`

- Same authentication and strict input rules.
- Success: `200 { success: true, data: { bookmarked: false } }`.
- Repeated DELETE is idempotent.
- Delete by authenticated user/post pair.
- Do not require the post to remain present; this permits cleanup of an orphaned relation.

Malformed IDs remain `400 VALIDATION_ERROR`.

## 4. Schema/index decision

New `CommunityPostBookmark`:

```js
{
  userId: ObjectId<User>,          // required
  postId: ObjectId<CommunityPost>  // required
}
```

- `createdAt` only; no mutable fields or `updatedAt`.
- Unique ownership index:

```js
{ userId: 1, postId: 1 } // unique
```

- Post-deletion cleanup index:

```js
{ postId: 1 }
```

- Keep the existing CommunityPost `{ createdAt: -1, _id: -1 }` index.
- Bookmark `createdAt` is not the Saved-feed ordering key.
- No denormalized bookmark arrays, bookmark counts, cached Booleans, migration, or backfill.

## 5. Saved feed contract

`GET /api/v1/community/posts/saved?page=1&limit=20`

- Authenticated and owner-scoped exclusively to `req.auth.userId`.
- `page`: integer ≥ 1, default `1`.
- `limit`: integer `1–100`, default `20`.
- Join the viewer’s bookmark relations to currently existing Community posts before calculating page results and totals.
- Deterministic order is post chronology:

```js
{ createdAt: -1, _id: -1 }
```

- Do not order by bookmark creation time.
- Response uses the existing feed envelope:

```js
{
  posts: [...],
  pagination: { page, limit, total, totalPages }
}
```

- `total` counts existing saved posts, not orphan relations.
- Deleted posts disappear without tombstones; delete-post cleanup removes their bookmark relations.
- A post with a missing author remains governed by the current `author: null` contract.
- A post whose recipe attachment is unavailable remains saved and visible with the existing unavailable-recipe presentation.
- Refresh exposes cross-device bookmark changes.
- Bookmark eligibility changes invalidate Saved pagination. The client must not invent replacement rows or totals.

## 6. Serialization rules

Every Community post becomes the exact allowlisted shape:

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

- `bookmarkedByCurrentUser` is always Boolean.
- It is derived from the authenticated viewer’s relation, never from the post document or request payload.
- Every row returned by Saved must have `bookmarkedByCurrentUser: true`.
- Newly created posts return `bookmarkedByCurrentUser: false`.
- All, Following, and Saved resolve bookmark metadata in bulk per page; no per-card queries.
- Comments gain no bookmark metadata.
- Never serialize bookmark records, bookmark IDs/timestamps, user IDs beyond the approved public-author ID, or bookmark counts.
- Mobile must strictly validate the new Boolean, Saved envelope, and mutation response. Malformed 2xx responses are unavailable, not empty data or success.

## 7. Mobile changes

- Add `FEED_SAVED`, `listSavedCommunityPosts`, and `setCommunityPostBookmarked`.
- Render exactly `All`, `Following`, and `Saved`; preserve `All` as default.
- Add the teammate-visible bookmark control to every valid post card in every mode.
- Mutations are pessimistic and single-flight per post ID using tokenized `pendingBookmarksRef` entries.
- All/Following confirmed mutation:
  - update only the matching visible post from the authoritative Boolean;
  - preserve rows, pagination, likes, comments, and follow state.
- Saved confirmed unbookmark:
  - perform a guarded page-one Saved reload so the card disappears and pagination is refilled authoritatively.
- A save started in another mode that resolves while Saved is active also triggers a guarded Saved reload.
- Mutation failure preserves the card, bookmark state, mode, and pagination and shows safe guidance.
- Creating a post while Saved is active must not insert it because the returned post is not bookmarked.
- Switching modes clears comments, cancels ownership of the prior feed operation, resets rows/pagination, and requests fresh page one.
- Preserve current follow behavior:
  - follow changes do not affect Saved eligibility;
  - Following still reloads after follow-state changes;
  - bookmark changes do not affect Following eligibility.
- Feed reads must be owned by account, mode, generation, mutation version, and operation token.
- Bookmark continuations must be owned by the authenticated account, mounted generation, and exact per-post mutation token.
- A stale initial read invalidated by a confirmed mutation must refetch while its operation remains owned; it cannot strand loading/pagination state.
- Account change clears pending bookmark ownership, resets to All, and prevents old-account responses or alerts—even when the new account mutates the same post ID.
- Unmounted continuations perform no state update, alert, reload, or token cleanup belonging to a later operation.

## 8. Security/ownership rules

- The authenticated principal is the only bookmark owner; reject or structurally exclude client-supplied user IDs, actors, relation IDs, counts, timestamps, roles, and state.
- Bookmark relations are private. Do not expose who bookmarked a post, bookmark lists, or bookmark counts to authors or other users.
- Admins receive no override or cross-user Saved access.
- All currently supported active authenticated roles have identical bookmark permissions.
- Bookmarking does not grant access beyond the existing authenticated Community feed.
- No private-profile, blocking, moderation, ranking, or notification policy is introduced.
- Missing and concurrently deleted targets return the same safe post-not-found result.
- Duplicate-key/index details never cross the API boundary.
- Post deletion cleans likes, comments, and bookmarks; the save/delete race must not leave an orphan.

## 9. Production allowlist

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

No User model, navigation, `AuthContext`, context/provider, storage, package, configuration, migration, notification, ranking, or other screen changes are permitted. `communityErrors.js` can reuse `COMMUNITY_POST_NOT_FOUND` and is not required.

## 10. Test allowlist

- `apps/api/test/community-model.test.js`
- `apps/api/test/community-repository.test.js`
- `apps/api/test/community-routes.test.js`
- `apps/api/test/community-bookmark-mongo.test.js` — new isolated live-Mongo gate
- `apps/mobile/__tests__/communityService.test.js`
- `apps/mobile/__tests__/communityStaticAudit.test.js`
- `apps/mobile/__tests__/communityInteraction.test.js`

The static audit currently rejects bookmark/Saved additions as COMM6 scope. It must be deliberately updated within this allowlist while retaining the COMM3/COMM4/COMM6 invariants.

## 11. Tests required

Backend:

- Exact bookmark schema fields, createdAt-only timestamps, unique owner/post index, and reverse post cleanup index.
- Authentication before validation; strict path/body/query rejection and server actor derivation.
- Own-post bookmarking, missing/deleted posts, repeated save/unsave, and duplicate-key idempotency.
- Post-deletion race cleanup and ordinary post deletion removing every bookmark relation.
- Saved isolation between users.
- Reverse bookmark-creation times proving ordering still follows post `createdAt/_id`.
- Stable pagination, exact existing-post totals, empty pages, deleted-post omission, unavailable recipes, and missing authors.
- Bulk bookmark metadata for All/Following/Saved without per-post queries.
- Exact serializer allowlist and absence of relation documents, IDs, timestamps, counts, and private User fields.
- Isolated real-Mongo proof that concurrent saves create exactly one row and both required physical indexes exist.

Mobile:

- Exact Saved endpoint, encoded bookmark IDs, bodyless mutations, and no identity/count fields.
- Strict rejection of missing, non-Boolean, contradictory, extra-key, malformed-post, and malformed-pagination 2xx responses.
- Mounted three-mode switching, loading, retry, refresh, pagination, and exact Saved empty state.
- Outline/filled icon, accessibility names/state, and authoritative Boolean on All, Following, and Saved cards.
- Pessimistic mutation, per-post duplicate-tap suppression, independent mutations for different posts, and failure preservation.
- Confirmed unbookmark in Saved causes authoritative page-one reload and replacement-row pagination.
- Saving in All/Following must not change feed membership; resolving after switching to Saved reloads that current mode.
- Creating a post in Saved does not insert it.
- Late responses from every prior mode cannot populate the current mode.
- A visibly corrupting feed response begun before bookmark success cannot restore stale bookmark state, rows, or pagination.
- An old-account mutation resolving for the same post ID cannot update UI, alert, reload, or clear the new account’s token.
- Successful and failed continuations after unmount do nothing.
- Removing any account, mode, generation, mutation-version, operation-token, or unmount guard must make its race test fail.
- Preserve all existing comments, likes, follows, CTA, deletion, pagination, and prior race coverage.

## 12. Blockers

- No audit blocker.
- Baseline was verified exactly at `main @ 7eb9bcc781ee6a1585e500507c31e6f9207337de`; tracked diff is empty.
- The pinned teammate commit was absent from the active repository’s object database but was inspected directly at exact SHA `4ffd47d176afcfb1f23ffa1be079f01791fae92e` in the separate `WECOOKEDD` checkout.
- No tests, builds, device runtime, or database operations were run during this read-only audit.
- Implementation closure cannot claim physical uniqueness/concurrent-save PASS until the isolated non-production live-Mongo gate runs successfully.
- Pre-existing untracked files remain untouched. The protected Cook Mode stash remains present and untouched.

## 13. Recommended milestone title

**MOBILE-COMM5 — Authoritative Post Bookmarks and Saved Community Feed**

## 14. Verdict

**MOBILE-COMM5 AUDIT COMPLETE — READY FOR CONTRACT FREEZE**
