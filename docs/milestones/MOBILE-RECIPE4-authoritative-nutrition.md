# MOBILE-RECIPE4 - Authoritative Nutrition

## 1. Status and authority

- Audit: **COMPLETE AND PERSISTED**
- Contract review: **APPROVED**
- Contract: **FROZEN**
- Implementation: **COMPLETE**
- Independent review: **COMPLETE**
- Closure review: **PASS**
- Status: **READY FOR FINALIZATION**
- Baseline: `origin/main` at `11e788427166f5c2e7c5b456bef80b205639a61f`

This document is the implementation authority for MOBILE-RECIPE4. Authority is,
in order: repository instructions, the live repository at the baseline above,
this frozen contract, and the recovered audit in
`docs/milestones/MOBILE-RECIPE4-authoritative-nutrition-audit.md`.

Implementation and independent closure review are complete within the frozen
production and test allowlists. This status does not authorize a production
database write or claim browser, physical-device, accessibility-runtime,
isolated-live-Mongo, or production-migration completion.

### Closure evidence

- API: **265/265 PASS**
- Admin: **98/98 PASS**
- Mobile: **61/61 PASS**
- `git diff --check`: **PASS**
- Exact frozen allowlist: **PASS**

The independent closure re-review found:

- schema/data-integrity: **PASS**
- provenance/security: **PASS**
- migration automated review: **PASS**
- duplicate-analysis: **PASS**
- Admin: **PASS**
- Mobile: **PASS**
- remaining implementation blockers: **NONE**

## 2. Exact public v1 nutrition schema

The public Recipe field is exactly:

```js
nutrition: null | {
  schemaVersion: 1,
  basis: 'perServing',
  caloriesKcal: number,
  proteinGrams: number,
  carbohydrateGrams: number,
  fatGrams: number,
  sugarGrams: number,
  fiberGrams: number,
}
```

No other public nutrition key is part of v1. In particular, v1 does not expose
an internal actor id, staff id, provenance record, audit timestamp, source
management identifier, confidence, estimate flag, serving multiplier, or
derived nutrient.

Every nutrient is a finite, nonnegative JavaScript number. `NaN`, positive or
negative infinity, negative values, numeric strings, missing keys, extra keys,
and partially populated objects are invalid. Fixed units are encoded by the
field names: kilocalories for `caloriesKcal` and grams for all five nutrient
fields ending in `Grams`. `schemaVersion` is the literal number `1`; `basis` is
the literal string `perServing`.

Nutrition is complete or `null`. There is no partial public object. Missing or
explicitly `null` stored nutrition means unavailable and serializes as
`nutrition: null`. Zero is valid only when explicitly accepted as an
authoritative nutrient within an otherwise complete sourced object. Missing or
invalid values must never be estimated or replaced with zero.

## 3. Staff mutation, provenance, and concurrency

Nutrition is authoritative, sourced, and staff-managed. Mutation uses the
existing Recipe PATCH lifecycle and existing `CATALOG_WRITE` capability. No new
capability or nutrition-only mutation route is introduced.

The client supplies reviewed nutrition values and required source material, but
never supplies a trusted actor, staff identity, provenance timestamp, audit
timestamp, or concurrency version other than the existing request-only
`expectedUpdatedAt`. The server derives the actor from authenticated request
state and derives provenance/audit timestamps at mutation time.

The existing Recipe `updatedAt` remains the public version authority and
`expectedUpdatedAt` remains the optimistic write precondition. A stale write
continues to fail under the existing Recipe edit-conflict contract. Nutrition
does not create a parallel version, audit identity, or last-write-wins path.

Internal source/provenance and staff attribution are retained for auditability
but are never returned by the consumer public Recipe serializer. Their storage
names are internal implementation detail; changing the exact public v1 object
is not.

## 4. Serialization and fail-closed mobile parsing

Public serialization is field-by-field. It emits either the complete exact v1
object or `nutrition: null`; it never spreads internal provenance or Recipe
document internals.

Missing and explicit `null` nutrition are clean unavailability. A present
nutrition value that fails any exact-key, literal, number, finiteness,
nonnegative, or completeness rule is malformed authoritative data and must fail
closed. It must not be converted to `null`, partially displayed, filtered,
estimated, coerced, or zero-filled.

Mobile validates the nutrition member at its Recipe service boundary before it
becomes Recipe Detail state. Both list and detail Recipe parsing must preserve
the distinction between clean unavailability and malformed present data. A
mixed response containing malformed present nutrition must not yield a
valid-looking partial collection.

## 5. Per-serving invariant

All v1 nutrition values are per serving. Recipe Detail's selected serving count
does not change nutrition values, basis, units, or source meaning. The client
must not multiply, divide, interpolate, infer, or recompute nutrition when the
serving stepper changes.

The existing serving stepper continues to scale only structured ingredient
quantities and to supply existing Cook Mode handoff state. Nutrition display
reads directly from the authoritative per-serving object and remains
numerically stable across serving changes.

## 6. JSON-LD suggestion-only contract

