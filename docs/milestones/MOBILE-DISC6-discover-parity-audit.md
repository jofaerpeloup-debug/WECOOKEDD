# MOBILE-DISC6 - Discover parity audit

**Phase:** READ-ONLY PRODUCT PARITY AUDIT<br>
**Baseline:** `origin/main @ 550c701ed4768ecc8b47502b5188b9eb237ee6c6`<br>
**Teammate product reference:** `jofaerpeloup-debug/WECOOKEDD @ 4ffd47d176afcfb1f23ffa1be079f01791fae92e`<br>
**Verdict:** `MOBILE-DISC6 AUDIT COMPLETE - READY FOR CONTRACT REVIEW`

## 1. Authority and audit boundary

The pinned teammate tree is visual-product evidence only. Its Discover screen is backed by `mockData`, client fuzzy search, locally persisted filter state, fake refresh, mock ratings/reviews, and locally computed counts. None of those are an authority for WeCooked persistence, visibility, taxonomy, ranking, security, or APIs.

This audit starts from the fetched `origin/main` baseline above. DISC4 and DISC5 are accepted completed contracts. RANK1 is separate and is not in this audit's implementation slice.

## 2. Existing merged Discover capabilities

`DiscoverScreen` (visible title `Search`) already has:

- authenticated, escaped server title/description search; trim + 300 ms debounce; intentional recent-search recording;
- one account-scoped, generation-bound device-local recent-search owner shared with Dashboard; blank-only recents, clear, case-insensitive dedupe, newest-first limit eight;
- canonical server filters staged in the inline panel: Region, Category, single Difficulty, single Dietary tag, maximum **prep** minutes, and selected canonical Ingredient ID;
- four completed presets (`All`, `Easy`, `Vegetarian`, `Vegan`), the six completed server sorts, page size 20, server pagination, ID dedupe, refresh, later-page retry, Recipe navigation, and favorites;
- truthful initial/loading/error/empty/refresh/load-more states. The visible count is loaded rows plus `+` when `totalPages` says more may exist, not a fabricated exact count;
- reset/discard/apply semantics: draft reset clears narrowing draft values; closing discards draft; Apply sends one page-one replacement; screen Clear clears query and all applied narrowing filters but preserves sort; search-only clear preserves filters/sort.

Existing server list validation is strict and only accepts scalar `search`, `region`, `category`, `difficulty`, `dietaryTag`, `ingredientId`, `maxPrepTimeMinutes`, `status`, `page`, `limit`, `sort`, plus the staff-only frozen `publicationStatus=draft` case. The mobile service deliberately does not expose status or publication status.

## 3. Pinned teammate behavior and comparison

The teammate's Search page exposes Cooking Time, Difficulty, multi-select Dietary, Cuisine, multi-select Mood, and Sort. It also accepts a route category. Its exact mock behavior is:

| Teammate control | Exact mock behavior | Current WeCooked position |
| --- | --- | --- |
| Cooking Time | `minutes`: `<15`, `15..30`, `31..60`, `>60` | Missing; WeCooked only has maximum `prepTimeMinutes`. |
| Difficulty | one of Easy/Medium/Hard | Complete as canonical `easy|medium|hard`. |
| Dietary | multiple selections, every selected tag must be in `r.dietary` (AND) | Only one canonical `dietaryTag` is currently selectable/queryable. |
| Cuisine | one of Luzon/Visayas/Mindanao/Fusion | Not a current Recipe field; `cuisine` is explicitly retired. |
| Mood | selected values match any recipe vibe (OR) | No authoritative Recipe mood/vibe field. |
| Category | route-driven mock categories: breakfast/noodles/ulam/desserts/vegetable | Current canonical Category selector is complete, but its independent vocabulary is only breakfast/lunch/dinner/snack. It cannot honestly impersonate the mock taxonomy. |
| Sort | Relevance, Top Rated, Quickest, newest; relevance is client fuzzy score, rating uses mock rating/reviews, quickest uses mock minutes | Current six non-ranking sorts are complete. Relevance, Top Rated, Trending and rating aggregation are RANK1, not DISC6. |

The teammate stores its entire filter object under one unscoped local storage key. DISC5 intentionally did not adopt that behavior: only account-scoped search-history preference persists; applied filters are screen-local and reset after the Search route is popped.

## 4. Exact remaining DISC6 slice

The contract-ready, server-representable remaining slice is narrowly:

1. Add an authoritative **total cooking-time bucket** filter with the pinned visual boundaries.
2. Upgrade canonical Dietary from one selected tag to a bounded canonical multi-select with **AND** semantics.
3. Present those two controls in the existing staged filter panel, preserving all DISC4/DISC5 request ownership, reset/discard/apply, search, sort, pagination, accessibility, and current single-tag behavior as the one-tag subset.

Do not add mock cuisine, mood, teammate categories, rating/relevance/quickest sort, Trending, fake counts, client filter/ranking, or persisted filter state. Region and existing canonical Category are already complete controls and are not to be reopened.

## 5. Filter predicates, combinations, and missing values

