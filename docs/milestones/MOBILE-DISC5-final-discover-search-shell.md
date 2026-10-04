# MOBILE-DISC5 — Final Discover Search Shell and Shared Recent Searches

**Phase:** FINALIZATION
**Status:** IMPLEMENTATION COMPLETE — CLOSURE PASS — READY FOR PR
**Baseline:** `origin/main @ 7409bcf6f8934994f6f0df13eadc67ab5b25fde5`
**Architecture:** `FRONTEND_ONLY`
**Merge status:** `NOT MERGED`
**Verdict:** `MOBILE-DISC5 FINALIZED — READY FOR PR`

## 1. Goal and authority

Deliver the final Search interaction shell over the completed P3 and DISC4 contracts. The pinned teammate frontend remains the visible-product authority for this shell; the live WeCooked API, authentication, Recipe and Ingredient data, filter/sort semantics, pagination, favorites, navigation, accessibility, and freshness rules remain authoritative for behavior and data.

MOBILE-DISC5 does not create another search, filter, result, ranking, or persistence authority. It changes only the mobile presentation, shared recent-search preference ownership, and stale-request protections required by the final shell.

## 2. Frozen architecture

- This milestone is frontend-only.
- Authenticated `GET /api/v1/recipes` remains the sole Recipe-result authority.
- Canonical Ingredient lookup remains authoritative for `ingredientId` selection.
- No backend, schema, serializer, index, migration, database, navigation, or package change is permitted.
- `DiscoverScreen`, presented to the user as Search, owns search text, results, pagination, errors, loading state, applied filters, filter drafts, sort, and request ownership.
- One shared mobile `SearchHistoryContext` owns recent-search preference state for Dashboard and Search.
- Recent searches are authenticated-account-scoped, device-local preferences. They are neither ephemeral screen state nor server domain data.
- The shared history provider must use the existing mobile storage wrapper. It must not own filter state or API results.
- Preserve existing Recipe Detail navigation, favorites, theme, accessibility, refresh, server filtering/sorting, and pagination contracts.

## 3. Frozen visible-product contract

- The pushed screen title is `Search`, with the existing back behavior; it does not become a tab.
- Use one vertically scrolling list surface containing the title/header, inline search, recent searches, collapsible inline filters, visible sort group, result count and states, and compact Recipe rows.
- The search field is a filled, minimum 44-point control with a search icon and `Search recipes...` placeholder. It searches inline as text changes, uses `keyboardShouldPersistTaps="handled"`, and does not force autofocus.
- Recent-search chips appear on Search only while the query is blank. Dashboard and Search show the same shared history immediately.
- History terms are trimmed, nonblank, case-insensitively deduplicated, newest-first, and capped at eight.
- Record a search only on an intentional action: keyboard Search submission, recent-chip selection, or opening a result while a nonblank query is active. Blur or partial typing must not record history.
- Replace the modal/sheet presentation with a collapsible inline `Filters · N` hierarchy while retaining staged draft behavior and all completed P3/DISC4 controls.
- Sort remains a separate, always discoverable visible group with exactly the six completed DISC4 choices.
- While filters are expanded, present the prominent bottom `Show recipes` CTA. It must not predict an unqueried result count.
- Above the compact Recipe rows, show the existing truthful uppercase loaded-result treatment. Do not present `pagination.total` as an exact visible usable-result count; preserve the loaded-count-plus indicator where more pages exist.
- Preserve real initial loading, background refresh, blocking error/retry, empty/`Nothing matches` recovery, populated, load-more, and later-page error/retry states.
- Pull-to-refresh and authoritative `pagination.totalPages` pagination remain available. Hide the vertical scroll indicator.
- Expanding the inline panel or changing unsettled search text must not accidentally trigger `onEndReached` pagination.
- Returning from Recipe Detail restores the still-mounted Search screen state. After Search is popped, reopening it starts from its route contract; only recent history persists.

### Clear and filter behavior

