# MODERATOR-OPS-META1 - Canonical Recipe Metadata Contract v1

**Contract date:** 2026-09-30

**Phase:** Contract re-freeze after product decision; milestone documentation only

**Branch:** `main`

**Baseline:** `6892642dff92b2a4dc455bd1649d5249d3979ebc`

**STATUS:** `CONTRACT FROZEN - READY FOR IMPLEMENTATION`

## 1. GOAL

Freeze one server-authoritative v1 contract for Recipe `region`, Recipe
`category`, and `dietaryTags`. This document authorizes a later, separately
requested implementation; it does not implement application code, modify live
data, stage, commit, push, touch YIELD1, or manipulate the Cook Mode stash.

## 2. PRODUCT DECISIONS

- `region` means the Philippine administrative region in which the Recipe or
  cuisine originates. META1 deliberately uses administrative regions as the
  canonical PH-only taxonomy; it is not a province, municipality, city,
  barangay, district, island group, author location, restaurant location, or
  arbitrary cuisine string.
- `category` means one primary meal occasion / meal type. It is not dish form,
  restaurant type, difficulty, Ingredient category, or Shopping category.
- The existing six-value `dietaryTags` contract remains authoritative.
- All three fields remain optional for Draft and Published Recipes. Absence is
  meaningful and must not be replaced by guessed fallback values.

## 3. FINAL REGION SEMANTICS

`Recipe.region` stores at most one canonical slug from the ordered vocabulary
in section 4. Its display label comes from the same shared contract.

The selected v1 taxonomy is the current Philippine Statistics Authority (PSA)
Philippine Standard Geographic Code administrative-region roster. The PSA
reports 18 regions and includes the Negros Island Region. META1 uses readable,
name-based slugs rather than numeric PSGC codes or Roman region numbers. A
future official rename, creation, merger, or abolition requires a versioned
product decision and migration; it must not silently change a stored slug.

Rules:

- `region` is optional and single-valued.
- A Filipino Recipe whose specific regional origin is unknown stores no
  `region` (field absent in MongoDB; API serialization remains `null`). There is
  no `unknown`, `other`, `filipino`, `philippines`, `luzon`, `visayas`, or
  `mindanao` escape value.
- A locality may support an explicit migration or Moderator choice of its
  containing administrative region, but its locality text is never stored in
  `region`.
- Do not infer origin from title, description, ingredients, author, source URL,
  restaurant location, or a generic Filipino/Asian cuisine assertion.
- Only exact canonical slugs are accepted by application writes and filters.
  Legacy aliases are migration inputs, not API aliases.
- Canonical stored region and imported cuisine/source wording are distinct.
  The former is a WeCooked classification; the latter remains untrusted source
  evidence and is not persisted into `region` by META1.

## 4. CANONICAL REGION VALUES

The order below is authoritative for shared constants, Admin controls, and
consumer filters. Labels are product display labels; slugs are the only stored
and API values.

| Order | Stored slug | Display label |
| ---: | --- | --- |
| 1 | `national-capital-region` | National Capital Region (NCR) |
| 2 | `cordillera-administrative-region` | Cordillera Administrative Region (CAR) |
| 3 | `ilocos-region` | Ilocos Region |
| 4 | `cagayan-valley` | Cagayan Valley |
| 5 | `central-luzon` | Central Luzon |
| 6 | `calabarzon` | CALABARZON |
| 7 | `mimaropa-region` | MIMAROPA Region |
| 8 | `bicol-region` | Bicol Region |
| 9 | `western-visayas` | Western Visayas |
| 10 | `negros-island-region` | Negros Island Region (NIR) |
| 11 | `central-visayas` | Central Visayas |
| 12 | `eastern-visayas` | Eastern Visayas |
| 13 | `zamboanga-peninsula` | Zamboanga Peninsula |
| 14 | `northern-mindanao` | Northern Mindanao |
| 15 | `davao-region` | Davao Region |
| 16 | `soccsksargen` | SOCCSKSARGEN |
| 17 | `caraga` | Caraga |
| 18 | `bangsamoro-autonomous-region-in-muslim-mindanao` | Bangsamoro Autonomous Region in Muslim Mindanao (BARMM) |

