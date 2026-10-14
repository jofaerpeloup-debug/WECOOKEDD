# COOKING-BACKEND — Recipe API slice 1

**Status:** FROZEN for implementation. **Base:** `887784a72a9966f841ae239cc985933a5597fef7`.
This slice excludes Shopping List, Admin UI, Mobile UI, migrations, and deployment.

## Product and compatibility contract

`Recipe.ingredients` remains the complete default ingredient list, including its existing
public shape and duplicate fingerprint. The optional embedded `cooking` value contains
`schemaVersion: 1`, `defaultSpiceLevel`, `spiceAlternatives`, and `stepTimers`.
For an unprofiled recipe, `cooking` is absent/null. A timer-only profile has a null
default, no alternatives, and null timer spice levels. A spice profile has a default
from `none`, `mild`, `medium`, `hot`, `extra_hot`; each alternative has a unique
different level and a complete canonical ingredient-usage list. No heuristic
substitution or per-level nutrition is generated. Authored `nutrition` remains
sourced, exact, and per serving for the default list only.

Alternative usages reuse the Recipe ingredient shape and limits: 1–50 entries,
active canonical Ingredient references on writes/publish/restore, positive finite
measurable quantities, no quantity for `toTaste`, canonical units, note and
optional flags. Repeated Ingredient IDs remain distinct usages. A profile with
alternatives requires valid base servings and a nonempty default list.

`stepTimers` contain `{stepOrder, servings, spiceLevel, durationSeconds}`.
`stepOrder` is the 1-based position of persisted `instructions` (and derived
public `steps`), servings are integers 1–100, duration is integer 1–10800
seconds. The `(stepOrder, servings, spiceLevel)` tuple is unique. A preset
references the current instruction array and an authored level exactly; null
spice is allowed only for a timer-only profile. No computed durations.

The authenticated Recipe **detail** response includes `cooking` (null for old
recipes). Public alternatives have the same ingredient summaries as the default.
Existing list representations and old-client `ingredients` remain unchanged.
Staff detail and mutation responses include the full authoring object.
Consumer reads omit an alternative with an inactive required Ingredient and
its presets, and omit inactive optional usages from remaining alternatives.
The default-list publication/visibility rule is unchanged. Active Ingredient
archive dependency checks cover default and alternative references.

Authoring uses the existing authenticated `POST /api/v1/recipes`,
`POST /api/v1/recipes/drafts`, and `PATCH /api/v1/recipes/:recipeId`
routes. The additional request member is exactly:

```json
{
  "cooking": {
    "schemaVersion": 1,
    "defaultSpiceLevel": "mild",
    "spiceAlternatives": [{
      "spiceLevel": "hot",
      "ingredients": [{
        "ingredientId": "507f1f77bcf86cd799439012",
        "quantity": 2,
        "unit": "clove",
        "note": null,
        "optional": false
      }]
    }],
    "stepTimers": [{
      "stepOrder": 2,
      "servings": 4,
      "spiceLevel": "hot",
      "durationSeconds": 90
    }]
  }
}
```

The example is a partial Recipe request, not a standalone create payload.
The public detail `cooking` member has the same profile fields, but each
alternative usage has the existing public `{ingredient:{id,name}, quantity,
unit,note,optional}` shape. Public list responses omit `cooking`. Staff detail
and mutation responses use input-compatible alternative usages with
`ingredientId` instead of the public `ingredient` summary, so saved cooking
data can be reloaded for editing. A missing/deleted reference appears as
`ingredientId:null` for repair. Unprofiled detail returns `cooking:null`.

Create, draft, and PATCH accept the complete `cooking` object. PATCH omission
preserves it; null clears it. Any PATCH of base `ingredients`, `servings`, or
`instructions`/`steps` on a profiled recipe requires a complete `cooking`
reaffirmation or clear in the same request, otherwise 409
`RECIPE_COOKING_REVIEW_REQUIRED`. Validate the merged document before a single
atomic write. Publish and restore revalidate all authored alternatives and
timer references, including current Ingredient activity. Existing duplicate
review, nutrition, auth, visibility, and conflict behavior remain authoritative.
Every PATCH that writes or clears `cooking` also requires the existing
`expectedUpdatedAt` precondition; omission is 400 `VALIDATION_ERROR`.
Shape and tuple errors use existing 400 `VALIDATION_ERROR`; merged or saved
incompleteness uses existing 400 `RECIPE_INCOMPLETE`; missing/inactive canonical
Ingredient references use 404 `RECIPE_INGREDIENT_NOT_FOUND` or 400
`RECIPE_INGREDIENT_INACTIVE`. A stale
write uses 409 `RECIPE_EDIT_CONFLICT`. No new route or separate variation
resource is introduced.

All relevant Recipe update/publish/archive/restore writers keep `__v` CAS and
set `updatedAt` strictly later than the loaded timestamp, including writes
within one millisecond. Use an atomic filter on both revision and expected
timestamp when supplied. Existing 409 `RECIPE_EDIT_CONFLICT` remains the
moderator stale-write result. This is needed for the later selected-serving
Shopping List import; that import is not part of this slice.

## Exact-path allowlist, confirmed before code edits

Production:

- `apps/api/src/modules/recipes/recipe.model.js`
- `apps/api/src/modules/recipes/recipe.validation.js`
- `apps/api/src/modules/recipes/recipe.service.js`
- `apps/api/src/modules/recipes/recipe.repository.js`
- `apps/api/src/modules/recipes/recipe.serializer.js`
- `apps/api/src/modules/recipes/recipe.controller.js`

Tests:

- `apps/api/test/recipe-model.test.js`
- `apps/api/test/recipe-validation.test.js`
- `apps/api/test/recipe-update-validators.test.js`
- `apps/api/test/recipe-service.test.js`
- `apps/api/test/recipe-routes.test.js`
- `apps/api/test/recipe-authoring.test.js`
- `apps/api/test/recipe-duplicate.test.js`
- `apps/api/test/ingredient-service.test.js`
- `apps/api/test/ingredient-routes.test.js`

Documentation: this file only. The active Ingredient archive guard calls
`recipeRepository.hasActiveConsumerRecipeUsingIngredient`; its production path
is already allowlisted above. No Ingredient module production edit is needed.
