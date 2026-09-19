# Ingredients & substitutions

This document covers what Phase 3 (`feat/ingredients-substitutions`) actually
implements in `apps/api`: canonical ingredients and directed ingredient
substitution relationships. See
[docs/architecture/backend.md](./backend.md) for the layered request-flow/
module conventions this feature follows, and
[docs/architecture/authentication-security.md](./authentication-security.md)
for the authentication/session system it depends on.

## Modules

- `src/modules/ingredients/` — the `Ingredient` model plus a repository/
  service/controller/routes/serializer/validation set for canonical
  ingredient data.
- `ingredient-dependency.guard.js` coordinates the M22 service policy through
  narrow read-only Recipe and Substitution repository existence checks; it
  does not depend on either module's service and therefore adds no service
  cycle.
- `src/modules/substitutions/` — the `Substitution` model plus the same
  layer set for directed source → substitute relationships between two
  ingredients.
- `SubstitutionService` calls `IngredientService` only; it never imports
  `ingredient.model.js` or `ingredient.repository.js` directly, matching the
  cross-module boundary rule in `backend.md`.

## Why two collections, not one

An `Ingredient` is a single canonical entity ("Butter"). A `Substitution` is
a relationship *between two* ingredients ("Butter → Olive Oil") with its own
fields (ratio, contexts, notes) that don't belong on either ingredient. A
given ingredient can appear in many substitution relationships on either
side (as a source and/or as a substitute), so this is a many-to-many
relationship best modeled as its own collection with two `ObjectId` refs,
rather than an array embedded in `Ingredient`.

## Ingredient schema

- `name` — required, trimmed, max 100 characters. The canonical display
  name.
- `normalizedName` — a lowercase, whitespace-collapsed derivation of `name`
  (`"  Brown   Sugar "` → `"brown sugar"`), computed in `IngredientService`
  and never accepted directly from a request. It carries a **unique index**,
  which is what actually prevents two ingredients from differing only by
  case or surrounding/internal whitespace — `name`'s own uniqueness would
  not catch that. `normalizedName` is `select: false` and is never read by
  `ingredient.serializer.js`, so it never appears in an API response.
- `aliases` — array of trimmed strings, max 100 characters each, max 20
  entries. `IngredientService` trims, collapses whitespace, and drops
  case-insensitive duplicates before persisting, preserving the casing of
  the first occurrence.
- `category` — required, one of a fixed V1 enum (`produce`, `meat`,
  `seafood`, `dairy`, `egg`, `grain`, `legume`, `nutSeed`, `herb`, `spice`,
  `oilFat`, `sweetener`, `baking`, `condiment`, `beverage`, `other`), camelCase
  in JSON.
- `allergenTags` — array constrained to a fixed V1 enum of major allergens
  (`milk`, `egg`, `fish`, `shellfish`, `treeNut`, `peanut`, `wheat`, `soy`,
  `sesame`), default `[]`. **Never inferred automatically** — a moderator
  supplies these explicitly.
- `isActive` — boolean, default `true`. See Archive semantics below.
- `createdAt` / `updatedAt` — via `{ timestamps: true }`.

The public API always exposes Mongo's `_id` as `id`, and never exposes
`normalizedName` or `__v` — `ingredient.serializer.js` builds the response
object field-by-field rather than spreading the document, so anything not
explicitly listed there is never leaked.

## Substitution schema

- `sourceIngredientId` / `substituteIngredientId` — required `ObjectId` refs
  to `Ingredient`. The relationship is **directed**: Butter → Olive Oil does
  not imply Olive Oil → Butter, and both may exist independently as separate
  documents.
- `ratio` — an explicit subdocument, not a free-text string:
  ```json
  { "sourceAmount": 1, "substituteAmount": 0.75 }
  ```
  read as "use 0.75 parts substitute for every 1 part source." Both amounts
  are required, finite, and greater than zero. **No unit conversion is
  attempted in V1** — that belongs to future recipe/substitution logic.
- `contexts` — array of trimmed strings (max 40 characters each, max 10
  entries), e.g. `"baking"`, `"frying"`. Deduplicated case-insensitively by
  `SubstitutionService`, the same way ingredient aliases are. Deliberately
  free-text rather than a second controlled collection — V1 has no other
  consumer of "context" that would need it modeled as its own entity.
