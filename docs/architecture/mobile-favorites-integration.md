# Mobile ↔ REST API: Favorites / Saved integration

Third mobile integration slice, after
[mobile-auth-session-integration.md](./mobile-auth-session-integration.md) and
[mobile-recipes-integration.md](./mobile-recipes-integration.md). It migrates
the **authenticated** app's Favorite/Saved behavior for **API (backend)
recipes** off the mock/local `SavedRecipesContext` and onto the existing
Express Favorites REST API (`apps/api`). See
[favorites-shopping-list.md](./favorites-shopping-list.md) for the backend
domain this consumes.

Target end state:

```
React Native / Expo  ->  mobile favorite service  ->  Express REST /api/v1/favorites  ->  MongoDB
```

## Scope

**In:** a Favorites API service, an API-backed `FavoritesProvider` (the single
source of favorite truth for backend recipes), favorite hearts on the
API-backed surfaces (Dashboard cards, Discover cards, API Recipe Detail), the
Saved tab backed by real favorites, cross-screen consistency, per-user session
isolation, loading / empty / error states, duplicate / race protection, this
document.

**Out (unchanged / deferred):** Shopping List API, Community backend,
Recommendations, AI, Notifications, profile/preferences persistence, Recipe
mutations, Admin, any `apps/api` change, and any cleanup of the legacy mock
recipe/favorite infrastructure. `apps/api`, `apps/admin`, the auth/session
foundation, and `ShoppingListContext` are untouched.

## REST layer structure (new files)

```
src/api/favoriteService.js    listFavorites(params) + addFavorite(recipeId) +
                              removeFavorite(recipeId). Uses the shared `api`
                              client. No other favorite mutation is wrapped.
src/api/favoriteErrors.js     getFavoriteErrorMessage(err) — ApiError -> short
                              safe string (mirrors recipeErrors.js). Plus
                              isIdempotentFavoriteOutcome(err, action).
src/context/FavoritesContext.js  FavoritesProvider + useFavorites() — the single
                              authoritative favorite state for API recipes.
src/components/FavoriteHeart.js  small shared heart control; consumes the
                              provider; API recipes only.
```

Data path (the only one for API-recipe favorite state after this slice):

```
Dashboard / Discover / RecipeDetail(API) / Saved
  -> useFavorites()  (FavoritesProvider)
  -> favoriteService
  -> api (src/api/client.js — shared, UNCHANGED)
  -> fetch  ->  /api/v1/favorites[...]  ->  MongoDB
```

Screens never call `fetch`, never import `client.js` directly, never touch the
token store. The shared client attaches the bearer access token and performs
one transparent refresh+retry on 401.

## Existing mobile API / auth reuse

Reused verbatim, not modified:

- `src/api/client.js` — base URL, `{ success, data }` / `{ success, error }`
  envelope, `ApiError` (`isNetworkError` / `isNotFound` / `isConflict` /
  `isRateLimited` / `code` / `status` / `details`), single transparent
  refresh+retry.
- `src/api/config.js` — `API_BASE_URL`.
- `src/api/tokenStore.js`, `src/api/authService.js`, `src/context/AuthContext.js`
  — access-token-in-memory / SecureStore-refresh / rotation / single-flight /
  startup restore. **No** second fetch wrapper, base-URL layer, token store,
  refresh mechanism, or auth context was introduced. AuthContext is only
  *observed* by `FavoritesProvider`, never modified.

## Endpoints consumed

| Function | Endpoint | Auth | Notes |
| --- | --- | --- | --- |
| `listFavorites({ page, limit, sort })` | `GET /api/v1/favorites` | any authenticated | `sort` = `newest` (default) or `oldest`; `limit` ≤ 100 |
| `addFavorite(recipeId)` | `POST /api/v1/favorites/:recipeId` | any authenticated | `recipeId` must be a real Mongo id |
| `removeFavorite(recipeId)` | `DELETE /api/v1/favorites/:recipeId` | any authenticated | keyed by **recipeId**, not a favorite id |

No other favorite mutation is wrapped. `page` / `limit` / `sort` are the only
query keys sent — the backend list schema is strict, so any other key (notably
`userId`) is a `400 VALIDATION_ERROR`.

