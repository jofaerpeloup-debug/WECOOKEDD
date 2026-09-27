# WeCooked — MOBILE-P1 Reviews + Cooking History

**Status:** IMPLEMENTATION COMPLETE — BATCH 1 + BATCH 2 REVIEW PASS — READY FOR CHECKPOINT
**Milestone type:** Backend extension + frontend integration
**Base checkpoint:** `f6ef49185c6064d9975e4786efbe572bdbe14163`
**Recommended branch:** `feat/mobile-p1-reviews-cooking-history`
**Frozen teammate reference:** `4ffd47d176afcfb1f23ffa1be079f01791fae92e`

## 1. Goal

Complete the real mobile frontend for two backend-supported capabilities:

1. Written recipe reviews.
2. Paginated cooking history.

This milestone must integrate existing server-authoritative contracts. It must not invent a second backend contract, duplicate authority in local state, or port teammate mock/local persistence into production.

## 2. Classification

`BACKEND_EXTENSION + FRONTEND_INTEGRATION`

The original audit classified this milestone as frontend integration only. That classification was amended after approval of the server-authoritative cook-before-rating/review rule.

Frozen constraints:

- No backend schema changes.
- No new backend routes.
- No new backend model or collection.
- No package changes.
- No lockfile changes.
- Backend changes are limited to review-create eligibility enforcement and a reusable cook-history service predicate.
- Existing auth/session/navigation architecture remains authoritative.
- Android/device runtime verification remains a separate later gate.

If implementation discovers a requirement beyond this amended contract, STOP and re-audit. Do not silently expand scope.

## 3. Backend authority — Reviews

Existing review routes are authoritative:

- `GET /api/v1/recipes/:recipeId/reviews`
  - query: `page`, `limit`, `sort=newest|oldest`
  - returns:
    - `summary`
    - `reviews`
    - `pagination`
    - `currentUserReview`
- `POST /api/v1/recipes/:recipeId/reviews`
  - strict body: `{ rating, comment? }`
  - one review per user/recipe
- `PATCH /api/v1/reviews/:reviewId`
  - strict body with at least one of `{ rating?, comment? }`
- `DELETE /api/v1/reviews/:reviewId`

Public review shape:

```text
{
  id,
  rating,
  comment: string | null,
  author: { id, name } | null,
  createdAt,
  updatedAt
}
```

Frozen semantics:

- Written comments are real server-authoritative data.
- Rating-only reviews are valid.
- `currentUserReview` is independent of the current page.
- Existing rating-only users must update with `PATCH`, not create another review.
- Deleting a review deletes both rating and comment.
- Client must never send ownership, author, aggregate, or timestamp authority.
- Foreign/missing review update/delete remains opaque `404 REVIEW_NOT_FOUND`.
- `REVIEW_ALREADY_EXISTS` means stale client state: refetch, do not silently retry another create.

## 4. Backend authority — Cooking History

Existing cook-history routes are authoritative:

- `GET /api/v1/cook-history`
  - query: `page`, `limit`, `sort=newest|oldest`
- `POST /api/v1/cook-history`
- `GET /api/v1/cook-history/stats`
- `GET /api/v1/cook-history/recipes/:recipeId/status`

List item shape:

```text
{
  id,
  recipe: {
    id,
    title,
    region,
    category,
    difficulty,
    prepTimeMinutes,
    cookTimeMinutes,
    imageUrl
  },
  servings: number | null,
  completedAt
}
```

Frozen semantics:

- `completedAt` is server-authoritative.
- Repeated cooking events are intentional and must remain separate.
- Default ordering is newest first.
- The mobile list must use the returned recipe summary.
- Hidden/unusable recipes may be omitted from a raw event page after pagination.
- Therefore load-more logic MUST use `page < totalPages`, never `items.length === limit`.
- A page may contain zero visible rows while later pages still exist.
- “No history” is valid only after all available pages are exhausted without a usable row.
- Do not fabricate a displayed total from `items.length`, profile stats, or raw `pagination.total`.
- Do not deduplicate by recipe ID.
- Do not fall back to client time.

## 5. Exact production allowlist

Only these production files may be edited in MOBILE-P1 unless a verified blocker causes a formal scope amendment:

```text
BACKEND — Controlled Scope Amendment A only
apps/api/src/modules/cook-history/cook-history.service.js
apps/api/src/modules/reviews/review.service.js

MOBILE
apps/mobile/src/api/reviewErrors.js
apps/mobile/src/api/reviewService.js
apps/mobile/src/api/cookHistoryService.js
apps/mobile/src/screens/RecipeDetailScreen.js
apps/mobile/src/screens/RecipeReviewsScreen.js
apps/mobile/src/screens/CookingHistoryScreen.js
apps/mobile/src/screens/ProfileScreen.js
apps/mobile/src/navigation/RootNavigator.js
```

New files:

```text
apps/mobile/src/screens/RecipeReviewsScreen.js
apps/mobile/src/screens/CookingHistoryScreen.js
```

## 6. Exact test allowlist

```text
BACKEND — Controlled Scope Amendment A only
apps/api/test/cook-history-service.test.js
apps/api/test/review-service.test.js
apps/api/test/review-routes.test.js
apps/api/test/review-validation.test.js

MOBILE
apps/mobile/__tests__/reviewService.test.js
apps/mobile/__tests__/reviewErrors.test.js
apps/mobile/__tests__/recipeReviewsStaticAudit.test.js
apps/mobile/__tests__/recipeDetailStaticAudit.test.js
apps/mobile/__tests__/cookHistoryService.test.js
apps/mobile/__tests__/cookingHistoryStaticAudit.test.js
apps/mobile/__tests__/profileStaticAudit.test.js
apps/mobile/__tests__/navigationShellStaticAudit.test.js
```

Expected new tests:

```text
apps/mobile/__tests__/reviewService.test.js
apps/mobile/__tests__/reviewErrors.test.js
apps/mobile/__tests__/recipeReviewsStaticAudit.test.js
apps/mobile/__tests__/cookingHistoryStaticAudit.test.js
```

Only the four backend tests listed above were authorized for amendment-specific coverage. All other backend tests remained frozen.

## 7. Frozen files / behavior

Do not edit:

- `apps/api/**` except the two backend production files and four backend test files explicitly authorized above by Controlled Scope Amendment A
- `apps/mobile/App.js`
- `apps/mobile/src/api/client.js`
- `apps/mobile/src/context/CookHistoryContext.js`
- `apps/mobile/src/screens/CookModeScreen.js`
- `apps/mobile/src/navigation/MainTabs.js`
- package manifests
- lockfiles
- auth/token/session architecture
- root auth stack switching
- deep-link configuration
- theme system
- favorites
- collections
- shopping list
- unrelated M27 screens

Narrow permitted integration:

- Recipe Detail may add review navigation/focus refresh and harden rating mutation against unknown ownership state.
- Profile may make the authoritative Cooked stat navigate to Cooking History.
- Root Navigator may register `RecipeReviews` and `CookingHistory`.

## 8. Navigation contract

Register in the existing authenticated root stack:

```text
RecipeReviews
CookingHistory
```

Recipe Detail opens:

```text
RecipeReviews {
  recipeId: recipe.id,
  recipeTitle: recipe.title
}
```

Profile Cooked stat opens:

```text
CookingHistory
```

History row opens:

```text
RecipeDetail {
  recipeSource: 'api',
  recipeId: item.recipe.id
}
```

No second navigator. No auth reset. No new tab.

## 9. Batch 1 — Written Reviews

**Status:** PASS / CLOSED
**Independent review:** BATCH 1 REVIEW PASS — READY FOR BATCH 2

Editable production files:

```text
apps/api/src/modules/cook-history/cook-history.service.js
apps/api/src/modules/reviews/review.service.js
apps/mobile/src/api/reviewErrors.js
apps/mobile/src/api/reviewService.js
apps/mobile/src/screens/RecipeDetailScreen.js
apps/mobile/src/screens/RecipeReviewsScreen.js
apps/mobile/src/navigation/RootNavigator.js
```

Editable tests:

```text
apps/api/test/cook-history-service.test.js
apps/api/test/review-service.test.js
apps/api/test/review-routes.test.js
apps/api/test/review-validation.test.js
apps/mobile/__tests__/reviewService.test.js
apps/mobile/__tests__/reviewErrors.test.js
apps/mobile/__tests__/recipeReviewsStaticAudit.test.js
apps/mobile/__tests__/recipeDetailStaticAudit.test.js
apps/mobile/__tests__/navigationShellStaticAudit.test.js
```

Acceptance criteria:

- Real newest-first paginated review rows.
- Author name/null fallback from API response only.
- Rating display from API response only.
- Optional written comment body.
- Server timestamps only.
- Loading state.
- Confirmed-empty state.
- Retryable error state.
- Pull-to-refresh.
- Guarded load-more.
- Create first review with `POST`.
- Update existing rating-only or written review with `PATCH`.
- Edit form preloads authoritative `currentUserReview`.
- Delete uses only `currentUserReview.id`.
- Destructive confirmation makes clear the rating and comment are both removed.
- After every mutation, reload page 1, summary, and `currentUserReview`.
- Recipe Detail review summary refreshes on focus after returning from review screen.
- Recipe Detail direct star mutation is disabled unless review ownership/current-review state is known.
- `REVIEW_ALREADY_EXISTS` triggers refetch, not another create attempt.
- Malformed successful review payloads fail closed; contract drift must not become “No ratings yet.”
- No client-supplied `userId`, author, aggregate, or timestamps.
- Accessible controls.
- Existing light/dark theme tokens.
- Generation/unmount guards prevent late responses from overwriting refreshed or different-recipe state.
- No fake reviews, fake users, fake dates, local authority, analytics, recommendations, or AI.

Final implementation includes real API-backed reviews with newest-first pagination; create, update, and delete flows; authoritative `currentUserReview`; server-enforced cook-before-first-review eligibility with `REVIEW_COOK_REQUIRED`; preserved legacy `PATCH`/`DELETE`; synchronous Recipe Detail rating-mutation serialization; and fail-closed successful-payload validation. A cook-history event establishes only that a cooking completion was recorded in WeCooked; it does not establish that physical real-world cooking occurred.

Batch gate (completed):

1. Focused tests.
2. Approved backend review/cook-history suites.
3. Relevant mobile regression.
4. Full mobile suite if required by repository workflow.
5. `git diff --check`.
6. Independent read-only review.
7. Only verified findings may be fixed before Batch 1 closure.

Batch 2 began only after the Batch 1 independent review passed.

## 10. Batch 2 — Cooking History

**Status:** PASS / CLOSED
**Independent review:** BATCH 2 REVIEW PASS — READY FOR P1 CLOSURE

Editable production files:

```text
apps/mobile/src/api/cookHistoryService.js
apps/mobile/src/screens/CookingHistoryScreen.js
apps/mobile/src/screens/ProfileScreen.js
apps/mobile/src/navigation/RootNavigator.js
```

Editable tests:

```text
apps/mobile/__tests__/cookHistoryService.test.js
apps/mobile/__tests__/cookingHistoryStaticAudit.test.js
apps/mobile/__tests__/profileStaticAudit.test.js
apps/mobile/__tests__/navigationShellStaticAudit.test.js
```

Acceptance criteria:

- Add real `getHistory({ page, limit, sort })` wrapper.
- Use `sort=newest`.
- Use event IDs as list keys.
- Keep repeated events for the same recipe as separate rows.
- Show only server `completedAt` timestamps.
- Use only returned recipe summary data for image/title/meta.
- Loading state.
- Final confirmed-empty state.
- Retryable error state.
- Pull-to-refresh.
- Guarded incremental loading.
- Continue while `page < totalPages`, even if the current visible page is empty.
- Do not show “No history” until all pages are exhausted with no usable rows.
- Do not display fabricated totals.
- History rows open the existing API-backed Recipe Detail route.
- `CookHistoryContext` remains stats-only and unchanged.
- Existing Cook Mode record behavior remains unchanged.
- Existing cooked status/pill behavior remains unchanged.
- Profile Cooked count remains authoritative and only gains navigation.
- Accessible controls and rows.
- Existing light/dark theme tokens.
- Generation/unmount guards prevent stale pagination responses from overwriting refreshes.

Final implementation integrates real `GET /cook-history` newest-first history, preserves repeated events using event IDs, renders only server-authoritative `completedAt`, advances across empty intermediate pages using `page < totalPages`, guards pagination and refresh generations from stale responses, makes the authoritative Profile Cooked stat a navigation affordance, and registers `CookingHistory` in the authenticated root stack.

Batch gate (completed):

1. Focused tests.
2. Existing backend cook-history suites.
3. Relevant mobile regression.
4. Full mobile suite if required by repository workflow.
5. `git diff --check`.
6. Independent read-only review.
7. Only verified findings may be fixed before Batch 2 closure.

