# MOBILE-DISC4 - Discover Ingredient + Sort Product Parity

## Status

- Phase: `FINALIZED FOR PR`
- Implementation status: `COMPLETE`
- Review status: `PASS WITH REQUIRED FIXES; FINAL CLOSURE RECHECK PASS`
- Runtime status: `DEFERRED BY PROJECT DECISION - NOT RUN - NOT CLAIMED AS PASS`
- Finalization verdict: `MOBILE-DISC4 FINALIZED - READY TO MERGE (RUNTIME DEFERRED)`

## 1. Baseline and authority

- WeCooked repository: `main`
- Frozen WeCooked baseline: `0e604e1279e63640e8d20b60fc599f7c98044695`
- Teammate repository: `https://github.com/jofaerpeloup-debug/WECOOKEDD`
- Frozen teammate reference: `4ffd47d176afcfb1f23ffa1be079f01791fae92e`
- Completed dependency: P3 advanced discovery filters, including its post-review request-generation and pagination corrections.

The teammate tree is authoritative only for Discover's visual composition, hierarchy, spacing, cards, typography direction, control placement, and interaction feel. The live WeCooked tree is authoritative for API and authentication contracts, navigation, real Recipe and Ingredient data, filter and sort semantics, pagination, favorites, state handling, accessibility, and persistence.

No teammate mock provider, local recipe array, client-side filter engine, fake refresh, fake count, fake rating, or teammate ThemeProvider is a permissible data or state source.

### Audited source evidence

Pinned teammate source inspected from the immutable commit:

- `src/screens/DiscoverScreen.js`
- `src/navigation/MainTabs.js`
- `src/navigation/RootNavigator.js`
- `src/theme/theme.js`
- `src/theme/brandKit.js`
- `src/context/SearchHistoryContext.js`
- `src/data/mockData.js`

Live WeCooked source inspected at the baseline:

- `apps/mobile/src/screens/DiscoverScreen.js`
- `apps/mobile/src/components/DiscoverFiltersSheet.js`
- `apps/mobile/src/utils/discoverFilters.js`
- `apps/mobile/src/api/recipeService.js`
- `apps/mobile/src/api/recipeOptions.js`
- `apps/mobile/src/api/ingredientService.js`
- `apps/mobile/src/components/IngredientPickerModal.js`
- `apps/mobile/src/screens/DashboardScreen.js`
- `apps/mobile/src/navigation/RootNavigator.js`
- `apps/mobile/src/navigation/MainTabs.js`
- `apps/mobile/src/theme/theme.js`
- `apps/mobile/__tests__/discoverStaticAudit.test.js`
- `apps/mobile/__tests__/discoverFilters.test.js`
- Recipe and Ingredient validation, routes, controllers, services, repositories, and serializers under `apps/api/src/modules/`

## 2. Pinned teammate Discover layout inventory

The pinned teammate implementation is one vertically scrolling `FlatList`; the header, search, recent searches, filters, sort, count, and compact result list all share that scroll surface.

### Header and navigation relationship

- Discover is a pushed root-stack screen, not a bottom tab.
- A circular 36 x 36 cream-deep back control sits beside the Playfair display title `Search`.
- Safe-area top inset plus `spacing.xl` is applied through the list content container.
- The teammate bottom tab navigator contains Home, Community, Swaps, and Profile. Discover therefore has a back relationship rather than a persistent selected Discover tab.

### Search treatment

- One 44-point filled cream-deep rounded field with a leading search icon.
- Placeholder: `Search recipes...`.
- A separate trailing `Clear` text action clears the query and narrowing filters while preserving sort.
- Recent-search pills appear only when the query is blank. They use a clock icon, compact rounded cream-deep surfaces, and a separate Recent clear action.

The recent-search semantics come from teammate-local `SearchHistoryContext`. They are not part of DISC4 because current WeCooked already has Dashboard-owned search history and must not create a second store.

### Filter presentation and hierarchy

- A compact inline `Filters · N` toggle with options icon and up/down chevron controls an expanded panel.
- Expanded groups are vertically ordered as Cooking Time, Difficulty, Dietary, Cuisine, and Mood.
- Each group uses an uppercase, letter-spaced 11.5-point label followed by wrapping pill chips.
- Inactive chips are outlined with the hairline token; active chips use deep sage with cream text.
- Cooking Time and Difficulty are single-select in presentation. Dietary and Mood are multi-select in teammate-local semantics.
- A route-provided category can narrow the mock results and increments the active count, but the pinned Discover screen renders no category group or direct category control.
- Sort is a separate always-present wrapping chip group below the collapsible filter groups.
- An absolute bottom surface appears while filters are open and contains a 52-point pill CTA: `Show N recipes`.

There is no teammate filter modal, sheet, segmented control, or separate ingredient-search modal. Its filters are inline and operate over a small local mock array.

### Recipe results and cards

- Result count is an uppercase group label: `N recipes found`.
- Results are compact horizontal rows on cream-deep rounded surfaces.
- Images are square 60 x 60 thumbnails with 10-point corners, not large landscape cards.
- Title uses a semibold Work Sans treatment; the secondary metadata line is smaller and faint.
- Rows have 10-point padding, approximately 12-point internal gap, 14-point corners, and 10-point vertical separation.
- The entire row navigates to Recipe Detail.
- Teammate rows do not contain the real WeCooked favorite control.
- Teammate result animation uses a short staggered fade-in.

