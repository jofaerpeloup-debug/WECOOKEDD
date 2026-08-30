# Mobile ↔ REST API: ingredient substitutions (read-only)

Follow-up slice to
[mobile-recipes-integration.md](./mobile-recipes-integration.md). It adds a
**read-only** "what can I use instead of this ingredient?" affordance to the
API Recipe Detail screen, backed by the existing substitution catalog
([ingredients-substitutions.md](./ingredients-substitutions.md)).

```
ApiRecipeDetail ingredient row
  -> user taps "Substitutes"
  -> SubstitutionsSheet (RN Modal)
  -> substitutionService.getSubstitutesFor(canonicalIngredientId)
  -> api (src/api/client.js — shared, UNCHANGED)
  -> GET /api/v1/substitutions?sourceIngredientId=<id>&limit=100
  -> MongoDB  ->  authoritative response  ->  read-only display
```

The backend is authoritative. Mobile never creates, edits, archives, ranks,
re-orders, or invents substitutions, and never mutates the recipe or the
shopping list.

## Scope

**In:** a read-only `substitutionService.getSubstitutesFor()`, an error mapper,
a `SubstitutionsSheet` bottom-sheet (RN `Modal`, no navigation screen), a small
per-row "Substitutes" affordance wired into `ApiRecipeDetail` only, this
document.

**Out (unchanged):** every backend module, `apps/admin`, auth/session,
Favorites, Shopping List, Recipes discovery/detail/scaling/Add-All, Cook Mode,
`LegacyRecipeDetail`, the mock `IngredientStudioScreen` / `SwapDetailScreen` /
`TopBar` swap icon, `package.json` / `package-lock.json`. No unit conversion, no
automatic ingredient replacement, no quantity math, no ratio display, no AI, no
ranking/confidence, no global provider.

## New / changed files

```
src/api/substitutionService.js   NEW  getSubstitutesFor(sourceIngredientId) ->
                                      GET /api/v1/substitutions. Requires a
                                      canonical 24-hex ObjectId; rejects
                                      (VALIDATION_ERROR) and sends NO request
                                      otherwise. Never sends status/userId.
                                      Normalizes to { id, substitute:{id,name},
                                      notes, contexts } — ratio is DROPPED.
src/api/substitutionErrors.js    NEW  getSubstitutionErrorMessage(err) —
                                      ApiError -> short safe string (mirrors
                                      recipeErrors.js / ingredientErrors.js).
src/components/SubstitutionsSheet.js
                                 NEW  RN Modal: source name, loading, canonical
                                      substitute names, optional notes, optional
                                      context chips, "No substitutions
                                      available." empty state, retry/error,
                                      close. Owns the monotonic generation
                                      guard + per-effect cancel flag + the
                                      forId render guard (stale-response /
                                      unmount / no-flash protection). No shared
                                      in-flight ref (see "In-flight
                                      deduplication").
src/screens/RecipeDetailScreen.js
                                 MOD  ApiRecipeDetail ONLY: `ingredientRows`
                                      memo (pairs each display line with the
                                      canonical { id, name } when present),
                                      per-row affordance gated on
                                      `row.ingredient`, screen-local cache ref,
                                      hosts the sheet. `ingredientLines` (the
                                      Cook Mode input) is now derived from
                                      `ingredientRows` — same ordered, filtered
                                      string array as before. LegacyRecipeDetail
                                      untouched.
docs/architecture/mobile-substitutions-integration.md   NEW  this file.
```

No new dependency. RN `Modal`, `ScrollView`, `ActivityIndicator`, `Ionicons`,
`Badge`, `useSafeAreaInsets`, `useRef`/`useState`/`useEffect` are all already in
use.

## Endpoint consumed

| Function | Endpoint | Auth | Notes |
| --- | --- | --- | --- |
| `getSubstitutesFor(id)` | `GET /api/v1/substitutions?sourceIngredientId=<id>&limit=100` | any authenticated | `id` must be a canonical Ingredient ObjectId |