- The search-field clear control removes only the query and runs the authoritative empty-query catalog request with the current applied narrowing filters and sort.
- The trailing screen-level `Clear` action clears the query and every applied narrowing filter, including canonical Ingredient, resets to page 1, and preserves the selected sort.
- `Clear recent searches` changes only shared history. It must not change query, filters, sort, results, error, loading, or pagination state.
- Opening filters copies applied state into draft state.
- Draft Reset clears narrowing-filter draft values only.
- Collapsing the panel, Android back, or another discard path abandons unapplied draft changes and issues no request.
- `Show recipes` validates and applies the draft once, collapses the panel, and starts one guarded page-1 request.
- Searching preserves applied filters and sort. Applying filters preserves search. Dashboard preset handoffs replace narrowing filters, clear search, preserve sort, and retain their completed P3/DISC4 semantics.

## 4. Frozen search and request contract

- Search is trimmed and debounced by 300 ms. A blank/whitespace query omits the `search` key and shows the server-filtered catalog.
- The API search maximum remains 150 characters and retains escaped literal, case-insensitive title-or-description matching.
- Requests may contain only the established keys: `search`, `region`, `category`, `difficulty`, `dietaryTag`, `ingredientId`, `maxPrepTimeMinutes`, `sort`, `page`, and `limit`.
- Sort remains restricted to `titleAsc`, `titleDesc`, `newest`, `oldest`, `prepTimeAsc`, and `prepTimeDesc`.
- Recipe page size remains 20. Continue by authoritative `pagination.totalPages`, retain dedupe by Recipe ID, and never locally filter, rank, or sort returned pages.
- Every first-page, retry, refresh, and load-more request is built from one immutable snapshot of current trimmed search, applied filters, sort, page, and limit.
- Typing query B immediately invalidates every owner for query A before B's debounce fires. It also clears results that no longer correspond to the visible query and establishes B's loading intent.
- Query clear, recent-chip selection, filter Apply, preset handoff, retry, refresh replacement, route transition, and unmount must synchronously invalidate incompatible request ownership before starting or scheduling replacement work.
- A stale first-page, refresh, or load-more success cannot replace, append to, count, paginate, or otherwise update current UI.
- A stale failure or finalizer cannot set or clear the current error, initial-loading, refreshing, loading-more, or footer-error state.
- A response from an unmounted Search instance cannot affect a newly mounted instance.
- Keyboard Search records the term and may flush the debounce immediately, but must not duplicate an already-current request.
- Selecting a recent chip records it newest-first, sets it as the query, and uses the same guarded request path.
- Opening a result records the current nonblank query before navigation without changing Recipe Detail parameters.
- Refresh and load-more retain the exact current search/filter/sort projection. Load-more cannot run while the query is unsettled, filters are expanded, a first-page replacement owns the UI, or another load-more owns the page.

## 5. Frozen history contract

- `SearchHistoryContext` is the single production owner of recent-search hydration, normalization, in-memory state, persistence, record, and clear operations.
- Dashboard and Search consume that provider; neither screen may keep an independent persisted history store.
- Storage is keyed by authenticated `user.id`. The scoped key must not contain a token, email address, display name, or other mutable identity.
- Do not automatically migrate or expose the legacy unscoped `wecooked:recentSearches` value because its account owner cannot be proven.
- On logout, session expiry, or authenticated-account change, clear visible history synchronously before hydrating the next account.
- Bind every hydration and write to the user/session generation that initiated it. A late user-A hydration, normalization write, record write, clear write, failure, or finalizer cannot alter user B's visible state or storage key.
- Valid history is an array of at most eight trimmed, nonblank strings, case-insensitively unique and newest-first.
- Sanitize malformed JSON shapes and entries before rendering. Ignore nonarrays, nonstrings, blank strings, duplicates, and overflow.
- Storage read/write/remove failures degrade safely to bounded in-memory behavior or empty history and never block Recipe search.
- Provider consumers synchronize immediately in memory; persistence is best-effort and must not create competing screen-local state.

## 6. Privacy and security contract

- Search history is a private device-local preference scoped to the authenticated backend user ID.
- There is no search-history API and no backend persistence, sync, schema, migration, or database mutation.
- Never send history or search terms to analytics, application logs, crash metadata, telemetry, or another account.
- Never mix history with SecureStore, access/refresh tokens, token keys, or credential lifecycle state.
- The existing general storage wrapper is allowed; device-local storage is best-effort and not encrypted. The visible clear-history control is therefore mandatory.
- Never record partially typed text on blur.
- Malformed or hostile stored values must be normalized and bounded before use or persistence.
- Client history never changes Recipe authorization, publication visibility, filtering, ranking, request validation, or canonical data.
- Preserve authenticated Recipe requests, fixed query allowlists, escaped server search, canonical Ingredient identity, and all completed P3/DISC4 visibility protections.

