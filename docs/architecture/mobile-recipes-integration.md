# Mobile ↔ REST API: Recipe discovery & detail integration

Second mobile integration slice (after
[mobile-auth-session-integration.md](./mobile-auth-session-integration.md)).
It migrates the **authenticated** app's generic Recipe discovery and
Recipe-detail *business data* from `src/data/mockData.js` to the existing
Express REST Recipe API (`apps/api`). See [recipes.md](./recipes.md) for the
backend domain this consumes and
[admin-recipes-integration.md](./admin-recipes-integration.md) for the
equivalent admin slice (this mirrors its service/enum split and race-safety
approach).

Target end state (unchanged):

```
React Native / Expo  ->  mobile recipe service  ->  Express REST /api/v1/recipes  ->  MongoDB
```

## Scope

**In:** Home Recipe discovery + search, Discover Recipe list (filter /
pagination / pull-to-refresh), Recipe Detail, Cook Mode compatibility,
`imageUrl` + safe fallback, structured ingredients, quantity/unit/`toTaste`
rendering, structured servings scaling, ordered instructions, loading / error /
empty states, this document.

**Out (unchanged / deferred):** Favorites API, Shopping List API, Community
backend, onboarding demo Recipe previews, Recommendations, AI, profile /
preferences, Ingredients admin, Substitutions UI, Recipe mutations, admin.
`apps/api` and `apps/admin` are untouched; the auth/session foundation is
untouched.

## REST layer structure (new files)

```
src/api/recipeService.js   listRecipes(params) + getRecipe(recipeId). Uses the
                           shared `api` client. No create/update/archive/delete.
src/api/recipeOptions.js   frontend-safe mirror of the backend difficulty /
                           dietaryTag / unit / sort enums + labels, the
                           region/category slugLabel() humanizer, and the
                           Discover filter set. No backend logic.
src/api/recipeErrors.js    getRecipeErrorMessage(err) — ApiError -> short safe
                           string (mirrors errorMessages.js for auth).
src/utils/recipe.js        pure view helpers: time label, badges, structured
                           quantity scaling, ingredient display line (incl.
                           toTaste / note / optional), instructions -> steps.
src/components/RecipeImage.js  <Image> wrapper: null/broken source -> bundled
                           placeholder; failure flag resets on source change.
```

Data path (the only one for generic Recipe business data after this slice):

```
DashboardScreen / DiscoverScreen / RecipeDetailScreen
  -> recipeService.listRecipes | recipeService.getRecipe
  -> api (src/api/client.js — shared, UNCHANGED)
  -> fetch  ->  /api/v1/recipes[...]  ->  MongoDB
```

Screens never call `fetch`, never import `client.js` directly, never touch the
token store. The shared client attaches the bearer access token and performs
one transparent refresh+retry on 401.

## Existing mobile API / auth reuse

Reused verbatim, not modified:

- `src/api/client.js` — base URL, `{ success, data }` / `{ success, error }`
  envelope, `ApiError` (`isNetworkError` / `isNotFound` / `code` / `status` /
  `details`), single transparent refresh+retry.
- `src/api/config.js` — `API_BASE_URL` from `EXPO_PUBLIC_API_BASE_URL` + the
  per-platform local default.
- `src/api/tokenStore.js`, `src/api/authService.js`, `src/context/AuthContext.js`
  — access-token-in-memory / SecureStore-refresh / rotation / single-flight /
  startup restore. No second fetch wrapper, base-URL layer, token store, refresh
  mechanism, or auth context was introduced.

Recipe GET endpoints require authentication; every Recipe screen already lives
inside the authenticated navigation stack, so no auth/navigation redesign was
needed.

## Endpoints consumed

| Function | Endpoint | Auth | Notes |
| --- | --- | --- | --- |
| `listRecipes(params)` | `GET /api/v1/recipes` | any authenticated | params below |
| `getRecipe(recipeId)` | `GET /api/v1/recipes/:recipeId` | any authenticated | `recipeId` must be a real Mongo id |

