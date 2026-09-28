# Recipes

This document covers what Phase 4 (`feat/recipes`) actually implements in
`apps/api`: the `Recipe` domain, which references canonical `Ingredient`
documents from Phase 3. See [docs/architecture/backend.md](./backend.md) for
the layered request-flow/module conventions this feature follows, and
[docs/architecture/ingredients-substitutions.md](./ingredients-substitutions.md)
for the `Ingredient`/`Substitution` modules it builds on.

## Module

- `src/modules/recipes/` — the `Recipe` model plus the same
  repository/service/controller/routes/serializer/validation layer set used
  by every other module.
- `RecipeService` calls `IngredientService` only; it never imports
  `ingredient.model.js` or `ingredient.repository.js` directly, matching the
  cross-module boundary rule in `backend.md`.

## Philippine focus — `region` and `category`, no `cuisine`

WeCooked is focused on Philippine food. The Recipe domain classifies a dish
by an optional Philippine **`region`** and an optional **`category`**, both
stored as conservative canonical slugs (see `shared/validation/slug.js`).
There is **no controlled vocabulary yet** — a future content milestone
establishes the canonical `region` / `category` values; until then any valid
slug is accepted and legacy recipes may have neither field.

**`cuisine` was retired from the Recipe domain in M3** (`feat/recipe-schema-m3`).
It is not part of the model, the create/update input, the list query, or the
public response. A create/update/query request that still sends `cuisine` is
rejected with `400 VALIDATION_ERROR` by the strict schema. Documents created
before M3 may still physically carry a `cuisine` property in MongoDB — the
serializer never reads it, and no destructive migration unsets it. `cuisine`
is **never** derived from anything, and `region` / `category` are **never**
derived from `cuisine`, the title, or ingredient content.

Test fixtures use Filipino dishes (Chicken Adobo, Sinigang na Baboy, Tinolang
Manok, Pancit Bihon) as realistic examples.

## Recipe schema

- `title` — required, trimmed, internal whitespace collapsed to single
  spaces (`RecipeService#collapseWhitespace`), max 150 characters.
  **Deliberately not unique** — two recipes may share a title (e.g. two
  different "Chicken Adobo" variations), unlike `Ingredient.name`.
- `description` — required, trimmed, max 2000 characters.
- `region` — **optional** Philippine-region slug. Trimmed, lowercased,
  internal whitespace/underscores collapsed to single hyphens, must match
  `^[a-z0-9]+(?:-[a-z0-9]+)*$`, max 64 chars. No enum. Absent on legacy
  records; never fabricated.
- `category` — **optional** recipe-category slug, same normalization/validation
  rules as `region`. No enum.
- `difficulty` — required, one of `easy` / `medium` / `hard`.
- `prepTimeMinutes` / `cookTimeMinutes` — required non-negative integers,
  capped at 1440 (24 hours) to reject nonsense input.
- `servings` — required positive integer, capped at 100.
- `ingredients` — embedded array, 1–50 entries (see below).
- `instructions` — array of trimmed, non-empty strings, 1–50 steps, each up
  to 1000 characters, **persisted and returned in order**. This string array
  is the single Mongo source of truth for cooking steps — there is no
  separate `Instruction` collection and no second stored `steps` field.
  - **Write input:** a request may send `instructions: string[]` (legacy) or
    the structured `steps: [{ order, text }]` form. On create exactly one is
    required; when both are sent they must describe the identical ordered text
    sequence (a mismatch is `400 VALIDATION_ERROR` — the API never silently
    picks one). Structured `steps` require a contiguous `order` running `1..N`
    with unique values and non-empty trimmed `text`; the service sorts by
    `order` and stores the resulting `string[]`.
  - **Response:** every recipe response carries both `instructions: string[]`
    (unchanged) **and** a derived `steps: [{ order, text }]` view (1-based,
    order = array position) for later RecipeDetail / CookMode work. Legacy
    string-only recipes need no migration — `steps` is derived on read.
- `dietaryTags` — array constrained to a fixed V1 enum (`vegetarian`,
  `vegan`, `pescatarian`, `glutenFree`, `dairyFree`, `nutFree`), default
  `[]`, deduplicated by `RecipeService`. **Always admin-supplied, never
  inferred** — no automatic or AI-based dietary classification happens in
  this phase. Deeper checks against canonical ingredients/allergens are left
  to future recommendation logic.
- `imageUrl` — optional URL string, nullable, max 2000 characters. Phase 4
  only stores an external URL reference; there is no upload/storage
  integration (no S3, Cloudinary, or Firebase Storage).
