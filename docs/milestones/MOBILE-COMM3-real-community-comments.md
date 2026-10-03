# MOBILE-COMM3 — Real Community Comments

## 1. Status and authority

- Audit: **COMPLETE**
- Contract freeze: **COMPLETE**
- Implementation: **COMPLETE; REQUIRED MOBILE FIX COMPLETE (2026-10-03)**
- Independent review: **NO-GO FINDINGS FIXED; CLOSURE PASS (2026-10-03)**
- Runtime: **DEFERRED — NOT RUN — NOT CLAIMED PASS**
- Baseline: `main` at `a7c47f30b0747be4f39c08ba7921455b220442b6`

This document freezes the completed MOBILE-COMM3 audit against `/AGENTS.md`
and the live backend/mobile source at the baseline above. MongoDB and the
authenticated API remain authoritative. MOBILE-COMM3 extends the existing
Community post/like architecture; it does not introduce local Community
persistence, mock comments, or a second source of truth.

## 2. Product goal

An authenticated user can lazily open one post's comment panel, page through
real comments, create a comment, and delete only their own comment. Every
displayed comment count comes from current server data:

`Community post -> open comments -> GET page 1 -> load more / comment / delete own comment`

The existing global Community feed, text/Recipe post creation, post deletion,
and binary likes remain otherwise unchanged.

## 3. Existing architecture and frozen extension

Preserve the existing paths:

`CommunityScreen -> communityService -> shared authenticated API client -> /api/v1/community -> MongoDB`

`route -> authentication / strict validation -> controller -> service -> repository -> Mongoose`

Add a `CommunityComment` model and a dedicated comment repository inside the
existing Community module. Comment orchestration remains in the existing
Community service/controller/routes/serializer/validation files. Do not add a
mobile provider, context, AsyncStorage state, direct `fetch`, client-generated
comment ids, or denormalized persisted count on `CommunityPost`.

## 4. Frozen comment model and repository contract

`CommunityComment` is its own collection with exactly these domain fields:

- `postId`: required ObjectId reference to `CommunityPost`;
- `authorId`: required ObjectId reference to `User`;
- `body`: required trimmed string, minimum 1 and maximum 1000 characters; and
- `createdAt`: server timestamp. No editable `updatedAt` contract is needed.

The model has a deterministic pagination index of
`{ postId: 1, createdAt: -1, _id: -1 }`. Lists are newest first, with `_id`
descending as the stable tie-breaker.

The comment repository owns only allowlisted comment persistence operations:
create, deterministic paginated find by `postId`, count by `postId`, aggregate
counts for a page of post ids, atomic delete by `{ _id: commentId, authorId }`,
delete the just-created comment by its id for race cleanup, and delete all by
`postId` for post cleanup. Cross-module user hydration goes through the
existing user service; comments do not populate or expose User documents.

## 5. Frozen comment API contract

All three routes require the existing access-token authentication middleware
and existing strict validation/error envelope conventions.

### `GET /api/v1/community/posts/:postId/comments`

- Params: valid `postId` ObjectId only.
- Query: `page` and `limit` only; defaults are `1` and `20`, minimum is `1`,
  and maximum `limit` is `100`.
- Missing post: `404 COMMUNITY_POST_NOT_FOUND`.
- Order: `createdAt DESC, _id DESC`.
- Success `200` data:

```js
{
  comments: [publicComment],
  commentCount: authoritativeTotal,
  pagination: { page, limit, total: authoritativeTotal, totalPages }
}
```

`commentCount` and `pagination.total` are the same repository count. An empty
page is a successful response with an empty `comments` array; it is not a
fabricated error.

### `POST /api/v1/community/posts/:postId/comments`

- Params: valid `postId` ObjectId only.
- Strict body: `{ body }` only.
- `body` is trimmed, non-empty, and at most 1000 characters; line breaks may be
  preserved.
- `authorId` comes only from `req.auth.userId`; post id comes only from the URL.
- Missing/deleted post: `404 COMMUNITY_POST_NOT_FOUND`.
- Success `201` data:

```js
{ comment: publicComment, commentCount: authoritativeCountAfterCreate }
```