All accepted filters compose by AND with active/public consumer visibility and escaped search. `search` remains an escaped literal case-insensitive title-or-description `$or`, nested under the enclosing AND where necessary. Pagination and total must use the identical completed filter; page is reset to 1 for any applied replacement.

| Family | Client value / validation | Exact server predicate | Missing-value behavior | Safe now? |
| --- | --- | --- | --- | --- |
| Region | one `RECIPE_REGIONS` slug | `{ region: value }` | absent region does not match | Already complete |
| Category | one `RECIPE_CATEGORIES` slug | `{ category: value }` | absent category does not match | Already complete; do not substitute teammate categories |
| Difficulty | one `easy|medium|hard` | `{ difficulty: value }` | absent/invalid does not match | Already complete |
| Dietary (current) | one fixed tag | `{ dietaryTags: value }` | absent/empty array does not match | Complete subset |
| Dietary (DISC6) | nonempty, deduplicated array from fixed `RECIPE_DIETARY_TAGS`, maximum enum length | `{ dietaryTags: { $all: values } }` | absent/empty array does not match any nonempty selection | Yes |
| Ingredient | selected canonical ObjectId only | `{ 'ingredients.ingredientId': id }` | no matching usage does not match | Already complete |
| Maximum prep | integer 0..1440 at API; mobile input 1..1440 | `{ prepTimeMinutes: { $lte: value } }` | absent prep does not match this legacy control | Already complete; not total time |
| Total-time bucket (DISC6) | one closed enum: `lt15`, `m1530`, `m3060`, `gt60` | server maps enum to a fixed `$expr` over canonical total, never accepts a client predicate or range | absent prep is zero; absent cook has no total and does not match | Yes |
| Cuisine | none | none | N/A | **BLOCKED**: retired/no authoritative field |
| Mood/vibe | none | none | N/A | **BLOCKED**: no authoritative field |

The total-time expression is `{$add: [{$ifNull: ['$prepTimeMinutes', 0]}, '$cookTimeMinutes']}`. The service must map the bucket, not trust a client expression:

- `lt15`: total `< 15`.
- `m1530`: total `>= 15` and `<= 30`.
- `m3060`: total `> 30` and `<= 60`.
- `gt60`: total `> 60`.

These are mutually exclusive and exhaustive for a present nonnegative cook time, exactly matching the teammate `timeBucket()` implementation. Repeated dietary values must be deduplicated before request construction; an empty array means omit the family. Invalid scalar/array/unknown query values are `400 VALIDATION_ERROR`, not ignored. A time-bucket query is scalar; repeated/operator-shaped values are rejected by the strict schema.

## 6. Time findings

Current display already defines canonical total time as `(prepTimeMinutes if present, otherwise 0) + cookTimeMinutes` in `totalTimeMinutes()`. The published authoring contract requires cook time 3..1440 and allows prep to be absent; legacy published validation allows nonnegative legacy values. Consumer usability removes incomplete/non-published records after the DB page, but the time predicate must still make absence explicit: only prep is coalesced to zero; a missing cook time is not converted to zero and cannot match a time bucket.

Therefore DISC6 must not relabel `maxPrepTimeMinutes` as total time, derive a client total after fetch, or sort by total time. The existing prep sorts remain complete DISC4 behavior. A total-time sort is not needed for pinned filter parity and would be a separate contract/index decision.

## 7. Taxonomy result

Canonical Region, Category, Difficulty, and Dietary are already server-owned controlled vocabularies. They are distinct axes:

- Region is a Philippine administrative-region slug, not the teammate's Luzon/Visayas/Mindanao/Fusion cuisine label.
- Category is `breakfast|lunch|dinner|snack`, not mock dish type (`ulam`, `noodles`, `desserts`, `vegetable`).
- Dietary is an explicit tag array; no health, allergen, or nutrition inference is permitted.
- Difficulty is its own enum.
- Mood/vibe has no persisted authoritative field.

DISC6 can safely add multi-tag composition because it uses the existing dietary taxonomy. Cuisine and mood are blocked until a separately approved data-model, controlled vocabulary, moderation/content ownership, and backfill contract exists. No “Healthy” definition is created; SAVED2 remains blocked on one.

## 8. Smallest secure API/backend extension

No schema migration, model field, serializer field, client-provided Mongo object, arbitrary sort, status override, or visibility override is needed.

Extend only `GET /api/v1/recipes` validation/controller/service with:

- `dietaryTags`: optional array of existing dietary enum strings; nonempty after validation, unique, bounded by the known enum size; service maps it to fixed `$all`.
- `totalTimeBucket`: optional fixed enum `lt15|m1530|m3060|gt60`; service maps it to the four fixed `$expr` comparisons above.

The mobile service exposes only those named keys. It continues to omit status/publication status. Query schema remains `.strict()`, fixed sort remains allowlisted, server alone composes `isActive` and consumer publication visibility, and the same final filter is passed to `findMany` and `countByFilter`. Existing no-SQL-injection proof must cover operator-shaped forms for each new key.

