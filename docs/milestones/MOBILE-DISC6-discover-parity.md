# MOBILE-DISC6 - Discover parity

**Phase:** CONTRACT REVIEW / FREEZE

**Baseline:** `origin/main @ 550c701ed4768ecc8b47502b5188b9eb237ee6c6`

**Audit:** `docs/milestones/MOBILE-DISC6-discover-parity-audit.md`

**Verdict:** `MOBILE-DISC6 CONTRACT FROZEN — READY FOR IMPLEMENTATION`

## 1. Authority and scope

This milestone freezes only the remaining server-representable DISC6 slice:

1. server-authoritative total-time buckets;
2. canonical multi-dietary AND filtering; and
3. those controls in the existing DISC5 staged Discover filter panel.

The API owns filter validation and Mongo predicate construction. The mobile app
may send only the named values frozen below. It must not send Mongo expressions,
numeric ranges, visibility/status/ownership input, or inferred classifications.

DISC4 and DISC5 remain closed. Their search, canonical Region/Category,
Difficulty, Ingredient, maximum prep-time filter, six existing sorts,
pagination, refresh, presets, loading/error/empty states, and count honesty are
preserved. DISC6 does not introduce RANK1 behavior.

The teammate product remains visual-product evidence only. Its mock data,
taxonomies, client filtering/ranking, ratings, and persisted filters are not
authority for this contract.

## 2. Canonical total-time contract

The canonical total is:

```text
(prepTimeMinutes when present, otherwise 0) + cookTimeMinutes
```

Both canonical time fields have integer-minute semantics today:

- authoring validation requires integer `prepTimeMinutes` and
  `cookTimeMinutes`;
- legacy stored-value compatibility validation also requires integers; and
- the Recipe model applies `Number.isInteger` validators to both fields.

Therefore the integer boundary between 30 and 31 is explicit and has no
fractional gap. DISC6 does not authorize decimal time values or reinterpret the
fields' units.

`totalTimeBucket` is an optional scalar query parameter with exactly these
allowlisted values and server-owned predicates:

| Key | UI label | Exact predicate |
| --- | --- | --- |
| `under-15` | Under 15 min | `total < 15` |
| `15-to-30` | 15-30 min | `total >= 15 AND total <= 30` |
| `31-to-60` | 31-60 min | `total >= 31 AND total <= 60` |
| `over-60` | Over 60 min | `total > 60` |

The four predicates are mutually exclusive. For a present canonical nonnegative
integer cook time they are exhaustive. The service maps the key to its fixed
predicate; it never accepts a client `$expr`, comparison operator, minimum,
maximum, or arbitrary range.

The fixed server expression must explicitly require numeric
`cookTimeMinutes`. Its semantic shape is:

```js
{
  $expr: {
    $and: [
      { $isNumber: '$cookTimeMinutes' },
      // the allowlisted comparison(s), where:
      // total = { $add: [{ $ifNull: ['$prepTimeMinutes', 0] }, '$cookTimeMinutes'] }
    ]
  }
}
```

The numeric cook-time guard is mandatory. A missing or null
`cookTimeMinutes` must not match any bucket, including `under-15`. A missing or
null `prepTimeMinutes` contributes zero. No client-side total calculation or
post-fetch bucket filtering is permitted. The existing `maxPrepTimeMinutes`
filter remains preparation time only and may compose with a total-time bucket.

## 3. Canonical multi-dietary contract

`dietaryTags` uses only the shared `RECIPE_DIETARY_TAGS` taxonomy. Its exact
canonical values are:

```text
vegetarian
vegan
pescatarian
glutenFree
dairyFree
nutFree
```

The accepted list has at most **6 submitted entries**. Each entry must be one
of the exact case-sensitive values above. Blank entries, unknown values,
operator-shaped values, nested values, and more than six submitted entries are
`400 VALIDATION_ERROR`; they are never ignored.

Duplicates are accepted only within that six-entry input bound and are
deduplicated to one occurrence before service predicate construction. Mobile
normalization also deduplicates and projects values in the shared taxonomy
order, producing stable immutable request snapshots. Selection order has no
meaning.

The canonical database predicate for a nonempty selection is:

```js
{ dietaryTags: { $all: values } }
```

This is AND semantics: every selected canonical tag must be stored on the
Recipe. Tags are never inferred from title, ingredients, nutrition, category,
or any other field. A Recipe with an absent or empty stored `dietaryTags` array
does not match a nonempty selection.

