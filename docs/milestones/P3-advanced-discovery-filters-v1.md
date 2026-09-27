# WeCooked — P3 Advanced Discovery Filters v1

**Status:** MILESTONE FROZEN — READY FOR IMPLEMENTATION

**Classification:** `FRONTEND_INTEGRATION_ONLY`

**Branch:** `feat/mobile-p3-advanced-discovery-filters`

**Verified HEAD:** `f9475bc5049c5c3090bd64501f9c521cc1b0ac04`

**Verified merge-base with `main`:** `f9475bc5049c5c3090bd64501f9c521cc1b0ac04`

**Baseline commit:** `f9475bc5049c5c3090bd64501f9c521cc1b0ac04` (`Merge pull request #67 from klaynn/feat/mobile-p2-canonical-shopping-categories`)

**Freeze verification:** The current branch, HEAD, and merge-base still match the completed approved P3 audit. This milestone freezes that audit's decisions, classification, production and test change allowlists, test commands, deferred scope, runtime checklist, and stop conditions. Any required departure must stop implementation and amend this milestone before work continues.

## 1. Goal

Expose a narrow set of advanced Discover filters that the current authenticated Recipe list API already validates and applies in MongoDB. P3 v1 must keep filtering server-authoritative, preserve the current Discover request lifecycle, and add no recipe classification or ranking semantics.

The repository proves that no backend, Admin, data-pipeline, or external-service change is required for the approved P3 v1 set.

## 2. Audit boundary and evidence

The audit traced the active path:

```text
DiscoverScreen
  -> mobile recipeService.listRecipes
  -> GET /api/v1/recipes
  -> authenticate
  -> validate(listRecipesSchema)
  -> requireCatalogReadAllForNonActive
  -> recipe.controller.listRecipes
  -> recipe.service.listRecipes
  -> recipe.repository.findMany/countByFilter
  -> Recipe.find/countDocuments
  -> MongoDB
```

Primary sources inspected:

- `apps/mobile/src/screens/DiscoverScreen.js`
- `apps/mobile/src/api/recipeService.js`
- `apps/mobile/src/api/recipeOptions.js`
- `apps/mobile/__tests__/discoverStaticAudit.test.js`
- `apps/mobile/__tests__/recipeCuisineRetired.test.js`
- `apps/api/src/modules/recipes/recipe.routes.js`
- `apps/api/src/modules/recipes/recipe.validation.js`
- `apps/api/src/modules/recipes/recipe.controller.js`
- `apps/api/src/modules/recipes/recipe.service.js`
- `apps/api/src/modules/recipes/recipe.repository.js`
- `apps/api/src/modules/recipes/recipe.model.js`
- `apps/api/src/modules/recipes/recipe.visibility.js`
- `apps/api/src/modules/recipes/recipe.serializer.js`
- relevant Recipe route, validation, service, and model tests

No live MongoDB catalog distribution, query plan, physical device, or rendered accessibility session was measured in this audit. Those remain runtime gates, not claimed evidence.

## 3. Current Discover behavior

Discover currently provides:

- one debounced, trimmed search input;
- four single-select shortcut chips;
- authenticated REST-backed first-page loading;
- page-number infinite loading with `page=1..totalPages`, `limit=20`;
- pull-to-refresh;
- distinct initial loading, blocking error, empty, load-more spinner, and load-more retry states;
- generation guards that discard stale first-page and load-more responses;
- a synchronous first-page ownership guard that blocks overlapping load-more;
- backend `imageUrl` rendering through `RecipeImage`;
- independent `FavoriteHeart` controls;
- Recipe Detail navigation with `{ recipeSource: 'api', recipeId, initialRecipe }`;
- a Dashboard `initialFilter` handoff that is consumed and then cleared.

Filter/search/pagination/request state is local to `DiscoverScreen`; there is no filter context or persisted filter store. `useRecipeScreenRefresh` adds focus-return and foreground refresh signals while deliberately skipping the initial focus load. `useTheme` supplies the active palette. `FavoriteHeart` reads the shared `FavoritesContext`, so favorite authority remains independent of Discover query state.

The result label is the number of currently loaded usable recipes, with `+` while more server pages remain. It is not presented as the backend's authoritative `pagination.total` because the API has a known post-page usability trim.

### Current filter contract

