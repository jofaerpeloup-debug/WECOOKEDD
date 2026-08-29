# Mobile ↔ REST API: manual Shopping List add (canonical ingredients)

Follow-up slice to
[mobile-shopping-list-integration.md](./mobile-shopping-list-integration.md). It
adds a way to put a **single canonical ingredient** on the Shopping List by hand,
without recipes — using the ingredient catalog
([ingredients-substitutions.md](./ingredients-substitutions.md)) and the existing
`POST /api/v1/shopping-list/items` contract
([favorites-shopping-list.md](./favorites-shopping-list.md)).

The pre-integration mobile app had a free-text "Add an item" bar that wrote
local-only strings. That was removed on purpose and is **not** restored: the
backend Shopping List only stores references to real `Ingredient` documents.

```
IngredientPickerModal
  -> ShoppingListContext.addItem()      (provider — one mutation at a time)
  -> runMutation(...)                   (existing lock / session / pessimism)
  -> shoppingListService.addItem()
  -> api (src/api/client.js — shared, UNCHANGED)
  -> POST /api/v1/shopping-list/items   ->  MongoDB
```

## Scope

**In:** a read-only canonical ingredient search service + error mapper, a
`shoppingListService.addItem()` wrapper, a thin `ShoppingListContext.addItem()`
mutation, an `IngredientPickerModal` (RN `Modal`, no navigation screen), an
in-content "Add item" affordance on the Shopping List screen, this document.

**Out (unchanged):** every backend module, `apps/admin`, auth/session,
Favorites, Recipes, `package.json` / `package-lock.json`. No unit conversion, no
free-text items, no local-only items, no optimistic/local merge, no servings
scaling, no quantity/unit **editing** of existing items (still add + remove
only).

## New / changed files

```
src/api/ingredientService.js     NEW  searchIngredients({ search, limit }) ->
                                      GET /api/v1/ingredients. Trims `search`,
                                      never sends `status`, caps `limit` at 100,
                                      normalizes to { id, name, category, aliases }.
src/api/ingredientErrors.js      NEW  getIngredientErrorMessage(err) — ApiError
                                      -> short safe string (mirrors recipeErrors).
src/components/IngredientPickerModal.js
                                 NEW  RN Modal: debounced search, unit picker,
                                      quantity field, "to taste", Add button.
src/api/shoppingListService.js   MOD  + addItem({ ingredientId, unit, quantity }).
src/context/ShoppingListContext.js
                                 MOD  + addItem() — runMutation({ type:'addItem' }).
                                      Exposed on the provider value.
src/screens/ShoppingListScreen.js
                                 MOD  "Add item" affordance + hosts the modal;
                                      empty-state copy updated.
src/api/shoppingListErrors.js    MOD  VALIDATION_ERROR comment only.
```

## Canonical ingredient lookup

`GET /api/v1/ingredients` is `authenticate`-only (no admin gate). For a normal
user it returns **active ingredients only** — asking for `status=inactive|all`
is a `403`, so the mobile client never sends `status` at all. `search` is
matched by the backend as an **escaped, case-insensitive substring** over
`name` and `aliases`; `pagination.total` is exact (same filter as the page
query).

`searchIngredients()`:

- trims `search`; a blank / whitespace-only query is never sent (`search=""`
  is a `400`) — the modal also skips the call for an empty box;
- clamps `limit` to `1..100` (backend cap), default `20`;
- returns `{ ingredients: [{ id, name, category, aliases }], pagination }` and
  drops any entry missing an `id` or `name`. Nothing is fabricated.

### Search race protection (modal)

Mirrors `DashboardScreen`'s recipe search:

| Guard | Mechanism |
| --- | --- |
| keystroke storms | 300 ms debounce (`setTimeout` cleared on change) |
| out-of-order responses | `searchGenRef` monotonic counter — a response with `gen !== searchGenRef.current` is dropped |
| modal closed / query cleared mid-flight | same generation bump on `!visible || !trimmed` |
| component unmount | `mountedRef` checked before every `setState` |
| stale results after query change | results only replaced by the response whose `gen` is still current; error path clears results |

No debounce dependency is added — plain `setTimeout`, like the rest of the app.

## Manual-add backend contract

`POST /api/v1/shopping-list/items`, body schema is `.strict()`:

| unit | body sent | notes |
| --- | --- | --- |
| measurable (`g`, `kg`, `ml`, `l`, `tsp`, `tbsp`, `cup`, `piece`, `clove`, `slice`, `can`, `pack`, `bunch`, `pinch`) | `{ ingredientId, unit, quantity }` | `quantity` is a finite JS **number** `> 0` — the backend does **not** coerce strings, so the raw `TextInput` value is `Number()`-parsed and validated first |
| `toTaste` | `{ ingredientId, unit }` | `quantity` is **omitted** — sending any quantity (even a stale one) is a `400` |

