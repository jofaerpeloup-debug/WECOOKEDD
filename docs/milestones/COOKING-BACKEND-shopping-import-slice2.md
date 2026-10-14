# COOKING-BACKEND — Shopping import slice 2

**Status:** FROZEN for implementation. **Base:** `2b8ec557e8f25b0a0ca65668a175a19a7d7d2d61`.
This slice extends only authenticated Shopping List v2 Recipe import. It excludes
Admin, Mobile, schema changes, migrations, indexes, deployment, and the v1 route.

## Import contract

`POST /api/v1/shopping-list/v2/recipes/:recipeId` accepts an absent or empty
body for the unchanged default-list/base-serving import. A selected import has
exactly `{servings, expectedRecipeUpdatedAt}` and, only when an authored spice
profile has a non-null default level, `spiceLevel`. Servings are integer 1–100;
the timestamp is an ISO-8601 offset timestamp; a supplied spice level is one of
`none`, `mild`, `medium`, `hot`, `extra_hot`. Unknown keys and partial selected
bodies are 400 `VALIDATION_ERROR`. Timer-only profiles have no selectable spice
level and therefore omit `spiceLevel`.

RecipeService resolves one consumer-visible populated Recipe snapshot before
Shopping List mutation. Hidden or unusable Recipes return the existing 404
`RECIPE_NOT_FOUND`. A selected import checks `updatedAt` against the supplied
timestamp and returns 409 `RECIPE_STALE` on mismatch. A missing spice level on
an authored spice profile is 400 `VALIDATION_ERROR`; a supplied level that was
never authored is 400 `RECIPE_SPICE_LEVEL_NOT_OFFERED`. An authored alternative
whose required Ingredient is now inactive/missing is 409
`RECIPE_SPICE_LEVEL_UNAVAILABLE`. Existing inactive optional usages are omitted.
Unavailable base servings return 422 `RECIPE_SERVINGS_UNAVAILABLE` only when
the Recipe would otherwise be consumer-usable; hidden Recipe states retain 404.

For each usage in the selected complete authored list, scale a measurable
quantity as `authoredQuantity * selectedServings / authoredBaseServings`, without
rounding or unit conversion. `toTaste` stays quantity-free. A nonfinite or
nonpositive scaled result returns 422 `RECIPE_QUANTITY_UNSCALABLE`. The resolved
payload retains usage order, unit, note, and optional status. Shopping List
stores its existing row fields only. The immutable resolved usage payload is
reapplied on the existing one additive SHOP5 OCC retry; no Recipe re-fetch
occurs during retry. Existing owner derivation, exact ingredient+unit merge,
provenance, limits, v1 upgrade wall, and response envelopes remain unchanged.

Before an import can create a Shopping List, resolve the Recipe and preflight
all final merged quantities against a noncreating owner-scoped read (or a
virtual empty list). Repeat preflight against the atomic upsert result and on
the additive retry. Preflight the full merge on a disposable list copy so
row/source limits also reject before upsert. A rejected quantity must not
create an empty list. Legacy v1 checks its existing-list upgrade wall with a
noncreating read before Recipe lookup, preserving old-client error precedence.

## Exact-path allowlist, frozen before production edits

Production:

- `apps/api/src/modules/recipes/recipe.service.js`
- `apps/api/src/modules/shopping-lists/shopping-list.validation.js`
- `apps/api/src/modules/shopping-lists/shopping-list.controller.js`
- `apps/api/src/modules/shopping-lists/shopping-list.service.js`
- `apps/api/src/modules/shopping-lists/shopping-list.repository.js` — noncreating
  owner-scoped read needed before the existing atomic upsert; added for the
  Slice 2 medium finding before repository edits.

Focused tests:

- `apps/api/test/recipe-service.test.js`
- `apps/api/test/shopping-list-validation.test.js`
- `apps/api/test/shopping-list-service.test.js`
- `apps/api/test/shopping-list-routes.test.js`
- `apps/api/test/shopping-list-repository.test.js` — verifies the noncreating
  read has no upsert side effect; added for the Slice 2 medium finding before
  test edits.

Documentation: this file only. The RecipeService path is required by the
existing cross-module boundary: ShoppingListService never imports Recipe's
model or repository directly. The v2 route already uses the allowlisted
validator and controller. Mongo runtime concurrency remains NOT RUN until an
isolated Mongo check is executed.
