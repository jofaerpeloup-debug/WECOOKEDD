# WeCooked — MOBILE-HOME2 Home Parity Audit

**Status:** READ-ONLY PRODUCT PARITY AUDIT COMPLETE — READY FOR CONTRACT REVIEW

**Audited baseline:** `origin/main` `5d61bde3c9602a3fc044bcb19e957212d0fc52a5` (fetched 2026-10-07)

**Teammate visible-product reference:** `jofaerpeloup-debug/WECOOKEDD` commit `4ffd47d176afcfb1f23ffa1be079f01791fae92e`
**Scope:** `apps/mobile/src/screens/DashboardScreen.js` is the authenticated `Home` tab. This audit changes no production code, tests, Git index, or existing worktree.

## 1. Authority and baseline conclusion

The teammate implementation is a presentation reference only. Its Home reads `recipes`, `CRAVINGS`, profile, recent-search, recently-viewed, shopping, and notification state from fixture/local-context modules. It searches and ranks the fixture array on device; its Trending row sorts fixture `rating` and `reviews`; its refresh is `useFakeRefresh`. None of that is transferable as domain authority.

Current WeCooked Home is already an authenticated API-backed recipe surface. It calls `listRecipes({ sort: 'newest', limit: 8 })`, sends search to the same server list endpoint, uses public recipe IDs, real recipe image URLs, the server-backed Favorites provider, and real navigation routes. The server applies public visibility/usability before serializing results. Home has no server recommendation, popularity, recently-viewed, craving taxonomy, or personalized-feed contract.

## 2. Current Home capabilities

| Capability | Current behavior and authority |
| --- | --- |
| Structure/header | Shared `TopBar` wordmark, Saved shortcut, notification dropdown; Home is the authenticated `Home` tab. |
| Greeting | Time-of-day greeting plus `AuthContext.user.name` first name; display-only, never identity/ownership authority. |
| Search | Debounced authenticated `GET /api/v1/recipes?search=...&page=1&limit=20`; backend search is title/description. Results open `RecipeDetail` with `{ recipeSource: 'api', recipeId, initialRecipe }`. |
| Recent searches | Account-scoped device convenience history. `SearchHistoryProvider` owns hydration, normalization, clearing, account-change generation, and persistence; it is not domain activity. |
| Recipe content | One bounded `GET /recipes?sort=newest&limit=8`; Home derives a daily visual hero and remaining Latest recipes from that exact server order. Cards use API images and `FavoriteHeart`. |
| Browse shortcuts | Easy, Vegetarian, Vegan only. Each is an exact Discover filter handoff; no cuisine/category inference occurs. |
| Saved | Header routes to the real Saved screen; card heart is server-backed Favorites. |
| Notifications | Shared server-backed notification dropdown. Home neither produces notifications nor implements native push. |
| Loading/empty/error | Loading, blocking error with retry, and empty states exist for latest and search. Background failure preserves already-rendered recipes through the freshness policy. |
| Refresh/lifecycle | Recipe refresh lifecycle reloads latest on subsequent focus/app-active. There is no Dashboard pull-to-refresh control. |
| Pagination | Latest is intentionally bounded to eight; inline search is intentionally first-page bounded to twenty. Discover owns broader catalog paging. |
| Authentication/races | `mountedRef`, independent `latestGenRef`/`searchGenRef`, query invalidation before debounce, and provider account ownership prevent stale continuations from applying after a newer request or unmount. |

## 3. Teammate Home inventory

| Teammate element | Data and interaction evidence | Classification |
| --- | --- | --- |
| Wordmark, greeting, search/filter | Local profile and fixture recipe array; filter opens teammate Search | A for presentation/entry point; WeCooked equivalents are authoritative and already implemented. |
| Saved shortcut | Routes to Saved | A: current header routes to server-backed Saved. |
| Grocery cart and pending count | Counts unchecked local shopping-context fixture items; routes to Grocery | B: authoritative ShoppingListProvider already has current user items and `List` is registered. No API/schema work needed. |
| Notification bell/dropdown | Local context presentation | A for current server-backed notification dropdown; NOTIF2 push delivery remains excluded. |
| Recent searches | Local persisted convenience history | A: current account-scoped convenience history is safer and records deliberate actions only. |
| Today's Feature | Day-index selection from fixture recipes | A: current deterministic daily visual selection from bounded, server-ordered newest results. It is not editorial or personalized. |
| Browse by craving | Fixture `CRAVINGS`, routes fixture category query | D/BLOCKED: labels are `Breakfast`, `Noodles`, `Ulam`, `Desserts`, `Vegetable`; they are mock taxonomy labels and do not prove exact current canonical mappings. |
| Trending meals | Sorts fixture `rating`, then fixture `reviews`; See all routes teammate Trending | C: RANK1-dependent and unmerged/release-held. |
| Recently viewed | Locally persisted fixture recipe IDs; clear control | D: current server has no recipe-view event/history contract. |
| Pull-to-refresh | `useFakeRefresh` | E: fake refresh must not be copied. |