| UI label | Client key | API query | Execution | Backend meaning |
| --- | --- | --- | --- | --- |
| All | `all` | none | server list without an optional filter | Active, consumer-visible recipes only |
| Easy | `easy` | `difficulty=easy` | server-side | Exact stored Recipe difficulty enum |
| Vegetarian | `vegetarian` | `dietaryTag=vegetarian` | server-side | Exact membership in stored `dietaryTags` |
| Vegan | `vegan` | `dietaryTag=vegan` | server-side | Exact membership in stored `dietaryTags` |

None of the current filters is presentation-only, locally inferred, or applied by post-filtering the returned page. `all` is an absence-of-optional-filter preset, not a backend enum value. Vegan does not imply Vegetarian unless the recipe is explicitly tagged with both values.

## 4. Current Recipe list/query contract

`GET /api/v1/recipes` requires authentication. The query object is strict: unknown keys and wrong shapes are rejected with `400 VALIDATION_ERROR` before the controller. Repeated values that arrive as arrays do not satisfy the scalar schemas.

| Key | Type and validation | Default | Allowed values / bounds | Mongo/service semantics |
| --- | --- | --- | --- | --- |
| `search` | trimmed string, length 1–150 | omitted | any bounded string | Escaped literal, case-insensitive substring; title OR description |
| `region` | normalized slug string, length 1–64 | omitted | lowercase alphanumeric words joined by single hyphens after normalization | exact `region` equality |
| `category` | normalized slug string, length 1–64 | omitted | same slug contract as `region` | exact `category` equality |
| `difficulty` | string enum | omitted | `easy`, `medium`, `hard` | exact `difficulty` equality |
| `dietaryTag` | string enum | omitted | `vegetarian`, `vegan`, `pescatarian`, `glutenFree`, `dairyFree`, `nutFree` | exact array membership in `dietaryTags` |
| `ingredientId` | string accepted by `mongoose.Types.ObjectId.isValid` | omitted | valid ObjectId | exact match on `ingredients.ingredientId` |
| `maxPrepTimeMinutes` | coerced integer | omitted | 0–1440 | `prepTimeMinutes <= value`; recipes without prep time do not match |
| `status` | string enum | `active` | `active`, `inactive`, `all` | active/inactive predicate; non-staff callers are forbidden from `inactive` and `all` |
| `page` | coerced integer | `1` | minimum 1; no explicit upper bound | skip `(page - 1) * limit` |
| `limit` | coerced integer | `20` | 1–100 | DB page size before the usability trim |
| `sort` | fixed string enum | `titleAsc` | `titleAsc`, `titleDesc`, `newest`, `oldest`, `prepTimeAsc`, `prepTimeDesc` | fixed server-owned sort map; never raw client Mongo syntax |

Sort meanings are exact:

| Sort | Mongo sort |
| --- | --- |
| `titleAsc` | `{ title: 1 }` |
| `titleDesc` | `{ title: -1 }` |
| `newest` | `{ createdAt: -1 }` |
| `oldest` | `{ createdAt: 1 }` |
| `prepTimeAsc` | `{ prepTimeMinutes: 1 }` |
| `prepTimeDesc` | `{ prepTimeMinutes: -1 }` |

`newest` and `oldest` are creation-time ordering, not publication-time ordering. The list sorts do not add an `_id` tie-breaker, so equal sort values and concurrent writes can make page boundaries nondeterministic. That is a pre-existing limitation and is not widened into P3.

### Combination and visibility semantics

- Optional filter families combine with AND semantics.
- `search` is one family whose title and description matches combine with OR semantics.
- `difficulty`, `dietaryTag`, `ingredientId`, and the two slug filters are scalar/single-select contracts.
- `maxPrepTimeMinutes` is one inclusive upper bound.
- The same constructed filter is used for `findMany` and `countDocuments`.
- Non-staff queries add the publication predicate: explicit `published` OR legacy missing `publicationStatus`.
- Active consumer results are then checked in application code for publication completeness and active required Ingredient references.
- That last usability check occurs after the Mongo page is fetched. Returned recipes remain safe, but pages may be short and `pagination.total/totalPages` may overcount usable recipes.

## 5. Recipe fields usable for filtering

Consumer-visible, publish-complete recipes can truthfully support these current API concepts:

- `difficulty`: required for consumer-visible publication and controlled by an enum;
- `dietaryTags`: controlled array; empty means no asserted tag, never an inferred classification;
- `prepTimeMinutes`: optional bounded integer; only maximum prep time is currently queryable;
- `region` and `category`: optional exact slugs, but without approved vocabularies or verified catalog coverage;
- `ingredients[].ingredientId`: canonical Ingredient reference, queryable by exact id;
- `title` and `description`: bounded literal substring search;
- `createdAt`, `title`, and `prepTimeMinutes`: current fixed sort fields.

