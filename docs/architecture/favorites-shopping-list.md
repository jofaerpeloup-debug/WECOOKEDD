# Favorites & Shopping List

This document covers what Phase 5 (`feat/favorites-shopping-list`) actually
implements in `apps/api`: the `Favorite` and `ShoppingList` domains, both
private, user-owned resources. See
[docs/architecture/backend.md](./backend.md) for the layered request-flow/
module conventions this feature follows, and
[docs/architecture/recipes.md](./recipes.md) /
[docs/architecture/ingredients-substitutions.md](./ingredients-substitutions.md)
for the `Recipe`/`Ingredient` modules it builds on.

## Modules

- `src/modules/favorites/` — the `Favorite` model plus the same
  repository/service/controller/routes/serializer/validation layer set used
  by every other module.
- `src/modules/shopping-lists/` — the `ShoppingList` model plus the same
  layer set.
- `FavoriteService` calls `RecipeService` only; it never imports
  `recipe.model.js` or `recipe.repository.js` directly.
- `ShoppingListService` calls `IngredientService` and `RecipeService` only;
  it never imports `ingredient.model.js`/`ingredient.repository.js` or
  `recipe.model.js`/`recipe.repository.js` directly — the same cross-module
  boundary rule as every other module in `backend.md`.

## Ownership

Both domains are strictly private to the authenticated caller:

- Every route requires `authenticate`.
- Ownership always comes from `req.auth.userId` — a client-supplied
  `userId` (body, query, or param) is never read or accepted anywhere in
  either module.
- `role` (including `admin`) grants no special access to another user's
  favorites or shopping list — an admin uses these features as an ordinary
  user, scoped to their own `req.auth.userId` like anyone else. There is no
  `authorize()` middleware on any Favorites/ShoppingList route.

## Favorites

### Why a separate collection instead of an array on User

A `Favorite` is a `User -> Recipe` relationship, stored as its own
collection (`src/modules/favorites/favorite.model.js`) rather than an array
embedded in `User`:

- Two independent users may each favorite the same recipe — an embedded
  array on `User` models this fine, but a separate collection makes the
  relationship queryable from either side (and from an admin/analytics
  angle later) without scanning every `User` document.
- A favorite has no fields of its own beyond the `(userId, recipeId)` pair
  and a timestamp — exactly what a dedicated relationship collection is for.

### Schema

```json
{
  "userId": "<ObjectId, ref User, required>",
  "recipeId": "<ObjectId, ref Recipe, required>",
  "createdAt": "...",
  "updatedAt": "..."
}
```

A unique compound index on `{ userId: 1, recipeId: 1 }` prevents the same
user from favoriting the same recipe twice, while leaving two different
users free to favorite the same recipe independently. A second index on
`{ userId: 1, createdAt: -1 }` backs the per-user `newest`/`oldest` list
sort.

### Deletion semantics

Favorites are ephemeral relationship data, not a domain entity in their own
right — `DELETE /favorites/:recipeId` **physically removes** the `Favorite`
document (`favorite.repository.js#deleteByUserAndRecipe`). There is no
`isActive`/soft-archive field on `Favorite`, unlike `Recipe`/`Ingredient`/
`Substitution`.

Deletion never calls `RecipeService` — it only touches the `Favorite`
collection — so removing a favorite always succeeds even when the
referenced `Recipe` has since become archived or otherwise unusable.

### Adding a favorite: Recipe usability

`POST /favorites/:recipeId` resolves the recipe through
`RecipeService.findUsableRecipeById` (a small cross-module extension added
in this phase — see below) before creating the `Favorite`:

- An unknown recipe id, or a recipe that exists but is currently archived
  or otherwise unusable for an ordinary user, is rejected with
  `404 RECIPE_NOT_FOUND` — a favorite can never be newly created against a
  recipe an ordinary user couldn't otherwise view.
- A duplicate `(userId, recipeId)` pair is rejected with
  `409 FAVORITE_ALREADY_EXISTS`, translated from the unique index's
  MongoDB `E11000` error the same way `IngredientService`/
  `SubstitutionService` translate their own duplicate-key errors.

### `RecipeService.findUsableRecipeById` (new in this phase)

`RecipeService` already had `getRecipeById(id, { isAdmin })`, which throws
`404` for an HTTP-facing caller, and `findRecipeById(id)`, a raw
(unfiltered) lookup for trusted internal use. Neither fit a cross-module
caller that needs a **non-throwing, already-usability-filtered** lookup, so
this phase adds:

```js
// recipe.service.js
async function findUsableRecipeById(id) {
  const recipe = await recipeRepository.findByIdWithIngredients(id);
  if (!recipe || !isUsableForNonAdmin(recipe)) {
    return null;
  }
  const view = toNonAdminView(recipe);
  return { ...view, ingredients: view.ingredients.map(toUsageSummary) };
}
```

It reuses the exact same `isUsableForNonAdmin`/`toNonAdminView` logic
`getRecipeById` already uses (see `recipes.md` for the full archived-
ingredient-visibility rules), just returning `null` instead of throwing —
and only for a genuine domain condition (recipe missing/archived/unusable).
An unexpected repository/database failure is never caught here; it
propagates like any other rejected promise, up through `FavoriteService`/
`ShoppingListService` (neither of which catch it either) to the central
error handler as a `500` — it must never be reinterpreted as "recipe
unavailable."

Each ingredient usage is additionally mapped through `toUsageSummary` to a
plain, stable `{ ingredient: { id, name }, quantity, unit, optional }`
shape — deliberately **not** the internal `{ ingredientId: <populated ref> }`
field name `Recipe.ingredients` uses for its own HTTP-serialization
pipeline (`recipe.serializer.js`). This keeps the cross-module contract
decoupled from how `Recipe` happens to represent a populated `Ingredient`
reference internally, so `ShoppingListService`'s recipe import
(`addRecipeIngredients`) depends only on `usage.ingredient.id`, never on a
raw Mongoose populate detail — reinforcing "do not expose Recipe
persistence internals" for both `FavoriteService` and `ShoppingListService`.

Both `FavoriteService` and `ShoppingListService` call this method — never
`recipe.model.js`/`recipe.repository.js` directly.

### If a favorited Recipe later becomes unusable

Archiving a `Recipe` (or archiving one of its required ingredients) never
cascades into the `Favorite` collection — no transactions, no batch
updates, the same trade-off already documented for `Substitution`/`Recipe`
themselves. Instead:

- The `Favorite` relationship is kept as-is.
- `GET /favorites` resolves each favorite's recipe through
  `findUsableRecipeById` and **omits** any favorite whose recipe is no
  longer usable, rather than presenting stale/unusable recipe data.
- `DELETE /favorites/:recipeId` still works regardless (see above) — a user
  must always be able to un-favorite something, even something that's no
  longer visible anywhere else.

**Pagination caveat (same shape as `recipes.md`/
`ingredients-substitutions.md`):** `GET /favorites`'s `pagination.total`/
`totalPages` are computed from the `Favorite` collection alone, *before*
the per-recipe usability filter runs. The returned `favorites` array itself
is always safe — no unusable recipe is ever included — but the total can
overstate how many favorites are currently visible, and a page can come
back with fewer than `limit` entries in the rare case a favorited recipe
became unusable after the count was taken.

### Favorite endpoints

```
GET    /api/v1/favorites            authenticated — current user's favorites
POST   /api/v1/favorites/:recipeId  authenticated — add a favorite
DELETE /api/v1/favorites/:recipeId  authenticated — remove a favorite
```

`GET` query params: `page` (default 1), `limit` (default 20, max 100),
`sort` (`newest` default, or `oldest`) — the same pagination convention as
every other list endpoint in this API.

### Favorite response shape

```json
{
  "id": "<favoriteId>",
  "recipe": {
    "id": "<recipeId>",
    "title": "Chicken Adobo",
    "region": null,
    "category": null,
    "difficulty": "easy",
    "prepTimeMinutes": 15,
    "cookTimeMinutes": 40,
    "imageUrl": null
  },
  "createdAt": "..."
}
```

Only the fields a mobile favorites screen needs are exposed
(`favorite.serializer.js#toFavoriteRecipeSummary`) — never the recipe's
ingredients/instructions, `userId`, or any Mongoose internals.

## Shopping List

### One list per user, embedded items

`ShoppingList` uses one document per `User` (`src/modules/shopping-lists/
shopping-list.model.js`), with items embedded rather than a separate
`ShoppingListItem` collection:

- Every list belongs to exactly one user.
- List mutations (add/merge/patch/remove/clear/import) normally touch one
  document, which MongoDB updates atomically — no multi-document
  transaction is needed anywhere in this module.
- Item count is bounded (200 max, see below), so the embedded array never
  approaches MongoDB's document-size limit in practice.

A unique index on `{ userId: 1 }` enforces "at most one list per user" at
the database level. `GET`/every mutation lazily creates the caller's list
via an **upsert** (`findOneAndUpdate` with `$setOnInsert` +
`upsert: true`), so a first-ever request and a later request return the
same shape (`{ id, items, createdAt, updatedAt }`) regardless of whether
the document already existed — and the unique index means a race between
two concurrent first requests still resolves to exactly one persisted
document rather than two.