- `notes` — optional string, max 500 characters, human-readable guidance.
- `isActive` — boolean, default `true`. See Archive semantics below.
- `createdAt` / `updatedAt` — via `{ timestamps: true }`.

`substitution.serializer.js` returns a summary shape that inlines the
referenced ingredients' `id`/`name` (via a populated query — see
`substitution.repository.js`) so a client can render "what can replace
Butter?" without two extra round trips. Only `id` and `name` are ever taken
from the populated `Ingredient` sub-documents; `isActive` is populated too,
but is read purely as internal visibility-filtering state (see below) and is
never copied into the response.

## Validation

Ingredient and substitution create/patch/params/list-query schemas live in
`ingredient.validation.js` and `substitution.validation.js`, following the
existing `validate(schema)` middleware convention: Zod schemas shaped
`{ body, params, query }`, `.strict()` bodies that reject unknown fields, and
`req.validated.query` for query params (Express 5 exposes `req.query` as
getter-only, so it's never reassigned — same as every other module).

Two details worth calling out because they're easy to get wrong:

- **PATCH schemas never reuse a `.default([])` array schema from the create
  schema.** If they did, omitting `aliases`/`allergenTags`/`contexts` from a
  patch body would parse to `[]` and silently wipe the stored array instead
  of leaving it untouched. The create and patch array schemas are built from
  a shared base schema, with `.default([])` applied only at the create call
  site.
- **PATCH bodies must contain at least one field** — enforced by a Zod
  `.refine()` on the body schema, not by application code.

`sourceIngredientId`/`substituteIngredientId` are checked for equality at
the validation layer too (on create always; on patch only when both are
present in the same request), but that's a best-effort early rejection —
patching just one side of an existing pair can only be checked against the
*stored* value, which is a service-layer concern (see below).

## Ingredient endpoints

```
GET    /api/v1/ingredients            authenticated (any role)
GET    /api/v1/ingredients/:id        authenticated (any role)
POST   /api/v1/ingredients            catalog.write (Moderator)
PATCH  /api/v1/ingredients/:id        catalog.write (Moderator)
DELETE /api/v1/ingredients/:id        catalog.write (Moderator; archives)
```

List query params: `search`, `category`, `allergen`, `status`, `page`,
`limit`, `sort`. `status` is one of `active` (default) / `inactive` / `all`;
`sort` is one of `nameAsc` (default) / `nameDesc` / `newest` / `oldest`.
Pagination: `page` defaults to 1, `limit` defaults to 20 and is capped at
100 — the same convention as every other paginated list in this API.

`search` matches against `name` and `aliases` via a case-insensitive regex.
The search text is escaped (`ingredient.service.js#escapeRegex`) before
being compiled into a `RegExp`, so user input is always matched literally
rather than interpreted as regex syntax. This is a deliberate, simple V1
choice — no Atlas Search, Elasticsearch, or fuzzy-search library.

## Substitution endpoints

```
GET    /api/v1/substitutions          authenticated (any role)
GET    /api/v1/substitutions/:id      authenticated (any role)
POST   /api/v1/substitutions          catalog.write (Moderator)
PATCH  /api/v1/substitutions/:id      catalog.write (Moderator)
DELETE /api/v1/substitutions/:id      catalog.write (Moderator; archives)
```

List query params: `sourceIngredientId`, `substituteIngredientId`,
`context`, `status`, `page`, `limit`, `sort` (`newest` default / `oldest`).
The primary use case is `GET /api/v1/substitutions?sourceIngredientId=<id>`
— "what can replace this ingredient?" — backed by the compound index
described below.

## Access control

- Every Phase 3 endpoint requires authentication (`authenticate` middleware,
  same as every other module).
- All mutation endpoints (`POST`/`PATCH`/`DELETE`, both modules) additionally
  require the server-side `catalog.write` capability. Moderator owns
  `catalog.write`; Admin has `catalog.read_all` but not `catalog.write`, and
  User has neither. Role still comes from `req.auth.role`, which
  `authenticate` resolves from the current MongoDB user record — a
  client-supplied or stale-token role is never trusted.
- `status=inactive` and `status=all` on either list endpoint are rejected
  with `403 FORBIDDEN` for a User. Moderator and Admin have
  `catalog.read_all`; this remains enforced in the service layer
  (`ingredient.service.js#listIngredients`,
  `substitution.service.js#listSubstitutions`) rather than only at the
  route, since it depends on both the caller's role and the requested
  query.
- A caller without `catalog.read_all` gets a `GET`-by-id 404 for an archived
  ingredient or substitution, returning
  a plain `404`, identical to a genuinely unknown id — never a distinguishing
  error that would confirm an archived record once existed.

## Archive semantics

Both `Ingredient` and `Substitution` use soft-delete via `isActive`, not
physical deletion:

- Ingredient `DELETE` represents soft deletion by setting `isActive: false`;
  it never removes the document. The service performs dependency validation
  when the observed state is active, and the final repository update is
  conditional on that observed `isActive` state. A state change causes a
  reread and reevaluation; repeated contention fails safely instead of
  falling back to an unconditional deactivation.
- Substitution `DELETE` sets `isActive: false` through its repository
  `archiveById` operation and never removes the document.
- Ingredient has two supported deactivation paths: `DELETE
  /api/v1/ingredients/:ingredientId` and `PATCH` of that resource with
  `isActive: false`. Both use the same service-layer guard for an actual
  active-to-inactive transition.
- `PATCH` can set `isActive: true` to reactivate. Reactivating a
  `Substitution` additionally re-validates that **both** referenced
  ingredients are currently active — including the side not being changed
  in that particular patch — before allowing it, so a reactivated
  relationship can never point at an archived ingredient.

### Ingredient deactivation dependency guard

An active Ingredient cannot be deactivated while it is referenced by
consumer-relevant active catalog content. The request-time guard checks for:

- an active Recipe whose `publicationStatus` is `published`;
- an active legacy Recipe with no `publicationStatus`, which retains
  Published consumer semantics; or
- an active Substitution where the Ingredient is either
  `sourceIngredientId` or `substituteIngredientId`.

Every matching Recipe usage blocks, including `optional: true`. Active Draft
Recipes, archived Published or Draft Recipes, archived Substitutions, and
Shopping List items do not block. Shopping List references remain user-owned
history under their existing unavailable-item behavior.

The guard does not archive, unpublish, delete, or rewrite dependent Recipe,
Substitution, or Shopping List documents. Existing Recipe publish and
Published-restore validation, plus Substitution create/reactivation
validation, remain authoritative for Draft or archived content. A rejected
PATCH is checked before its Ingredient mutation, so other fields in the same
request are not partially applied.

This safeguard is a request-time precheck, not strict cross-collection
referential integrity. A concurrent Recipe publish or Substitution
create/reactivation can occur between dependency reads and Ingredient
mutation. M22 adds no transactions, locks, version protocol, or cross-module
serialization. Existing fail-closed Recipe/Substitution consumer reads remain
the safety net for that known race.

### Consumer fail-closed behavior

Deactivating an `Ingredient` does **not** cascade to dependent Recipe,
Substitution, or Shopping List documents. If an inconsistent relationship
exists despite the request-time guard, visibility still fails closed at read
time:

- Recipe consumer reads hide active Published/legacy recipes with an
  inactive required Ingredient. An inactive optional Ingredient usage is
  omitted while the otherwise-usable Recipe remains visible.
- `SubstitutionService` treats a substitution as "usable" for a caller
  without `catalog.read_all` only when the relationship itself is active
  **and** both the populated source and substitute ingredients are active
  (`substitution.service.js#isUsableForNonAdmin`). A populated ref that
  fails to resolve (`null`) is treated the same as inactive.
- `GET /substitutions/:id` applies this check for a caller without
  `catalog.read_all`: if the substitution itself is archived, **or** either
  referenced ingredient is archived (or fails to populate at all), the
  response is `404
  SUBSTITUTION_NOT_FOUND` — identical to an unknown id. There is no
  `status` query param on the single-resource endpoint; a caller with
  `catalog.read_all` bypasses the check, so Moderator or Admin can fetch a
  substitution by id regardless of its own or its ingredients' `isActive`
  state for staff inspection.
- `GET /substitutions` (the list endpoint) applies the same "usable" filter
  to each page of results whenever the effective `status` is `active`
  (always for Users; the default for staff). A staff caller explicitly
  requesting `status=inactive` or `status=all` sees the raw, unfiltered
  relationships — including ones whose ingredient has since been archived —
  so staff can find and clean these up.

**Known limitation (list endpoint only):** because the "usable" filter runs
in application code *after* the database page is fetched (rather than as a
`$lookup` aggregation joining against `Ingredient.isActive`), the three
response fields mean slightly different things for a normal-user (active
view) query:

- `data` (the `substitutions` array) — **always safe.** It is the post-filter
  result: no substitution whose relationship or either referenced ingredient
  is archived is ever included, regardless of how many the raw DB page
  contained. Its length can be less than `limit` even when more matching
  *documents* exist, per the note below.
- `pagination.total` — the raw count of `Substitution` documents matching
  the Mongo filter (`isActive: true` plus any other query params), computed
  by `countByFilter` **before** the archived-ingredient trim is applied. It
  does not subtract rows that get dropped for referencing an archived
  ingredient, so it can overstate how many *usable* relationships actually
  exist.
- `pagination.totalPages` — `Math.ceil(total / limit)`, derived directly
  from the same pre-trim `total`, so it inherits the same imprecision.

In the active view, a page can therefore come back with fewer than `limit`
visible rows in the rare case where a referenced ingredient was archived
after the substitution itself stayed active, and `total`/`totalPages` can be
a slight overcount of the truly usable relationships. This is an accepted V1
trade-off — the important safety property (no unusable substitution
document is ever exposed to a normal user, on either the list or the
single-resource endpoint) still holds — in exchange for avoiding
aggregation-pipeline complexity and cross-module transactions; it can be
revisited if/when substitution volume makes the count imprecision worth the
added complexity.

## MongoDB indexes

`Ingredient`:
- `{ normalizedName: 1 }`, **unique** — the actual enforcement mechanism
  behind "no two ingredients differ only by case/whitespace." A duplicate
  insert/update surfaces as a Mongo `E11000`, which both
  `IngredientService.createIngredient` and `updateIngredient` translate into
  a stable `409 INGREDIENT_ALREADY_EXISTS` rather than leaking the raw
  driver error.
- `{ isActive: 1, category: 1 }` — the primary list-filtering shape.
- `{ name: 1 }` — backs `nameAsc`/`nameDesc` sorting and the regex search.

`Substitution`:
- `{ sourceIngredientId: 1, substituteIngredientId: 1 }`, **unique** — one
  relationship per ordered pair. Butter → Olive Oil and Olive Oil → Butter
  hash to different compound keys and may both exist. A duplicate becomes a
  stable `409 SUBSTITUTION_ALREADY_EXISTS`, same pattern as ingredients. This
  compound index's leading field also serves the primary
  `?sourceIngredientId=` list-query shape.
- `{ substituteIngredientId: 1 }` — supports the reverse lookup ("what is
  this ingredient a substitute for?") without a full collection scan.

`Recipe` already has `{ "ingredients.ingredientId": 1 }`, which supports the
Ingredient dependency lookup. M22 adds no schema migration or new index.

## Error codes

| Code | Status | Meaning |
| --- | --- | --- |
| `INGREDIENT_NOT_FOUND` | 404 | No matching ingredient (or hidden from a caller without `catalog.read_all` because it is archived) |
| `INGREDIENT_ALREADY_EXISTS` | 409 | `normalizedName` collision on create/update |
| `INGREDIENT_HAS_ACTIVE_DEPENDENCIES` | 409 | Active Ingredient deactivation is blocked by an active consumer Recipe and/or Substitution |
| `INGREDIENT_EDIT_CONFLICT` | 409 | Concurrent Ingredient state/edit conflict; retry using the current Ingredient state |
| `INGREDIENT_INACTIVE` | 400 | A substitution create/patch referenced an ingredient that exists but is archived |
| `SUBSTITUTION_NOT_FOUND` | 404 | No matching substitution (or hidden from a caller without `catalog.read_all`) |
| `SUBSTITUTION_ALREADY_EXISTS` | 409 | Duplicate ordered `(source, substitute)` pair |
| `SUBSTITUTION_SAME_INGREDIENT` | 400 | `sourceIngredientId === substituteIngredientId` |
| `FORBIDDEN` | 403 | Capability rejection — including Admin/User mutations or a User requesting `status=inactive`/`all` |
| `VALIDATION_ERROR` | 400 | Request shape/type failure at the Zod boundary |

All of the above are raised as `AppError`s and pass through the existing
central `error.middleware.js` unchanged — no new error-handling
infrastructure was introduced for this phase.