Schema.org nutrition is untrusted suggestion input. It may produce a local
suggestion only when all six v1 nutrients, their units, and the per-serving
basis are explicit and unambiguous. There is no heuristic nutrient derivation,
unit guessing, missing-value fill, total-recipe division, ingredient-based
calculation, serving inference, percentage conversion, or partial suggestion.

Preview and URL import perform no Recipe mutation. The suggestion must disclose
its source and requires an explicit Moderator acceptance action before it enters
the existing local authoring form. The ordinary explicit save action remains
required afterward. Replacing pasted input or completing a later URL import
invalidates the prior unaccepted suggestion and its provenance handoff.

JSON-LD author, publisher, date, or free-form identity cannot become trusted
WeCooked staff attribution. The URL adapter may hand the server-returned final
`sourceUrl` to the single intake parser as source context; it must not create a
second nutrition parser or persistence path.

## 7. Migration and backfill contract

The migration consumes a separately approved artifact whose records are keyed
only by canonical Recipe ObjectId. It must not match, join, or fall back by
title, slug, source title, array position, display text, or fuzzy content.

The migration is dry-run by default. Dry-run validates the approved artifact,
reports matched, eligible, unchanged, invalid, missing, stale/conflicting, and
would-change counts, and performs zero writes. It must not print credentials,
connection strings, full Recipe documents, raw source payloads, or internal
staff identity.

Apply requires an explicit flag and a separately authorized environment. It
must preserve unrelated Recipe fields, use canonical ids, fail closed on
invalid nutrition, and be idempotent. Production apply is a separate operator
gate and is not authorized during RECIPE4 implementation. No implementation
test or dry-run result may be reported as a production backfill.

The explicit API package command is:

```json
"migrate:recipe-nutrition-v1": "node scripts/migrate-recipe-nutrition-v1.js"
```

The command remains dry-run unless the separate explicit apply option is
supplied.

## 8. Exact production allowlist

Only these production paths may be added or modified during implementation:

```text
apps/api/src/modules/recipes/recipe.model.js                         (modify)
apps/api/src/modules/recipes/recipe.validation.js                    (modify)
apps/api/src/modules/recipes/recipe.service.js                       (modify)
apps/api/src/modules/recipes/recipe.serializer.js                    (modify)

apps/admin/src/recipeAuthoring/recipeAuthoringModel.js               (modify)
apps/admin/src/recipeAuthoring/recipeAuthoringState.js               (modify)
apps/admin/src/recipeAuthoring/RecipeAuthoringSteps.jsx              (modify)
apps/admin/src/recipeAuthoring/RecipeReview.jsx                      (modify)
apps/admin/src/recipeAuthoring/recipeAuthoring.css                   (modify)
apps/admin/src/recipeAuthoring/recipeIntake.js                       (modify)
apps/admin/src/recipeAuthoring/recipeUrlImport.js                    (modify)

apps/mobile/src/api/recipeService.js                                 (modify)
apps/mobile/src/screens/RecipeDetailScreen.js                        (modify)

apps/api/scripts/migrate-recipe-nutrition-v1.js                      (new)
apps/api/package.json                                                (modify)
docs/milestones/MOBILE-RECIPE4-authoritative-nutrition.md            (modify)
```

`RecipeAuthoringSteps.jsx` owns the existing Details controls;
`RecipeReview.jsx` owns the shared authoring/read-only Review projection; and
`recipeAuthoring.css` owns their existing visual system.
`recipeAuthoringModel.js` owns form shape, normalization, validation, PATCH
generation, and server-to-form mapping. `recipeAuthoringState.js` owns saved
versus working form state and replacement/conflict behavior.

`recipeIntake.js` remains the sole pasted/URL candidate parser.
`recipeUrlImport.js` is the exact current candidate plus final-URL handoff. The
backend URL-import service already returns both and is not allowlisted.
`RecipeDetailsModal.jsx`, `RecipeAuthoringWizard.jsx`, and
`useRecipeAuthoring.js` compose the allowlisted model/state/components and do
not require RECIPE4 changes. Existing Recipe PATCH routing, controller, and
repository behavior is reused and those production paths are not allowlisted.

No root package file, lockfile, shared package, native configuration, Recipe
controller/route/repository, API URL-import module, or other production path is
authorized. If one becomes necessary, stop and amend this contract first.

## 9. Exact test allowlist

Only these test paths may be added or modified during implementation:

```text
apps/api/test/recipe-model.test.js                                   (modify)
apps/api/test/recipe-validation.test.js                              (modify)
apps/api/test/recipe-service.test.js                                 (modify)
apps/api/test/recipe-routes.test.js                                  (modify)
apps/api/test/recipe-authoring.test.js                               (modify)
apps/api/test/recipe-nutrition-migration.test.js                     (new)

apps/admin/test/recipeAuthoringModel.test.js                         (modify)
apps/admin/test/recipeAuthoringState.test.js                         (modify)
apps/admin/test/recipeIntake.test.js                                 (modify)
apps/admin/test/recipeIntakeIntegration.test.js                      (modify)
apps/admin/test/recipeUrlImport.test.js                              (modify)
apps/admin/test/recipeDuplicateReview.test.js                        (modify)

apps/mobile/__tests__/recipeService.test.js                          (new)
apps/mobile/__tests__/recipeDetailStaticAudit.test.js                (modify)
apps/mobile/__tests__/recipeDetailInteraction.test.js                (new)
```