Creation must close the post-delete race. Check that the post exists before
creation, create the comment, then confirm the post still exists. If deletion
won the race, remove the just-created comment and return the same controlled
post-not-found response; no orphan comment may survive.

### `DELETE /api/v1/community/comments/:commentId`

- Params: valid `commentId` ObjectId only; there is no body.
- Ownership comes only from `req.auth.userId`.
- Delete with one atomic repository predicate on
  `{ _id: commentId, authorId: authenticatedUserId }`.
- A missing comment and another user's comment both return the identical
  `404 COMMUNITY_COMMENT_NOT_FOUND` response. Admin/moderator role alone does
  not bypass ownership. The response must not reveal whether the comment
  exists or who owns it.
- Success `200` data:

```js
{ deleted: true, commentCount: authoritativeCountAfterDelete }
```

There is no comment update endpoint, reply endpoint, reaction endpoint, bulk
delete endpoint, or client-supplied count/owner field.

## 6. Public comment and count contract

The serializer constructs each comment field-by-field:

```js
{
  id,
  body,
  author: { id, name } | null,
  createdAt,
  isOwner
}
```

It never exposes `postId`, `authorId`, email, role, status, auth identities,
tokens, `__v`, or arbitrary User/Comment fields. A missing public author safely
degrades to `author: null`; the comment remains displayable.

`CommunityPost` does not store `commentCount`. Feed resolution aggregates
comment documents for every post in the returned page, just as like metadata
is resolved in bulk. Every serialized feed post receives an integer
`commentCount`, defaulting to `0` only when the aggregate has no row. Newly
created posts return `commentCount: 0` because no comment exists yet.

The comment list total and every create/delete response count are computed by
the server. Mobile must replace the affected post's count with the returned
value exactly; it must never increment/decrement optimistically or infer a
count from the currently loaded partial page.

## 7. Post deletion and cleanup contract

Existing post deletion remains owner-only and opaque:

- the post repository atomically deletes by `{ _id: postId, authorId }`;
- missing and non-owned posts remain the same `404 COMMUNITY_POST_NOT_FOUND`;
- after a successful post delete, the service deletes both all likes and all
  comments for that post;
- unrelated posts, likes, comments, Recipes, and Users are untouched; and
- comment cleanup is not delegated to the client.

Post/comment creation races must converge without comment orphans through the
POST recheck/cleanup rule above. Deleting a post in mobile removes its open
comment panel and pending comment UI only after confirmed server success.

## 8. Frozen mobile comment workflow

The existing comment-count affordance becomes an accessible `Pressable`. A
post's comment panel is closed by default and issues no comment request until
the user opens it. Keep at most one active inline panel at a time so comment
state and ownership are unambiguous. Opening another post invalidates and
clears the former panel's loaded rows, pagination, errors, pending operations,
and draft.

The active panel provides:

- initial loading;
- explicit load error with Retry;
- honest empty state;
- newest-first comments using safe author-name/initial fallback and the
  existing Community time formatter;
- `Load more comments` while another page exists;
- pagination failure guidance without discarding already loaded comments;
- a bounded 1000-character composer and character count;
- a single-flight submit action; and
- a delete affordance only when server-derived `comment.isOwner` is true.

Comment pages append by comment id without duplicates and preserve server
order. Retry for the initial failure reloads page 1. Load-more retry requests
only the still-missing next page. Closing and reopening starts a fresh page-1
read so local state is not treated as authority.

Create and delete are pessimistic:

- create sends exactly `{ body: trimmedDraft }` for the active post;
- a successful create prepends/reconciles the returned public comment, replaces
  the post count with the returned authoritative count, and only then clears
  the draft;
- create validation/network/server failure keeps the draft and loaded comments
  intact and permits an explicit retry;
- delete changes no row while pending;
- successful delete removes only the returned target comment locally and
  replaces the post count with the returned authoritative count; and
- delete failure preserves the row, loaded pages, and count.

Rapid duplicate submit/delete/load-more actions must issue at most one request
for the same active operation. No failure may fabricate success, clear a draft,
erase loaded comments, or change a comment count.