No `POST` / `PATCH` / `DELETE` is wrapped — mobile is read-only against the
Recipe domain.

List query keys sent (only backend-supported keys; empty/undefined omitted):
`search`, `region`, `category`, `difficulty`, `dietaryTag`, `ingredientId`,
`maxPrepTimeMinutes`, `page`, `limit`, `sort`. (`cuisine` was retired in M3.)

**`status` is never sent.** The backend defaults it to `active` and returns
`403 FORBIDDEN` to a non-admin caller that asks for `inactive` / `all`.

Response envelope (already unwrapped by `client.js` to `data`):
`{ recipes: PublicRecipe[], pagination: { page, limit, total, totalPages } }`
for the list, `{ recipe: PublicRecipe }` for detail.

## Home — "Latest Recipes"

`DashboardScreen.js`. With no active search it shows a horizontal carousel from:

```
listRecipes({ sort: 'newest', limit: 6 })
```

The section is titled **"Latest Recipes"** — not "Featured", not "Recommended",
not "For You". The backend has **no** featured/curation flag and this slice does
**not** integrate Recommendations, so the label reflects exactly what the query
returns (the 6 most recently created recipes).

States: first-load spinner, error + Retry, "No recipes yet." empty.

## Home — search

The existing Home search box runs:

```
listRecipes({ search, page: 1, limit: 20 })
```

- Backend `search` is a case-insensitive, regex-escaped substring match over
  **`title` OR `description` only** — not ingredients, not tags. The input
  placeholder says "Search recipes by name..." and no copy claims otherwise.
- Typing is debounced ~300 ms.
- Stale-response protection: a monotonic `searchGenRef`. Each keystroke bumps
  the generation; a slower earlier response whose generation no longer matches
  is discarded and never replaces a newer query's results. Clearing the box
  bumps the generation too (abandons any in-flight search) and returns to Latest
  Recipes.
- States: search-loading (full block when there are no prior results, inline
  spinner in the header otherwise), error + Retry, zero-result
  ("No recipes match ...").
- Only the first page (20) is fetched for a search in this slice — no search
  pagination.

## Home — unsupported category chips

The former `Breakfast / Lunch / Dinner / Dessert / Vegies` row had no correct
backend mapping (the backend has no meal-type concept). It was **replaced** with
a small **"Browse"** row of shortcuts that each navigate to Discover with an
explicit, backend-supported initial filter:

`Easy` → `difficulty=easy`, `Vegetarian` → `dietaryTag=vegetarian`,
`Vegan` → `dietaryTag=vegan`. (The former `Filipino` → `cuisine=filipino`
shortcut was dropped in M3 when `cuisine` left the Recipe domain.)

No fake `mealType`, no `search=breakfast`, no client-side tag invention.

## Discover — list, filters, pagination

`DiscoverScreen.js`, rewritten onto a `FlatList` (was a static `ScrollView` +
`.map`).

**Filters** (`DISCOVER_FILTERS` in `recipeOptions.js`) — each maps to an exact
backend query, replacing the invented `Quick` / `High-Protein` pills:

| Pill | Backend query |
| --- | --- |
| All | (none) |
| Easy | `difficulty=easy` |
| Vegetarian | `dietaryTag=vegetarian` |
| Vegan | `dietaryTag=vegan` |

There is no cuisine / region / category pill: `cuisine` was retired in M3 and
`region` / `category` have no controlled vocabulary or classified content yet.

An `initialFilter` param handed over from Home is applied on mount and then
cleared (`navigation.setParams`) so a repeat tap re-applies it.

**Pagination:** `limit: 20`, page-based append via `onEndReached`
(`onEndReachedThreshold={0.5}`). Pull-to-refresh via React Native's
`RefreshControl` (resets to page 1). No new dependency.

**Pull-to-refresh + append safety:**

- One monotonic `genRef` per filter change / refresh. `loadMore` captures the
  current generation; if the filter changes mid-flight, the append is dropped
  (`gen !== genRef.current`) and never lands on the new list.
