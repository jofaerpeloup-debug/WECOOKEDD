# Mobile ↔ REST API: Shopping List integration

Fourth mobile integration slice, after
[mobile-auth-session-integration.md](./mobile-auth-session-integration.md),
[mobile-recipes-integration.md](./mobile-recipes-integration.md), and
[mobile-favorites-integration.md](./mobile-favorites-integration.md). It replaces
the mobile app's temporary/local Shopping List behavior with the existing
authenticated Express Shopping List REST API (`apps/api`). See
[favorites-shopping-list.md](./favorites-shopping-list.md) for the backend domain
this consumes.

Target end state:

```
React Native / Expo  ->  mobile shopping list service  ->  Express REST /api/v1/shopping-list  ->  MongoDB
```

## Scope

**In:** a Shopping List REST service, safe error mapping, an API-backed
`ShoppingListProvider` (the single source of shopping-list truth), the Shopping
List screen migrated to backend data, Recipe Detail "Add All to Shopping List"
against the API, check/uncheck, remove item, clear list, quantity/unit/`toTaste`
rendering, per-user session isolation, loading / empty / error / refresh states,
this document.

**Out (deferred / unchanged):** a canonical Ingredient picker and any free-text
Shopping List items, servings-scaled recipe import, any `apps/api` change,
Community backend, Recommendations, AI, Notifications, profile/preferences
persistence, Admin, Recipe mutations, unit conversion. `apps/api`, `apps/admin`,
the auth/session foundation, and `FavoritesProvider` are untouched.

## REST layer (new files)

```
src/api/shoppingListService.js   getShoppingList() + addRecipe(recipeId) +
                                 updateItem(itemId, patch) + removeItem(itemId) +
                                 clearItems(). Uses the shared `api` client.
                                 No other mutation is wrapped. No manual addItem
                                 in this slice.
src/api/shoppingListErrors.js    getShoppingListErrorMessage(err) — ApiError ->
                                 short safe string (mirrors favoriteErrors.js).
                                 Plus isItemAlreadyGone(err).
src/context/ShoppingListContext.js   ShoppingListProvider + useShoppingList() —
                                 MIGRATED IN PLACE from local state to API-backed
                                 state. Still the same provider, same file, same
                                 mount position; internals fully replaced.
```

Data path (the only one for shopping-list state after this slice):

```
ShoppingListScreen / ApiRecipeDetail
  -> useShoppingList()  (ShoppingListProvider)
  -> shoppingListService
  -> api (src/api/client.js — shared, UNCHANGED)
  -> fetch  ->  /api/v1/shopping-list[...]  ->  MongoDB
```

Screens never call `fetch`, never import `client.js` directly, never touch the
token store. The shared client attaches the bearer access token and performs one
transparent refresh+retry on 401. **No** second fetch wrapper, base-URL layer,
token store, refresh mechanism, or auth context was introduced.

## Endpoints consumed

| Function | Endpoint | Method | Body | Notes |
| --- | --- | --- | --- | --- |
| `getShoppingList()` | `/api/v1/shopping-list` | GET | — | lazily upserts the caller's one list server-side → new users get `200` + `items: []`, never `404` |
| `addRecipe(recipeId)` | `/api/v1/shopping-list/recipes/:recipeId` | POST | **none** | no multiplier / servings; imports base-serving quantities |
| `updateItem(itemId, patch)` | `/api/v1/shopping-list/items/:itemId` | PATCH | `{ isChecked }` (this slice) | keyed by the shopping-list ITEM id |
| `removeItem(itemId)` | `/api/v1/shopping-list/items/:itemId` | DELETE | — | keyed by the ITEM id; idempotent on `404` |
| `clearItems()` | `/api/v1/shopping-list/items` | DELETE | — | idempotent |

Every endpoint (read and mutation) returns the full authoritative
`data.shoppingList`; the service unwraps to
`{ id, items, createdAt, updatedAt }`. Path ids are `encodeURIComponent`-wrapped.