An empty mobile selection means no dietary narrowing and omits the
`dietaryTags` query parameter. An explicitly empty wire value is invalid rather
than a second representation of no filter.

The existing scalar `dietaryTag` API parameter remains a compatibility alias
for a one-entry selection. The mobile app moves presets and the filter panel to
canonical `dietaryTags`; one selected tag remains behaviorally compatible.
Supplying `dietaryTag` and `dietaryTags` together is ambiguous and must return
`400 VALIDATION_ERROR`. The service normalizes either accepted representation
to one list and uses the same `$all` path.

## 4. Filter composition and preserved list behavior

Every active family composes with AND at the service-owned filter boundary:

```text
escaped literal search over title OR description
AND region
AND category
AND difficulty
AND dietaryTags-all
AND canonical ingredientId membership
AND maxPrepTimeMinutes when active
AND totalTimeBucket when active
AND server-owned consumer visibility
```

Search retains its internal title-or-description OR but is enclosed by the
overall composition. Consumer visibility remains server-owned active/public
visibility, including the existing legacy publication compatibility rule.
Mobile cannot override status, publication status, ownership, or visibility.

The identical completed Mongo filter object must be passed to both `findMany`
and `countByFilter`. Page resets to 1 for every applied filter replacement.
Page size, ID deduplication, pagination/total behavior, later-page retry, and
the currently supported sorts remain unchanged:

```text
titleAsc
titleDesc
newest
oldest
prepTimeAsc
prepTimeDesc
```

No relevance, Top Rated, Trending, rating, total-time, or other new sort is
authorized.

## 5. Exact API query contract

The consumer route remains `GET /api/v1/recipes`. DISC6 adds only these strict
named parameters:

- `totalTimeBucket=<one exact bucket key>`
- `dietaryTags=<comma-delimited canonical tag list>`

Example before URL encoding:

```text
GET /api/v1/recipes?dietaryTags=vegetarian,glutenFree&totalTimeBucket=15-to-30&page=1&limit=20&sort=titleAsc
```

`dietaryTags` is exactly one scalar parameter. Repeated query keys, bracket
syntax, arrays/objects produced by the query parser, leading/trailing commas,
empty elements, whitespace variants, and client Mongo operators are invalid.
The comma is transport syntax only; the validation layer parses the scalar,
enforces the raw six-entry maximum and exact enum, deduplicates it, and passes a
canonical array to the controller/service. The shared client URL-encodes the
scalar normally.

`totalTimeBucket` is also exactly one scalar. Repeated, bracketed,
operator-shaped, array, object, unknown, or empty forms are invalid. The query
schema remains strict, so unknown keys are rejected.

The current named parameters for search, Region, Category, Difficulty,
Ingredient, maximum prep time, pagination, and the six sorts are preserved.
The existing `dietaryTag` compatibility alias is preserved only as specified
above. Mobile continues not to expose `status` or `publicationStatus`. No
predicate, sort expression, visibility/status override, ownership input, or
arbitrary numeric range is accepted.

## 6. Mobile staged-filter contract

DISC6 extends the existing DISC5 inline staged filter panel; it does not create
a new filter screen, modal, route, or persistent store.

- Opening the panel copies normalized applied filters into independent draft
  state.
- Editing dietary selections or total time changes draft state only and starts
  no Recipe request.
- Dietary is presented as a multi-select group with each of the six canonical
  labels and an accessible selected/checked state. Any number from zero through
  six may be selected.
- Total time is presented as an accessible single-select group with `Any` plus
  the four labels frozen above. At most one bucket may be active.
- Apply validates/normalizes one immutable filter snapshot, synchronously
  invalidates incompatible request ownership, closes the panel, replaces the
  applied state, and starts exactly one page-one request.
- Reset clears all narrowing values in the draft, including all dietary tags
  and total time, while preserving the currently applied sort. Reset does not
  fetch until Apply.
- Close, hardware Back, or Cancel discards un-applied draft edits and restores
  from applied state on the next open.
- The screen-level Clear clears search and every applied narrowing family while
  preserving sort. Search-only clear preserves applied filters and sort.
- The existing Vegetarian and Vegan presets become one-element
  `dietaryTags` selections. Existing preset replacement and selected-preset
  behavior otherwise remain unchanged.
- Active-filter count treats a nonempty dietary selection as one active family
  regardless of selected tag count and treats total time as one family. Sort is
  not counted.