- `loadingMoreRef` (synchronous) blocks duplicate `onEndReached` firings.
- Appends are de-duplicated by `id` (`mergeById`); the first page is
  de-duplicated too (`dedupeById`).
- A filter change resets `recipes` / `pagination` / `pageLoaded` and shows the
  first-load spinner.

## Backend V1 pagination imprecision — how mobile handles it

Per [recipes.md](./recipes.md): the DB page is fetched **before** the non-admin
"usable recipe" filter runs in application code. Therefore, for the active view:

- a page can contain **fewer than `limit`** recipes;
- `pagination.total` / `totalPages` can **overcount**;
- a short page is **not** a signal that there are no more usable recipes later.

Mobile consequences, implemented in `DiscoverScreen`:

- **Never** stop paging on `results.length < limit`. `loadMore` continues while
  `pageLoaded < pagination.totalPages` and stops only when that is no longer
  true (or `pagination` is missing).
- Counts from `pagination` are not shown as authoritative totals anywhere.
- The de-dupe on append means a defensively re-fetched or overlapping page can
  never introduce duplicate rows.

## API-vs-legacy Recipe navigation (transitional)

Home and Discover now push **backend PublicRecipe** objects. Saved / Community /
onboarding still use **mock** recipe objects (ids like `r4`). To keep both
working without a mock id ever reaching `GET /api/v1/recipes/:id` (which would
be a `400 VALIDATION_ERROR` — `r4` is not an ObjectId), navigation carries an
**explicit source flag**:

```js
// Home / Discover  ->  RecipeDetail
navigation.navigate('RecipeDetail', {
  recipeSource: 'api',
  recipeId: recipe.id,       // real Mongo id
  initialRecipe: recipe,     // list object, for instant paint
});

// Saved / other deferred screens  ->  RecipeDetail  (unchanged)
navigation.navigate('RecipeDetail', { recipe: mockRecipe });
```

`RecipeDetailScreen` is a thin dispatcher: `recipeSource === 'api'` renders
`ApiRecipeDetailContainer`; anything else renders `LegacyRecipeDetail` with the
mock object and makes **no** API request. The source is never inferred from id
shape. `CookMode` uses the same `recipeSource: 'api'` flag.

**This split is temporary** and is removed when Favorites / Community migrate to
the backend (at which point Saved/Community stop producing mock recipe objects).

## Recipe Detail — API mode

`ApiRecipeDetailContainer`:

1. renders `initialRecipe` (the list object) immediately — the list and detail
   serializers are identical, so there is nothing to wait for to paint;
2. fires `getRecipe(recipeId)` for the authoritative current copy;
3. request is guarded against unmount, a stale response, and a `recipeId`
   change — each firing bumps `genRef`; a mismatched response is dropped;
4. on `404 RECIPE_NOT_FOUND` (recipe archived / became unusable after the list
   loaded) → a safe notice screen: **"This recipe isn't available anymore."**
   with Go Back;
5. on any other fetch error while still showing the list object → a dismissible
   inline "couldn't refresh — tap to retry" banner (the screen stays usable);
6. cold entry with no `initialRecipe` → spinner, then content or a
   notice + Try Again / Go Back.

No raw backend error, stack, or body is ever shown — `getRecipeErrorMessage`
maps everything to a short safe string.

## Recipe Detail — legacy mock mode

`LegacyRecipeDetail` is the pre-slice screen, unchanged: mock `tags`, `score`,
string `time`, string ingredients, the estimated Nutrition card, the
mock-`ingredientSwaps` "Need a Substitute?" section, the favorite heart. It is
**not** pushed through the PublicRecipe shape and never fetches. It exists only
so Saved keeps working this slice; it was not extended or improved.

## Backend Recipe field mapping (API mode)