Response envelopes (already unwrapped by `client.js` to `data`):

- list → `{ favorites: Favorite[], pagination: { page, limit, total, totalPages } }`
- add → `{ favorite: Favorite }` (HTTP 201)
- remove → `{ deleted: true }` (HTTP 200)

`Favorite` shape:

```json
{
  "id": "<favoriteId>",
  "recipe": {
    "id": "<recipeId>", "title": "...", "cuisine": "filipino",
    "difficulty": "easy", "prepTimeMinutes": 15, "cookTimeMinutes": 40,
    "imageUrl": null
  },
  "createdAt": "<ISO>"
}
```

The nested `recipe` is a **summary** — never a full `PublicRecipe`. It has no
`description`, `servings`, `ingredients`, or `instructions`, and the mobile app
never fabricates them.

## Ownership / IDOR (BOLA) protection

Ownership is **always** the authenticated backend identity (`req.auth.userId`,
derived from the DB-verified session in `authenticate.middleware.js`). The
mobile client:

- never sends a `userId` in a body, query, or path — `favoriteService` only
  ever sends `page` / `limit` / `sort`;
- uses the path param `:recipeId` (a public recipe id) as the only identifier
  for add/remove;
- relies on the backend's per-user scoping: `GET /favorites` filters by the
  caller's `userId`, `DELETE /favorites/:recipeId` is
  `findOneAndDelete({ userId, recipeId })` (a foreign favorite id simply
  yields `404 FAVORITE_NOT_FOUND`).

There is no client-controlled ownership surface. `role` / `admin` grants no
cross-user access on the backend.

## `FavoritesProvider` architecture

`src/context/FavoritesContext.js` is the **single** authoritative favorite
state for API recipes. Every heart and the Saved screen read from it — there
are **no** per-screen favorite arrays.

State:

| Field | Meaning |
| --- | --- |
| `entries` | `recipeId -> { favoriteId, recipe: <summary>, createdAt }` — the loaded + optimistically-applied favorites |
| `status` | `idle` (no session) / `loading` (initial load) / `ready` / `error` (initial load failed, nothing to show) |
| `error` | last safe error string (or `null`) |
| `pending` | `recipeId -> true` while a POST/DELETE is in flight |
| `pendingTargets` | `recipeId -> desired boolean` while a mutation is in flight (overlays `entries` for `isFavorite`) |

Exposed by `useFavorites()`:

```
favorites        // entry[] sorted newest-first (for the Saved screen)
favoriteIds      // Set<recipeId> (confirmed)
status, error
isInitializing   // status === 'idle' || 'loading'
isReady          // status === 'ready'
isFavorite(recipeId)
isPending(recipeId)
addFavorite(recipe)        // recipe object (needs id + summary fields)
removeFavorite(recipeId)
toggleFavorite(recipe)     // target computed from the authoritative Set
reload()                   // generation-guarded refetch (pull-to-refresh / focus)
```

`isFavorite` consults `pendingTargets` first, then `entries`, so an in-flight
optimistic mutation is reflected immediately and consistently everywhere.

Provider mount (`App.js`): **inside `AuthProvider`** so it can observe
authenticated user/session state, and outside the rest so every screen can
consume it:

```
AuthProvider > FavoritesProvider > SavedRecipesProvider > ShoppingListProvider > CommunityProvider
```

`SavedRecipesProvider` and `ShoppingListProvider` are unchanged and still
mounted.

## User / session isolation (security)

`FavoritesProvider` derives `authUserId = authStatus === 'authenticated' ? user.id : null`
from `AuthContext` and keys its lifecycle on it. Two separate counters, plus a
render-time ownership gate:

- **`sessionRef`** — bumped on every auth/user identity change. Every list page
  and every mutation captures the session it started under; a response from a
  superseded session is discarded and can never write state.
- **`listGenRef`** — bumped on every `reload()` / load; only the newest list
  request applies its result. It is **separate from `sessionRef`** on purpose:
  a focus / pull-to-refresh reload must never look like a session change, or it
  would strand an in-flight mutation's `pending` / `pendingTargets` cleanup
  (stuck spinner) and skip its rollback-on-failure.