Roster authority checked for this v1 freeze:
[PSA PSGC - Regions](https://psa.gov.ph/classification/psgc/regions). The
application must use the frozen shared constants, not call PSA at runtime.

## 5. FINAL CATEGORY SEMANTICS

`Recipe.category` stores one optional, primary meal occasion selected by a
Moderator. V1 remains a scalar string, not an array. If a Recipe could fit
several occasions, the Moderator chooses its primary occasion or leaves the
field unset; the application does not infer or add multiple categories.

The smallest useful v1 vocabulary is breakfast, lunch, dinner, and snack. It
matches the clarified product examples without introducing a second semantic
axis. `fine-dining-restaurant`, `medium`, `soup`, `pasta`, `stew`, `ulam`,
`main-dish`, `main-course`, `dessert`, `noodles`, and `vegetable` are not
canonical Recipe categories. Dish form/course may be designed as a separate
future field, but must not be folded into this enum.

Recipe category remains wholly separate from the controlled
`Ingredient.category` taxonomy and Shopping List's projection of Ingredient
category.

## 6. CANONICAL CATEGORY VALUES

The order below is authoritative.

| Order | Stored slug | Display label |
| ---: | --- | --- |
| 1 | `breakfast` | Breakfast |
| 2 | `lunch` | Lunch |
| 3 | `dinner` | Dinner |
| 4 | `snack` | Snack |

## 7. DIETARY TAG CONTRACT

No schema expansion is required. The exact ordered values and labels remain:

| Order | Stored/API value | Display label |
| ---: | --- | --- |
| 1 | `vegetarian` | Vegetarian |
| 2 | `vegan` | Vegan |
| 3 | `pescatarian` | Pescatarian |
| 4 | `glutenFree` | Gluten-free |
| 5 | `dairyFree` | Dairy-free |
| 6 | `nutFree` | Nut-free |

`dietaryTags` remains a string array. `[]` means no dietary claim has been
asserted. Values are exact and case-sensitive; unknown values are rejected;
writes deduplicate while preserving first occurrence order. No tag implies
another tag. Tags are explicit Moderator assertions, not ingredient, allergen,
nutrition, category, or cuisine inference. No allergy, medical, religious, or
safety claim is added by META1.

## 8. IMPORT MAPPING BOUNDARY

Schema.org metadata is untrusted suggestion input and never becomes canonical
authority merely because it was imported. META1 does not add import mappings.
Any later META2 work must keep `parseRecipeIntake` as the sole mapping authority,
remain Preview/Apply-only, preserve existing form values, and require Moderator
acceptance before a suggested value enters the form. Preview/Apply performs no
persistence.

| JSON-LD field | Frozen boundary |
| --- | --- |
| `recipeCuisine` | Must not automatically become `region`. Source wording may support a future META2 suggestion only through an explicit, deterministic, allowlisted source-value to canonical-region crosswalk. Generic `Filipino`, `Philippine`, `Asian`, `Luzon`, `Visayas`, and `Mindanao` do not resolve to a specific canonical region. Unsupported source wording remains unsupported; it is not stored as `region`. |
| `recipeCategory` | May suggest only an exact canonical meal occasion. After trimming and case-folding a single plain-text token, only `breakfast`, `lunch`, `dinner`, or `snack` may map to the identically named canonical slug. Compound, list, course, dish-form, restaurant, or difficulty wording is unsupported and must not be guessed. |
| `suitableForDiet` | Suggestion-only. Exact Schema.org enum identity may map `VegetarianDiet` to `vegetarian`, `VeganDiet` to `vegan`, and `GlutenFreeDiet` to `glutenFree`. `LowLactoseDiet` is not `dairyFree`; Schema.org provides no exact v1 mapping for `pescatarian` or `nutFree`; Vegan does not imply Vegetarian. URL/object/bare-token syntax normalization belongs to META2, but it must preserve exact enum identity. |

No future importer may infer region/category/tags from title, prose,
ingredients, keywords, URL host, or related fields.

## 9. LEGACY DATA HANDLING

The prior projection/aggregation-only audit remains the data basis. It found
one populated dev region and two populated production regions/categories; it
performed no write. META1 freezes these exact dispositions:

| Environment | Field | Observed value | Frozen disposition | Reason |
| --- | --- | --- | --- | --- |
| dev | region | `tondo` | Approved one-time mapping to `national-capital-region` | Tondo is a locality within the canonical National Capital Region; locality text itself is not retained in `region`. |
| production | region | `bicol` | Approved one-time mapping to `bicol-region` | Deterministic legacy short name for the canonical Bicol Region. |
| production | region | `mangaldan` | Approved one-time mapping to `ilocos-region` | Mangaldan is a municipality in Pangasinan within the canonical Ilocos Region; locality text itself is not retained in `region`. |
| production | category | `fine-dining-restaurant` | Clear/unset `category` | Restaurant type has no exact meal-occasion mapping. |
| production | category | `medium` | Clear/unset `category` | It is a difficulty value, not a meal occasion. |

These mappings are migration-only decisions. They must not become runtime
aliases, broad locality lookup behavior, or silent request coercions. Missing
region/category values remain absent and receive no blanket backfill. Cleared
category records may later be classified manually by a Moderator, but the
migration must not infer an occasion from Recipe content.

## 10. MIGRATION / BACKFILL DECISION

A targeted, idempotent migration is required before strict enum enforcement is
released against live writes and filters.

- Default mode is dry-run and reports dev and production separately.
- Apply mode must require an explicit flag and operate only on the five exact
  legacy field/value cases above.
- It maps the three region values and unsets the two category values.
- It does not change missing values, canonical values, dietary tags, YIELD1
  data, publication state, timestamps unrelated to the approved migration, or
  any other field.
- It must report matched/changed/skipped/conflict counts without printing
  credentials or Recipe content.
- Re-running after success changes zero records.
- A fresh read-only aggregate after each environment must show only canonical
  populated values before strict discovery controls are released.

No live write is authorized by this contract-refreeze task.

## 11. SHARED AUTHORITY DESIGN

`packages/contracts/index.js` becomes the single dependency-free authority for
the ordered region, category, and dietary values and their labels. It exports
frozen value arrays plus frozen value-to-label objects:

- `RECIPE_REGIONS` and `RECIPE_REGION_LABELS`;
- `RECIPE_CATEGORIES` and `RECIPE_CATEGORY_LABELS`; and
- `RECIPE_DIETARY_TAGS` and `RECIPE_DIETARY_TAG_LABELS`.

The API model imports those values for Mongoose enums and may re-export them
for compatibility. API body/query validation consumes the same arrays. Admin
and mobile build their controls and label lookups from those exports; they do
not copy enums or labels.

The API remains authoritative for accepted writes and exact filters. Admin
uses controlled optional single-selects for authoring and catalog filters.
Mobile discovery adds optional single-select region and category filters that
are combined with existing filters and sent to the existing exact API query
parameters. Unknown response values receive no fabricated canonical label.

Existing serializers already return stored `region`/`category` or `null` and
`dietaryTags` or `[]`; their wire shape does not change. Existing API service
filter behavior is already exact. Summary serializers continue carrying the
same slugs, while display consumers use the shared labels. Therefore no API
serializer, controller, route, repository, or service implementation change is
required for META1.

## 12. SCHEMA / INDEX / PACKAGE IMPACT

- **Recipe schema:** validation changes are necessary: `region` and `category`
  become enums sourced from `@wecooked/contracts`. Their persisted shape stays
  an optional scalar string; no new field and no array conversion is required.
- **API validation:** create/draft/PATCH/list-query schemas must accept only the
  shared canonical values. PATCH `null` continues to unset the optional field.
  Arbitrary valid-looking slugs are rejected rather than normalized into a
  canonical value.
- **Serializers:** no schema or implementation change; wire values and null
  behavior are unchanged.
- **Indexes:** no change. Existing `{ isActive, region }` and
  `{ isActive, category }` indexes support exact filtering.
- **Packages:** no new dependency, version bump, workspace declaration, or
  lockfile change. All three apps already depend on `@wecooked/contracts`.
- **Migration:** the exact targeted migration in section 10 is required; no
  blanket backfill is required.

## 13. EXACT IMPLEMENTATION ALLOWLIST

Only these application/migration files may be modified or created by the later
META1 implementation:

- `packages/contracts/index.js`
- `apps/api/src/modules/recipes/recipe.model.js`
- `apps/api/src/modules/recipes/recipe.validation.js`
- `apps/api/scripts/migrate-recipe-metadata-v1.js` (new)
- `apps/admin/src/recipeOptions.js`
- `apps/admin/src/App.jsx`
- `apps/admin/src/RecipesTab.jsx`
- `apps/admin/src/recipeAuthoring/recipeAuthoringModel.js`
- `apps/admin/src/recipeAuthoring/RecipeAuthoringSteps.jsx`
- `apps/admin/src/recipeAuthoring/RecipeReview.jsx`
- `apps/mobile/src/api/recipeOptions.js`
- `apps/mobile/src/utils/discoverFilters.js`
- `apps/mobile/src/components/DiscoverFiltersSheet.js`
- `apps/mobile/src/screens/DiscoverScreen.js`
- `apps/mobile/src/screens/CookingHistoryScreen.js`

No import-mapping implementation file is allowlisted: `recipeCuisine`,
`recipeCategory`, and `suitableForDiet` suggestions remain META2. No serializer
is allowlisted because the response representation is already correct. No
YIELD1 file, package manifest, lockfile, route, controller, service, repository,
or index declaration is allowlisted. If implementation evidence shows another
production file is essential, stop and amend the contract rather than widening
scope silently.

## 14. EXACT TEST ALLOWLIST

Only these test files may be modified or created by the later META1
implementation:

- `apps/api/test/recipe-model.test.js`
- `apps/api/test/recipe-validation.test.js`
- `apps/api/test/recipe-service.test.js`
- `apps/api/test/recipe-routes.test.js`
- `apps/api/test/recipe-update-validators.test.js`
- `apps/api/test/recipe-metadata-migration.test.js` (new)
- `apps/api/test/collection-service.test.js`
- `apps/api/test/collection-routes.test.js`
- `apps/api/test/cook-history-service.test.js`
- `apps/api/test/cook-history-routes.test.js`
- `apps/api/test/favorite-service.test.js`
- `apps/api/test/favorite-routes.test.js`
- `apps/api/test/meal-plan-routes.test.js`
- `apps/api/test/review-routes.test.js`
- `apps/admin/test/contractsInterop.test.js`
- `apps/admin/test/dashboard.test.js`
- `apps/admin/test/recipeAuthoringModel.test.js`
- `apps/admin/test/recipeIntakeIntegration.test.js`
- `apps/admin/test/recipeMetadataContract.test.js` (new)
- `apps/mobile/__tests__/discoverFilters.test.js`
- `apps/mobile/__tests__/discoverStaticAudit.test.js`
- `apps/mobile/__tests__/recipeCuisineRetired.test.js`
- `apps/mobile/__tests__/cookingHistoryStaticAudit.test.js`
- `apps/mobile/__tests__/cookHistoryService.test.js`

The downstream route/service files above are allowlisted only to replace stale
noncanonical fixture values and assert unchanged slug serialization. Focused
tests must prove the exact order/labels, rejection of unknown values on every
write/query path, PATCH-null unsetting, optional absence, exact filter wiring,
no semantic-axis leakage, single-select UI behavior, migration dry-run/apply/
idempotence, and shared-package interop. Existing broader suites may be run
read-only; their files are not thereby authorized for modification.

## 15. RUNTIME / DATA GATES

Before implementation release or production migration:

1. Focused API, Admin, mobile, contracts-interop, and migration tests pass.
2. The migration dry-run reports exactly the expected legacy value/count set
   separately for dev and production; any new value or count drift stops the
   rollout for review.
3. An authorized operator explicitly invokes apply mode; this milestone alone
   does not authorize that external write.
4. A post-migration read-only audit shows no populated value outside the
   canonical enums and no unexpected document changes.
5. Strict API validation and controlled clients are deployed in an order that
   does not reintroduce open-slug writes.
6. Admin rendering verifies the controlled authoring/catalog controls and
   correct canonical labels.
7. Mobile rendering verifies region/category filter selection, reset/apply,
   combined exact queries, empty states, pagination, and canonical labels.

Automated/static tests do not constitute browser, Android/device, touch,
visual, or accessibility runtime proof. Those checks remain implementation
gates, not completed evidence in this documentation-only phase.

## 16. IN SCOPE

- exact v1 semantics, ordered slugs, and labels for Recipe region/category;
- reconfirmation of the six dietary tags;
- the JSON-LD suggestion boundary for future META2;
- exact disposition of the five observed legacy values;
- schema, migration, index, package, Admin, discovery, serializer, and consumer
  impact;
- a single shared authority design;
- exact future implementation/test allowlists; and
- this milestone update only.

## 17. OUT OF SCOPE

- application or test implementation in this phase;
- META2 import suggestions or changes to `parseRecipeIntake`;
- YIELD1 or servings behavior;
- live writes, migration execution, normalization, or backfills;
- subregional/province/city/municipality/barangay storage;
- a dish-form, course, cuisine, restaurant, difficulty, Ingredient, or Shopping
  taxonomy inside Recipe category;
- inferred dietary/allergen/health/safety claims;
- nutrition, keyword, rating, or recommendation metadata;
- package or lockfile changes;
- staging, commits, pushes, branch operations, or stash manipulation.

## 18. BLOCKERS / OPEN DECISIONS

There is no remaining META1 contract blocker or product decision. Runtime and
data checks in section 15 are release gates for the later implementation, not
reasons to leave the contract undefined. Any future Philippine administrative
region change or desire for multiple meal occasions requires a new versioned
decision; it is not an implicit extension of v1.

## 19. FINAL VERDICT

**META1 CONTRACT FROZEN - READY FOR IMPLEMENTATION**

## 20. IMPLEMENTATION EVIDENCE (2026-09-30)

Implementation branch: `feat/moderator-ops-meta1-recipe-metadata-contract`

Baseline: `6892642dff92b2a4dc455bd1649d5249d3979ebc`

- `packages/contracts/index.js` now owns the exact ordered Region, Recipe
  category, and dietary-tag values and label maps.
- Recipe Mongoose and Zod write/query validation consume those shared values;
  optional absence and PATCH `null` clearing remain supported, while aliases,
  arbitrary slugs, and semantic-axis leakage are rejected.
- Admin authoring and catalog filters use controlled optional selects built
  from the shared values and labels. Review and overview display paths use the
  shared labels. Recipe intake mapping remains unchanged; META2 suggestions
  were not added.
- Mobile discovery exposes optional single-select Region and category filters,
  combines them with existing exact query filters, and uses shared labels in
  discovery and cooking history. Cuisine was not reintroduced.
- `apps/api/scripts/migrate-recipe-metadata-v1.js` is dry-run by default,
  requires one explicit development/production environment, requires
  `--apply` for writes, identifies its environment/database, and implements
  only the three frozen Region mappings and two category unsets. It reports
  before/after, matched, changed, skipped, and conflict counts.
- Migration tests prove zero dry-run writes, all five exact dispositions,
  preservation of missing/canonical/unsupported metadata, and a zero-change
  second apply. No live development or production migration was invoked.
- Focused API/regression command: 385 tests passed, 0 failed.
- Focused Admin/regression command: 43 tests passed, 0 failed. The identical
  Vite-backed command required execution outside the sandbox after the sandbox
  returned `spawn EPERM`.
- Focused mobile/regression command: 118 tests passed, 0 failed.
- Admin production build passed. It retained the pre-existing Vite chunk-size
  and static/dynamic import warnings; neither warning is a META1 failure.
- `git diff --check` passed. No package manifest, lockfile, index declaration,
  serializer, route, controller, service, repository, YIELD1, or Cook Mode
  stash change was made.
- Browser/Admin rendering and Android/device/touch/visual/accessibility runtime
  checks, environment-specific live migration dry-runs, authorized apply, and
  post-migration data audits remain release gates; automated/static evidence
  does not claim those runtime checks.

**META1 IMPLEMENTATION COMPLETE - READY FOR INDEPENDENT REVIEW**