### Empty state, scrolling, and accents

- `Nothing matches` empty state uses a search icon and filter/search recovery copy.
- Pull-to-refresh exists but is fake/local in the teammate implementation.
- The list hides the vertical indicator and preserves keyboard taps.
- Extra bottom content padding leaves room for the absolute CTA.
- Visual language is Sage & Stone: warm cream background, parchment/cream-deep surfaces, deep-sage selected chips and CTA, pill radii, restrained hairlines, Playfair display type, and Work Sans UI/body type.

## 3. Current WeCooked Discover inventory

### Screen and navigation

- Discover is an authenticated root-stack destination reached from Dashboard and other approved flows; it is not a tab.
- The screen keeps the shared `<TopBar mode="back" title="Discover">` contract and `navigation.goBack()` behavior.
- Dashboard always hands Discover an explicit `initialFilter` of `all`, `easy`, `vegetarian`, or `vegan`.
- The initial preset seeds the first render. Later handoffs use `presetFiltersState`, clear search, and clear the consumed route parameter without causing a duplicate first-page request for an equivalent preset.
- The other inspected entry, Collection Detail's empty-state CTA, navigates to `Discover` without filter params. DISC4 must not reinterpret that bare navigation as an Ingredient or sort handoff or introduce another route-state authority.
- Recipe navigation is `RecipeDetail` with `{ recipeSource: 'api', recipeId, initialRecipe }`.

### Visual structure already aligned with the teammate

- Fixed TopBar, short subtitle, 44-point cream-deep recipe search field, trailing clear behavior, and horizontal pill controls.
- Deep-sage active pills, uppercase result count, Sage & Stone theme tokens, and compact 60 x 60 Recipe rows.
- Real `RecipeImage`, real `FavoriteHeart` as a sibling of the navigation pressable, and real Recipe metadata.
- Light/dark palettes remain controlled by the existing WeCooked theme architecture.

### Real data and request behavior

- `listRecipes` calls authenticated `GET /api/v1/recipes`; there is no local Recipe array or client-side result filtering.
- Search is trimmed and debounced by 300 ms before it becomes the server `search` query.
- Existing P3 applied filters are server query keys and combine with search using backend AND semantics:
  - `region`
  - `category`
  - `difficulty`
  - one `dietaryTag`
  - `maxPrepTimeMinutes`
- Quick presets remain exactly All, Easy, Vegetarian, and Vegan.
- Page size is 20. Filter or settled-search changes rebuild `queryFor`, start a guarded first-page request, and reset page/list state.
- Pull-to-refresh retains current search and filters.
- Load more retains current search and filters and continues while `pageLoaded < pagination.totalPages`; it does not stop merely because a usable page is short or empty.
- First-page, refresh, and load-more responses use monotonic generation ownership, synchronous first-page ownership, mounted checks, and a load-more lock so stale responses or cleanup cannot corrupt newer state.
- First-page loading, first-page error with Retry, empty results, background refresh, loading-more, and later-page error/retry are distinct real states.

### Existing P3 filter sheet

- A bottom `Modal` contains draft-only selections for Region, Category, Difficulty, Dietary tag, and Maximum prep minutes.
- Cancel, backdrop, Android back, and close restore applied state; Reset clears the draft only; Apply validates and commits once.
- Region, category, difficulty, and dietary controls are single-select accessible radio groups.
- Maximum prep time accepts whole minutes from 1 through 1440, with inline validation and an honest note that recipes without prep time do not match.
- Controls use selected accessibility state, safe-area bottom padding, keyboard avoidance, and at least 44-point touch targets.

### Existing Ingredient capability

- `searchIngredients` is an authenticated wrapper over `GET /api/v1/ingredients`.
- It trims search, requests at most the short first page, normalizes public `{ id, name, category, aliases }` results, and never asks for inactive/all catalog state.
- The backend defaults normal consumers to active Ingredients, escapes the query as a case-insensitive substring search over canonical name or aliases, and returns server pagination.
- `IngredientPickerModal` already demonstrates the approved 300 ms debounce, 20-result cap, generation-guarded requests, loading/error/empty/truncated states, and canonical selection behavior, but the component itself is Shopping List-specific because it also owns unit, quantity, and `onAdd` submission. Its current guard does not invalidate an already-started old request until a later debounced request begins, so DISC4 must strengthen this to immediate invalidation on every query change. DISC4 may reuse its interaction conventions and services, not its Shopping List form semantics.

### Real result fields

The public Recipe response supports id, title, description, region, category, difficulty, prep time, cook time, servings, canonical Ingredient summaries, instructions/steps, dietary tags, image URL, active state, and timestamps. The Discover card currently renders only title, image, category/region/prep-time/difficulty metadata, favorite state, and navigation. It does not receive a rating aggregate, review count, calories, popularity, editorial label, or ranking score from the Recipe list response.

## 4. Adopt / Adapt / Reject matrix