- Selected values remain visible when the panel is reopened; no new applied
  summary outside the existing panel is required.
- Applied/draft filters are screen-local only. They are not written to
  AsyncStorage or any other cross-session persistence.

## 7. Race and async ownership

The existing DISC5 monotonic-generation ownership remains authoritative. Every
request captures an immutable normalized query snapshot. Only a mounted screen
and the current generation may mutate rows, pagination, count metadata, phase,
errors, refreshing, loading-more, or request guards.

Required behavior:

- rapid Apply A then Apply B synchronously invalidates A before B starts; only
  B may commit success, error, or finalizer state;
- a stale filter success or failure cannot overwrite the current list or
  surface an obsolete error;
- refresh owns a new first-page generation for the exact current applied
  snapshot; stale refresh completion cannot affect a replacement;
- pagination uses the same snapshot/generation as the visible list, cannot
  start while filters are open or search is unsettled, and cannot append after
  a replacement;
- an account/session change must fail closed through the authenticated client
  session binding, and the old account's completion cannot become visible in a
  new account session;
- unmount invalidates ownership and all later success, failure, and finalizer
  continuations are no-ops;
- a stale finalizer cannot clear the current generation's first-page,
  refreshing, or loading-more guards;
- search changes, preset replacement, screen Clear, Apply, refresh, and
  account/unmount transitions retain the existing synchronous invalidation
  rules.

Ingredient lookup inside the staged panel retains its separate mounted/session
generation. DISC6 does not reopen that behavior.

## 8. Exact implementation allowlists

### Production allowlist

Only these existing production paths may change:

```text
apps/api/src/modules/recipes/recipe.validation.js
apps/api/src/modules/recipes/recipe.controller.js
apps/api/src/modules/recipes/recipe.service.js
apps/mobile/src/api/recipeService.js
apps/mobile/src/api/recipeOptions.js
apps/mobile/src/utils/discoverFilters.js
apps/mobile/src/components/DiscoverFiltersSheet.js
```

`apps/mobile/src/screens/DiscoverScreen.js` is not authorized: its existing
generic applied-filter query projection, Apply replacement, pagination,
refresh, and generation ownership are sufficient for this contract. No model,
repository, serializer, shared client, shared contracts package, migration,
index, navigation, Dashboard, App, storage, package, lockfile, or configuration
change is authorized.

If implementation evidence shows that any other production path is necessary,
stop and amend/re-review this contract before changing it.

### Test allowlist

Only these test paths may change:

```text
apps/api/test/recipe-validation.test.js
apps/api/test/recipe-service.test.js
apps/api/test/recipe-routes.test.js
apps/api/test/nosql-injection-routes.test.js
apps/mobile/__tests__/discoverFilters.test.js
apps/mobile/__tests__/discoverInteraction.test.js
apps/mobile/__tests__/discoverStaticAudit.test.js
```

Required automated proof includes exact enum/shape/unknown/repeated/operator
rejection; raw maximum length; deduplication; empty omission versus empty-wire
rejection; compatibility alias and dual-parameter rejection; `$all` behavior;
14/15/30/31/60/61 boundaries; missing prep as zero; missing/null cook excluded;
exact search/filter/visibility composition; identical find/count filter;
draft/Apply/Reset/discard/preset behavior; request projection; pagination; and
mounted rapid-Apply/search/refresh/load-more/unmount stale-continuation proof.

## 9. Performance and runtime gates

Total-time filtering uses `$expr`. DISC6 authorizes no index, materialized
total-time field, migration, or backfill.

Before implementation closure, non-production query-plan evidence against
representative real data is required. Record `explain('executionStats')` (or
the provider-equivalent read-only evidence) for all four bucket predicates and
at least one realistically combined consumer query. Preserve the winning plan,
documents/keys examined, rows returned, and observed duration. This evidence is
a gate, not permission to invent an index. If it demonstrates unacceptable
behavior, stop and amend the contract before remediation.

Production performance verification is a release/runtime gate: observe the
deployed bucket query latency and production query plan through an approved
read-only provider path before declaring production runtime complete. No
production database connection, explain, migration, or index action is
authorized by this freeze itself.

Authenticated Android and iOS runtime checks against a representative real
API/database remain required for bucket boundaries and missing values;
multi-dietary AND results; combined filters; staged Apply/Reset/discard;
retained sort; slow-network Apply A/B, search, refresh, page-two, retry, account
change, and unmount/remount; honest loaded counts and all loading/error/empty
states; keyboard/safe-area behavior; screen readers; 44-point targets; and
large text.