## 7. Exact production allowlist

Only these production files may change:

```text
apps/mobile/App.js
apps/mobile/src/context/SearchHistoryContext.js
apps/mobile/src/screens/DashboardScreen.js
apps/mobile/src/screens/DiscoverScreen.js
apps/mobile/src/components/DiscoverFiltersSheet.js
```

`SearchHistoryContext.js` is an approved new file. `DiscoverFiltersSheet.js` may be adapted into the inline staged panel without being renamed.

Explicitly unchanged:

```text
apps/mobile/src/utils/storage.js
apps/mobile/src/utils/discoverFilters.js
apps/mobile/src/api/recipeOptions.js
apps/mobile/src/api/recipeService.js
apps/mobile/src/api/ingredientService.js
apps/mobile/src/navigation/**
apps/api/**
packages/**
package.json
package-lock.json
```

If implementation requires another production file, stop and amend this contract rather than widening scope silently.

## 8. Exact test allowlist

Only these test files may change:

```text
apps/mobile/__tests__/searchHistoryInteraction.test.js
apps/mobile/__tests__/dashboardStaticAudit.test.js
apps/mobile/__tests__/discoverStaticAudit.test.js
apps/mobile/__tests__/discoverInteraction.test.js
```

`searchHistoryInteraction.test.js` is an approved new file. No backend test changes are allowed. Existing Discover-filter, navigation-shell, retired-cuisine, Recipe service/validation/routes, and full mobile tests remain unchanged regression gates.

## 9. Required automated and race proof

Tests must mount the relevant providers/screens and observe UI and requests. Static source assertions alone are insufficient for the behavioral contract. Race tests must establish visible current state before stale work settles so removing the ownership guard produces a real failure.

Required cases:

1. Start query A, type query B, and settle A before B's debounce fires. A cannot render rows, count, error, or pagination, or clear B's loading intent.
2. Resolve B visibly, then settle A separately as success and failure. B's rows, count, error, pagination, and loading state remain unchanged.
3. Start a query, clear to empty, resolve the current unfiltered request visibly, then settle the old query. The unfiltered state remains authoritative.
4. Start A, select recent chip B, resolve B visibly, then settle A. Only B remains.
5. Start load-more for A, type B, resolve B page 1 visibly, then settle A load-more. There is no stale append or stale footer cleanup.
6. Start refresh for A, type B, resolve B, then settle A. B remains and refreshing/loading ownership stays correct.
7. Start a query, then Apply filters or consume a Dashboard preset. Resolve the composed current request and then the old request. The exact current query/filter/sort/page state remains authoritative.
8. Unmount Search with work pending, mount a fresh instance, resolve its current request visibly, then settle the old instance. The old instance cannot affect the new one.
9. Defer user A history hydration, switch to user B and display B history, then resolve A. No A term or A-key write may affect B.
10. Defer an A write, switch to B, perform a B history action, and settle A in both success and failure orderings. B's state and key remain authoritative.
11. Submit or clear from Search and observe Dashboard update immediately; repeat Dashboard-to-Search to prove one shared owner.
12. Prove trimmed/case-insensitive dedupe, newest-first ordering, eight-item eviction, blank rejection, malformed-value sanitization, storage-failure degradation, and no legacy-unscoped migration.
13. Prove keyboard submission, recent-chip selection, and result opening record history, while blur and mere typing do not.
14. Prove query-only clear, screen-level Clear, history clear, filter Reset/discard/Apply, sort preservation, exact one-request Apply, and no pagination caused by filter expansion.
15. Preserve mounted coverage for real loading, error/retry, empty, refresh, load-more/footer error, favorites, Recipe navigation, and exact server query composition.

## 10. Finalization evidence