| Teammate visual or product element | WeCooked equivalent | Decision | Frozen reason |
| --- | --- | --- | --- |
| Pushed Search screen with back control | Root-stack Discover with shared back TopBar | ADAPT | Preserve the current navigation/header authority; retain the teammate's compact pushed-screen hierarchy without adding a tab. |
| Warm cream Sage & Stone surface system | Existing light/dark WeCooked theme tokens | ADOPT | The current theme already carries the same visual direction; no ThemeProvider copy or global rewrite is needed. |
| 44-point filled rounded search field | Current real debounced Recipe search | ADOPT | Presentation already matches; keep server search, clear action, accessibility label, and fixed mounting. |
| Teammate Recent chips | Dashboard-owned current search history | REJECT on Discover | A second history store would duplicate authority and is outside DISC4. |
| Inline `Filters · N` affordance | Current Filters pill with active count | ADAPT | Keep the compact icon/count treatment while opening the established accessible P3 sheet. |
| Inline wrapping filter groups | P3 bottom-sheet radio/chip groups | ADAPT | Region/category plus an async Ingredient picker and six sorts make the inline list header excessively long and keyboard-sensitive. The sheet preserves focus containment, Cancel/Apply semantics, safe area, and list virtualization. |
| Uppercase group labels and pill chips | P3 group labels and choice pills | ADOPT | Use teammate hierarchy, spacing rhythm, borders, and deep-sage selected state inside the current sheet. |
| Cooking Time buckets | Maximum prep minutes | ADAPT | Preserve the exact server `maxPrepTimeMinutes` contract; do not imply cook or total time. |
| Difficulty chips | Server `difficulty` | ADOPT presentation | Keep one approved scalar value. |
| Multi-select Dietary | Server `dietaryTag` | ADAPT | Keep one server-supported dietary tag; do not manufacture multi-tag query semantics. |
| Cuisine chips | No consumer Recipe cuisine contract | REJECT semantics | Cuisine is retired from the target Recipe contract. |
| Mood/Vibe chips | No API equivalent | REJECT semantics | Pure mock/local data with no server contract. |
| Teammate Relevance sort | No ranked full-text relevance contract | REJECT | Search is escaped title/description matching and defaults to title order; no score is returned. |
| Teammate Top Rated sort | No Recipe-list rating sort | REJECT | Review data does not create a Recipe list sort contract. |
| Teammate Quickest sort | `prepTimeAsc` | ADAPT | Label as prep time only; never total or cooking time. |
| Separate Sort chip group | Six approved consumer server sorts | ADAPT | Retain chip presentation, but use only fixed live consumer values and truthful labels. |
| Local mock recipe count in `Show N recipes` | Server result/pagination state after Apply | ADAPT | Use `Apply filters` or `Show recipes` before the request; never predict an unqueried count. |
| Compact 60 x 60 result cards | Current API Recipe rows | ADOPT | Existing result layout already matches while retaining real image, favorite, metadata, and route params. |
| Whole-row Recipe navigation | Current RecipeDetail navigation | ADAPT | Keep the teammate interaction feel and current API route shape; the favorite remains a separate sibling target. |
| Mock rating/review metadata | No RecipeSummary equivalent | REJECT | Do not fabricate or join unsupported list metadata on the client. |
| Fake pull-to-refresh | Guarded real first-page refresh | REJECT semantics / ADOPT gesture | Keep the gesture only with the live API pipeline. |
| Local `Nothing matches` state | Current real empty state | ADOPT | Retain truthful query/filter-specific recovery copy. |
| Staggered fade animation | No required shared equivalent | REJECT for DISC4 | It adds no contract value and is not needed for parity; avoid widening the allowlist. |
| Absolute bottom `Show N` CTA | Sheet Apply footer | ADAPT | Preserve the prominent sage CTA and staged interaction without fake pre-query totals or list overlay problems. |

## 5. Frozen canonical Ingredient filter contract

### User flow

```text
Discover
  -> open Filters
  -> Ingredient group
  -> type a name or alias
  -> GET /api/v1/ingredients?search=<trimmed>&limit=20
  -> select one returned canonical Ingredient
  -> Apply filters
  -> GET /api/v1/recipes?...&ingredientId=<selected public id>
```

### State and query rules

- The applied Discover state owns one optional canonical selection `{ id, name }`; there is no second persistent Ingredient-filter store.
- The typed Ingredient text is search input only. It is never treated as an id or applied Recipe filter.
- Only a result returned by `searchIngredients` can become the selected Ingredient through the production UI.
- Query projection emits exactly `ingredientId: selected.id`; it never sends the name, alias, category, full object, or an arbitrary text value.
- The selected canonical name remains visible in the sheet and as an applied summary/removable pill on the Discover header.
- Clear Ingredient removes the selected object and therefore omits `ingredientId` from the next Recipe query.
- Reset clears the Ingredient draft with the other narrowing filters. Cancel restores the applied Ingredient. The screen-level clear action clears search and all narrowing filters, including Ingredient, while preserving the current sort as the teammate interaction does.
- A Dashboard `initialFilter` handoff replaces the narrowing filter set, including any Ingredient selection, clears Discover search, and preserves the current approved sort. This preserves P3's replacement-preset meaning while matching the teammate rule that route filter handoffs do not silently change sorting.
- Ingredient composes with search, region, category, difficulty, dietary tag, maximum prep time, page, limit, and sort in the same `listRecipes` request.

### Search-state rules

- Do not download the catalog. Search starts only for a nonblank trimmed query and requests `limit=20`.
- Debounce by the existing 300 ms convention.
- Maintain a monotonically increasing Ingredient-search generation. Query change, clear, close/cancel, reopen, and unmount invalidate earlier requests.
- An older success, failure, or completion may not replace newer results, error, or loading state.
- Expose truthful initial guidance, loading, no-results, error with explicit retry, results, and truncated-first-page guidance.
- Selection uses the public Ingredient id/name only. Moderator-only resolution, creation, aliases editing, archived catalog access, and ingredient creation from import are not reused.