No teammate Home Community, follow, meal-plan, profile, or recommendation section was found at the pinned commit. Existing product routes/providers do not make an absent teammate Home section a HOME2 requirement.

## 4. Parity and data mapping

| Candidate | Status | Existing authority / required boundary |
| --- | --- | --- |
| Latest recipe hero/rail | A | `GET /api/v1/recipes` with server-owned `newest` order, public projection, bounded limit. |
| Search, filters, recent searches | A | Existing recipe API plus account-scoped local search convenience state. |
| Saved/favorite access | A | `GET/POST/DELETE /api/v1/favorites` and Saved route; no local Saved authority. |
| Shopping cart shortcut/count | B | ShoppingListProvider's existing authenticated `GET /api/v1/shopping-list`, item `isChecked`, and root `List` route. |
| Cravings/categories | D | Need an explicitly approved canonical product mapping and content coverage. Do not map teammate fixture terms by resemblance. |
| Trending/top-rated/popular | C | RANK1 must supply server ranking/eligibility; client sorting of reviews is prohibited. |
| Recently viewed | D | New server-owned view-event/history contract, retention/privacy policy, serializer and bounded list endpoint would be required. |
| Personalized/For You/recommendations | D/E | No authoritative recommendation contract/data exists; teammate Home does not implement one. |
| Community/following Home feed | C/D | Community All/Following/Saved is already Community-owned; ranked Trending/For You belongs to COMM7. Do not duplicate it in Home. |
| Meal-plan shortcut/reminders | E | Meal Plan is accessible via PlusMenu; reminders/scheduling belong to MEAL4. |

## 5. Findings

### Recommendation, craving, activity, and ranking

- Home content is deterministic/catalog-based: server `newest` ordering plus a client visual daily index. It is not account-, activity-, Saved-, follow-, or category-personalized.
- The five teammate craving labels are fixture category keys, not evidence of an approved mapping. `Breakfast`, `Noodles`, `Ulam`, `Desserts`, and `Vegetable` must remain unavailable as Home shortcuts until a contract confirms exact canonical category values and sufficient classified public recipes. They are neither region, dietary, ingredient/search, nor a safe inferred taxonomy in this audit.
- Teammate recent activity means recently viewed fixture IDs, distinct from its local recent searches. Current WeCooked has real Cook History, but that represents completed cooking events and must not be relabeled "Recently viewed." No current recipe-view persistence exists.
- Ratings/reviews are available per recipe detail, but no recipe-list sort supports rating, review count, Trending, Top Rated, or recommendation score. Ranking must remain RANK1-owned and cannot be reimplemented in HOME2.

### Backend, schema, and performance

- The recommended slice requires **no backend change**. It reuses the provider's existing one-list read; the provider already loads independently at authenticated app startup, so Home must consume state and must not issue another list request.
- Existing public recipe list is authenticated, strict-query, visibility-filtered, paginated, and capped. HOME2 must continue to send only allowlisted filter/sort keys and never status, ownership, arbitrary sort, Mongo predicates, or scores.
- Grocery pending count is a derived display count of current authenticated `items.filter(!isChecked)`; it needs no new field, schema, index, aggregation, migration, or backfill.
- A craving catalog would require canonical schema/query/content decisions. Recent views would require persisted activity records, retention/privacy rules, endpoints, indexes, and migration assessment. Ranking/recommendations need their own server-owned data contract and, potentially, aggregation/materialization/index work. None is approved here.
- The cart shortcut adds no startup request or N+1 behavior. It must not prefetch recipe, meal, Community, Favorites, or history data. Keep recipe Home at one bounded latest request; search remains debounced and bounded.