## Ownership / IDOR (BOLA) protection

Ownership is **always** the authenticated backend identity (`req.auth.userId`,
derived from the DB-verified session in `authenticate.middleware.js`). The mobile
client:

- never sends a `userId` (body, query, or path) — `shoppingListService` only ever
  sends a `recipeId` / `itemId` path param and, for PATCH, `{ isChecked }`;
- never sends or uses a `shoppingListId` — there is no such param anywhere in the
  backend contract; the list is always the caller's single document;
- relies on backend per-user scoping: `PATCH`/`DELETE /items/:itemId` resolve the
  item on the caller's own list only, so a foreign `itemId` simply yields
  `404 SHOPPING_LIST_ITEM_NOT_FOUND`.

`role` / `admin` grants no cross-user access. There is no client-controlled
ownership surface. (Full audit: the read-only Shopping List audit on this
branch.)

## `ShoppingListContext` — migrated IN PLACE

`src/context/ShoppingListContext.js` keeps its name, its `useShoppingList()`
hook, and its mount position, but its internals are fully replaced: it is now the
**single** authoritative shopping-list state, backed only by the REST API. There
is **no** second provider.

Exposed by `useShoppingList()`:

```
list            // { id, items, createdAt, updatedAt } | null  (ownership-gated)
items           // list?.items ?? []                            (ownership-gated)
status          // 'idle' | 'loading' | 'ready' | 'error'
error           // last safe error string | null
isInitializing  // status === 'idle' || 'loading'
isReady         // status === 'ready'
isMutating      // a mutation (any of the below) is in flight
pendingAction   // { type: 'addRecipe'|'setChecked'|'removeItem'|'clear', itemId? } | null
isItemPending(itemId)
reload()                       // generation-guarded refetch (focus / pull-to-refresh)
addRecipe(recipeId)            // POST /recipes/:recipeId
setChecked(itemId, isChecked)  // PATCH /items/:itemId { isChecked }
removeItem(itemId)             // DELETE /items/:itemId
clear()                        // DELETE /items
```

Each mutation resolves to `{ ok: true }` or
`{ ok: false, error?, busy?, superseded?, idempotent? }` — the screen shows an
`Alert` only when `!ok && error`.

Provider mount (`App.js`, **unchanged**): still inside `AuthProvider` (so it can
observe auth), still wrapping `CommunityProvider`:

```
AuthProvider > FavoritesProvider > SavedRecipesProvider > ShoppingListProvider > CommunityProvider
```

`FavoritesProvider` / `SavedRecipesProvider` are untouched.

## Backend is the sole source of truth — no local storage

- The provider **does not** hydrate shopping-list state from AsyncStorage and
  **does not** write it there. The old `wecooked:shoppingList` key is **left in
  place** (not deleted in this slice — cleanup can follow once the migration is
  proven stable) but is **never read or written again**.
- Old local shopping-list content is **never** uploaded to the backend and
  **never** merged with backend data. `src/data/mockData.js` still exports an
  (now unused) empty `shoppingList` seed; it was not modified.
- `src/utils/storage.js` is unchanged.

## User / session isolation

Same proven design as `FavoritesProvider`. The provider derives
`authUserId = authStatus === 'authenticated' ? user.id : null` from `AuthContext`
(observed, never modified) and keys its lifecycle on it:

- **`sessionRef`** — bumped on every auth/user identity change. Every GET and
  every mutation captures the session it started under; a response from a
  superseded session is discarded and can never write state.
- **`listGenRef`** — bumped on every `reload()`/load **and** on every mutation.
  Only the newest GET applies its result, and a mutation's authoritative response
  always supersedes a GET that started before it. Deliberately **separate** from
  `sessionRef` so a focus/pull reload never looks like a session change and never
  strands a mutation.