### Smallest safe picker architecture

Extend `DiscoverFiltersSheet` with a Discover-specific Ingredient group that calls the existing `searchIngredients` and `getIngredientErrorMessage` modules. Reuse the debounce/generation convention from `IngredientPickerModal`, with the stricter immediate invalidation rule frozen above, but do not reuse or modify the Shopping List picker component because its unit, quantity, submission, and mutation-lock contract is unrelated.

No new production picker file and no Ingredient service change are authorized by this contract.

## 6. Frozen supported sort contract

### Live enum audit

The live API validator currently accepts seven named values:

`titleAsc`, `titleDesc`, `newest`, `oldest`, `prepTimeAsc`, `prepTimeDesc`, and `updatedDesc`.

The current mobile consumer contract in `recipeOptions.js` and `recipeService.js` approves the first six. `updatedDesc` was added specifically for the guarded Moderator active-Draft review query and is absent from the consumer mobile sort contract. DISC4 therefore must not expose `updatedDesc`.

### DISC4 consumer choices

| Backend value | Frozen mobile label | Exact server meaning |
| --- | --- | --- |
| `titleAsc` | `Title: A-Z` | `{ title: 1 }`; current backend default. |
| `titleDesc` | `Title: Z-A` | `{ title: -1 }`. |
| `newest` | `Newest added` | `{ createdAt: -1 }`; creation time, not publication time, popularity, or relevance. |
| `oldest` | `Oldest added` | `{ createdAt: 1 }`; creation time. |
| `prepTimeAsc` | `Prep time: low to high` | `{ prepTimeMinutes: 1 }`; preparation time only. |
| `prepTimeDesc` | `Prep time: high to low` | `{ prepTimeMinutes: -1 }`; preparation time only. |

Sort values are fixed enum strings. No raw field/direction, client comparator, or unsupported label may reach the request. The current list sorts do not add an `_id` tie-breaker; DISC4 does not claim stable order among equal values and does not expand into a backend pagination correction.

### Sort state rules

- `titleAsc` is the initial/default sort and must be shown as selected.
- Sort is single-select and does not increment the active narrowing-filter count.
- Sort is staged with the filter draft and committed by the same Apply action.
- Any committed sort change triggers the existing first-page reset/generation path.
- Refresh and load-more retain the selected sort.
- Clear-all preserves sort, matching the teammate behavior; the Sort group itself provides a direct way to choose the default `titleAsc`.
- Dashboard preset handoff preserves sort but replaces narrowing filters/search as described above.

Explicitly not exposed: `updatedDesc`, Relevance, Top Rated, Trending, Most Popular, Best Match, review count, and any rating/popularity/ranking-derived option.

## 7. Final filter UX

The final DISC4 composition is an adaptation of the teammate layout over the existing P3 sheet:

1. Keep the shared back TopBar and fixed filled search field so typing state is not remounted by list virtualization.
2. Keep the horizontal All/Easy/Vegetarian/Vegan quick-preset row and compact Filters pill/count.
3. When applied, show the canonical Ingredient name as a removable sage/outlined summary pill below the quick row. Never show a raw id.
4. Show the selected sort label in the applied summary area so ordering remains visible without reopening the sheet.
5. Open the existing bottom sheet for staged advanced changes. Preserve its header, close/backdrop/Android-back cancellation, Reset, and Apply behavior.
6. In the sheet, use teammate-style group hierarchy and wrapping pills in this order:
   - Region
   - Category
   - Difficulty
   - Dietary tag
   - Maximum prep minutes
   - Ingredient
   - Sort
7. Ingredient uses an in-sheet canonical search/selection state, not a free-text id field and not a full-catalog list.
8. Sort uses six wrapping single-select chips with the labels frozen above.
9. The primary footer remains a prominent deep-sage control and may read `Show recipes`; it must not show a speculative count before the new request resolves.
10. Applied filter/search/sort changes flow through the existing `queryFor -> loadFirstPage` dependency and generation guard. The sheet never calls `listRecipes` itself.

This retains the teammate visual rhythm while avoiding an extremely long inline header containing all Philippine regions, asynchronous Ingredient states, and keyboard interaction. It also preserves P3 accessibility and draft/apply semantics.

## 8. Teammate-layout parity rules

- Use current `spacing`, `radius`, `typography`, and active `colors`; do not hard-code a second palette.
- Preserve warm cream page ground, cream-deep search/card surfaces, restrained hairlines, deep-sage selected chips and CTA, Playfair screen hierarchy, and Work Sans labels/body.
- Keep search height at 44 and interactive controls at a minimum 44 x 44 effective target.
- Use uppercase, letter-spaced small group labels and wrapping pill groups in the sheet.
- Retain compact 60 x 60 square result photography, rounded parchment rows, title/meta hierarchy, and approximately 10-12 point internal rhythm.
- Retain the real favorite as a sibling control; visual parity may not make favorite taps open Recipe Detail.
- Retain real loading, error, retry, empty, refreshing, pagination, and later-page states even where the teammate mock has only local states.
- Retain safe-area padding, keyboard avoidance, `keyboardShouldPersistTaps`, accessible modal containment, labels, selected/busy/disabled states, and screen-reader semantics.
- Do not add a Discover tab, copy teammate navigation, or replace the current back TopBar.
- Do not add a global theme/component refactor. Any styling needed for DISC4 stays in the allowlisted Discover files.
- Do not render any field absent from the public Recipe list response.