`$expr` may reduce index usefulness for the bucket portion. This audit does not authorize a materialized total field or backfill. Contract review must decide whether representative production explain evidence shows a performance problem; an index/migration is not presumed necessary.

## 9. Async, state, and race findings

DISC5 already proves mounted behavior for query A/B, clear, recent selection, staged Apply, Dashboard preset, refresh, load-more, later-page retry, unmount/remount, and stale finalizers. It synchronously invalidates generations before replacements; stale success, failure, or finalizer cannot mutate rows, count, pagination, errors, refreshing, or loading-more state. Filter expansion and unsettled search suppress pagination.

Search-history account switching is separately protected: visible A history clears synchronously, A hydration/write cannot affect B, and storage is scoped to authenticated user ID. DISC6 must retain those paths. New time/dietary draft changes need the same Apply/close/discard model and must invalidate immediately only on Apply; rapid Apply A then Apply B, time/dietary + search, refresh, page-two, and unmount must prove immutable request snapshots and rejection of stale completions. Filters remain nonpersistent local UI state.

## 10. Proposed allowlists for contract review

Production allowlist (only if this contract is approved):

```text
apps/api/src/modules/recipes/recipe.validation.js
apps/api/src/modules/recipes/recipe.controller.js
apps/api/src/modules/recipes/recipe.service.js
apps/mobile/src/api/recipeService.js
apps/mobile/src/api/recipeOptions.js
apps/mobile/src/utils/discoverFilters.js
apps/mobile/src/components/DiscoverFiltersSheet.js
```

`DiscoverScreen.js` is explicitly excluded unless the approved UI design requires a label/count rendering change that cannot be contained in the existing panel. No model, repository, serializer, migration, index, contract-package, navigation, Dashboard, App, storage, package, or lockfile change is authorized.

Test allowlist:

```text
apps/api/test/recipe-validation.test.js
apps/api/test/recipe-service.test.js
apps/api/test/recipe-routes.test.js
apps/api/test/nosql-injection-routes.test.js
apps/mobile/__tests__/discoverFilters.test.js
apps/mobile/__tests__/discoverInteraction.test.js
apps/mobile/__tests__/discoverStaticAudit.test.js
```

Required proof includes enum/unknown/repeated/operator rejection; `$all` AND behavior; all four total boundaries (14, 15, 30, 31, 60, 61); missing prep as zero; missing cook excluded; exact filter/search/visibility composition; identical count/find filter; reset/discard/Apply and one-tag compatibility; pagination; and mounted rapid-Apply/search/refresh/load-more/unmount races. No test may turn an unrun device/database gate into a pass.

## 11. Exclusions, dependencies, and adjacent findings

- **RANK1:** relevance, Top Rated, Trending, ratings/reviews aggregation, quickest/ranked query logic, and ranking indexes are excluded and unmerged.
- **SAVED2:** no Quick/Weekend/Breakfast/Dinner/Healthy collection semantics; Healthy remains blocked pending an approved definition, not inferred from dietary/nutrition.
- **HOME2:** Dashboard craving rail, recently viewed, cart/badge, and route-category mock taxonomy are excluded.
- **RECIPE4:** existing authoritative nutrition is unchanged; no nutrition filter or health claim.
- **COMM7:** Trending/For You community ranking is excluded.
- **PROFILE2:** identity/avatar/public-author behavior is unrelated and unchanged.

Adjacent product finding: the teammate's cuisine, mood, and route category experience cannot be faithfully ported with current fields. They are explicit future taxonomy/data-governance blockers, not permission to reuse mock labels or heuristics.

## 12. Runtime and production gates

Automated proof is necessary but not a physical pass. Before declaring implementation runtime-complete, run authenticated Android and iOS checks against a representative real API/database for:

- all bucket boundaries and missing-prep recipes; multi-dietary AND results; combined region/category/difficulty/ingredient/search filters; reset/discard/apply and retained sort;
- slow-network rapid filter edits, Apply A/B, search + filters, refresh, page-two, retry, account switch, and unmount/remount;
- loaded-count honesty when post-query usability filtering shortens a page; loading/error/empty/footer states; keyboard, safe areas, screen readers, 44-point controls, and large text;
- production query latency/explain observation for `$expr` before authorizing any performance remediation.

These runtime/device/database gates are **NOT RUN** and are not claimed as passed.

## 13. Blockers and recommended contract

There is no blocker for the narrow time-bucket plus multi-dietary contract. The following requested visual families are blocked: cuisine (retired field), mood/vibe (no field), mock category vocabulary (different taxonomy), and ranking/sorts (RANK1). Any attempt to add them requires a new data/taxonomy contract and content backfill, not DISC6 implementation expansion.

Recommended contract: preserve all completed DISC4/DISC5 behavior; add only `totalTimeBucket` and canonical `dietaryTags` as named, strict, server-mapped filters; use existing staged inline UI and generation ownership; explicitly leave mock taxonomy and ranking out.

**MOBILE-DISC6 AUDIT COMPLETE - READY FOR CONTRACT REVIEW**