Ownership is always `req.auth.userId` (from the DB-verified session). The client
**never** sends `userId` or `shoppingListId` — there is no such concept in the
service, and `.strict()` would reject them anyway.

Backend behavior reused as-is:

- **merge** by `ingredientId` + exact `unit`: a measurable re-add **sums**
  `quantity` and resets `isChecked`; a `toTaste` re-add is a no-op beyond the
  `isChecked` reset. Array position is preserved.
- ingredient must exist and be active → else `INGREDIENT_NOT_FOUND` (404) /
  `INGREDIENT_INACTIVE` (400).
- 200-item cap → `SHOPPING_LIST_LIMIT_EXCEEDED` (400), nothing saved.
- the response is the **complete** authoritative shopping list, same shape as
  every other shopping-list endpoint.

## Provider path — why `addItem` is safe

`ShoppingListContext.addItem()` is a **thin** `runMutation({ type: 'addItem' },
() => shoppingListService.addItem(...))` wrapper. It adds **no** new state, lock,
or session logic — it inherits everything the existing mutations use:

- **one mutation at a time** — `runMutation` sets the synchronous `mutatingRef`
  lock *before* any `await`; a second call (double-tap, or an add while a
  check/remove/clear is running) returns `{ busy: true }` and issues no request.
- **cannot race `reload()`** — `reload()` no-ops while `mutatingRef` or a GET is
  in flight, and `addItem` bumps `listGenRef` so any GET that started earlier is
  discarded when it returns.
- **cannot overwrite newer state** — pessimistic: state is replaced *only* with
  the full list the backend returns, and only after a `session === sessionRef`
  check. A response that arrives after an auth-identity change returns
  `{ superseded: true }` and touches nothing.
- **cannot unlock another user's mutation** — the lock is released in a
  `finally` **guarded by `session === sessionRef.current`**; a stale add
  resolving after a user switch never clears the new user's lock.
- **no AsyncStorage, no local merge** — nothing is written locally before the
  request succeeds, so there is no rollback path.

The modal calls **`onAdd` (wired to the provider)** and never
`shoppingListService.addItem` directly — a direct call would bypass all of the
above.

## Quantity / unit / "to taste" rules (modal)

- A unit is **required** — no measurable unit is auto-selected. `Add to list`
  stays disabled until an ingredient *and* a unit are chosen.
- Selecting `toTaste` clears the quantity state and hides the quantity field;
  submit sends `{ ingredientId, unit: 'toTaste' }`.
- For any other unit the quantity field is shown and must parse (via
  `Number(value.replace(',', '.'))`) to a finite number `> 0`; otherwise a
  client-side message is shown and no request is made.
- Errors: client validation → inline text; provider/backend failure →
  `result.error` (already mapped by `getShoppingListErrorMessage`); `busy` →
  "Another change is still saving…" and the modal stays open; `ok` /
  `superseded` → modal closes.

## UX

- Shopping List screen: a dashed **"Add item"** button at the top of the list,
  shown both when the list has items and when it is empty (empty-state copy
  updated to "Add an ingredient above, or add everything from a recipe"). It is
  disabled while any mutation is in flight, consistent with the rows and Clear.
- The `TopBar` back-mode right slot is already the **Clear** action — manual add
  is deliberately **not** a second top-bar icon.
- The picker is an RN `Modal` (`animationType="slide"`, `KeyboardAvoidingView`),
  the same primitive `TopBar` / `ProfileScreen` already use. No new screen, no
  route, no `RootNavigator` change.

## Non-idempotent retry limitation

`POST /shopping-list/items` is **not idempotent** for measurable quantities
(re-adding sums). The shared client's single transparent refresh+retry is safe
(a `401` is rejected before the controller runs). But if a request **succeeds**
server-side and its response is lost (connection drop), a user who deliberately
taps **Add** again will merge the quantity a second time (e.g. `200 g` →
`400 g`). This is the same at-least-once property the existing "Add All from
recipe" already has. This slice does **not** invent client-side idempotency
keys; the mitigations are the merge semantics (no duplicate rows) and add +
remove being the recovery path.

## Validation

- `npm test --workspace=apps/api` — backend untouched; expected **556 pass /
  0 fail**.
- `apps/mobile` Android export via the local Expo CLI (no `npx`, no new deps):
  `.\node_modules\.bin\expo.cmd export --platform android`.

## Intentionally deferred

Quantity/unit editing of existing items, ingredient detail (category/allergen)
in the picker, recent/frequent ingredient shortcuts, servings-scaled import,
and every item already listed as deferred in
[mobile-shopping-list-integration.md](./mobile-shopping-list-integration.md).