## 9. Filter composition and page-reset invariants

The one authoritative request is:

```text
listRecipes({
  search?,
  region?,
  category?,
  difficulty?,
  dietaryTag?,
  maxPrepTimeMinutes?,
  ingredientId?,
  sort,
  page,
  limit: 20,
})
```

- All present narrowing filters and search combine on the server.
- `ingredientId` and `sort` use the existing `recipeService` allowlist; no service or backend change is required.
- Applying a changed Ingredient, sort, or P3 filter resets to page 1 through the existing first-page path.
- Changing settled Recipe search also resets to page 1.
- Refresh keeps the same composed request at page 1.
- Load more increments page while retaining the identical search/filter/sort projection.
- Continue by authoritative `pagination.totalPages`, not returned row count.
- Preserve dedupe-by-id and stale-response protection.
- Do not locally filter, rank, or sort returned Recipe pages.

## 10. Exact production allowlist

Only these production files are authorized for a future DISC4 implementation:

1. `apps/mobile/src/screens/DiscoverScreen.js`
   - compose applied Ingredient/sort with the existing request;
   - render applied Ingredient and sort summaries;
   - preserve search, navigation, page reset, refresh/load-more, favorites, and request-generation guards.
2. `apps/mobile/src/components/DiscoverFiltersSheet.js`
   - add the staged canonical Ingredient search/selection and six-value Sort groups;
   - preserve Cancel/Reset/Apply, safe-area, keyboard, modal, and accessibility behavior.
3. `apps/mobile/src/utils/discoverFilters.js`
   - normalize the canonical selection and consumer sort;
   - project only `ingredientId` plus the approved sort into the Recipe query;
   - preserve P3 preset, count, validation, and draft behavior.
4. `apps/mobile/src/api/recipeOptions.js`
   - add/freeze the six consumer sort descriptors and truthful labels from the already-existing mobile sort allowlist.

Explicitly unchanged and reused:

- `apps/mobile/src/api/recipeService.js`
- `apps/mobile/src/api/ingredientService.js`
- `apps/mobile/src/api/ingredientErrors.js`
- `apps/mobile/src/components/IngredientPickerModal.js`
- `apps/mobile/src/components/RecipeImage.js`
- `apps/mobile/src/components/FavoriteHeart.js`
- navigation, Dashboard, theme, API, contracts, database, and all backend files.

If implementation evidence shows any backend file, navigation file, Dashboard file, theme file, shared card file, or service file must change, stop and return the concrete contradiction for a new audit. Do not widen this allowlist silently.

## 11. Exact test allowlist

Only these tests are authorized for a future DISC4 implementation:

1. `apps/mobile/__tests__/discoverFilters.test.js` - extend direct utility coverage for canonical Ingredient state/query projection, clearing/Reset, six sort values/default, active-count exclusion for sort, P3 composition, invalid-value fail-closed behavior, and preset/handoff rules.
2. `apps/mobile/__tests__/discoverStaticAudit.test.js` - extend structural and negative-contract coverage for real service wiring, query composition, existing request guards, teammate-layout landmarks, accessibility, retained P3 controls, and forbidden mock/rating/trending/cuisine/mood semantics.
3. `apps/mobile/__tests__/discoverInteraction.test.js` - new mounted behavioral coverage for the sheet and Discover request path.

The mounted interaction suite must prove behavior, not merely string presence:

- Ingredient control is visible when Filters is open.
- Nonblank input calls `searchIngredients` after the debounce with the exact trimmed query and `limit: 20`.
- Loading, empty, error/retry, results, and truncated guidance render from real mocked service outcomes.
- A slow old Ingredient result/error cannot replace the newest query state; close/reopen invalidates an in-flight result.
- Selecting a result preserves its canonical name in UI and sends its exact public id as `ingredientId` only after Apply.
- Typed-but-unselected text never becomes an Ingredient filter.
- Clear Ingredient removes `ingredientId`; Cancel restores the applied selection; Reset remains draft-only until Apply.
- Sort is visible, single-select, and every exposed label sends its exact frozen backend value.
- `updatedDesc`, rating, popularity, relevance, trending, and arbitrary sort values are not rendered or sent.
- Region, category, difficulty, dietary tag, and max prep controls remain present and compose with search, Ingredient, sort, page, and limit in one request.
- Applying a changed filter or sort starts page 1; refresh retains composition; load-more retains composition and follows `totalPages`.
- Dashboard `initialFilter` replacement still clears search/narrowing filters, consumes the param, and does not cause an equivalent duplicate first-page request; sort remains unchanged.
- Real empty/error/loading/retry paths remain available.
- Compact card image/title/meta/favorite/navigation structure remains present; no fake rating, review count, calories, popularity, editorial label, or teammate mock data appears.
- Modal controls expose appropriate labels, selected/busy/disabled state, 44-point targets, keyboard handling, and close semantics.

Existing unchanged service/backend suites may be run as regression evidence, but they are not authorized edit targets.

## 12. Focused verification commands for implementation

Run the focused mobile contract first:

```powershell
npm test --workspace=apps/mobile -- --runInBand __tests__/discoverFilters.test.js __tests__/discoverStaticAudit.test.js __tests__/discoverInteraction.test.js
```