Uses the actual `PublicRecipe` contract — `id`, `title`, `description`,
`region`, `category`, `difficulty`, `prepTimeMinutes`, `cookTimeMinutes`,
`servings`, `ingredients`, `instructions`, `steps` (derived `[{ order, text }]`),
`dietaryTags`, `imageUrl`, `isActive`, `createdAt`, `updatedAt`. (`cuisine` was
retired in M3; `region` / `category` are optional and `null` on legacy records.)

| UI element | Source |
| --- | --- |
| Stat "Total time" | `formatMinutes(prepTimeMinutes + cookTimeMinutes)` |
| Sub-line "Prep N min · Cook N min" | `prepTimeMinutes`, `cookTimeMinutes` shown separately |
| Stat "Difficulty" | `difficulty` directly (`easy`→`Easy` …) |
| Stat "Servings" | the servings stepper, initialised from `recipe.servings` |
| Badges | classifier label (`category`, else `region` — humanized slug; absent on legacy records), then each `dietaryTags` label (readable: `glutenFree`→`Gluten-free`, …) |
| Card meta (Home / Discover) | total time + `difficulty` |

**Never fabricated for API recipes:** `score`, `rating`, `reviews`, nutrition
(calories/fat/carbs/protein/sugar/fiber), `author`, protein level, meal type,
popularity, featured flag. The **Nutrition card is not rendered** in API mode.
Mock-only tags (`Dinner`, `Breakfast`, `High-Protein`, `Quick`) never appear for
API recipes.

## Structured ingredients / toTaste

Backend usage entry:
`{ ingredient: { id, name } | null, quantity: number | null, unit, note: string | null, optional: boolean }`.

Rendered by `ingredientDisplayText` (`src/utils/recipe.js`):

- `ingredient === null` → the row is **skipped** (no fabricated name; in
  practice a non-admin never receives `null` because the backend drops
  archived optional entries and 404s on an archived required one — this is
  purely defensive).
- measurable unit → `"1 kg Chicken"` (`unitLabel` map for display casing only;
  no unit conversion, no pluralisation).
- `unit === 'toTaste'` → `"Black Pepper — to taste"`. `quantity` is always
  `null` for `toTaste` (backend invariant); it is never rendered as
  `null`/`0`, and servings scaling never touches it.
- `note` present → ` (<note>)` appended.
- `optional === true` → ` · optional` appended.

Ingredient **ids are never shown**.

## Servings scaling (API mode)

The mock string-parser (`BASE_SERVINGS = 4`, regex over ingredient text) is not
used for API recipes. Instead, structured scaling:

```
scaledQuantity = quantity * (selectedServings / recipe.servings)   // only when quantity is a finite number
```

The stepper initialises from `recipe.servings` (min 1, max `max(20, servings)`).
`toTaste` entries are unaffected. No unit conversion. The mock path keeps its
own `BASE_SERVINGS = 4` behavior for transitional compatibility.

## Instructions / Cook Mode adapter

MongoDB persists `instructions` as the ordered `string[]` source of truth. The
public Recipe serializer also derives `steps: [{ order, text }]` from that same
array, with contiguous one-based order values.

`CookModeScreen` uses `cookModeSteps` in `src/utils/recipe.js`: it prefers a
valid structured `steps` array and falls back to legacy `instructions` strings.
Neither path invents titles, durations, or a second recipe-data source.
Ingredient checklist rows are built from the structured recipe ingredients and
scaled for display only. The step thumbnail uses
`recipe.imageUrl ?? recipe.image` through `RecipeImage`.

## Image handling

`RecipeImage` (`src/components/RecipeImage.js`) wraps `<Image>` and reuses
`src/utils/image.js`'s `imageSource`:

- backend `imageUrl` string → remote image;
- `null` / empty, **or** a remote image that fails to load (`onError`) → a
  bundled placeholder already in the repo (`assets/leaf-deco.jpg`);
- the failure flag resets whenever the `source` prop changes, so a broken image
  on one recipe never pins the placeholder for the next recipe (e.g. in a
  recycled `FlatList` row).