- **Render-time ownership gate.** The loaded state carries the user id it
  belongs to (`ownerId`, set in the same batch as the wipe). `favorites` /
  `favoriteIds` / `isFavorite` are exposed as **empty** — and `status` reads as
  `loading` — for any render where `ownerId !== authUserId`. `useEffect` runs
  *after* render, so on the frame where `authUserId` has flipped but the
  clearing effect hasn't run yet, User A's `entries` are still in state; the
  gate makes that frame render empty rather than leak A's favorites under B.
- **The previous user's state is also wiped synchronously in the effect** —
  `entries` / `pending` / `pendingTargets` (state *and* refs) — and `ownerId`
  is set to the new user, before any load starts.
- **Logout** (`authUserId -> null`) → the gate makes effective state empty
  immediately (that render) and `status` reads `idle`; the effect then wipes.
- **A→B switch** (including a `refreshUser()` that returns a different id): the
  gate blanks the transitional frame, then the effect wipes A and loads B. An
  in-flight A request resolves into a superseded `sessionRef` and is dropped.
- **Startup restore**: while `AuthContext` is `restoring`, `authUserId` is
  `null` and the provider stays `idle`; once it resolves to `authenticated`
  the provider loads that user's favorites. Nothing is persisted to
  AsyncStorage — the backend is the only source of truth; SecureStore remains
  auth-token-only.

## Initial favorites load (fetch-all-pages)

`GET /favorites` is paginated. The provider fetches **every** page so the
favorite-id set is complete for hearts:

- `limit=100`, `sort=newest`;
- continue while `page <= pagination.totalPages`, bounded by a hard
  `MAX_PAGES = 50` safety cap;
- **never** stop because `favorites.length < limit`.

**Backend V1 caveat:** `GET /favorites` paginates the `Favorite` collection
*before* filtering out favorites whose recipe has become archived/unusable.
Therefore `pagination.total` / `totalPages` can **overcount**, and a page can
come back **short or empty** without being the last page. The loop pages
strictly against `totalPages` and dedupes by public `recipe.id`. The Saved UI
uses `favorites.length` for any count — **never** `pagination.total`.

A slower list response cannot undo a newer optimistic mutation: after the
multi-page load completes, the provider folds in every still-`pending` mutation
(add → keep/insert, remove → drop) before committing the new `entries`.

## Initial heart state

Until the initial load finishes, API hearts must not appear interactively
"unsaved":

- `status === 'idle' | 'loading'` → `FavoriteHeart` renders a dimmed neutral
  outline and is **not** interactive (layout preserved).
- `status === 'error'` (initial load failed) → same dimmed neutral state; a tap
  triggers `reload()` (retry) rather than a mutation. A load error never
  silently implies every recipe is unsaved.
- `status === 'ready'` → `favoriteIds` is authoritative; hearts are live.
- mutation in flight → small spinner, taps ignored.

## Add / remove mutation semantics

`runMutation(recipeId, target, recipeObj)`:

1. **Per-recipe pending guard** (`pendingIdsRef` — a synchronous `Set`): if a
   mutation for that id is already in flight, the tap is ignored and no second
   `POST`/`DELETE` is issued.
2. **Target from the authoritative Set**, not a blind toggle: if the recipe is
   already in the desired state (`wasFavorite === target`), it's a no-op.
3. **Optimistic apply** to `entries` + record rollback info + set
   `pendingTargets[id] = target`.
4. On success → reconcile with the server payload (real `favoriteId` /
   `createdAt`).
5. **Idempotent backend outcomes are NOT rolled back**
   (`isIdempotentFavoriteOutcome`):
   - `FAVORITE_ALREADY_EXISTS` (409) on add → stays saved;
   - `FAVORITE_NOT_FOUND` (404) on remove → stays unsaved.
6. On any other failure → **roll back** to the recorded previous state and
   return a safe message (the heart shows a brief `Alert`).
7. If the auth session changed mid-flight (`sessionRef` mismatch) → the
   response is **discarded**; local user cleanup wins and the stale result
   never writes state. A list reload (`listGenRef` bump) does **not** count as
   a session change — the mutation still completes its cleanup and its
   rollback.

## List + mutation races