Then run the relevant unchanged regression surface:

```powershell
npm test --workspace=apps/mobile -- --runInBand __tests__/dashboardStaticAudit.test.js __tests__/navigationShellStaticAudit.test.js __tests__/recipeCuisineRetired.test.js __tests__/shoppingListStaticAudit.test.js
```

If environment-level process spawning fails, rerun the same focused commands with the repository's established Windows-safe test procedure and report the environment distinction. Do not weaken assertions or change unrelated files.

## 13. Runtime gates

Runtime status is `NOT RUN` for this contract-freeze phase.

A future implementation is not runtime-complete until this small authenticated mobile flow is performed against a real API/database environment:

1. Open Discover from Dashboard and confirm the teammate-style pushed layout, filled search, pill hierarchy, compact rows, real images, and favorite controls.
2. Apply one existing P3 filter and verify the real request/result.
3. Open Filters, search a canonical Ingredient by name/alias, observe loading/results, select it, Apply, and verify the outgoing Recipe request contains the exact selected `ingredientId`.
4. Verify the selected Ingredient name remains visible; clear it and verify the next request omits `ingredientId`.
5. Apply at least `titleDesc`, `newest`, `prepTimeAsc`, and `prepTimeDesc`; verify real ordering and exact query values. Confirm prep labels never imply cook or total time.
6. Compose search + region/category + difficulty/dietary + maximum prep + Ingredient + sort and verify one real API request/result.
7. Change a filter/sort and verify page resets to 1; refresh and load more while retaining the complete composition.
8. Exercise real loading, no Ingredient result, Ingredient-search error/retry, no Recipe result, Recipe first-page error/retry, and later-page error/retry.
9. Clear filters and confirm sort remains selected while narrowing keys/search are removed.
10. Open a real Recipe Detail and return; verify no navigation or favorite regression.
11. Check light/dark themes, keyboard avoidance, safe areas, touch targets, selected states, and screen-reader labels/busy state.

Android/device runtime may be deferred only when the environment is unavailable. The handoff must then say exactly what was unavailable and must not claim visual, touch, keyboard, screen-reader, network, or device proof.

## 14. Explicitly rejected teammate mock-only behavior

- Local `recipes` arrays and client-side Recipe filtering/sorting.
- `useFakeRefresh` or artificial latency.
- Fuzzy/relevance ranking without a server response contract.
- Top Rated, rating sort, review-count tie-breaks, Trending, Most Popular, Best Match, or mock popularity.
- Cuisine revival.
- Mood/vibe filters.
- Multi-dietary selection when the API accepts one `dietaryTag`.
- Cooking/total-time claims derived from the prep-only field.
- Hard-coded collections, seeded ratings/reviews, mock result totals, and speculative pre-query `Show N` counts.
- Teammate SearchHistory/filter persistence as a new Discover state authority.
- Client-generated or free-text Ingredient ids.
- Full Ingredient catalog download.
- Moderator Ingredient resolution/creation/catalog semantics in the consumer app.
- `updatedDesc` in the consumer sort UI.
- Fake rating, review count, calorie, nutrition, popularity, recommendation, confidence, or editorial labels on Recipe rows.
- Copying teammate navigation, theme provider, auth, mock contexts, or source tree.

## 15. Out of scope

- Trending backend or ranked feeds.
- Rating/review aggregation in Recipe list or rating sort.
- Nutrition, calories, or macro data.
- Cuisine revival.
- Mood/vibe filters.
- Multi-dietary backend changes.
- Moderator/Admin changes, including Ingredient creation from import and Draft review ordering.
- Recipe schema, serializer, validation, service, repository, route, index, migration, or database changes.
- Community, Shopping List, Saved/Collections, Dashboard redesign, AI Assistant, and Cook Mode timer work.
- Search relevance backend work.
- Publication-time migration or sort tie-breaker changes.
- Global theme/component rewrite.
- Legal/help/license cleanup.
- Inspection, application, removal, or mutation of the protected Cook Mode stash.

## 16. Blockers and stop conditions

No contract blocker was found at the frozen baseline:

- Recipe list already accepts `ingredientId` and the six approved consumer sort values.
- Mobile `recipeService` already forwards `ingredientId` and `sort`.
- Authenticated canonical Ingredient search already exists.
- The current Recipe response contains everything needed by the retained compact cards.

Stop implementation and report rather than widening scope if:

- the deployed API does not match the audited baseline contracts;
- canonical selection cannot be implemented without changing Ingredient service/backend behavior;
- any proposed sort needs backend aggregation, raw field/direction input, publication-time semantics, or Moderator-only `updatedDesc`;
- navigation, Dashboard, theme, shared Recipe cards, Shopping List picker, or backend files appear necessary;
- an accessibility regression is required to reproduce the teammate inline panel.

Android/device availability is a runtime gate, not a contract blocker. Runtime remains honestly `NOT RUN` in this phase.

## 17. Repository safety snapshot

At audit start, WeCooked was `main` at the exact frozen baseline and tracked/index state was clean. The following pre-existing untracked files were present and are not part of DISC4:

- `AGENTS.md`
- `app.json`
- `apps/api/audit-result.json`
- `apps/mobile/.tmp-expo-config-error.txt`
- `docs/WeCooked_Android_Dev_Build_Setup.md`
- `docs/WeCooked_Local_Development_Startup.md`
- `docs/architecture/WeCooked_Full_Project_Handoff.md`
- `docs/architecture/frontend-migration-m2-screen-audit.md`
- `docs/milestones/M25-email-verification.md`