No image upload, no Firebase Storage / S3 / Cloudinary, no downloads, no
generated images.

## Favorites — deferred (boundary)

Favorites API is **not** integrated. Backend recipe ids do not resolve against
the current mock-seeded `SavedRecipesContext`, so on **API-backed** surfaces
the favorite heart is **not rendered** (Home cards, Discover cards, API Recipe
Detail). No API recipe id is written into `SavedRecipesContext`; nothing implies
an API recipe was saved.

`SavedScreen`, `SavedRecipesContext`, `mockData.recipes`, `savedRecipeIds` are
**unchanged** — the Saved tab keeps working on mock data. Legacy mock Recipe
Detail keeps its existing heart behavior.

## Shopping List — still local / temporary (boundary)

Shopping List API is **not** integrated. Recipe Detail's "Add All to Shopping
List" stays **local** (`ShoppingListContext`). In API mode it consumes clean
structured names only:

```js
recipe.ingredients.map((e) => e.ingredient?.name).filter(Boolean)
```

The legacy string measurement-parser is **not** run against structured
ingredients. This is not server-synced and no backend Shopping List call is
made.

## Mock Recipe data intentionally remaining

`src/data/mockData.js` is **not** deleted. Home and Discover no longer import
its `recipes` array, but it is still required by, and unchanged for:

- `SavedScreen` / `SavedRecipesContext` (Favorites deferred);
- `CommunityScreen`'s recipe-tag picker (Community deferred);
- the onboarding demo preview pages (`DiscoverPage` / `StepsPage` /
  `FavoritesPage`, guest-only static mockups);
- `LegacyRecipeDetail`'s `ingredientSwaps` "Need a Substitute?" section
  (Substitutions UI deferred).

Unrelated mock exports were not touched.

## Recommendations / AI — deferred

No personalized/recommended Recipe UI exists or was added. "Latest Recipes" is
generic discovery (`sort=newest`), explicitly not a recommendation surface. The
Assistant screen is untouched.

## Request race / lifecycle safety (summary)

No new dependency. Every fetch path uses a monotonic generation ref (or `nonce`)
+ a mounted/cancelled guard:

| Path | Guard |
| --- | --- |
| Home search | `searchGenRef` bumped per keystroke / clear / retry; late response dropped |
| Home latest | `latestGenRef` bumped per load / retry |
| Discover filter change / refresh | `genRef` bumped; first-page + append responses validated against it |
| Discover `onEndReached` | `loadingMoreRef` (sync) blocks duplicates; append validated against `genRef` |
| Recipe Detail fetch | per-effect `cancelled` flag + `genRef`; no `setState` after unmount or `recipeId` change |

## Error / loading / empty states (summary)

Reuses `ApiError` + `getRecipeErrorMessage`. Never surfaces stacks, raw bodies,
tokens, or DB errors.

- **Home:** initial spinner, search-loading, zero-result, network/API error +
  Retry (for both Latest and search).
- **Discover:** initial spinner, `ListFooterComponent` "load more" spinner,
  pull-to-refresh, empty ("No recipes match this filter yet."), initial error +
  Retry, load-more error (tap footer to retry).
- **Recipe Detail (API):** instant paint from the list object, inline
  "couldn't refresh" banner, `404` "This recipe isn't available anymore." +
  Go Back, cold-entry spinner / notice.

## Validation

- `npm test --workspace=apps/api` — backend untouched; expected 556 pass / 0
  fail.
- `apps/mobile` Android export via the local Expo CLI (no `npx`, no new deps):
  `.\node_modules\.bin\expo.cmd export --platform android --output-dir "$env:TEMP\wecooked-mobile-recipes"`.

## Intentionally deferred

Favorites API, Shopping List API, Community backend, Recommendations, AI,
profile/preferences, Ingredients admin, Substitutions UI, Recipe mutations,
image upload/storage, unit conversion, search pagination, a sort selector,
`ingredientId` / `maxPrepTimeMinutes` UI, and removal of the API-vs-legacy
navigation shim.