These query-plan, production, device, provider, and real-database gates are
**NOT RUN** by contract freeze and are not claimed as passed.

### 9.1 Non-production query-plan verification (2026-10-07)

**Status: PASS — read-only retry completed.** Before connecting, the ignored
API `.env` was parsed without printing its value and independently resolved to
`NODE_ENV=development` and database name `wecooked-dev`. The connected Mongoose
database name was then verified as exactly `wecooked-dev` before any collection
read. `wecooked-production` was not accessed. No data, index, migration, or
fixture was written.

The `recipes` collection contained 44 documents. The exact database-level
consumer filter (`isActive: true` plus published-or-missing
`publicationStatus`) selected four documents; this is useful real-data context,
but not a claim of the final post-population ingredient-usability count. All
four were sampled for canonical filter availability. The inspected missing/null
or string time-value check found zero rows in that database-visible set.

Each explain used the actual consumer list shape: active consumer visibility,
the service-owned numeric cook/prep guard and fixed total-time `$expr`, default
`titleAsc` sorting, and limit 20. The combined query additionally used the
existing canonical `region: national-capital-region` filter. The results were:

| Query | Winning plan | Scan behavior | Docs / keys examined | Returned | Execution time |
| --- | --- | --- | ---: | ---: | ---: |
| `under-15` | `SORT -> FETCH -> OR -> IXSCAN` via `isActive_1_publicationStatus_1_publishedAt_-1_createdAt_-1` | no `COLLSCAN`; blocking title sort | 4 / 4 | 0 | 8 ms |
| `15-to-30` | `SORT -> FETCH -> OR -> IXSCAN` via `isActive_1_publicationStatus_1_publishedAt_-1_createdAt_-1` | no `COLLSCAN`; blocking title sort | 4 / 4 | 2 | 6 ms |
| `31-to-60` | `SORT -> FETCH -> OR -> IXSCAN` via `isActive_1_publicationStatus_1_publishedAt_-1_createdAt_-1` | no `COLLSCAN`; blocking title sort | 4 / 4 | 1 | 6 ms |
| `over-60` | `SORT -> FETCH -> OR -> IXSCAN` via `isActive_1_publicationStatus_1_publishedAt_-1_createdAt_-1` | no `COLLSCAN`; blocking title sort | 4 / 4 | 1 | 5 ms |
| `region=national-capital-region` + `15-to-30` | `SORT -> FETCH -> IXSCAN` via `isActive_1_region_1` | no `COLLSCAN`; blocking title sort | 1 / 1 | 1 | 7 ms |

The materially relevant rejected alternatives were also index-backed; none was
a collection scan. The fixed `$expr` executed successfully in real MongoDB for
all four buckets and the combined filter. This is a small development dataset,
so it is truthful non-production evidence only, not a production-scale latency
benchmark or authorization for an index, migration, or materialized total.
Production query-plan/latency observation remains a separate approved
read-only release/runtime gate.

## 10. Explicit exclusions

DISC6 excludes:

- cuisine, including Luzon/Visayas/Mindanao/Fusion mock labels;
- mood/vibe;
- teammate mock categories or reinterpretation of canonical Category;
- relevance or other ranking changes;
- ratings, reviews aggregation, or Top Rated;
- Trending;
- Saved smart collections;
- nutrition/Healthy filters or dietary inference;
- total-time or Quickest sorting;
- client-side filtering, Mongo predicate construction, or fabricated counts;
- persistent or cross-session filter state;
- schemas, migrations, indexes, backfills, deployment, or production mutation;
- any reopening of DISC4, DISC5, RANK1, RECIPE4, SAVED2, HOME2, COMM7, or
  unrelated Profile behavior.

Cuisine, mood/vibe, teammate category parity, and ranking remain separate
taxonomy/data/ranking contracts, not DISC6 implementation work.

## 11. Freeze blockers

There is no blocker to this narrow contract. Integer-minute semantics are
confirmed, the 30/31 boundary is exact, missing cook time is explicitly
excluded, the dietary taxonomy is already canonical, and the new controls fit
the existing staged panel and request-ownership path.

Any need for a production path outside the allowlist, a query representation
other than the two strict named parameters above, a data/index migration, or an
excluded taxonomy/ranking feature is a stop condition requiring contract
amendment and review.

**MOBILE-DISC6 CONTRACT FROZEN — READY FOR IMPLEMENTATION**