`recipeDuplicateReview.test.js` is the existing test that imports and mounts
the shared `RecipeReview.jsx`; its filename reflects its first feature, not an
alternative Review component. `recipeService.test.js` and
`recipeDetailInteraction.test.js` are exact new service-boundary and mounted-
screen proof files. The migration test name follows the existing
`recipe-metadata-migration.test.js` convention.

Required proof includes the exact schema, strict keys, fixed literals/units,
finite nonnegative values, complete-or-null behavior, malformed-present
failure, public redaction, current authorization and concurrency, server-owned
attribution, explicit JSON-LD acceptance and provenance handoff, ID-only
dry-run/apply migration behavior, service-boundary rejection without partial
collections, mounted stable nutrition across serving changes, and preservation
of every existing Recipe Detail action.

## 10. Recipe Detail preservation and exclusions

RECIPE4 may populate the existing Nutrition card but must preserve all existing
Recipe Detail layout and action behavior, including freshness/loading states,
header actions, Favorites, Collections, ratings/reviews, metadata, serving
stepper, structured ingredient scaling, substitutions, ordered instructions,
Shopping import, Meal Plan, sharing, and Start Cooking.

Explicitly excluded:

- COOK2 step, timer, or media behavior;
- Shopping, Meal, Saved, or Ingredient changes;
- DISC6 taxonomy expansion;
- smart/health collection semantics;
- MealPlanSheet race hardening;
- CollectionPickerSheet race hardening;
- nutrition goals, recommendations, health scores, dietary inference, allergy
  or medical claims;
- client-side nutrition estimation or scaling;
- a new Recipe route, capability, concurrency token, public staff identity, or
  second import/parser path;
- packages, lockfiles, shared-contract expansion, native configuration, or new
  dependencies; and
- production migration/backfill execution during implementation.

## 11. Migration and runtime gates

Implementation-time automated evidence is separate from these later gates:

1. An isolated non-production Mongo dry-run against representative missing,
   null, valid, invalid, stale, absent-id, unchanged, and would-change records.
2. A separately authorized isolated non-production apply proving canonical-ID
   matching, unrelated-field preservation, conflict behavior, idempotency, and
   public redaction.
3. Staff Portal browser verification for manual entry, exact validation,
   Details/Review display, pasted JSON-LD, URL import, source disclosure,
   explicit acceptance, save, stale conflict, source replacement, keyboard,
   focus, screen-reader naming, narrow layout, and both themes.
4. Physical mobile verification that null and populated Nutrition cards render
   correctly; changing servings leaves every nutrition value unchanged; all
   existing actions still work; and accessibility names/focus remain usable.
5. Production migration apply only under a later explicit authorization, with
   pre-apply dry-run review, backup/rollback readiness, post-apply aggregate,
   and sanitized operator evidence.

Automated tests cannot satisfy browser, physical-device, accessibility-runtime,
provider, isolated-live-Mongo, or production-apply gates. No such gate may be
claimed from unit, static, mounted-Jest, or migration-fixture evidence.

Current gate dispositions:

Staff Portal browser:
**NOT RUN — NOT CLAIMED AS PASS**

Physical mobile/accessibility:
**NOT RUN — NOT CLAIMED AS PASS**

Isolated live-Mongo:
**NOT RUN — NOT CLAIMED AS PASS**

Production migration:
**NOT RUN — NOT CLAIMED AS PASS**

## 12. Adjacent findings kept outside RECIPE4

The audit observed adjacent async lifecycle risk in `MealPlanSheet` and
`CollectionPickerSheet`: a late completion from an older close/reopen session
can require generation/session ownership hardening. Those components and their
tests are outside RECIPE4. Nutrition work must not opportunistically change
them or claim their races resolved.

Broader COOK2 behavior and any cross-feature use of nutrition for discovery,
Saved collections, Shopping, Meal Plan, Ingredient, recommendations, or health
classification remain separate audits. Their absence does not block the narrow
RECIPE4 implementation.

## 13. Blockers, stop condition, and verdict

There are no remaining implementation blockers or unresolved path ambiguities
on the audited baseline. Implementation and independent automated closure
review are complete. Staff Portal browser, physical mobile/accessibility,
isolated live-Mongo, and production migration remain explicitly unrun and are
not claimed as release or runtime completion.

If implementation needs any production or test path outside sections 8 and 9,
stop and amend this contract before editing it.

**MOBILE-RECIPE4 IMPLEMENTATION COMPLETE — INDEPENDENT REVIEW COMPLETE — CLOSURE REVIEW PASS — READY FOR FINALIZATION**