- **Render-time ownership gate.** Loaded state carries `ownerId` (set in the same
  batch as the wipe). `items` is `[]` and `status` reads `loading` for any render
  where `ownerId !== authUserId`. `useEffect` runs *after* render, so the frame
  where `authUserId` has flipped but the clearing effect hasn't run yet renders
  empty rather than leaking User A's items under User B.
- **Synchronous wipe** in the auth effect: `list`, `pendingAction`, the mutation
  lock (`mutatingRef`) — all reset before any load starts; `ownerId` set to the
  new user.
- **Logout** (`authUserId → null`): the gate makes effective `items` `[]`
  immediately and `status` reads `idle`; the effect then wipes.
- **A→B switch**: the gate blanks the transitional frame, then the effect wipes A
  and loads B. An in-flight A request resolves into a superseded `sessionRef` and
  is dropped.
- **Startup restore**: while `AuthContext` is `restoring`, `authUserId` is `null`
  and the provider stays `idle`; once it resolves to `authenticated` the provider
  issues its first `GET /shopping-list` for that user. Nothing is persisted
  locally; SecureStore remains auth-token-only.

No `AuthContext` change was needed.

## Initial load / states

`GET /shopping-list` lazily upserts an empty list server-side, so there is **no**
client-side create operation. Provider states: `idle` (no session) → `loading`
(first GET) → `ready` (list in hand, possibly empty) → `error` (initial GET
failed, nothing to show). A failed **refresh** while a list is already shown
keeps the list and sets `error` (soft inline banner), it does not drop to
`error` status.

Screen:

| State | UI |
| --- | --- |
| initial loading | centered `ActivityIndicator` |
| `ready` + 0 items | "Your shopping list is empty. Add ingredients from a recipe." |
| initial error | message + Retry (`reload()`) |
| refresh failed, list shown | list stays; small tappable "… Tap to retry." banner |
| mutation in flight | the affected row shows a spinner; all rows + Clear disabled |

## Mutation serialization (one at a time)

The Shopping List is one Mongo document with embedded items. Two concurrent
`save()`s on it risk a Mongoose version conflict. The provider therefore
**serializes** all mutations:

- a **synchronous** `mutatingRef` lock — set before the request starts — means
  two taps that land before React re-renders still cannot issue two requests
  (the second returns `{ ok: false, busy: true }`, silently ignored);
- while any mutation is in flight: `isMutating` is `true`, the Shopping List
  screen disables every checkbox, every trash button, and Clear; Recipe Detail
  disables "Add All". `pendingAction` / `isItemPending(itemId)` still say which
  row/button should show a spinner.
- the lock is released in a `finally` **only when the mutation's own session is
  still current** (`session === sessionRef.current`). A mutation whose session
  changed mid-flight must not touch the lock — the auth effect already reset it,
  and a newer session's mutation may now legitimately hold it.
- **no queue** — one mutation at a time is sufficient for this UI.

## Mutation strategy (pessimistic)

```
user action -> mark pending -> call backend
            -> backend returns the COMPLETE shoppingList
            -> replace provider state with it -> clear pending
```

Nothing is fabricated locally before a request succeeds, so there is **no
rollback logic**. The one exception: a `DELETE /items/:itemId` that returns
`404 SHOPPING_LIST_ITEM_NOT_FOUND` is treated as **idempotently removed** — the
backend has confirmed the item is gone, so the provider drops exactly that item
from the current list with a pure self-guarding `setList` updater (independent of
the mutation-lock release timing), then kicks a best-effort `reload()` for full
reconciliation, and reports `{ ok: true }` rather than surfacing an error.

## GET vs mutation races