Fields/data that exist elsewhere but are not current Recipe discovery filters include `cookTimeMinutes`, `servings`, internal `createdBy`, Review ratings, Favorites, and Cook History. Cuisine is retired from the target Recipe contract. Nutrition and generic tags do not exist.

## 6. Candidate-filter decision matrix

The classification column uses the required repository-capability categories. The P3 decision is separate so a technically supported filter can still be deferred to keep v1 narrow.

| Candidate | Classification | Evidence / semantics | P3 v1 decision |
| --- | --- | --- | --- |
| Difficulty | `SUPPORTED_BY_EXISTING_API` | Required published field; enum; exact DB predicate; current Easy chip already proves integration | **APPROVE** all three values, single-select |
| Dietary classification | `SUPPORTED_BY_EXISTING_API` | Explicit `dietaryTags` enum; exact array membership; current Vegetarian/Vegan chips already use it | **APPROVE** all six exact tags, single-select |
| Maximum prep time | `SUPPORTED_BY_EXISTING_API` | Optional `prepTimeMinutes`; API applies inclusive `$lte` | **APPROVE** as “Maximum prep minutes,” not total cooking time |
| Exact canonical Ingredient | `SUPPORTED_BY_EXISTING_API` | `ingredientId` ObjectId filter plus an existing authenticated mobile Ingredient search service | `DEFER` — requires a searchable canonical picker and additional request/state UX beyond narrow v1 |
| Region | `DATA_EXISTS_BUT_SEMANTICS_AMBIGUOUS` | Optional open slug; no controlled vocabulary, facet endpoint, or verified coverage/backfill | `DEFER` pending taxonomy/content coverage |
| Recipe category | `DATA_EXISTS_BUT_SEMANTICS_AMBIGUOUS` | Optional open slug; no controlled vocabulary, facet endpoint, or verified coverage/backfill | `DEFER` pending taxonomy/content coverage |
| Cook-time maximum | `DATA_EXISTS_BACKEND_QUERY_MISSING` | Required `cookTimeMinutes` exists, but list validation/service expose no predicate | `DEFER` |
| Total time | `UNSAFE_TO_INFER` | No stored or defined total-time field; silently summing optional prep and cook time would invent semantics | `DEFER` |
| Servings | `DATA_EXISTS_BACKEND_QUERY_MISSING` | Stored field, no list query contract | `DEFER` |
| Author | `DATA_EXISTS_BACKEND_QUERY_MISSING` | Internal `createdBy` exists but is not a public Recipe discovery identity or query | `DEFER` |
| Minimum rating | `DATA_EXISTS_BACKEND_QUERY_MISSING` | Reviews compute an authoritative per-recipe aggregate, but Recipe list has no cross-collection rating filter | `DEFER` |
| Popularity / trending | `DATA_EXISTS_BUT_SEMANTICS_AMBIGUOUS` | Favorite/Cook History events exist, but no approved score, time window, aggregation, or list query exists | `DEFER` |
| Newest / recent | `SUPPORTED_BY_EXISTING_API` | `sort=newest` uses `createdAt`, not publication time | `DEFER` from filter v1; label would be easy to misinterpret during the publication transition |
| Other sort choices | `SUPPORTED_BY_EXISTING_API` | Fixed title/prep-time sorts exist, but sorting is not required for the narrow filter milestone | `DEFER` |
| Generic tags | `DATA_NOT_AVAILABLE` | Only the explicit dietary tag array exists | `DEFER` |
| Cuisine | `DATA_NOT_AVAILABLE` | Retired from schema, validation, queries, serializers, and mobile contract; legacy physical values are ignored | `DEFER` permanently unless a new contract is approved |
| Allergen safety inferred from Ingredients | `UNSAFE_TO_INFER` | Ingredient allergen metadata does not define recipe-level absence, cross-contact, or safety | `DEFER`; never infer |
| Nutrition / calories / macros | `DATA_NOT_AVAILABLE` | No authoritative Recipe nutrition fields or computation contract | `DEFER` |

No recommendation engine, AI service, personalization, data migration, or external service is required or approved.

## 7. Approved P3 v1 filter set

P3 v1 freezes exactly three optional filter families:

1. **Difficulty** — one of Any, Easy, Medium, Hard; query key `difficulty`.
2. **Dietary tag** — one of Any, Vegetarian, Vegan, Pescatarian, Gluten-free, Dairy-free, Nut-free; query key `dietaryTag`.
3. **Maximum prep minutes** — absent or a user-entered whole number from 1 through 1440; query key `maxPrepTimeMinutes`.

Frozen semantics:

- AND across the three approved families and text search.
- Single-select within Difficulty and Dietary tag because the API accepts one scalar value for each.
- No client-side OR/multi-select emulation.
- Maximum prep time means only `prepTimeMinutes`; do not label it Cooking time or Total time.
- The mobile UI deliberately does not expose zero even though the backend accepts zero for legacy compatibility; new stored prep-time values begin at 1.
- A missing `prepTimeMinutes` does not match an active maximum.
- Dietary labels describe exact author-assigned tags, not medical or allergen guarantees.
- Vegan and Vegetarian remain independent exact tags.
- Existing Dashboard shortcut keys remain exactly `all`, `easy`, `vegetarian`, and `vegan`.

## 8. Frozen mobile interaction model

Use the existing chips as immediate presets and add one compact **Filters** control that opens a bottom sheet/modal for the three approved families.

The frozen relationship between the existing `All` / `Easy` / `Vegetarian` / `Vegan` controls and the new P3 filter UI is replacement-preset behavior:

- `All` applies the empty filter object.
- `Easy` applies only `{ difficulty: 'easy' }`.
- `Vegetarian` applies only `{ dietaryTag: 'vegetarian' }`.
- `Vegan` applies only `{ dietaryTag: 'vegan' }`.
- Selecting a shortcut replaces the complete advanced-filter state; it cannot leave a hidden stale max-prep or second family active.
- An advanced combination that is not exactly one of those presets leaves the four preset chips unselected and shows an active-filter count on Filters.
- Opening the sheet copies applied state into draft state.
- Cancel/back dismisses draft changes without a request.
- Apply validates the draft and commits it once, producing one first-page request.
- Reset in the sheet returns the draft to no advanced filters; the screen-level Clear resets search and all applied filters.
- Applying filters preserves the current Discover search. The existing Dashboard shortcut handoff continues to clear search exactly as it does today.
- The sheet must use the existing theme tokens, accessible labels/selected states, a descriptive maximum-prep input label, numeric keyboard hint, inline validation, and a usable close path for Android back.

This is a presentation addition, not a broad Discover redesign.

## 9. Search, filter, refresh, and pagination interaction

- Debounced text search and applied filters are included in the same server request.
- Every first-page, retry, refresh, and load-more request must be built from the same applied search/filter snapshot.
- Applying a different filter state changes the query dependency, claims a new request generation, clears old page state, and requests page 1.
- Pull-to-refresh retains search and applied filters.
- Load-more retains search and applied filters and requests the next page only.
- Clear resets search immediately, clears the debounced search, clears all filters, and starts page 1.
- Existing generation and first-page ownership guards remain authoritative; stale responses cannot replace or append results and stale cleanup cannot release a newer request.
- Favorites state and Recipe Detail navigation remain independent of filters.
- No returned page may be filtered locally. Client-side post-filtering would make short pages, totals, empty states, and load-more termination misleading.
- Continue paging by `pagination.totalPages`, not by whether a returned usable page is shorter than 20.

## 10. Security and data invariants

P3 must preserve all of the following:

- `GET /recipes` remains authenticated.
- Mobile never sends `status`; ordinary users cannot request drafts or archived recipes.
- Strict Zod query validation remains the HTTP trust boundary.
- The controller forwards only destructured validated scalar fields.
- The service constructs its own Mongo filter and fixed sort object; no request object, field name, operator, projection, or raw sort reaches Mongoose.
- Search remains regex-escaped before compilation.
- `limit` remains capped at 100.
- The consumer publication predicate remains explicit Published OR legacy missing state.
- The post-query completeness and active-required-Ingredient usability checks remain intact.
- Drafts, archived recipes, malformed/incomplete recipes, and recipes with unavailable required Ingredients never become consumer-visible.
- No client inference of dietary, allergen, category, region, nutrition, rating, or popularity semantics.
- No filter state is persisted as a second product-data authority.

Known bounded-query caveat: response size is bounded, but `page` has no maximum and therefore a caller can request a very large skip. P3 must not add eager page walking or automatic bulk fetching.

## 11. Performance and index findings

Declared Recipe indexes are:

- `{ isActive: 1, region: 1 }`
- `{ isActive: 1, category: 1 }`
- `{ isActive: 1, difficulty: 1 }`
- `{ isActive: 1, publicationStatus: 1, createdAt: -1 }`
- `{ publicationStatus: 1, isActive: 1, updatedAt: -1 }`
- `{ 'ingredients.ingredientId': 1 }`
- `{ title: 1 }`

Implications for approved P3 filters:

- Difficulty has a directly relevant compound index.
- Dietary tags have no declared index.
- Prep-time range filtering has no declared index.
- Combined difficulty + dietary tag + prep-time queries have no purpose-built compound index and may scan/filter more records and sort in memory.
- The case-insensitive unanchored title/description substring search is not a good fit for an ordinary B-tree index; description has no index.
- The publication compatibility OR and default title sort can further limit a simple compound index's usefulness.

No new index is justified by repository inspection alone. Catalog size, selectivity, query frequency, and representative `explain('executionStats')` evidence were not available. P3 must not add speculative indexes. If runtime evidence shows a material regression, stop and amend the milestone with the measured query shape and the smallest justified index.

## 12. Exact production allowlist

Only these production files may change during P3 implementation.

### Backend production

```text
NONE
```

The existing Recipe API already accepts and enforces every approved query. In particular, do not change route, validation, controller, service, repository, model, serializer, visibility, shared contracts, or indexes.

### Mobile production

```text
apps/mobile/src/screens/DiscoverScreen.js
apps/mobile/src/components/DiscoverFiltersSheet.js
apps/mobile/src/utils/discoverFilters.js
```

`DiscoverFiltersSheet.js` and `discoverFilters.js` are approved new files. The utility owns the fail-closed applied/draft value normalization, preset mapping, active count, and backend query projection so those behaviors receive direct unit coverage.

Do not modify `apps/mobile/src/api/recipeService.js`: its allowlist already includes `difficulty`, `dietaryTag`, and `maxPrepTimeMinutes`. Do not modify Dashboard, navigation, context, theme, FavoriteHeart, RecipeImage, Recipe Detail, or storage.

### Admin production

```text
NONE
```

## 13. Exact test-change allowlist

### Backend tests

```text
NONE
```

Existing backend tests are regression commands only; no backend behavior changes.

### Mobile tests

```text
apps/mobile/__tests__/discoverStaticAudit.test.js
apps/mobile/__tests__/discoverFilters.test.js
```

`discoverFilters.test.js` is an approved new pure behavior test. Existing Dashboard and retired-cuisine tests are run as regressions but are not in the change allowlist.

### Admin tests

```text
NONE
```

## 14. Exact test commands

Run these existing backend regression commands separately from `apps/api`:

```powershell
node --test --test-isolation=none test/recipe-validation.test.js
node --test --test-isolation=none test/recipe-service.test.js
node --test --test-isolation=none test/recipe-routes.test.js
node --test --test-isolation=none test/recipe-model.test.js
```

Run the focused mobile command from the repository root:

```powershell
npm test --workspace=apps/mobile -- --runInBand __tests__/discoverFilters.test.js __tests__/discoverStaticAudit.test.js __tests__/dashboardStaticAudit.test.js __tests__/recipeCuisineRetired.test.js
```

Then run the full mobile regression from the repository root:

```powershell
npm test --workspace=apps/mobile -- --runInBand
```

Final repository checks:

```powershell
git diff --check
git status --short --branch
```

Audit baseline results at the verified HEAD:

```text
Backend Recipe validation/service/routes/model: 167 passed, 0 failed
Mobile Discover/Dashboard/retired-cuisine:       85 passed, 0 failed
```

## 15. Proposed automated test plan

The implementation tests must cover:

- exact preset mappings for All, Easy, Vegetarian, and Vegan;
- every Difficulty value and rejection/drop of unsupported values;
- every Dietary tag value and rejection/drop of unsupported values;
- maximum prep values at 1 and 1440, non-integers, zero, negative, overflow, blank, and nonnumeric input;
- AND query projection for difficulty + dietary tag + max prep;
- search plus all approved filters in one request;
- absence of optional query keys when their state is Any/blank;
- single-select behavior within each family and no array-valued query emission;
- preset selection replacing hidden advanced state;
- sheet draft Apply, Cancel/back, Reset, and screen Clear behavior;
- active-filter count and exact-preset selected states;
- filter Apply resetting to page 1;
- load-more retaining the exact filter query;
- refresh retaining search and filters;
- empty, loading, blocking error, load-more error/retry, and populated states;
- stale first-page and load-more guards remaining structurally attached to every request path;
- no `Array.filter` or equivalent client-side recipe filtering;
- unchanged publication/status safety through existing backend regressions;
- unchanged Favorites sibling control and Recipe Detail navigation contract;
- accessibility labels, selected states, input errors, focus/close path, and touch targets;
- theme-token use for light/dark compatibility;
- no cuisine, category, region, ratings, popularity, ranking, nutrition, or recommendation semantics.