No `POST` / `PATCH` / `DELETE` is wrapped — mobile is read-only against the
Substitution domain (those routes are `authorize('admin')` anyway).

**Query keys sent:** `sourceIngredientId`, `limit` — nothing else.

- **`status` is never sent.** The backend defaults it to `active` and returns
  `403 FORBIDDEN` to a non-admin that asks for `inactive` / `all`, so archived
  substitutions are already excluded.
- **`userId` / ownership fields are never sent.** Substitutions are global
  catalog data with no owner; the backend query schema is `.strict()` and would
  reject them.
- `limit=100` is the backend maximum and is the reviewed V1 choice: a single
  canonical ingredient has at most `(ingredientCount - 1)` substitutes (unique
  `{source, substitute}` index), realistically a handful. One page covers it
  with no pagination logic, and the UI renders the returned array — never
  `pagination.total`, which the backend documents can overcount.

Response envelope (already unwrapped by `client.js` to `data`):
`{ substitutions: PublicSubstitution[], pagination: {...} }`. Each
`PublicSubstitution` is
`{ id, sourceIngredient:{id,name}|null, substituteIngredient:{id,name}|null, ratio:{sourceAmount,substituteAmount}, contexts:string[], notes:string|null, isActive, createdAt, updatedAt }`.

## Directional substitution semantics

The relation is **directed**. `?sourceIngredientId=X` returns rows whose
**source** is X — i.e. "things you can use instead of X" — which is exactly the
recipe use case. `X -> Y` does not imply `Y -> X`; the reverse query
(`substituteIngredientId=X`) is a different lookup and is **not** used here.
Results are returned in the backend's default order (`createdAt` desc); there is
**no** rank/score/confidence field, so the sheet presents them in received
order with no "best match" labelling.

## Canonical `sourceIngredientId` lookup — the guard

Substitution lookup is keyed on **canonical Ingredient identity**, never on
ingredient name text.

An API Recipe ingredient usage serializes as
`{ ingredient: { id, name } | null, quantity, unit, note, optional }`. The
`ingredient.id` is the canonical `Ingredient._id` — the same id space as
`substitution.sourceIngredientId`. `optional`, `quantity`, `unit`, `note`, and
`unit === 'toTaste'` do **not** affect which canonical ingredient is queried.

A request is issued **only** when the id is a valid canonical id. The guard is
enforced in two independent places:

1. **Call site** (`ApiRecipeDetail`): `ingredientRows` carries
   `ingredient: { id, name } | null`. `null` (a usage with no canonical
   identity — defensive; a non-admin never actually receives one because the
   backend 404s an archived required ingredient and strips archived optional
   ones) renders **no** affordance. `openSubstitutes` also early-returns if
   `!ing.id`.
2. **Service** (`substitutionService.getSubstitutesFor`): rejects with an
   `ApiError` (`code: 'VALIDATION_ERROR'`) and issues **no** `fetch` unless the
   argument matches `/^[a-f0-9]{24}$/i`. A missing / blank / non-canonical value
   (e.g. a legacy mock id like `r4`, a mock swap id like `s1`, or `undefined`)
   can therefore **never** produce an unfiltered `GET /api/v1/substitutions`.

## API Recipe vs legacy/mock isolation

The new UI lives **only** inside `ApiRecipeDetail`. `RecipeDetailScreen` is a
dispatcher: `route.params.recipeSource === 'api'` renders `ApiRecipeDetail`;
anything else renders `LegacyRecipeDetail`, which:

- is **not modified** by this slice;
- keeps its own mock `ingredientSwaps` "Need a Substitute?" section
  (`src/data/mockData.js`), which is unrelated local content;
- receives free-text ingredient strings with **no** `ingredient.id`, so it has
  nothing to hand to `substitutionService` and never imports it.