## 11. Security invariants

- Authentication remains server authority.
- Never send or trust client-supplied owner IDs.
- Review edit/delete capability must come from `currentUserReview`; backend ownership predicate is final authority.
- Serialize review mutations and guard duplicate submissions.
- Preserve opaque foreign-review behavior.
- Do not introduce HTML rendering for untrusted review comments.
- Do not send `completedAt`, author data, aggregate fields, or recipe snapshots.
- Do not deduplicate cook-history events.
- Do not manufacture missing server timestamps.
- Do not expose hidden/unusable recipe rows by trying to reconstruct them client-side.

## 12. Regression risks to test explicitly

- Recipe Detail summary stale after review mutation.
- Existing star-only review accidentally causes duplicate `POST`.
- Delete removes both star rating and comment without adequate confirmation.
- Concurrent `onEndReached` creates duplicate page requests.
- Empty filtered history page incorrectly becomes final empty state.
- Profile cooked count differs from visible history because stats retain unavailable recipes.
- Root stack static audit broken by new route registration.
- History navigation accidentally passes a mock recipe object instead of API identity.
- Accessibility labels omit destructive/state meaning.
- Dark-mode colors bypass theme tokens.

## 13. Teammate reference policy

Frozen teammate SHA:

`4ffd47d176afcfb1f23ffa1be079f01791fae92e`

Adoptable presentation ideas:

- Cooking History root-stack destination.
- Profile Cooked affordance.
- Compact history image/title/meta/date rows.
- Empty-state presentation.
- Accessible row labels.

Do not adopt:

- AsyncStorage review authority.
- AsyncStorage cooking-history authority.
- Generated local history IDs.
- Client `Date.now` authority.
- Fabricated “Earlier” history.
- Mock recipe lookup.
- Seeded rating/review counts.
- Local progress/notification/seeded profile behavior.

The teammate frontend contains no real written-review body/list/edit/delete flow. MOBILE-P1 review UX must be built from WeCooked's real API contract.

## 14. Final verification results

Final P1 closure verification:

- Backend review/cook-history: 181 passed, 0 failed.
- P1-focused mobile: 8 suites, 170 tests passed, 0 failed, 0 snapshots.
- Full mobile: 53 suites, 832 tests passed, 0 failed, 0 snapshots.
- `git diff --check`: PASS.
- Android/device runtime verification: DEFERRED.

M27 checkpoint before P1:

`f6ef49185c6064d9975e4786efbe572bdbe14163`

M27 full mobile baseline at closure:

- 49 suites
- 765 tests
- 0 failures
- 0 snapshots

Do not mechanically target old test counts if P1 legitimately adds tests.

## 15. Git safety

Known unrelated untracked files must remain untouched:

```text
AGENTS.md
app.json
apps/api/audit-result.json
apps/mobile/.tmp-expo-config-error.txt
docs/WeCooked_Android_Dev_Build_Setup.md
docs/WeCooked_Local_Development_Startup.md
docs/architecture/WeCooked_Full_Project_Handoff.md
docs/architecture/frontend-migration-m2-screen-audit.md
docs/milestones/M25-email-verification.md
```

Rules:

- Never `git add .`
- Never `git add -A`
- Never clean untracked files.
- Never stage unrelated documentation.
- Do not push until milestone closure explicitly authorizes it.

## 16. Runtime policy

Android/device runtime verification: **DEFERRED**.

Static/unit/regression PASS does not equal runtime PASS.

No runtime claim may be made until a later explicit device/runtime gate.

This runtime deferral does not change the completed source, unit, regression, or independent-review closure status. No Android runtime, visual runtime, device accessibility, or live API/device PASS is claimed.

## 17. Milestone completion definition

MOBILE-P1 implementation and review closure are complete:

- Controlled Scope Amendment A was implemented and independently reviewed as part of Batch 1.
- Batch 1 independently passed and is closed.
- Batch 2 independently passed and is closed.
- The cumulative P1 closure audit passed subject to the documentation correction recorded here.
- Required tests/regressions and `git diff --check` passed.
- Exact P1 scope was verified with no package or unrelated scope creep.
- Android/device runtime remains truthfully deferred.
- The checkpoint commit has not yet been created.
- Nothing has been pushed yet.

The implementation is checkpoint-ready, but this document does not claim that a checkpoint commit or branch push already exists.