- `sessionRef` (auth) and `listGenRef` (GET/mutation) are independent.
- Only the newest GET may apply (`listGenRef` check in the load's `stale()`).
- A mutation bumps `listGenRef` at its start, so a GET that began earlier is
  discarded when it returns — the mutation's full-state response is authoritative.
- `reload()` is a **no-op while a mutation or another GET is already in flight**,
  so a focus/pull reload can never strand a mutation and overlapping GETs are
  avoided.
- An old user's mutation/GET response resolves into a superseded `sessionRef` and
  never applies to the new user.
- `isMutating` / `pendingAction` are cleared in a `finally`, so a session or
  generation change never leaves them stuck.

## Recipe → Shopping List ("Add All")

`ApiRecipeDetail` only. Calls `shoppingList.addRecipe(recipe.id)` →
`POST /api/v1/shopping-list/recipes/:recipeId` with **no body**. On success the
provider already holds the returned authoritative list; the screen shows brief
feedback and navigates to the List. On failure it stays on Recipe Detail and
shows a safe `Alert`. The button is `loading` while its own mutation runs and
`disabled` while any shopping-list mutation runs. It never dual-writes to local
state.

### Base-servings limitation (locked)

The backend recipe import does **not** support selected-serving scaling. If the
recipe's base servings are 4 and the user changes the on-screen servings stepper
to 8, "Add All" **still** imports base (4-serving) quantities. The mobile app
does **not** issue individual `POST /items` requests to simulate scaling and does
**not** multiply quantities client-side. The servings stepper still drives the
ingredient display and the Cook Mode hand-off. A note under the button states:
*"Adds ingredients for {recipe.servings} servings — the recipe's default.
Changing servings above only affects what's shown here."*

## Backend behavior the client relies on (not re-implemented)

- **Merge key = `ingredientId` + exact `unit`.** Same ingredient + same unit →
  quantities sum, the item keeps its array position, `isChecked` resets to
  `false`. Same ingredient + different unit → separate items. Two `toTaste` adds
  → one item, `quantity` stays `null`. **No unit conversion.** After `addRecipe`
  the client simply renders the returned list.
- **`toTaste`**: `unit: "toTaste"` always has `quantity: null`; rendered as
  "Name — to taste", never "null Name" / "0 toTaste".
- **Optional recipe ingredients**: the backend import includes *active* optional
  ingredient usages; the client does not filter them and does not duplicate
  recipe-usability logic.
- **Item cap**: 200 items after merge. `SHOPPING_LIST_LIMIT_EXCEEDED` →
  "Your shopping list is full (200 items). Remove some items first." The recipe
  import is atomic — the client never shows a partially-added list.

## Shopping List screen

`src/screens/ShoppingListScreen.js` renders `provider.items` in **backend array
order**. No `produce` / `pantry` / `dairy` / `recipeItems` buckets, no
`item.source` grouping — those fields do not exist in backend data.

Item shape: `{ id, ingredient: { id, name } | null, ingredientId, isAvailable,
quantity, unit, isChecked }`.

- **Available** item → primary line via the shared
  `ingredientPrimaryLine` helper ("1 kg Chicken", "Black Pepper — to taste").
- **Unavailable** item (`ingredient: null`, `isAvailable: false` — archived or
  deleted ingredient; the serializer exposes **no** historical name) → a safe
  generic label **"Unavailable ingredient"** + an "Unavailable" badge + a
  secondary amount line ("1 kg" / "to taste"). The raw `ingredientId` is **never**
  shown, and no other endpoint is called to re-resolve it. The row is still
  deletable.
- **check / uncheck** → `PATCH /items/:itemId { isChecked }`, pessimistic, per-item
  spinner, one mutation at a time. Setting the same value is a valid no-op.
- **remove** → `DELETE /items/:itemId` by the item id; `404` treated as already
  gone (reconcile via reload).
- **clear** → trash icon in the `TopBar` right slot → `Alert.alert` confirm
  (Cancel / Clear destructive) → `DELETE /items`. Disabled while empty or while
  any mutation is in flight. Idempotent.
- **pull-to-refresh** (`RefreshControl`) and **focus reload** (`useFocusEffect`)
  → `reload()` (generation-guarded, no-op during a mutation/GET).

## Manual free-text add — removed for this slice

The backend only accepts canonical ingredients (`POST /items` requires a valid
`ingredientId`); it has no free-text item field. The old "Add an item…"
`TextInput` (and its `newItem` state and local `addItem`) is **removed** from the
screen, along with wording implying manual text add is supported. No Ingredient
is ever invented from typed text, and no free-text data is kept locally.

### Canonical Ingredient picker — future work

`GET /api/v1/ingredients` (+ `?search=`) is available to any authenticated user
(not admin-only). A later focused slice can add a small `ingredientService.js`
and a canonical ingredient picker (search → pick → quantity → unit / `toTaste`)
that posts real `{ ingredientId, quantity, unit }` to `POST /items`. **No
backend change is required** for that; it is simply out of scope now.

## Legacy / mock Recipe Detail

`LegacyRecipeDetail` (mock ids `r1`, `r4`, … reached only via the explicit
`recipeSource` navigation contract — currently unreachable in the authenticated
app) **no longer offers "Add All to Shopping List"**. Its button, handler, and
`useShoppingList()` usage were removed, along with the now-dead string
measurement-parser helpers (`stripMeasurement` / `stripLeadingUnitWords` /
`MEASURE_UNITS`) they fed. Mock ids and mock ingredient strings can never reach
the Shopping List REST API, and there is no parallel local Shopping List kept for
legacy mode. API-vs-legacy is decided by the existing `recipeSource` flag, never
by id format.

## Error / loading / empty / refresh states

Reuses `ApiError` + a new `getShoppingListErrorMessage` (mirrors
`favoriteErrors.js` / `recipeErrors.js` / `errorMessages.js`) — never surfaces
raw backend bodies, stacks, DB internals, or tokens.

| Condition | Handling |
| --- | --- |
| `SHOPPING_LIST_LIMIT_EXCEEDED` (400) | "Your shopping list is full (200 items). Remove some items first." |
| `RECIPE_NOT_FOUND` (404) on Add All | "This recipe isn't available anymore." — stay on Recipe Detail |
| `SHOPPING_LIST_ITEM_NOT_FOUND` (404) on delete | silent success — drop that item locally + best-effort reload |
| `SHOPPING_LIST_ITEM_NOT_FOUND` (404) on patch | "That item is no longer on your list." |
| `SHOPPING_LIST_ITEM_ALREADY_EXISTS` (409) | "You already have that ingredient in that unit." *(not reachable — no unit editing this slice)* |
| `VALIDATION_ERROR` (400) | fixed "That request wasn't valid. Please try again." — no field-detail passthrough (this slice sends no user-typed content) |
| `RATE_LIMIT_EXCEEDED` (429) | "Too many requests. Please wait a moment and try again." |
| network failure | "Can't reach WeCooked. Check your connection and try again." |
| `500` / non-JSON | "WeCooked is having trouble right now. Please try again shortly." |
| session expiry | shared client's one refresh+retry, then `AuthContext` → `unauthenticated`; the provider clears; a mid-flight mutation is discarded |

## Validation

- `npm test --workspace=apps/api` — backend untouched; expected 556 pass / 0 fail.
- `apps/mobile` Android export via the local Expo CLI (no `npx`, no new deps):
  `.\node_modules\.bin\expo.cmd export --platform android --output-dir "$env:TEMP\wecooked-mobile-shopping-list"`.

## Intentionally deferred

Canonical Ingredient picker / free-text items, servings-scaled recipe import,
Community backend, Recommendations, AI, Notifications, profile/preferences
persistence, Recipe mutations, Admin, any `apps/api` change, deletion of the old
`wecooked:shoppingList` AsyncStorage key, and removal of the now-unused
`mockData.shoppingList` seed and the API-vs-legacy navigation shim.