The upsert is the primary defense, but MongoDB can still surface a raw
duplicate-key error from the upsert call itself in the rare case two
first-time requests for the same user race each other at the storage-engine
level. `shopping-list.repository.js#findOrCreateByUserId` catches exactly
that (`err.code === 11000`) and falls back to a plain `findOne({ userId })`
to read the document the winning request just created, rather than letting
a raw duplicate-key failure surface as a `500` to the loser. This is a
single fallback read, not a general-purpose retry loop — any other error
(or a fallback `findOne` that unexpectedly finds nothing) still propagates
as-is.

No unnecessary indexes are added on the embedded `items` array — normal
lookup always starts from the authenticated user's single, unique list, so
there's nothing per-item to index.

### Embedded item shape

```json
{
  "_id": "<itemId>",
  "ingredientId": "<ObjectId, ref Ingredient, required>",
  "quantity": 2,
  "unit": "piece",
  "isChecked": false
}
```

Unlike `Recipe.ingredients` (which uses `{ _id: false }`, since entries are
never addressed individually), each `ShoppingList` item keeps its own
`_id` because `PATCH`/`DELETE /shopping-list/items/:itemId` address one
item directly.

### Shared measurement-unit constant

`quantity`/`unit` use the **same** unit system as `Recipe.ingredients` — no
second, conflicting unit enum. Rather than have `ShoppingList` import
`Recipe.model.js` just to reach its `UNITS` constant (a real cross-module
coupling at the model layer, and exactly the kind of dependency
`ShoppingListService` is barred from taking on `Ingredient`), the constant
and its cross-field validation were extracted in this phase to
`src/shared/constants/measurement-units.js`:

- `UNITS` — the same 15-value enum (`g`, `kg`, `ml`, `l`, `tsp`, `tbsp`,
  `cup`, `piece`, `clove`, `slice`, `can`, `pack`, `bunch`, `pinch`,
  `toTaste`) Phase 4 defined.
- `isPositiveFiniteNumber` / `validateQuantityForUnit` — the exact
  quantity/unit cross-field rule `recipe.model.js` already used in its
  embedded-ingredient `pre('validate')` hook.

`recipe.model.js` now imports from this shared module and re-exports
`Recipe.UNITS` unchanged (so nothing importing `Recipe.UNITS` needed to
change), and `shopping-list.model.js#shoppingListItemSchema` uses the exact
same `UNITS` enum and `validateQuantityForUnit` hook. This is the smallest
refactor that gives both schemas one source of truth instead of two unit
systems that could drift apart — no new configuration/DI layer was added.

`toTaste` semantics are identical to `Recipe.ingredients`: `unit ===
"toTaste"` requires `quantity` to be absent (omitted or explicitly `null`,
both normalized to "field absent" before storage); every other unit
requires `quantity` to be a finite number greater than zero. This is
enforced at the Mongoose layer (the shared hook) and, for requests that can
see the resulting state ahead of time, at the Zod boundary too (`POST
/shopping-list/items`). A `PATCH`, which can change `unit` without
re-supplying `quantity`, additionally validates the **resulting prospective
item** in `shopping-list.service.js` — see PATCH semantics below, since
Zod alone can't see the item's current stored state.

### Merge key: ingredientId + unit

A list should not accumulate duplicate entries when quantities are
directly compatible. The merge key used everywhere in this module —
manual add, PATCH-driven unit changes, and recipe import — is
**`ingredientId` + `unit`**:

- Same ingredient, same unit → quantities are summed into the existing
  item, and `isChecked` is reset to `false` (there's new shopping work to
  do — an already-checked-off item shouldn't silently stay checked once
  more is needed).
- Same ingredient, different unit → kept as **two separate items**. No
  unit conversion is attempted in this phase — `0.5 cup` and `2 tbsp` of
  soy sauce stay two line items, exactly as the Phase 5 brief specifies.
  Converting between units (`cup`↔`tbsp`, `kg`↔`g`, `ml`↔`l`, …) is
  explicitly out of scope; see "Explicitly out of scope" below.
- Same ingredient, both `toTaste` → deduplicated into a single item (there
  is no numeric quantity to sum, so a second `toTaste` add is a no-op
  merge beyond resetting `isChecked`).

This merge logic lives in one place
(`shopping-list.service.js#mergeItemInto`), shared by `addItem` (manual
add) and `addRecipeIngredients` (recipe import) — both mutate the same
live Mongoose `items` `DocumentArray` in memory, then a single `save()`
persists the result.

### 200-item limit