## 12. Closure review (2026-10-07)

**Closure status: PASS — READY FOR FINALIZATION.**

Fresh host verification established `HEAD`, `origin/main`, and their merge-base
as `550c701ed4768ecc8b47502b5188b9eb237ee6c6`; `origin/main` has not moved
from the implementation baseline. The local closure-retry refs match that SHA
as well. The local `git fetch origin` retry was transport-blocked by its proxy,
but no integration was attempted.

### Implementation and exact scope confirmation

DISC6 implements only the frozen server-authoritative `under-15`, `15-to-30`,
`31-to-60`, and `over-60` total-time buckets; canonical multi-dietary AND
filtering; and the corresponding controls in the existing staged Discover
filter panel. The server maps a bucket to a fixed `$expr`, coalesces only a
missing/null prep value to zero, and uses `$cond` plus numeric guards so
malformed stored prep/cook values cannot enter arithmetic. The server maps a
nonempty normalized dietary selection to `$all`; the raw submitted maximum is
six, values are deduplicated before predicate construction, `dietaryTag`
remains the one-tag compatibility alias, and supplying both forms is invalid.

The final production scope is exactly these seven paths:

```text
apps/api/src/modules/recipes/recipe.validation.js
apps/api/src/modules/recipes/recipe.controller.js
apps/api/src/modules/recipes/recipe.service.js
apps/mobile/src/api/recipeService.js
apps/mobile/src/api/recipeOptions.js
apps/mobile/src/utils/discoverFilters.js
apps/mobile/src/components/DiscoverFiltersSheet.js
```

The final test scope is exactly these seven paths:

```text
apps/api/test/recipe-validation.test.js
apps/api/test/recipe-service.test.js
apps/api/test/recipe-routes.test.js
apps/api/test/nosql-injection-routes.test.js
apps/mobile/__tests__/discoverFilters.test.js
apps/mobile/__tests__/discoverInteraction.test.js
apps/mobile/__tests__/discoverStaticAudit.test.js
```

There are no model, migration, index, package, lockfile, navigation, storage,
RANK1, or SAVED2 changes.

### Review history and resolved finding

The initial independent review found one HIGH issue: malformed stored time
arithmetic could reach the total-time expression. The narrow fix was completed:
the expression is guarded with `$cond` and numeric cook/prep checks, while
missing/null prep remains zero-compatible. The independent re-review passed.
This history is retained; the HIGH finding is resolved, not erased.

### Automated evidence

Fresh evidence is: API frozen suite **218/218 PASS**; focused
`recipeService` suite after the malformed-time fix **76/76 PASS**; and mobile
frozen suite **3/3 suites, 82/82 tests PASS** across
`discoverFilters.test.js`, `discoverInteraction.test.js`, and
`discoverStaticAudit.test.js`. The prior mobile runner availability blocker is
resolved by that fresh mobile execution result.

### Non-production query-plan evidence

The required read-only development evidence was collected only against
`wecooked-dev`: 44 Recipe documents and four active/public database-visible
candidates. Plans were index-backed with no `COLLSCAN` observed:

| Query | Docs / keys examined | Returned | Duration |
| --- | ---: | ---: | ---: |
| `under-15` | 4 / 4 | 0 | 8 ms |
| `15-to-30` | 4 / 4 | 2 | 6 ms |
| `31-to-60` | 4 / 4 | 1 | 6 ms |
| `over-60` | 4 / 4 | 1 | 5 ms |
| visibility + `region=national-capital-region` + `15-to-30` | 1 / 1 | 1 | 7 ms |

This passes the representative non-production evidence gate only. It does not
prove production-scale latency or selectivity.

### Remaining deferred runtime and release gates

- Production read-only query-plan / latency: **NOT RUN — NOT CLAIMED AS PASS**.
- Android authenticated runtime: **NOT RUN — NOT CLAIMED AS PASS**.
- iOS authenticated runtime: **NOT RUN — NOT CLAIMED AS PASS**.
- Physical accessibility / real-device checks: **NOT RUN — NOT CLAIMED AS PASS**.
- Provider/runtime checks where applicable: **NOT RUN — NOT CLAIMED AS PASS**.

`git diff --check` passes. The worktree contains only the fourteen frozen
production/test modifications and the two untracked authority documents.

**MOBILE-DISC6 CLOSURE PASS — READY FOR FINALIZATION.** No production or test
defect was found during closure review.