The mock `IngredientStudioScreen` / `SwapDetailScreen` (reached from the
`TopBar` brand-mode swap icon) are likewise untouched mock surfaces — the same
way the mock `AssistantScreen` coexists with real features. This slice does not
replace them; that is deferred.

Because legacy/mock recipes carry no canonical ingredient ids and the service
hard-rejects non-24-hex ids, a fake/local id can never reach the substitution
REST endpoint.

## Lazy / on-demand loading + screen-local cache

- **No prefetch.** A recipe with N ingredients issues **0** substitution
  requests on mount. A request happens only when the user opens the sheet for a
  specific row.
- **Screen-local cache.** `ApiRecipeDetail` holds `useRef(new Map())` keyed by
  canonical ingredient id, passed to the sheet as `cacheRef`. A cache hit
  renders instantly with no request. The cache survives sheet open/close and
  switching between ingredients within the same recipe view. It dies when the
  screen remounts — `ApiRecipeDetailContainer` is keyed by `recipeId`, so
  navigating to another recipe starts with a fresh cache. No persistence, no
  TTL, no cross-screen sharing.
- **No global Context/provider.** Nothing needs cross-screen substitution
  state; substitutions are read-only global data with no mutation lock or
  shared-state reconciliation to coordinate.

## In-flight deduplication

The realistic case — an impatient double-tap on the same row — collapses
without any explicit registry: `openSubstitutes` is handed the same
`ingredient` object (from the stable `ingredientRows` memo), so
`setSwapIngredient` with an identical reference makes React bail out of the
re-render, and even when a re-render does occur the string `ingredientId`
effect dependency is unchanged, so the effect never re-runs and **no second
request is issued**.

There is deliberately **no shared "in-flight" ref**. An earlier attempt used
one (`inFlightRef = currentId`) cleared in a `.finally`, but that clear was
keyed only on id, not on request identity — after `A → close → reopen A`, the
first A request's `.finally` would null the marker belonging to the *second* A
request. A settled stale request must never mutate state a newer request relies
on, so the mechanism was removed. The residual cost: closing and reopening the
**same** ingredient before its first response lands issues one fresh request
(an idempotent `GET`); the earlier one is dropped by `genRef` and never
renders. Switching between ingredients is only possible via a close (the rows
sit behind the modal), so a direct `A → B` mid-flight switch cannot occur.

## Stale-response protection

`SubstitutionsSheet` uses a monotonic `genRef`, bumped at the top of **every**
effect run (fetch start, cache hit, and the `!visible` / no-selection early
return):

| Situation | Protection |
| --- | --- |
| switch source ingredient mid-request | `genRef` bumped; the older response fails `gen === genRef.current` and is dropped — a **stale success cannot replace** the newer ingredient's results, and a **stale error cannot clear** them |
| close the sheet with a request in flight | effect cleanup sets `cancelled = true` and `genRef` is bumped on the next run — the in-flight response is invalidated for any later session of the sheet |
| reopen for another ingredient | render derives from `state` **only** when `state.forId === ingredientId`; otherwise it shows loading, so the previous ingredient's list can never flash during the modal slide-in, regardless of effect timing |
| component unmount | per-effect `cancelled` flag guards every `setState`; there is no `.finally` and no post-settle side effect |
| cache hit for a previous ingredient racing a slower fetch | the cache-hit path also bumps `genRef` before reading the cache, so a slower in-flight response for an earlier ingredient cannot overwrite it |

## Ratio is hidden in V1

The backend `Substitution.ratio` is `{ sourceAmount, substituteAmount }` — two
positive numbers with **no unit on either side**, **no target unit**, and **no
unit conversion** (the model comment states this explicitly). It is a
dimensionless proportion between two canonical ingredients whose measurement
basis (by volume? by weight?) is not recorded.

Displaying it next to a row like "2 tbsp butter" would invite the user to
compute "1.5 tbsp olive oil" — an equivalence the backend does not and cannot
vouch for. Therefore:

- `substitutionService` **drops `ratio`** during normalization; it is not in
  the UI-facing shape at all.
- `SubstitutionsSheet` shows canonical substitute **names**, optional admin
  **notes**, and optional **context** tags only, plus an explicit footnote:
  *"Suggestions from the WeCooked catalog — a starting point, not exact amounts.
  Adjust to taste."*

`ratio` can be surfaced later, once/if the backend adds replacement-unit
semantics.

## No Recipe / Shopping List mutation

The sheet is informational only. It has **no** "replace", "apply", "swap in",
"add to list", or "adjust quantity" action. It does not touch:

- recipe ingredients, quantities, servings, or the servings stepper;
- "Add All to Shopping List" (still recipe-id only, unchanged);
- `ShoppingListContext` / the Shopping List API;
- `FavoriteHeart` / Favorites;
- Cook Mode — `ingredientLines` (the array passed to `CookMode`) is still the
  same ordered, filtered display-string array, now derived from `ingredientRows`.

## Unavailable / null ingredient handling

If a recipe ingredient usage has `ingredient == null` (defensive — a non-admin
never receives one), the row renders its text with **no** "Substitutes"
affordance and can issue no request. `ingredientDisplayText` already returns
`null` for such an entry, so the row is skipped entirely in practice.

## Error / empty-state handling

`getSubstitutionErrorMessage(err)` maps `ApiError` to a short safe string —
never a raw 5xx body, stack, DB internal, or token:

| Case | Treatment |
| --- | --- |
| empty `substitutions` array | **NORMAL empty state** — "No substitutions available." (never routed through the error mapper) |
| `VALIDATION_ERROR` (400) | "Couldn’t look up substitutes for this ingredient." (should not occur — id is pre-validated) |
| `FORBIDDEN` (403) | generic failure (not expected — mobile never sends `status`) |
| `RATE_LIMIT_EXCEEDED` (429) | "Too many requests. Please wait a moment and try again." + retry |
| `AUTH_TOKEN_MISSING` / `AUTH_TOKEN_INVALID` / `AUTH_SESSION_INVALID` (401) | shared client attempts one silent refresh+retry; if still failing → "Your session has expired. Please log in again." |
| network failure | "Can’t reach WeCooked. Check your connection and try again." + retry |
| 5xx | "WeCooked is having trouble right now. Please try again shortly." + retry |

The error view offers **Try again**, which bumps a `retryTick` that re-runs the
fetch effect (errors are not cached).

## Scope boundaries

Untouched, and a diff touching any of these is a scope violation to stop on:
`apps/api/**`, `apps/admin/**`, auth/session files, any Favorites file, any
Shopping List file (`shoppingListService.js`, `ShoppingListContext.js`,
`ShoppingListScreen.js`, `IngredientPickerModal.js`), `src/api/client.js`,
`src/api/config.js`, `src/components/TopBar.js`,
`src/screens/IngredientStudioScreen.js`, `src/screens/SwapDetailScreen.js`,
`src/data/mockData.js`, `package.json`, `package-lock.json`,
`docs/architecture/WeCooked_Full_Project_Handoff.md`.

## Validation

- `npm test --workspace=apps/api` — backend untouched; expected the current
  baseline (556 pass / 0 fail).
- `apps/mobile` Android export via the local Expo CLI (no `npx`, no new deps):
  `.\node_modules\.bin\expo.cmd export --platform android --output-dir "$env:TEMP\wecooked-mobile-substitutions"`.

## Intentionally deferred

Ratio / quantity guidance UI, unit conversion, "apply substitute" / ingredient
replacement, sending a substitute to the shopping list, a standalone
substitutes browser, migrating the mock `IngredientStudioScreen` /
`SwapDetailScreen` / `TopBar` swap icon off mock data, reverse-direction
lookup, `context` filtering, and substitution pagination.