## 9. Account, generation, unmount, and feed-overlap safety

Every feed/comment continuation and mutation finalizer is bound to the
authenticated account, the relevant feed or active-post generation, and its
own operation token. Unmount invalidates all generations/tokens. An account
change closes and clears the comment panel, draft, loaded comments, pagination,
errors, and pending state before the new account can interact.

Stale results from a prior account, closed panel, different post, retry,
superseded page request, or unmounted screen must not mutate posts/comments,
replace pagination/counts, show an alert, clear a draft, close/reopen a panel,
or clear a pending flag owned by a newer operation.

The existing Community feed needs one narrow concurrency repair while this
screen is touched:

- initial/retry/refresh/load-more and post-create continuations have explicit
  operation ownership rather than relying on shared booleans alone;
- a new page-1 feed request invalidates an older feed read and synchronously
  releases only the pending state it supersedes;
- a confirmed post-create or comment-count mutation cannot be overwritten by
  a feed response that began before that mutation completed;
- an invalidated refresh/load-more/create `finally` block cannot leave its old
  spinner stuck or clear a spinner/pending state belonging to a newer request;
- load-more still appends unique ids only and a failed/stale request leaves the
  currently loaded feed intact; and
- all accepted results must still match the current authenticated owner and
  mounted generation.

This is a narrow correctness fix in `CommunityScreen`; it is not a feed
redesign, cursor migration, polling system, cache layer, or new global state.

## 10. Production allowlist

Only these production files may change during implementation:

- `apps/api/src/modules/community/community-comment.model.js` (new)
- `apps/api/src/modules/community/community-comment.repository.js` (new)
- `apps/api/src/modules/community/community.service.js`
- `apps/api/src/modules/community/community.controller.js`
- `apps/api/src/modules/community/community.routes.js`
- `apps/api/src/modules/community/community.validation.js`
- `apps/api/src/modules/community/community.serializer.js`
- `apps/mobile/src/api/communityService.js`
- `apps/mobile/src/api/communityErrors.js`
- `apps/mobile/src/screens/CommunityScreen.js`

No `CommunityContext`, navigation, theme, package, database bootstrap, post
model, like model/repository, shared API client, or app-provider change is
expected. If implementation proves another production file is required, stop
and justify the concrete expansion before changing it.

## 11. Test allowlist and required proof

Only these test files may change during implementation:

- `apps/api/test/community-model.test.js`
- `apps/api/test/community-repository.test.js`
- `apps/api/test/community-routes.test.js`
- `apps/mobile/__tests__/communityService.test.js`
- `apps/mobile/__tests__/communityStaticAudit.test.js`
- `apps/mobile/__tests__/communityInteraction.test.js` (new)

Tests must prove the model/index/bounds, strict authentication and validation,
safe serialization, stable pagination, authoritative feed/list/mutation counts,
opaque owner-only deletion, post cleanup, create-vs-post-delete cleanup, and no
cross-post deletion. Mobile transport tests must prove exact paths, encoded ids,
allowlisted fields, response shapes, and failure propagation.

Mounted mobile interaction tests must discriminate successful behavior from
mutations that would incorrectly clear drafts, fabricate counts, reuse stale
pages, leak one post/account into another, or mishandle overlapping
refresh/load-more/create finalizers. Static string presence alone is not enough
to prove those interactions.

## 12. Explicit out of scope

- Comment attachments or images
- Follows
- Bookmarks
- Following, Saved, Trending, or For You feeds
- Profiles or avatars
- Comment editing
- Replies or threads
- Comment reactions
- Reporting or moderation queue
- Notifications
- Navigation changes
- Global theme changes
- Package or lockfile changes
- Mock, `CommunityContext`, or AsyncStorage Community behavior
- Post attachment expansion or post-image upload
- Feed ranking, cursor redesign, polling, or realtime delivery
- Admin/moderator deletion bypass

## 13. Verification policy

Implementation may claim only the focused automated evidence recorded below.
No emulator/device, browser, live API, or database runtime is claimed.
Implementation must receive a separate independent read-only review and
runtime decision before release.

## 14. Implementation evidence (2026-10-03)