- Implementation is complete within the exact five-production-file and four-test-file allowlists.
- Independent review findings are resolved; the closure result is `PASS`.
- Frozen DISC5 verification passed: 4 suites, 61/61 tests.
- The current accepted direct DISC4 filter regression passed: 1 suite, 36/36 tests.
- The mounted real Dashboard/Search `SearchHistoryProvider` integration passed, including immediate cross-screen record and clear synchronization.
- Mutation-sensitive finalizer ownership evidence passed for stale first-page, refresh, load-more, Apply, and Dashboard-preset completions.
- Current-main reconciliation passed at `7409bcf6f8934994f6f0df13eadc67ab5b25fde5`; the merged NOTIF1 provider behavior in `App.js` remains intact.
- Shared `App.js` / current-main NOTIF1 regression passed: 5 suites, 56/56 tests.
- `git diff --check` passed after transplantation.
- Android/iOS physical verification is `DEFERRED — NOT RUN — NOT CLAIMED AS PASS`.
- This branch is ready for PR but is not merged.

## 11. Runtime gates

Before MOBILE-DISC5 can be declared runtime-complete, verify on authenticated Android and iOS runtimes against a real API and representative database:

- One-scroll Search layout, back behavior, `Search` title, inline field, conditional recents, inline groups, visible sort, truthful count, compact rows, favorites, and bottom CTA.
- Keyboard Search submission, recent-chip selection, query-only clear, screen-level Clear, history clear, filter Reset/discard/Apply, and empty-query behavior.
- Same-account history persistence across relaunch and strict nonappearance after logout or account switch.
- Search/filter/sort restoration through Recipe Detail and local reset after Search is popped and reopened.
- Initial loading, background refresh, offline/error/retry, empty, populated, load-more, and later-page failure states.
- Slow-network A-to-B, query clear, recent-chip, filter-Apply, preset, refresh, load-more, and unmount/remount races.
- Filter expansion and keyboard/layout changes do not trigger pagination.
- Keyboard focus/dismissal, chip taps with keyboard open, CTA reachability, Android back, safe areas, small screens, large text, screen-reader announcements, and minimum 44-point targets.
- Light/dark presentation and real outgoing Recipe query values.

Runtime remains `DEFERRED — NOT RUN — NOT CLAIMED AS PASS`. No visual, touch, keyboard, accessibility, network, Android, or iOS proof is claimed by this document.

## 12. Deferred and negative scope

- DISC6 cuisine, mood/vibe, multi-dietary taxonomy/query semantics, controlled vocabularies, and catalog backfill.
- RANK1 relevance, Top Rated, Trending, popularity, Best Match, and any other ranked discovery contract.
- Nutrition, calories, macros, or inferred health/allergen claims.
- Trending or For You screens/feeds.
- Backend, schema, serializer, index, migration, or database changes.
- Navigation route changes or Search becoming a tab.
- Dependency, package, lockfile, native-config, theme-system, shared-card, or global component changes.
- Server-synced search history, a history API, cross-device history, analytics, telemetry, or search-term logging.
- Client-side Recipe filtering, sorting, ranking, fabricated counts, mock Recipe data, fake refresh, or a second filter/search/history authority.
- Changes to completed P3/DISC4 Ingredient, filter, sort, favorites, Recipe Detail, publication, or pagination semantics.
- Cook Mode or its protected stash.

## 13. Blockers and stop conditions

There is no contract-freeze or implementation blocker at the frozen baseline. Existing backend and mobile primitives are sufficient, and DISC5 does not depend on DISC6 or RANK1.

Stop implementation and amend this milestone if any of the following becomes necessary:

- a file outside the exact production or test allowlist;
- any backend, database, schema, serializer, migration, index, navigation, package, lockfile, native-config, or SecureStore change;
- a second filter, request, result, or recent-history authority;
- server history, analytics, telemetry, or logging of search terms;
- automatic migration of the unscoped legacy history key;
- client filtering/ranking/sorting, fabricated totals, unsupported query keys, or semantics assigned to DISC6/RANK1;
- weakening authenticated Recipe, visibility, canonical Ingredient, accessibility, or stale-request protections.

Physical-device availability is a runtime gate, not a contract blocker.

## 14. Verdict

**MOBILE-DISC5 FINALIZED — READY FOR PR**

Implementation and automated closure are complete. Android/iOS physical runtime remains deferred, and no merge is claimed.