This milestone document is the only authorized new working-tree path for the contract-freeze phase. Nothing is staged, committed, pushed, or applied to a database.

Protected stash recorded by list only, without inspection or mutation:

```text
stash@{0}: On feat/cook-mode-timer-ui: WIP cook mode timer UI
```

## 18. Implementation evidence

Implementation completed on `feat/mobile-disc4-discover-parity` from frozen baseline `0e604e1279e63640e8d20b60fc599f7c98044695`.

Production changes stayed within the frozen four-file allowlist:

- `DiscoverScreen.js` composes canonical Ingredient and the selected consumer sort into the existing guarded Recipe request path, preserves sort across clear/preset handoffs, and renders applied Ingredient/sort summaries while retaining real cards, favorites, navigation, loading, error, refresh, and pagination behavior.
- `DiscoverFiltersSheet.js` adds staged canonical Ingredient search/selection and the six frozen sort choices after the retained P3 groups. Ingredient search uses the existing authenticated service with trimmed 300 ms debounce, `limit: 20`, explicit loading/empty/error/retry/truncated states, and generation invalidation on query change, clear, close/cancel, reopen, Apply, and unmount.
- `discoverFilters.js` normalizes canonical `{ id, name }` selection and the six-value sort, projects only `ingredientId` plus the approved sort, excludes sort from the narrowing-filter count, and preserves sort through replacement presets.
- `recipeOptions.js` exposes the six frozen consumer sort descriptors and labels; `updatedDesc` is not exposed.

Test changes stayed within the frozen three-file allowlist:

- `discoverFilters.test.js` covers canonical Ingredient normalization/query projection, fail-closed values, sort defaults/options, count exclusion, draft behavior, and preset replacement semantics.
- `discoverStaticAudit.test.js` covers the canonical services, query and race guards, exact sort allowlist, sheet hierarchy, applied summaries, accessibility landmarks, server-authoritative filtering, and forbidden mock-only semantics.
- `discoverInteraction.test.js` mounts the sheet and screen to cover debounce, loading/empty/error/retry/truncated states, stale success/failure and close/reopen races, selection/clear/cancel/reset/Apply, all six sorts, full filter composition, page reset, refresh, `totalPages` load-more, Dashboard handoff, Recipe states, and card navigation/favorite/image wiring.

Focused verification:

```text
PASS — 3 suites, 108 tests
discoverFilters.test.js
discoverStaticAudit.test.js
discoverInteraction.test.js
```

Unchanged regression verification:

```text
PASS — 4 suites, 109 tests
dashboardStaticAudit.test.js
navigationShellStaticAudit.test.js
recipeCuisineRetired.test.js
shoppingListStaticAudit.test.js
```

No backend, Dashboard, navigation, theme, shared-card, service, database, staging, commit, push, or stash mutation was performed. Independent review and Android/device runtime verification were not run during this implementation phase.

## 19. Verdict

`MOBILE-DISC4 IMPLEMENTATION COMPLETE — READY FOR INDEPENDENT REVIEW`

## 20. Independent review and required findings fix

The latest independent review returned **PASS WITH REQUIRED FIXES**. It found
three bounded issues: the Ingredient service converted malformed successful
payloads into clean empty results, several DISC4 controls had effective touch
targets below the frozen 44-point minimum, and mounted coverage did not fully
discriminate malformed responses or pending-request and Cancel behavior.

The findings-fix phase authorized `apps/mobile/src/api/ingredientService.js` in
addition to the original DISC4 production allowlist. The conditional
`FavoriteHeart.js` expansion was not used: its existing `style` prop reaches the
root `Pressable`, so Discover supplies a local 44 by 44 minimum without changing
other callers.

Exact fixes:

- `ingredientService.js` now exports `searchIngredientsStrict` for DISC4 while
  retaining the legacy `searchIngredients` behavior for Ingredient Studio and
  the Shopping List picker. The strict path accepts only a real `ingredients`
  array and fails the whole lookup if any candidate lacks a nonblank string
  public id or trimmed name. It never stringifies ids or derives identity from
  typed search text.
- `DiscoverFiltersSheet.js` uses the strict path. A valid empty array remains
  the normal empty state; a missing, null, object, string, or otherwise malformed
  collection and malformed candidates reach the existing truthful unavailable
  state. Existing debounce, retry, selection, staged Apply/Cancel, and generation
  invalidation behavior is preserved.
- `DiscoverScreen.js` and `DiscoverFiltersSheet.js` give the Ingredient and
  Recipe clear actions, quick and sort chips, filter button, Ingredient rows,
  selected-Ingredient action, footer actions, compact Recipe row, and favorite
  sibling control explicit effective targets of at least 44 points where their
  owning Pressable needed strengthening.
- Mounted tests now mock the API client below the real strict service boundary.
  They distinguish valid empty and canonical results from every reviewed
  malformed payload, prove typed text never becomes a canonical id, exercise
  controlled pending requests for clear/select/Apply/Cancel/unmount, and verify
  Cancel neither calls `onApply` nor mutates/restores anything except the
  externally applied state.
- Accessibility coverage now inspects the relevant mounted control styles and
  exact named style bindings instead of counting unrelated `minHeight: 44`
  literals.