- `isActive` — boolean, default `true`. See Archive semantics below.
- `createdAt` / `updatedAt` — via `{ timestamps: true }`.

The public API always exposes Mongo's `_id` as `id` and never exposes `__v`
or any Mongoose internals — `recipe.serializer.js` builds the response
object field-by-field rather than spreading the document.

## Embedded ingredient usage

Each entry in `Recipe.ingredients` describes how one canonical `Ingredient`
is used in that recipe:

```json
{
  "ingredientId": "<ObjectId>",
  "quantity": 1,
  "unit": "kg",
  "note": "cut into serving pieces",
  "optional": false
}
```

- `ingredientId` — required `ObjectId` ref to `Ingredient`. Recipes
  reference the canonical `Ingredient` collection (rather than embedding a
  free-text ingredient name) so the same "Garlic" used across many recipes
  stays a single entity — this is what makes `?ingredientId=` filtering and
  future substitution/recommendation logic possible without text matching.
- `quantity` / `unit` — `unit` is a controlled 17-value enum (`g`, `kg`, `lb`, `oz`, `ml`, `l`,
  `tsp`, `tbsp`, `cup`, `piece`, `clove`, `slice`, `can`, `pack`, `bunch`,
  `pinch`, `toTaste`). For every unit except `toTaste`, `quantity` is
  **required** and must be a finite number greater than zero. For
  `toTaste` (e.g. "salt to taste"), `quantity` must be **absent** — omitted
  or explicitly `null` are both accepted as equivalent at the validation
  layer, and always normalized to "field absent" before storage
  (`RecipeService#normalizeIngredients`). No unit conversion is attempted in
  V1; that belongs to future shopping-list/recommendation logic, same as
  substitution ratios.