Static source tests do not prove actual modal focus, screen-reader output, asynchronous rendering, or device layout. Those are runtime requirements below.

## 16. Runtime checklist

Before P3 can be marked complete, verify on an authenticated mobile runtime against a real API and representative catalog:

- All, each difficulty, each dietary tag, and max-prep boundary cases issue the expected query and return server-filtered results;
- a recipe missing prep time is excluded when max prep is active;
- Vegan does not silently imply Vegetarian, or vice versa;
- search combines with each family and with all three together;
- Apply produces one first-page request; Cancel produces none;
- changing filters during an in-flight first-page/load-more request cannot display or append stale results;
- pull-to-refresh retains the active query;
- load-more retains filters and does not stop on a short usable page before `totalPages`;
- Clear restores unfiltered page 1;
- Dashboard Easy/Vegetarian/Vegan handoffs still clear search and apply the exact preset;
- Favorite toggles do not open Recipe Detail and Recipe Detail navigation remains correct;
- loading, empty, blocking error, footer error/retry, and offline/recovery states remain truthful;
- Android back closes the filter sheet before leaving Discover;
- keyboard appearance, input dismissal, small screens, large font sizes, and long translated-style labels do not make Apply/Reset unreachable;
- screen reader announces sheet purpose, group labels, selected values, prep validation, active-filter count, and buttons meaningfully;
- light and dark themes are visually usable;
- representative server logs/query plans show no material regression for common combined filters.

No device, screen-reader, live-provider, deployed MongoDB, or production query-plan pass is claimed by this audit.

## 17. Negative scope

P3 must not expand into:

- recommendation engines, AI, personalization, or predictive ranking;
- ratings, popularity, trending, or recently viewed feeds;
- nutrition, calories, macros, allergen safety, or ingredient substitution;
- meal planning, community/social features, notifications, or P2 Shopping List work;
- Ingredient filtering or an Ingredient picker in v1;
- region/category/cuisine browsing, taxonomy redesign, content backfill, or migration;
- total-time or cook-time filtering;
- sort controls;
- recipe authoring semantics;
- client-side post-filtering of paginated Recipe results;
- local persistence of filters;
- new indexes without measured evidence and a milestone amendment;
- dependency, package, or lockfile changes;
- navigation, Dashboard, Recipe Detail, Favorites, theme, or auth redesign;
- Admin changes;
- unrelated documentation or untracked-file cleanup.

## 18. Blockers and deferred work

There is no blocker to the approved frontend-only implementation.

Deferred items:

- Ingredient filtering: existing backend/mobile primitives are real, but the searchable selection UX is a separate slice.
- Region/category browsing: requires an approved vocabulary or facet contract plus verified catalog coverage; a data audit/backfill may be required.
- Cook/total-time and servings filters: require backend query/product contracts.
- Ratings: requires a Recipe-list aggregation/query extension and performance design.
- Popular/trending: requires a frozen product definition, time window, aggregation source, and backend query contract.
- Publication-time “Newest”: remains deferred until the publication-state backfill and ordering contract are verified.
- Stable pagination tie-breakers and the pre-existing usable-result overcount are backend concerns outside P3.
- Dietary/prep compound indexing remains evidence-driven follow-up only.

Live catalog coverage was not inspected. Sparse dietary tags or prep times may yield honest empty results; that is not permission to infer or fabricate metadata.

## 19. Stop conditions

Stop and amend this milestone before implementation continues if any of the following is required:

- a backend, Admin, package, lockfile, navigation, context, or storage change;
- any file outside the exact production/test change allowlists;
- more than one dietary tag in a request or new OR semantics;
- client-side filtering of returned Recipe pages;
- a new taxonomy, inferred classifier, ranking score, or total-time calculation;
- a speculative database index;
- weakening authentication, visibility, publication, or Ingredient-usability predicates.

## 20. Verdict

**P3 MILESTONE FROZEN — READY FOR IMPLEMENTATION**