- `sessionRef` (auth identity) and `listGenRef` (list request) are independent.
  A mutation is only invalidated by a `sessionRef` change; a `reload()` bumps
  only `listGenRef`, so a focus / pull-to-refresh landing during an in-flight
  add/remove supersedes the *list* but never strands the *mutation*
  (`pending` / `pendingTargets` are always cleared, rollback still fires).
- `reload()` during the initial load bumps `listGenRef`, so the newer load
  **supersedes** the older one instead of racing; a superseded load bails at
  its next page boundary and never touches state.
- The post-load fold-in (step above) means a list response applied after an
  optimistic add/remove does not undo it.
- Screen unmount is safe: favorite state lives in the provider (session
  lifetime), not the screen; there is no `setState`-after-unmount in a screen.
- Repeated `SavedScreen` focus events each call `reload()`; every superseded
  load bails after its first page fetch, so the worst case is a few wasted
  single `GET`s, never overlapping full multi-page loads.

No state-management dependency was added — two counter refs + plain `Set`s only.

## API-vs-legacy favorites boundary

The explicit `recipeSource` navigation contract from the Recipes slice is
unchanged and is the boundary — **id shape is never inspected**.

- **API recipes** (Dashboard cards, Discover cards, `ApiRecipeDetail`, the
  migrated Saved screen): favorites go through `FavoritesProvider` + the
  Favorites REST API, keyed by the backend `recipe.id`. They never touch
  `SavedRecipesContext`.
- **Legacy / mock recipes** (`LegacyRecipeDetail`, onboarding mockups): keep
  their existing `SavedRecipesContext` behavior. A mock id (`r1`, `r4`, …) is
  never sent to the Favorites API (it would be a `400 VALIDATION_ERROR`).

`FavoriteHeart` only accepts an API recipe object and makes no API call from a
legacy/mock surface (it is simply not rendered there).

Left intact and untouched this slice: `src/context/SavedRecipesContext.js`
(and its `wecooked:savedRecipeIds` AsyncStorage key), `mockData.recipes`,
`mockData.savedRecipeIds`, and `LegacyRecipeDetail`. Once the Saved screen
navigates to API Recipe Detail, `LegacyRecipeDetail` has no remaining entry
point — it is left as (now unreachable) code; its removal, and unmounting
`SavedRecipesProvider`, belong to a later dedicated cleanup slice.

## Screen changes

### Dashboard (`DashboardScreen.js`)

Each API recipe card (Latest + search results) gets a `FavoriteHeart`,
rendered as a **sibling** of the card `Pressable` (both children of the card
`View`), so a heart tap never also triggers card navigation. No
`SavedRecipesContext`, no mock ids. Card navigation is unchanged.

### Discover (`DiscoverScreen.js`)

Same sibling-heart pattern on each `FlatList` row. `keyExtractor` stays
`item.id`. The recipe list / pagination / pull-to-refresh behavior from the
Recipes slice is untouched. The heart reads shared provider state — there is
**no** per-card favorites fetch.

### API Recipe Detail (`RecipeDetailScreen.js`)

Only `ApiRecipeDetail` gains a `FavoriteHeart` (in the existing top-right
button row, styled like the other overlay buttons). `LegacyRecipeDetail` keeps
its existing `SavedRecipesContext` heart, **untouched**. The `recipeSource`
navigation contract is unchanged.

### Saved (`SavedScreen.js`)

Fully migrated to `useFavorites()` — no `SavedRecipesContext`, no `mockData`,
no mock recipe lookup. Renders the favorite's nested recipe **summary** only
(`title`, `imageUrl` via `RecipeImage`, `recipeTimeLabel` from prep+cook, and a
`cuisine`/`difficulty` label). Featured + grid layout and the existing
empty-state copy/styling are preserved.

States:

- `loading` / `idle` with nothing loaded → centered spinner;
- `error` with nothing loaded → message + Retry (`reload()`);
- `ready` + empty → the existing "No saved recipes yet" empty state;
- `ready` + items → featured + grid;
- pull-to-refresh via `RefreshControl` → `reload()`;
- `useFocusEffect` → `reload()` on focus, to reconcile with server truth
  (generation-guarded, so it can't race the initial load).

No separate Saved infinite scroll — the screen renders the provider's complete
loaded set.

### Saved → Recipe Detail (cold navigation)

Opening a recipe from Saved navigates with **only**:

```js
navigation.navigate('RecipeDetail', { recipeSource: 'api', recipeId: recipe.id });
```

The favorite summary is **not** passed as `initialRecipe` (it is not a full
`PublicRecipe`). `ApiRecipeDetailContainer` performs the authoritative
`GET /api/v1/recipes/:recipeId` and shows its cold-entry spinner → content, or
its existing `404` "This recipe isn't available anymore." notice.

## Cross-screen consistency

One provider `Set` → every heart and the Saved list derive from it. An
optimistic mutation updates the provider synchronously, so:

- save Chicken Adobo in `ApiRecipeDetail` → back on Discover its card heart is
  filled → Saved includes it;
- remove it from Saved → its row disappears and the Dashboard / Discover /
  Recipe Detail hearts all become outline;
- on a real failure the provider rolls the change back everywhere at once.

Saved additionally refetches on focus to pick up server-side truth (e.g. a
recipe archived after it was favorited).

## Recipe availability

`GET /favorites` omits any favorite whose recipe has become archived/unusable,
so:

- the Saved screen never fabricates a card for an omitted recipe (it renders
  only entries the API returned, each with a real summary);
- a `reload()` can legitimately **reduce** the number of Saved items;
- UI counts use `favorites.length`, never `pagination.total`;
- opening a recipe that has since become unavailable still hits the existing
  `ApiRecipeDetail` `404` handling.

## Legacy `SavedRecipesContext` — intentionally retained

Not deleted, not redesigned, AsyncStorage key kept, `mockData.savedRecipeIds`
kept. It remains mounted (`App.js`) and is still used by `LegacyRecipeDetail`.
Cleanup is deferred to a later slice.

## Community / onboarding — deferred (unchanged)

`CommunityScreen` (recipe-tag picker, post-like state) and the onboarding
decorative hearts do not render an API recipe surface and are **not** wired to
`FavoritesProvider`. `CommunityContext` and `mockData` recipe-picker behavior
are unchanged.

## Shopping List — deferred (unchanged)

`ShoppingListContext` and all Shopping List behavior are untouched. This slice
makes no Shopping List API call and does not alter `RecipeDetail`'s local
"Add All to Shopping List".

## Error / loading / empty states

Reuses `ApiError` + a new `getFavoriteErrorMessage` (mirrors `recipeErrors.js`
/ `errorMessages.js`) — never surfaces raw backend bodies, stacks, DB
internals, or tokens.

| Condition | Handling |
| --- | --- |
| `409 FAVORITE_ALREADY_EXISTS` on add | treated as **saved** (success) — no rollback, no message |
| `404 FAVORITE_NOT_FOUND` on remove | treated as **unsaved** (success) — no rollback, no message |
| `404 RECIPE_NOT_FOUND` on add | roll back; "This recipe isn't available anymore." |
| `429 RATE_LIMIT_EXCEEDED` | roll back; "Too many requests. Please wait a moment and try again." |
| network failure | roll back; "Can't reach WeCooked. Check your connection and try again." |
| `500` / non-JSON | roll back; "WeCooked is having trouble right now. Please try again shortly." |
| session expiry | flows through the shared client's one refresh+retry, then `AuthContext` → `unauthenticated`; the provider clears; a mid-flight mutation is discarded |

## Validation

- `npm test --workspace=apps/api` — backend untouched; expected 556 pass / 0
  fail.
- `apps/mobile` Android export via the local Expo CLI (no `npx`, no new deps):
  `.\node_modules\.bin\expo.cmd export --platform android --output-dir "$env:TEMP\wecooked-mobile-favorites"`.

## Intentionally deferred

Shopping List API, Community backend, Recommendations, AI, Notifications,
profile/preferences persistence, Recipe mutations, Admin, backend changes,
removal of the API-vs-legacy navigation shim, and removal of the legacy mock
recipe/favorite infrastructure (`SavedRecipesContext`, `LegacyRecipeDetail`,
`mockData.savedRecipeIds`).