### Async/race requirements for the candidate cart

ShoppingListProvider already owns session invalidation, list generation, mounted checks, initial/error states, reload exclusion during GET/mutation, and a user gate that exposes no prior account's items. HOME2 should only render its current exposed items/status; it must not cache a count, optimistically decrement it, or start a parallel request. A TopBar cart callback is synchronous navigation only. Therefore no new Home-wide generation is warranted: the existing independent provider owns the independent Shopping section, while Dashboard owns recipe requests.

## 6. Dependency and overlap review

- DISC6 remains the authoritative Discover/search/filter surface; HOME2 only keeps its existing explicit Discover handoff.
- RANK1 owns Trending, Top Rated, and relevance. It is unmerged/release-held; exclude all ranking work.
- SAVED2 is on implementation hold; Home keeps the existing favorite/Saved access only and introduces no collections or Healthy Meals.
- PROFILE2 supplies self-profile detail only. Community follow/public-author behavior is Community-owned; no Home profile/follow feature is indicated.
- COMM3–COMM6 already own comments, follows, saved Community feed, and final recipe CTAs. COMM7 owns server-ranked Trending/For You feeds. No Community Home feed is proposed.
- MEAL2/MEAL3 remain the authoritative planner; MEAL4 owns reminders. Keep the existing PlusMenu entry, no new Home meal feature.
- SHOP3 owns the real Shopping state. SHOP4/SHOP5 are excluded; a read-only header shortcut/count does not alter list behavior.
- RECIPE4 nutrition remains recipe-detail/list projection behavior, not a Home ranking or Healthy Meals signal.
- NOTIF1 owns inbox state. NOTIF2 device FCM and NOTIF3 producers remain excluded.

## 7. Recommended smallest HOME2 contract

Add only the teammate-visible Shopping cart affordance to the existing Home header:

1. Render an accessible cart button between Saved and notifications from the shared Home header path.
2. Navigate to existing root-stack `List` on activation.
3. Read the existing `ShoppingListProvider` state; show a capped non-fabricated pending badge only when the provider is ready and has unchecked items. Do not show a count during load/error and do not create a Home request.
4. Preserve all current Header/Saved/notification behavior, recipe fetches, navigation, account gate, and Shopping mutation ownership.

This is independently testable, has deterministic behavior, and closes the only teammate Home control omitted despite live authoritative backing.

### Proposed implementation allowlist

```text
apps/mobile/src/screens/DashboardScreen.js
apps/mobile/src/components/TopBar.js
```

No backend, API service, context, route, schema, migration, index, configuration, or package path is proposed.

### Proposed test allowlist

```text
apps/mobile/__tests__/dashboardInteraction.test.js (new)
apps/mobile/__tests__/dashboardStaticAudit.test.js
```

Mounted coverage must assert authenticated loaded empty/nonempty/error/loading Shopping provider states, capped badge semantics, exact `List` navigation, no direct shopping service call, no previous-account count after an identity switch, and preservation of existing Saved/bell/search/recipe behavior. Static coverage alone is insufficient.

## 8. Exclusions, gates, and blockers

**Exclusions:** RANK1 ranking; SAVED2/Healthy Meals; category/craving taxonomy; recent views/activity persistence; recommendations/AI; Community feed architecture; notification delivery/producers; Meal reminders; SHOP4/SHOP5 behavior; backend/schema/index/migration work; final visual polish.

**Runtime/device gates (not run):** authenticated Android and iOS navigation; initial Shopping loading, empty, ready, and error; count updates after server-confirmed check/uncheck; sign-out/account switch during loading/mutation; offline/slow-network state; pull/focus lifecycle coexistence; screen-reader labels/state/order and touch targets; light/dark rendering.

**Blockers:** RANK1 for ranking; explicit taxonomy/product decision plus canonical content coverage for cravings; new privacy-reviewed server contract for recent views; new server contract/data policy for personalization; approval status for SAVED2 Healthy Meals. These blockers are excluded from the recommended slice, so they do not block the cart shortcut contract.

## 9. Verdict

**MOBILE-HOME2 AUDIT COMPLETE — READY FOR CONTRACT REVIEW**