Focused verification on 2026-10-02:

```text
PASS - 3 suites, 122 tests
discoverFilters.test.js
discoverStaticAudit.test.js
discoverInteraction.test.js

PASS - 4 unchanged regression suites, 109 tests
dashboardStaticAudit.test.js
navigationShellStaticAudit.test.js
recipeCuisineRetired.test.js
shoppingListStaticAudit.test.js

PASS - Babel parsed all 5 DISC4 production files
```

Android/device runtime, visual rendering, physical touch measurement, keyboard,
and screen-reader verification remain `NOT RUN`; this findings-fix evidence does
not claim runtime or final milestone completion. No staging, commit, push,
database mutation, or stash mutation was performed.

## 21. Findings-fix verdict

`MOBILE-DISC4 FINDINGS FIX COMPLETE - READY FOR CLOSURE REVIEW`

## 22. Narrow test-hardening evidence

The closure review found no production defect: DISC4's async Ingredient-search
behavior remained `PASS`. Closure failed only because several mounted tests
could false-pass while stale state was hidden by a blank query, a closed sheet,
or a reset on reopen. This phase changed tests and this milestone only; no
production file was modified.

The strict Ingredient-response matrix now explicitly rejects candidate ids of
`null`, object, array, and number types, plus blank ids and blank names. The
canonical valid-string id/name case remains covered, and typed query text still
cannot become Ingredient identity.

The clear, select, Apply, and Cancel pending-request tests now settle an old
request only after a visible current search has been established and resolved.
They assert the current result remains visible and that stale result, error, and
loading state cannot replace it. Apply and Cancel exercise a close/reopen
boundary; Cancel also retains the separate proof that it neither calls
`onApply` nor changes the applied Discover Recipe request. The static audit
binds each public transition to its exact invalidation statement/call, so
removing the clear, select, Apply, or Cancel invalidation fails the focused
suite even where a later query/session generation would otherwise provide a
second guard.

Unmount coverage now starts request A in an old sheet, unmounts it, mounts a
fresh sheet, resolves a visible current request B, then settles A and proves the
fresh state remains authoritative. React 19 silently ignores a pure state write
to an already-unmounted component, and component instances do not share local
state, so removing only the old instance's mounted guard is not externally
observable through this public component behavior. No production test seam and
no `console.error` oracle was added. The focused cleanup-invalidation source
assertion is therefore retained alongside behavioral remount/session-isolation
coverage.

Focused verification on 2026-10-02:

```text
PASS - 2 suites, 90 tests
discoverInteraction.test.js
discoverStaticAudit.test.js
```

`discoverFilters.test.js` was not rerun because this phase did not touch shared
fixtures or filter contracts. Android/device runtime, visual rendering,
physical touch measurement, keyboard, network, and screen-reader verification
remain `NOT RUN`; this test-only phase does not claim runtime or final product
completion. No staging, commit, push, database mutation, or stash mutation was
performed.

## 23. Test-hardening verdict

`MOBILE-DISC4 TEST HARDENING COMPLETE - READY FOR CLOSURE RECHECK`

## 24. Final closure and PR evidence

Implementation is complete. The final production scope is exactly:

- `apps/mobile/src/screens/DiscoverScreen.js`
- `apps/mobile/src/components/DiscoverFiltersSheet.js`
- `apps/mobile/src/utils/discoverFilters.js`
- `apps/mobile/src/api/recipeOptions.js`
- `apps/mobile/src/api/ingredientService.js`

The final test scope is exactly:

- `apps/mobile/__tests__/discoverFilters.test.js`
- `apps/mobile/__tests__/discoverStaticAudit.test.js`
- `apps/mobile/__tests__/discoverInteraction.test.js`

The teammate-style Discover layout was adopted and adapted while preserving
WeCooked's live API, navigation, theme, data, and state authority. The completed
implementation adds canonical Ingredient search and filtering plus the six
supported consumer sorts. It preserves P3 filter behavior, composed first-page,
refresh, and `totalPages`-authoritative load-more requests, Dashboard handoff,
real Recipe cards, and the unchanged shared `FavoriteHeart` component.

Ingredient search now rejects malformed response collections and malformed
candidates, fails closed, and protects current state from stale requests.
Interactive controls within the DISC4-owned surfaces enforce effective targets
of at least 44 points.

Independent review returned **PASS WITH REQUIRED FIXES**. The required fixes
were strict Ingredient-response parsing, malformed candidate rejection,
touch-target corrections, stronger Cancel coverage, and stronger
pending-request coverage. The first closure review failed at the test-quality
level only; production behavior remained `PASS`. Test hardening was completed,
and the final closure recheck returned `PASS`.

Recorded focused and regression evidence:

```text
PASS - 3 suites, 122 tests
PASS - later hardening: 2 suites, 90 tests
PASS - regressions: 4 suites, 109 tests
PASS - Babel parsed all 5 DISC4 production files
PASS - git diff --check
```

Android/device runtime is **DEFERRED BY PROJECT DECISION**. It was not run and
is not claimed as `PASS`. This deferral is not an implementation blocker.
Deferred runtime may later verify Android/device visual parity, physical touch
targets, keyboard and sheet behavior, light/dark rendering, screen-reader
behavior, and real API interaction on device.

## 25. Final verdict

`MOBILE-DISC4 FINALIZED - READY TO MERGE (RUNTIME DEFERRED)`