Bounded in the service/domain layer — `shopping-list.service.js#assertWithinLimit`
throws `400 SHOPPING_LIST_LIMIT_EXCEEDED` whenever the *post-merge* item
count would exceed `ShoppingList.MAX_ITEMS` (200), for both a manual add
and a recipe import (checked once, against the fully-merged result, not
per ingredient usage). The schema itself also carries a redundant
`items.length <= MAX_ITEMS` validator as a defense-in-depth safety net —
the same pattern as `Recipe.MAX_INGREDIENTS`/`Ingredient.MAX_ALIASES` — but
the primary, user-facing enforcement (with a stable error code) is the
service-layer check, deliberately not a reliance on MongoDB's document-size
limit.

### PATCH semantics

`PATCH /shopping-list/items/:itemId` is strict and partial — `quantity`,
`unit`, and `isChecked` are the only allowed fields (never `ingredientId`;
changing which ingredient an item refers to is delete-then-add, not a
PATCH). The Zod schema rejects an empty body and unknown fields, but the
deeper rule — **the resulting item, not each field in isolation, must be
valid** — can only be checked in `shopping-list.service.js#patchItem`,
since it depends on the item's current stored state:

- Switching to `toTaste` requires the *resulting* quantity to be
  `null`/omitted — if the item currently has a positive quantity and the
  request doesn't also clear it (`quantity: null`), the request is
  rejected with `400 VALIDATION_ERROR` rather than silently dropping the
  stale quantity. This mirrors the invariant enforced everywhere else in
  this module: a valid `toTaste` item never carries a quantity.
- Switching away from `toTaste` requires a positive `quantity` to be
  supplied in the same request — a `PATCH { "unit": "piece" }` against a
  `toTaste` item with no quantity is rejected the same way.
- Changing `unit` (and only changing `unit`) is checked against every
  other item's `ingredientId`+`unit` key: if the new key would collide
  with an existing different item, the request is rejected with
  `409 SHOPPING_LIST_ITEM_ALREADY_EXISTS` rather than silently merging the
  two during a PATCH — a merge is something `POST /items` or
  `POST /recipes/:recipeId` do explicitly and predictably, not a PATCH
  side effect.

### Stale/archived Ingredient representation

Archiving (or otherwise removing) an `Ingredient` never cascades into
`ShoppingList` documents — the exact same "no cascade, filter/represent at
read time" trade-off as `Recipe`/`Substitution`. A list item can therefore
end up referencing an `Ingredient` that's since become inactive or been
deleted outright. `shopping-list.repository.js` deliberately **never
populates** `items.ingredientId` — populating would silently replace a
dangling reference with `null`, losing the raw historical id the safe
response shape needs. Instead, `shopping-list.service.js#resolveIngredientsById`
resolves each item's `ingredientId` through `IngredientService` (batched,
by unique id — the same `Promise.all` pattern `RecipeService.assertIngredientsActive`
uses) and the serializer combines the two:

```json
{
  "id": "<itemId>",
  "ingredient": null,
  "ingredientId": "<historical id>",
  "isAvailable": false,
  "quantity": 2,
  "unit": "piece",
  "isChecked": false
}
```

```json
{
  "id": "<itemId>",
  "ingredient": { "id": "...", "name": "Garlic" },
  "ingredientId": "...",
  "isAvailable": true,
  "quantity": 3,
  "unit": "clove",
  "isChecked": false
}
```

`ingredientId` is always the item's own stored value — never derived from
the (possibly missing) resolved `Ingredient` — so a stale reference still
reports which ingredient it used to point at. `isAvailable` is `true` only
when the `Ingredient` still exists **and** is active; an archived-but-
still-existing `Ingredient` and a deleted-outright one both read as
`isAvailable: false, ingredient: null`, indistinguishable to the client
(the historical id is the only trace left).

A user can always remove a stale item (`DELETE /shopping-list/items/:itemId`
never calls `IngredientService`), but a **new** add (`POST /items` or a
recipe import) always requires the referenced `Ingredient` to currently be
active — staleness is only ever inherited from history, never newly
created. Admins have no bypass here: Shopping List is a personal end-user
feature with no admin-only view.

### Recipe-to-shopping-list import

`POST /shopping-list/recipes/:recipeId` resolves the recipe through
`RecipeService.findUsableRecipeById` — the same method `FavoriteService`
uses — and merges its already-usability-filtered ingredient usages into
the current user's list:

- An archived or otherwise unusable recipe is rejected with
  `404 RECIPE_NOT_FOUND`, before touching the `ShoppingList` at all.