- `note` — optional, trimmed, max 200 characters (e.g. "minced", "thinly
  sliced"). Accepts `null` as equivalent to omitted.
- `optional` — boolean, default `false`. Marks an entry as non-essential
  (e.g. a garnish) — see how this affects archived-ingredient visibility
  below.

This cross-field rule (quantity required/forbidden depending on `unit`) is
enforced twice: at the HTTP boundary via a Zod `.refine()` on the embedded
ingredient schema, and again at the Mongoose layer via a `pre('validate')`
hook on the embedded subdocument schema — a plain per-path validator would
be skipped by Mongoose when the value itself is `undefined`, so the
cross-field check needs the hook instead.

The Mongoose-layer hook also applies on PATCH, not just on create. PATCH
persists a replacement `ingredients` array via `recipe.repository.js#updateById`
(`Recipe.findByIdAndUpdate(..., { runValidators: true })`), a query-based
update rather than `document.save()`. As a general rule, Mongoose does
**not** run document middleware (`pre('validate')`/`pre('save')`) for
query-based updates — but this project's Mongoose version constructs a real
subdocument instance for each element of a replaced `DocumentArray` and
calls that instance's full `.validate()` as part of `runValidators`, which
*does* run `pre('validate')` hooks. This was verified directly (see
`test/recipe-update-validators.test.js`) rather than assumed: a
`Recipe.findByIdAndUpdate` call with an invalid `ingredients` replacement is
rejected with the same `ValidationError` message as `new Recipe(...).validate()`
would produce, and — because Mongoose runs `runValidators` entirely
client-side before the query ever reaches the network — this is observable
without a live MongoDB connection. In practice the invariant is therefore
enforced at both the Zod boundary (the only reachable path today, since
`RecipeService` is the sole caller of the repository) and the persistence
layer.

**Ingredient entries are never deduplicated.** The same canonical Ingredient
may legitimately appear twice in one recipe for different uses (e.g. garlic
minced into a marinade, and again thinly sliced as garnish) — each is a
separate array entry with its own quantity/unit/note.

### Create/update-time validation vs. read-time visibility

Two distinct rules govern ingredient references, and they intentionally
differ in how they treat `optional`:

- **On create, on any PATCH that replaces the ingredients array, and on
  reactivation** (`isActive: true`), *every* referenced Ingredient —
  including entries marked `optional` — must exist and be active
  (`RecipeService#assertIngredientsActive`). You cannot save a recipe that
  references an archived Ingredient at all, even for an optional garnish.
- **At read time**, once a recipe is already stored, an `optional` entry
  going inactive later does not hide the whole recipe (see below). This
  reflects "optional" meaning "not essential to cook the dish," not "not
  worth validating."

Both checks call `IngredientService.findIngredientById` only —
`RecipeService` never imports the `Ingredient` model or repository
directly.

## Validation

Recipe create/patch/params/list-query schemas live in `recipe.validation.js`,
following the existing `validate(schema)` middleware convention: Zod schemas
shaped `{ body, params, query }`, `.strict()` bodies that reject unknown
fields (including on each embedded ingredient entry), and
`req.validated.query` for query params.

The same two details called out in `ingredients-substitutions.md` apply
here too:

- **PATCH schemas never reuse a `.default([])`/`.min(1)`-defaulted array
  schema from the create schema in a way that would wipe stored data.**
  `ingredients`, `instructions`, and `dietaryTags` are all built from a
  shared base schema, with defaults (`dietaryTags`) or requiredness
  (`ingredients`, `instructions` are always required on create, never
  defaulted) applied only at the create call site. On PATCH, all three are
  plain `.optional()` — an omitted key leaves the stored array untouched
  rather than resetting it.
- **PATCH bodies must contain at least one field** — enforced by a Zod
  `.refine()`, not application code.

`search` text is escaped (`recipe.service.js#escapeRegex`) before being
compiled into a case-insensitive `RegExp` matched against `title` and
`description` — the same deliberate, simple V1 choice as ingredient search:
no Atlas Search, Elasticsearch, or fuzzy-search library.

## Recipe endpoints

```
GET    /api/v1/recipes            authenticated (any role)
GET    /api/v1/recipes/:id        authenticated (any role)
POST   /api/v1/recipes            admin only
PATCH  /api/v1/recipes/:id        admin only
DELETE /api/v1/recipes/:id        admin only (archives, does not delete)
```

List query params: `search`, `region`, `category`, `difficulty`, `dietaryTag`,
`ingredientId`, `maxPrepTimeMinutes`, `status`, `page`, `limit`, `sort`.

- `region` / `category` filter on the canonical slug and are normalized the
  same way as the stored field (`?region=Central%20Luzon` → `region=central-luzon`).
  They compose with `search`, `difficulty`, `dietaryTag`, `ingredientId`,
  pagination and the visibility/status rules, and are applied in the DB query
  before `countDocuments`, so `pagination.total` covers the same filtered
  universe. (The separate pre-existing "usable-recipe" overcount below is
  unchanged — see the known limitation.)
- `status` is one of `active` (default) / `inactive` / `all`. A non-admin
  requesting `inactive` or `all` gets `403 FORBIDDEN`.
- `sort` is one of `titleAsc` (default), `titleDesc`, `newest`, `oldest`,
  `prepTimeAsc`, `prepTimeDesc` — a fixed named set, never raw Mongo sort
  syntax.
- `ingredientId` filters to recipes containing that canonical Ingredient
  (`{ "ingredients.ingredientId": <id> }`), which will also back future
  "what can I cook with X" recommendation queries.
- `maxPrepTimeMinutes` filters to `prepTimeMinutes <= value`.
- Pagination: `page` defaults to 1, `limit` defaults to 20 and is capped at
  100 — the same convention as every other paginated list in this API.

## Access control

- Every Phase 4 endpoint requires authentication (`authenticate`
  middleware).
- All mutation endpoints (`POST`/`PATCH`/`DELETE`) additionally require
  `authorize('admin')`. Role comes from `req.auth.role`, resolved from
  current MongoDB state — a client-supplied role is never trusted.
- A non-admin `GET`-by-id for an archived or unusable recipe returns a plain
  `404`, identical to a genuinely unknown id.

## Archive semantics

`Recipe` uses soft-delete via `isActive`, not physical deletion:

- `DELETE` always sets `isActive: false` (`archiveById`) and never removes
  the document.
- `PATCH` can set `isActive: true` to reactivate. Reactivating re-validates
  that **every** currently-stored ingredient reference (including
  `optional` ones) is still active before allowing it — see
  "Create/update-time validation" above.

### Archived-ingredient visibility (deliberate V1 simplification)

Archiving an `Ingredient` does **not** cascade to touch every `Recipe`
document that references it — no transactions, no batch updates, no
cross-module write coupling, exactly the same trade-off documented for
`Substitution` in `ingredients-substitutions.md`. Instead, visibility is
filtered at read time:

- `RecipeService` treats a recipe as "usable" for a non-admin view only
  when the recipe itself is active **and** every *non-optional* ingredient
  entry resolves to a currently-active Ingredient
  (`recipe.service.js#isUsableForNonAdmin`). A populated ref that fails to
  resolve (`null`, i.e. the Ingredient was deleted outright rather than
  archived) is treated the same as inactive. An `optional` entry (e.g. a
  garnish) going inactive does **not** hide the recipe.
- `GET /recipes/:id` applies this check for any non-admin caller: if the
  recipe itself is archived, **or** a non-optional referenced ingredient is
  archived or missing, the response is `404 RECIPE_NOT_FOUND` — identical
  to an unknown id. An admin's request bypasses the check unconditionally.
- `GET /recipes` (the list endpoint) applies the same "usable" filter to
  each page of results whenever the effective `status` is `active` (always
  for non-admins; the default for admins too, unless they explicitly
  request `inactive`/`all`).

#### Masking an archived optional ingredient usage within a visible recipe

A recipe surviving the "usable" check can still contain an `optional` entry
whose Ingredient has since been archived or deleted outright — that is
exactly the case the `optional` carve-out exists for. Serializing that entry
unchanged would hand a normal user an archived (or nonexistent) canonical
Ingredient's `id`/`name` looking exactly like any other normal, currently-
active ingredient usage, with nothing marking it as no longer valid.

To avoid that, `RecipeService#toNonAdminView` drops any `optional` entry
whose Ingredient is inactive or missing from the response given to a
non-admin caller, for both `GET /recipes/:id` and `GET /recipes` — the
stored `Recipe` document itself is never touched, only the response shape.
A non-optional entry is never affected by this (it's already guaranteed
active, or the whole recipe would have been hidden by the "usable" check
above). Admins always receive the complete, unfiltered `ingredients` array —
including archived/missing optional entries — regardless of the requested
`status`, since inspecting exactly what's stored is the point of an admin
view.

**Known limitation (list endpoint only):** the "usable" filter runs in
application code *after* the database page is fetched, not as a `$lookup`
aggregation joining against `Ingredient.isActive`. This means, for the
active view:

- `data` (the `recipes` array) — **always safe.** No recipe with an
  archived/missing non-optional ingredient is ever included, regardless of
  how many the raw DB page contained.
- `pagination.total` / `pagination.totalPages` — computed from the raw
  `Recipe` collection count *before* the archived-ingredient trim, so they
  can overstate how many usable recipes actually exist, and a page can come
  back with fewer than `limit` visible rows in the rare case a referenced
  ingredient was archived after the recipe itself stayed active.

This is the same accepted V1 trade-off as substitutions: the safety property
(no unusable recipe is ever exposed to a normal user) always holds, in
exchange for avoiding aggregation-pipeline complexity and cross-module
transactions.

## MongoDB indexes

- `{ isActive: 1, region: 1 }`, `{ isActive: 1, category: 1 }` and
  `{ isActive: 1, difficulty: 1 }` — the primary list-filtering shapes.
  (The pre-M3 `{ isActive: 1, cuisine: 1 }` declaration was removed; see the
  M3 section above for the stale-physical-index note.)
- `{ "ingredients.ingredientId": 1 }` — backs `?ingredientId=` filtering and
  future "recipes using this ingredient" / recommendation queries.
- `{ title: 1 }` — backs `titleAsc`/`titleDesc` sort and the regex search.
  `title` is **not** unique — recipes may legitimately share a title.

## Error codes

| Code | Status | Meaning |
| --- | --- | --- |
| `RECIPE_NOT_FOUND` | 404 | No matching recipe, or hidden from a non-admin caller because it's archived or unusable |
| `RECIPE_INGREDIENT_NOT_FOUND` | 404 | A create/PATCH/reactivation referenced an Ingredient that does not exist |
| `RECIPE_INGREDIENT_INACTIVE` | 400 | A create/PATCH/reactivation referenced an Ingredient that exists but is archived |
| `FORBIDDEN` | 403 | Role-based rejection — either a non-admin mutation attempt, or a non-admin requesting `status=inactive`/`all` |
| `VALIDATION_ERROR` | 400 | Request shape/type failure at the Zod boundary |

All of the above are raised as `AppError`s and pass through the existing
central `error.middleware.js` unchanged — no new error-handling
infrastructure was introduced for this phase.

## M3 recipe-domain uplift (`feat/recipe-schema-m3`)

Delta on top of the Phase 4 baseline above:

- Added optional `region` / `category` slug fields + `?region=` / `?category=`
  server-side filters + supporting indexes.
- Retired `cuisine` from the model, validation, list query, service filter,
  serializer, the **declared** index set, and the Favorites recipe summary.
  New writes/queries carrying `cuisine` are rejected; legacy Mongo `cuisine`
  values are left physically in place (no destructive migration) and never
  read. **The schema no longer declares `{ isActive: 1, cuisine: 1 }`, but on
  an already-deployed database the physical `isActive_1_cuisine_1` index is
  not auto-dropped** (the app relies on Mongoose `autoIndex`, which only
  *creates* missing indexes — nothing here calls `syncIndexes()`). Dropping
  the stale index is a one-line deployment/data-maintenance task
  (`db.recipes.dropIndex('isActive_1_cuisine_1')`), not done in this slice —
  an unused index is harmless; an automatic drop is not.
- `region` / `category` on PATCH accept an explicit `null` to **unset** the
  field (`$unset`, the way to correct a bad classification); an empty string
  or non-slug is still `400`. Create does not accept `null`.
- Structured cooking steps: `instructions: string[]` stays the Mongo source
  of truth; write input additionally accepts `steps: [{ order, text }]`
  (normalized to `instructions`), and every response adds a derived
  `steps: [{ order, text }]` view.
- **Not** in M3: the pre-existing `pagination.total` "usable recipe"
  overcount (needs a cross-collection aggregation touching Favorites /
  ShoppingList too — tracked separately), ingredient-name search (needs a new
  cross-module Ingredient lookup abstraction), and any `region` / `category`
  content classification / backfill.

## Explicitly out of scope for Phase 4

Per the Phase 4 brief: favorites, shopping lists, recommendations, AI/OpenAI
integration, Google Sign-In, mobile/admin frontend integration, image
uploads/storage, and unit conversion are all deliberately not implemented
here. `ingredients.ingredientId` filtering exists specifically so this later
work has something to build on without a schema migration. (The Phase 4
`cuisine` field was later retired — see the M3 section above.)

## M20B authoring and publication lifecycle

Recipe publication and archival are independent axes:

- `publicationStatus: "draft" | "published"` controls publication.
- `isActive` controls archive state and is changed only by the explicit
  `POST /recipes/:recipeId/archive` and `POST /recipes/:recipeId/restore`
  commands (with `DELETE /recipes/:recipeId` retained as a soft-archive
  compatibility alias).
- Archive/restore never changes `publicationStatus`; restoring a Draft does
  not require publish completeness, while restoring a Published recipe
  revalidates referenced Ingredient usability.

Legacy records with no physical `publicationStatus` are explicitly treated
as Published during rollout. New Drafts are created through
`POST /recipes/drafts`, explicitly store `publicationStatus: "draft"`, and
require only a nonblank title. Supplied optional fields remain structurally
validated. Publishing uses `POST /recipes/:recipeId/publish`, requires
`{ "confirmFilipinoCuisine": true }`, validates the complete legacy create
contract plus Ingredient usability, and atomically records `publishedBy` and
the first `publishedAt`.

Normal consumer list/detail and the shared `findUsableRecipeById` gate accept
only active, fully publish-valid Published recipes or fully publish-valid
legacy records with missing state. Malformed legacy or explicit Published
records fail closed using the same authoritative completeness contract as the
Publish command. That central gate protects Favorites, Collections, Reviews,
Meal Plan, Shopping, Community, and Cook History. `catalog.read_all` callers
receive a staff representation that includes lifecycle and attribution
metadata and may inspect all Draft/Published and active/archived combinations.

Generic PATCH is content-only. It rejects lifecycle/attribution assignment,
allows incomplete Draft content, and keeps explicitly Published records
publish-valid. An optional `expectedUpdatedAt` precondition supports the M20C
wizard; a stale value returns `409 RECIPE_EDIT_CONFLICT`. It is optional for
the current Staff Portal during transition.

The current Staff Portal still submits its existing complete Add Recipe form
to `POST /recipes`. That route is a temporary compatibility path which keeps
the pre-M20 behavior by storing the complete recipe as Published and stamping
server-owned attribution. It requires the Moderator to actively check the
visible Filipino-cuisine acknowledgement; the request must carry literal
`confirmFilipinoCuisine: true`, which is validated but never persisted or
serialized. The Portal's archive/restore controls already use the explicit
lifecycle commands. M20C should replace complete-create with Draft creation
followed by the explicit, confirmed publish command.

`newest` and `oldest` retain the pre-M20 `createdAt` ordering during the
transition. `publishedAt` is stored correctly but is not yet used for list
ordering. Switching Newest to publication-time ordering is deferred until the
publication-state backfill has been executed and verified; a compound Mongo
sort is not a true `publishedAt ?? createdAt` fallback.

The dry-run-first `scripts/migrate-recipe-publication-state.js` reports every
legacy record missing state, migrates only complete records when `--apply` is
explicitly supplied, preserves `isActive`, uses `createdAt` as `publishedAt`,
and leaves unknowable actor fields null. Malformed legacy records are reported
without mutation. The operation is idempotent and is never run automatically.

Additive query indexes cover `(isActive, publicationStatus, createdAt)` for
transitional consumer lists and `(publicationStatus, isActive, updatedAt)` for
staff Draft management. No existing index is dropped automatically.