Implementation was completed on `feat/mobile-comm3-real-comments` from the
frozen `a7c47f30b0747be4f39c08ba7921455b220442b6` baseline, within the production
and test allowlists above.

- Backend: added the exact comment model/repository, authenticated strict
  list/create/delete routes, field-by-field public serialization, bulk feed
  counts, authoritative mutation/list counts, opaque owner-only deletion,
  post-delete comment cleanup, and create-vs-delete orphan cleanup.
- Mobile: added allowlisted comment transports and one lazy inline panel with
  deterministic pagination, retry/empty/error states, bounded creation,
  pessimistic owner deletion, authoritative count replacement, draft
  preservation, and account/post/generation/unmount operation ownership.
- Feed: added only the frozen operation-token/mutation-version repair for
  overlapping page-one, load-more, refresh, post-create, and count mutations.
- Backend focused verification:
  `node --test test/community-model.test.js test/community-repository.test.js test/community-routes.test.js`
  passed **45/45** tests. The identical command required execution outside the
  Windows sandbox after the sandbox returned `spawn EPERM`.
- Mobile focused verification plus the smallest related regressions:
  `npm test -- --runInBand __tests__/communityService.test.js __tests__/communityStaticAudit.test.js __tests__/communityInteraction.test.js __tests__/communityTime.test.js __tests__/pendingFeatureHonestyStaticAudit.test.js __tests__/topBarStaticAudit.test.js --silent`
  passed **50/50** tests across **6/6** suites.
- The mounted interaction suite proves lazy/fresh reads, stable deduplicated
  paging, create/delete pessimism and failure preservation, authoritative count
  replacement, post/account isolation, post-delete panel cleanup, and stale
  feed finalizer/mutation overlap behavior.
- No database was mutated. No emulator/device, live API, or live MongoDB runtime
  was run or claimed. Independent review remains **NOT RUN**.

**MOBILE-COMM3 IMPLEMENTATION COMPLETE - READY FOR INDEPENDENT REVIEW**

## 15. Required mobile fix evidence (2026-10-03)

The first independent review passed the backend contract and returned four
mobile MAJOR findings. The required fix remained within the two authorized
mobile production files and three authorized Community mobile test files:

- comment create/delete continuations now use monotonic operation ordering, so
  an older successful response may reconcile its own row but cannot replace a
  count already returned by a newer successful mutation;
- an initial page-one feed read invalidated by a confirmed mutation refetches
  under the same owned operation until it can install a current feed and
  pagination, without accepting the stale page over a confirmed post create;
- comment list/create/delete transports fail closed on malformed public
  comments, pagination, confirmation, or authoritative counts; and
- mounted tests cover out-of-order mutations, stale same-post pages, stale feed
  counts, initial-feed/create overlap, account switching, close/reopen, and
  unmount continuations. Service tests cover malformed successful envelopes.

Focused mobile verification:

`npm test -- --runInBand __tests__/communityService.test.js __tests__/communityInteraction.test.js __tests__/communityStaticAudit.test.js --silent`

passed **54/54** tests across **3/3** suites. No emulator/device, live API, or
database runtime was run or claimed. A separate closure review remains
required.

**MOBILE-COMM3 REQUIRED FIX COMPLETE - READY FOR CLOSURE REVIEW**

## 16. Final closure evidence (2026-10-03)

- The independent review NO-GO findings were fixed within the frozen COMM3
  allowlist.
- The independent closure review passed.
- Focused mobile closure remains **54/54 PASS** across the three Community
  mobile suites recorded above.
- Runtime remains **DEFERRED — NOT RUN — NOT CLAIMED PASS**. No emulator/device,
  live API, live MongoDB, or other physical runtime result is claimed.

**MOBILE-COMM3 CLOSURE PASS — READY FOR PR**

## 17. Freeze verdict

The live Community module, authenticated API client, serializer conventions,
public User hydration, existing post/like cleanup patterns, and current mobile
screen provide sufficient boundaries for this implementation. No navigation,
theme, package, mock-persistence, or protected-stash change is required.

**MOBILE-COMM3 CONTRACT FROZEN — READY FOR IMPLEMENTATION**