- Every usage `RecipeService` returns is trusted as-is — required
  ingredient usages are guaranteed active (or the whole recipe would have
  been rejected), and an archived *optional* usage has already been
  dropped by `RecipeService`'s own non-admin view (see `recipes.md`), so it
  never reaches `ShoppingListService` in the first place. `ShoppingListService`
  does not independently re-check ingredient activity for an import — that
  would duplicate a check `RecipeService` already made, and would require
  importing `Ingredient` internals it has no business touching.
- Each usage is merged into the list with the exact same `ingredientId` +
  `unit` key described above — same-unit usages combine, different-unit
  usages of the same ingredient stay separate, and a `toTaste` usage
  deduplicates the normal way.
- The entire import is applied to the one in-memory `ShoppingList`
  document and saved **once** (`shoppingListRepository.save`), not once
  per ingredient usage — there's no multi-document transaction because
  it's a single document either way.
- The 200-item limit is enforced once, against the fully-merged result.

No serving-size scaling, unit conversion, or AI-based quantity estimation
happens here — those are explicitly out of scope for this phase (see
below).

### Shopping list endpoints

```
GET    /api/v1/shopping-list                 authenticated — current user's list (lazy create)
POST   /api/v1/shopping-list/items           authenticated — manually add an ingredient (merges)
PATCH  /api/v1/shopping-list/items/:itemId   authenticated — edit quantity/unit/isChecked
DELETE /api/v1/shopping-list/items/:itemId   authenticated — physically remove one item
DELETE /api/v1/shopping-list/items           authenticated — clear every item
POST   /api/v1/shopping-list/recipes/:id     authenticated — import a recipe's usable ingredients
```

### Shopping list response shape

```json
{
  "id": "...",
  "items": [
    { "id": "...", "ingredient": { "id": "...", "name": "Chicken" }, "ingredientId": "...", "isAvailable": true, "quantity": 1, "unit": "kg", "isChecked": false },
    { "id": "...", "ingredient": { "id": "...", "name": "Black Pepper" }, "ingredientId": "...", "isAvailable": true, "quantity": null, "unit": "toTaste", "isChecked": false }
  ],
  "createdAt": "...",
  "updatedAt": "..."
}
```

Every mutation endpoint returns this same full, current-state shape (not a
bespoke per-endpoint response) so the client always has the authoritative
post-mutation list — important here specifically because merge results
(the resulting summed quantity, or which items combined) are otherwise not
derivable from the request alone. `userId`, `normalizedName`, and `__v` are
never exposed.

## Indexes

- `Favorite`: unique `{ userId: 1, recipeId: 1 }` (prevents double-
  favoriting); `{ userId: 1, createdAt: -1 }` (list sort).
- `ShoppingList`: unique `{ userId: 1 }` (one list per user). No indexes on
  embedded `items` — lookup always starts from the unique per-user
  document.

## Error codes

| Code | Status | Meaning |
| --- | --- | --- |
| `FAVORITE_ALREADY_EXISTS` | 409 | The current user already favorited this recipe |
| `FAVORITE_NOT_FOUND` | 404 | No favorite for this recipe belongs to the current user |
| `SHOPPING_LIST_ITEM_NOT_FOUND` | 404 | No item with this id on the current user's list |
| `SHOPPING_LIST_ITEM_ALREADY_EXISTS` | 409 | A PATCH's unit change would collide with another item's ingredientId+unit |
| `SHOPPING_LIST_LIMIT_EXCEEDED` | 400 | The post-merge item count would exceed 200 |
| `RECIPE_NOT_FOUND` | 404 | Reused from Recipes — unknown, archived, or otherwise unusable recipe |
| `INGREDIENT_NOT_FOUND` | 404 | Reused from Ingredients — unknown ingredient referenced by a new item |
| `INGREDIENT_INACTIVE` | 400 | Reused from Ingredients — archived ingredient referenced by a new item |
| `VALIDATION_ERROR` | 400 | Zod boundary failure, or a PATCH's resulting quantity/unit combination is invalid |

All of the above are raised as `AppError`s and pass through the existing
central `error.middleware.js` unchanged — no new error-handling
infrastructure was introduced for this phase.

## Explicitly out of scope for Phase 5

Per the Phase 5 brief: recommendations, AI/OpenAI integration, unit
conversion, notifications, Google Sign-In, email verification, password
reset, mobile/admin frontend integration, image uploads, and Firebase
changes are all deliberately not implemented here. The merge-key design
(`ingredientId` + `unit`, no conversion) and the `Recipe`-referencing
`ingredientId` shape on both `Favorite` and `ShoppingList` items exist
specifically so unit conversion and recipe-aware recommendations have
something to build on later without another schema migration.