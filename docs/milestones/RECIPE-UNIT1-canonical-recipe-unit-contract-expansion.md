# RECIPE-UNIT1 - Canonical Recipe Unit Contract Expansion

Status: implementation, data gates, independent review, and runtime verification complete - ready for repository finalization

Audit date: 2026-09-28

Audited branch: `main`

Audited commit: `d753d28a05c057ded0cafd736cc0061b6257aac8`

Application code status: read-only during this audit

## 1. Goal and verdict

Expand the canonical Recipe measurement-unit contract only far enough for the
existing ING1 import resolver to normalize common pound and ounce source text
without treating a unit token as part of the Ingredient name.

The change is additive. Persisted Recipe and Shopping List data must continue
to contain canonical values only. Import-only aliases may normalize to a
canonical value, but Recipe and Shopping List request bodies must reject alias,
case, and punctuation variants. No quantity conversion, density conversion,
unit inference, Ingredient creation, or ING2 UI change is authorized.

Verdict: **AUDIT PASS — READY FOR IMPLEMENTATION**.

## 2. Verified current-main baseline

The audit began from current `main` after ING1 was merged:

```text
git status --short --branch
## main...origin/main
?? AGENTS.md
?? app.json
?? apps/api/audit-result.json
?? apps/mobile/.tmp-expo-config-error.txt
?? docs/WeCooked_Android_Dev_Build_Setup.md
?? docs/WeCooked_Local_Development_Startup.md
?? docs/architecture/WeCooked_Full_Project_Handoff.md
?? docs/architecture/frontend-migration-m2-screen-audit.md
?? docs/milestones/M25-email-verification.md

git rev-parse HEAD
d753d28a05c057ded0cafd736cc0061b6257aac8

git branch --show-current
main

git merge-base HEAD main
d753d28a05c057ded0cafd736cc0061b6257aac8

git rev-parse origin/main
d753d28a05c057ded0cafd736cc0061b6257aac8

git rev-list --left-right --count HEAD...origin/main
0  0
```

HEAD is `d753d28 Merge pull request #71 from
klaynn/feat/moderator-ops-ing1-canonical-ingredient-resolution`.
The listed untracked files pre-date this audit and were not modified.

The IDE-referenced
`docs/milestones/MODERATOR-OPS-ING2-missing-ingredient-creation-from-import.md`
does not exist in the live checkout and is not present in Git status. No ING2
file or application work was inspected through a stash, created, or modified.
The supplied runtime observation is accepted as the reproduction evidence for
this audit; ING2 remains parked.

## 3. Current canonical unit contract

### 3.1 Canonical values

The current canonical set contains exactly 15 persisted values, in this order:

```text
g
kg
ml
l
tsp
tbsp
cup
piece
clove
slice
can
pack
bunch
pinch
toTaste
```

`apps/api/src/shared/constants/measurement-units.js#UNITS` is the backend
source of truth shared by Recipe ingredients and Shopping List items. The
Admin and mobile applications deliberately mirror it because the browser and
React Native bundles cannot import backend CommonJS source.

Every value except `toTaste` is measurable and requires a finite numeric
quantity greater than zero. `toTaste` requires quantity to be absent; request
validation also accepts explicit `null` and service normalization removes it
before persistence. Unit conversion is not performed anywhere.

### 3.2 Definition, validation, persistence, and serialization

| Boundary | Current authority and behavior |
|---|---|
| Backend unit definition | `apps/api/src/shared/constants/measurement-units.js` exports `UNITS`, positive-number checking, and the shared Mongoose quantity/unit hook. |
| Recipe request validation | `apps/api/src/modules/recipes/recipe.validation.js` builds `unitSchema = z.enum(UNITS)` and applies it to Draft, create, replacement PATCH, Publish completeness, restore, and legacy-completeness paths. Input must already be an exact canonical value. |
| Recipe persistence | `apps/api/src/modules/recipes/recipe.model.js` stores `ingredients[].unit` as a required string with `enum: UNITS`. `RecipeService.normalizeIngredients` passes the validated unit unchanged, and the repository writes through Mongoose with validators enabled for updates. MongoDB stores the canonical string on each embedded usage. |
| Recipe serialization | `apps/api/src/modules/recipes/recipe.serializer.js` returns `unit: entry.unit` unchanged in public and Staff payloads. It does not normalize aliases on read. |
| Shopping List validation/persistence | `shopping-list.validation.js` and `shopping-list.model.js` consume the same `UNITS`; the service merges by exact `ingredientId + unit`, imports Recipe units unchanged, and performs no conversion. |
| Shopping List serialization | `shopping-list.serializer.js` returns the stored unit unchanged. |
| Admin authoring | `apps/admin/src/recipeOptions.js#RECIPE_UNITS` supplies exact option values and labels. `recipeAuthoringModel.js` derives its valid-unit set, validates rows, and sends the selected canonical value unchanged. Both normal authoring rows and ING1 confirmation use the same options. |
| ING1 import parsing | `apps/api/src/modules/ingredients/ingredient-resolution.js#UNIT_TOKENS` maps controlled source tokens to a canonical hint only after a valid leading quantity. The result is advisory until a Moderator explicitly confirms a canonical Ingredient and valid quantity/unit pair. |
| Mobile Recipe display | `apps/mobile/src/api/recipeOptions.js` mirrors the values and labels. Recipe Detail, Cook Mode, and shared Recipe formatters use `unitLabel`; unknown values fall back to the raw value rather than being discarded. |
| Mobile Shopping List | The manual picker renders `RECIPE_UNITS`; its service sends the chosen exact value. Shopping List display uses `unitLabel`. Recipe-to-list import preserves the server unit and merges only exact same-unit items. |

### 3.3 Current import aliases

ING1 currently recognizes the following case-insensitive tokens after a valid
leading quantity:

| Source tokens | Canonical value |
|---|---|
| `g`, `gram`, `grams` | `g` |
| `kg`, `kilogram`, `kilograms` | `kg` |
| `ml`, `milliliter`, `milliliters`, `millilitre`, `millilitres` | `ml` |
| `l`, `liter`, `liters`, `litre`, `litres` | `l` |
| `tsp`, `teaspoon`, `teaspoons` | `tsp` |
| `tbsp`, `tablespoon`, `tablespoons` | `tbsp` |
| `cup`, `cups` | `cup` |
| `piece`, `pieces` | `piece` |
| `clove`, `cloves` | `clove` |
| `slice`, `slices` | `slice` |
| `can`, `cans` | `can` |
| `pack`, `packs` | `pack` |
| `bunch`, `bunches` | `bunch` |
| `pinch`, `pinches` | `pinch` |

Exact trailing `to taste`, independently case-insensitive, maps to `toTaste`
and clears quantity. An exact optional `of` after a recognized unit is removed.

The parser currently lowercases but does not remove punctuation from its first
post-quantity token. Consequently `3/4 lb. spaghetti` produces quantity
`0.75`, unit `null`, and name `lb. spaghetti`. Dotted forms of even current
abbreviations, such as `tsp.`, are also not recognized.

## 4. Affected application boundaries

The unit contract crosses all of these live paths:

```text
Schema.org recipeIngredient source string
  -> ING1 resolver token normalization
  -> advisory parsed quantity/unit/name
  -> Moderator selects canonical Ingredient and confirms
  -> Admin authoring canonical option/value validation
  -> Recipe Zod request validation
  -> Recipe service normalization
  -> Recipe Mongoose enum
  -> MongoDB embedded Recipe ingredient
  -> Recipe serializer
  -> Admin review / mobile Recipe Detail / Cook Mode
  -> Shopping List recipe import
  -> Shopping List validation/model/merge/serializer
  -> mobile Shopping List display and manual picker
```

The backend constant, ING1 parser, Admin mirror, and mobile mirror require
implementation edits. Recipe model/validation/service/repository/serializer,
Shopping List model/validation/service/serializer, Admin authoring model and
renderers, and mobile renderers/payload code are affected consumers but already
derive from or pass through those four authorities and must not be edited
unless implementation evidence disproves this audit.

The public request contract remains strict. Alias normalization occurs only in
the read-only ING1 parser; it must not be added to generic Recipe or Shopping
List validation, Mongoose setters, serializers, or read paths.

## 5. Proposed canonical additions

Add exactly these two measurable canonical values:

| Canonical value | Display label | Decision and evidence |
|---|---|---|
| `lb` | `lb` | **Add.** The supplied ING2 runtime import contains `3/4 lb. spaghetti`. The repository's legacy Filipino recipe corpus also contains repeated `lb`/`lbs` ingredient lines. Without a canonical value, ING1 cannot safely remove the source unit from the Ingredient-name query or persist the confirmed amount without conversion. |
| `oz` | `oz` | **Add.** The same repository recipe corpus contains an `8 oz pancit canton noodles` usage. Ounce is the corresponding common US weight unit and can be preserved exactly without conversion. |

The resulting canonical set is exactly 17 values:

```text
g, kg, lb, oz, ml, l, tsp, tbsp, cup, piece, clove, slice, can, pack,
bunch, pinch, toTaste
```

Place `lb` and `oz` with the other mass units, after `kg` and before the volume
units, in backend, Admin, and mobile lists. Order is presentation/order
consistency only; it has no persistence meaning.

Do not add `lbs`, `pound`, `pounds`, `ounce`, `ounces`, capitalized values, or
dotted values to persistence. They are import aliases only. Do not add fluid
ounce (`fl oz`), stone, stick, head, jar, packet, pint, quart, gallon, or any
other new unit without separate repository/product evidence and a new audit.

## 6. Accepted import aliases and normalization

After implementation, the base token table is frozen as:

| Accepted base source tokens | Canonical value |
|---|---|
| `g`, `gram`, `grams` | `g` |
| `kg`, `kilogram`, `kilograms` | `kg` |
| `lb`, `lbs`, `pound`, `pounds` | `lb` |
| `oz`, `ounce`, `ounces` | `oz` |
| `ml`, `milliliter`, `milliliters`, `millilitre`, `millilitres` | `ml` |
| `l`, `liter`, `liters`, `litre`, `litres` | `l` |
| `tsp`, `teaspoon`, `teaspoons` | `tsp` |
| `tbsp`, `tablespoon`, `tablespoons` | `tbsp` |
| `cup`, `cups` | `cup` |
| `piece`, `pieces` | `piece` |
| `clove`, `cloves` | `clove` |
| `slice`, `slices` | `slice` |
| `can`, `cans` | `can` |
| `pack`, `packs` | `pack` |
| `bunch`, `bunches` | `bunch` |
| `pinch`, `pinches` | `pinch` |

Normalization is limited to the candidate unit token and must occur only after
the existing valid leading-quantity grammar succeeds:

- trim the source line using the current behavior;
- compare the ASCII alias case-insensitively and emit the lower-case canonical
  value, so `LB`, `Lb`, and `lb` all produce `lb`;
- accept exactly one optional terminal ASCII period on a recognized base token,
  so `tsp. -> tsp`, `tbsp. -> tbsp`, `g. -> g`, `kg. -> kg`, `ml. -> ml`,
  `l. -> l`, `LB. -> lb`, `lbs. -> lb`, and `oz. -> oz`;
- keep the existing optional exact `of` handling and exact trailing `to taste`
  handling;
- remove a token from the parsed Ingredient name only after the normalized base
  token has an exact entry in the frozen alias table.

The optional period rule applies uniformly to every base token in the table;
for example, `cups.` and `ounces.` are accepted. It removes one terminal `.`
only. Commas, multiple periods, slashes, hyphens, quotes, and other punctuation
are not stripped or guessed. Unsupported tokens remain in the parsed name, and
ingredient-name matching retains its existing trim/lowercase/whitespace-only
normalization. No singularization, stemming, spelling correction, synonym
inference, or unit conversion is authorized.

Examples:

| Source | Parsed result |
|---|---|
| `3/4 lb. spaghetti` | `{ quantity: 0.75, unit: "lb", name: "spaghetti" }` |
| `8 OZ pancit canton noodles` | `{ quantity: 8, unit: "oz", name: "pancit canton noodles" }` |
| `1 TbSp. of soy sauce` | `{ quantity: 1, unit: "tbsp", name: "soy sauce" }` |
| `2 cups. rice` | `{ quantity: 2, unit: "cup", name: "rice" }` |
| `1 fl oz milk` | `{ quantity: 1, unit: null, name: "fl oz milk" }` |
| `1 lb.. spaghetti` | `{ quantity: 1, unit: null, name: "lb.. spaghetti" }` |
| `1 stone beef` | `{ quantity: 1, unit: null, name: "stone beef" }` |

## 7. Migration and backward-compatibility assessment

No migration is required for valid existing Recipe or Shopping List documents.
The change adds enum values and does not rename or reinterpret any of the 15
existing canonical values. Quantities remain in their stored unit; nothing is
converted between metric and US customary measures.

Current API request validation admits only the existing exact canonical enum,
and Mongoose enforces the same enum. Therefore valid data created through the
live application cannot contain `lb`, `oz`, aliases, dotted forms, or case
variants today. The audit did not connect to or scan a live MongoDB, so a
read-only distinct-value/count query over both `recipes.ingredients.unit` and
`shoppinglists.items.unit` is a deployment gate. If that scan finds any value
outside the pre-implementation 15-value set, stop and audit the provenance;
do not silently normalize historical data in this milestone.

Backward compatibility:

- existing stored data and existing API clients remain valid;
- older mobile builds render unknown `lb`/`oz` values as their raw safe labels,
  but do not offer them in the manual picker;
- an older Admin build does not offer `lb`/`oz` and must not be used to edit a
  newly authored row with either unit;
- an old backend rejects a new client sending `lb`/`oz`.

Deploy the API contract first, then the updated Admin and mobile clients, and
do not begin authoring `lb`/`oz` data until the API and Staff Portal versions
are both live. This is a coordinated additive rollout, not a data migration.

## 8. Exact implementation allowlist

Backend production:

```text
apps/api/src/shared/constants/measurement-units.js                 (modify)
apps/api/src/modules/ingredients/ingredient-resolution.js          (modify)
```

Admin production:

```text
apps/admin/src/recipeOptions.js                                    (modify)
```

Mobile production:

```text
apps/mobile/src/api/recipeOptions.js                               (modify)
```

Contract documentation:

```text
docs/architecture/recipes.md                                       (modify)
docs/architecture/favorites-shopping-list.md                       (modify)
docs/architecture/mobile-shopping-list-manual-add.md               (modify)
```

No Recipe model, validation, controller, service, repository, serializer, or
route; no Shopping List production file; no Admin authoring component/model;
no mobile Recipe/Shopping component or service; no Ingredient model/catalog
mutation; no ING2 file; no M27/URL1 intake parser; no shared package; no
migration/script; no package/lockfile; no environment/deployment file; and no
protected documentation file is allowlisted. The historical ING1 milestone is
not rewritten. If implementation needs another production or documentation
file, stop and amend this audit before editing it.

## 9. Exact test allowlist and required coverage

Only these test files may be created or modified:

```text
apps/api/test/ingredient-resolution.test.js                         (modify)
apps/api/test/recipe-model.test.js                                  (modify)
apps/api/test/recipe-validation.test.js                             (modify)
apps/api/test/recipe-routes.test.js                                 (modify)
apps/api/test/recipe-service.test.js                                (modify)
apps/api/test/shopping-list-model.test.js                           (modify)
apps/api/test/shopping-list-validation.test.js                      (modify)
apps/api/test/shopping-list-routes.test.js                          (modify)
apps/api/test/shopping-list-service.test.js                         (modify)
apps/api/test/catalog-consistency-audit.test.js                     (modify)
apps/admin/test/recipeAuthoringModel.test.js                        (modify)
apps/admin/test/recipeIngredientResolution.test.js                  (modify)
apps/mobile/__tests__/recipeUnitContract.test.js                    (new)
```

Required automated coverage:

- assert the exact 17-value canonical set and matching Admin/mobile order and
  labels;
- prove Recipe and Shopping List Mongoose schemas accept `lb`/`oz` with a
  positive finite quantity and preserve the existing `toTaste` rule;
- prove Recipe and Shopping List request validation accepts only exact `lb`
  and `oz`, while rejecting `lb.`, `lbs`, `pound`, `oz.`, `ounce`, `LB`, `OZ`,
  unsupported units, and missing/nonpositive/nonfinite quantities;
- prove create, Draft/PATCH, serialization, and Recipe-to-Shopping-List flows
  preserve the exact canonical unit without conversion;
- exhaustively test every frozen base alias, case normalization, and exactly
  one optional terminal period;
- test `3/4 lb. spaghetti` and `8 OZ pancit canton noodles` end to end through
  parsing, resolver classification input, Admin confirmation, and canonical
  payload creation;
- prove unsupported or malformed punctuation (`fl oz`, `lb..`, `lb,`, unknown
  unit) is not consumed and remains in the Ingredient-name hint;
- prove all 15 existing canonical units/aliases and `to taste` remain unchanged;
- prove Admin validation/options accept `lb`/`oz` and send only canonical
  values; and
- prove mobile Recipe, Cook Mode, Shopping List display, and manual-picker
  labels render `lb`/`oz` from the canonical mirror without conversion.

All other tests in the commands below are regression-only and are not
allowlisted for modification.

## 10. Exact test commands for implementation

Focused backend contract, parser, Recipe, and Shopping List:

```text
node --test --test-isolation=none apps/api/test/ingredient-resolution.test.js apps/api/test/recipe-model.test.js apps/api/test/recipe-validation.test.js apps/api/test/recipe-routes.test.js apps/api/test/recipe-service.test.js apps/api/test/recipe-update-validators.test.js apps/api/test/shopping-list-model.test.js apps/api/test/shopping-list-validation.test.js apps/api/test/shopping-list-routes.test.js apps/api/test/shopping-list-service.test.js
```

Focused Admin authoring and ING1 confirmation:

```text
node --test --test-isolation=none apps/admin/test/recipeAuthoringModel.test.js apps/admin/test/recipeIngredientResolution.test.js apps/admin/test/recipeIntakeIntegration.test.js apps/admin/test/recipeAuthoringState.test.js
```

Focused mobile rendering and manual Shopping List picker:

```text
npm test --workspace=apps/mobile -- --runInBand __tests__/recipeUnitContract.test.js __tests__/recipeDurationFormatting.test.js __tests__/cookModeData.test.js __tests__/recipeDetailStaticAudit.test.js __tests__/shoppingListStaticAudit.test.js
```

Relevant authority regressions:

```text
node --test --test-isolation=none apps/api/test/recipe-authoring.test.js apps/api/test/catalog-consistency-audit.test.js apps/api/test/ingredient-service.test.js apps/api/test/ingredient-routes.test.js
node --test --test-isolation=none apps/admin/test/recipeAuthoringApiContract.test.js apps/admin/test/recipeAuthoringAcknowledgement.test.js apps/admin/test/recipeCatalogFreshness.test.js
```

Build and final checks:

```text
npm run build --workspace=apps/admin
git diff --check
git diff --stat
git status --short --branch
```

If a Vite/Jest worker or Admin build hits the established Windows sandbox
`spawn EPERM` or teardown hang, rerun the identical read-only command outside
the sandbox and record both results. Do not weaken tests or treat an environment
failure as a product failure.

## 11. Runtime verification requirements

Automated tests do not prove live persistence, browser behavior, mobile
rendering, or the state of deployed data. After implementation:

1. Before deployment, run read-only distinct-value and count queries for
   `recipes.ingredients.unit` and `shoppinglists.items.unit`. Record the values
   and counts; any value outside the current 15-value set is a stop condition
   requiring a separate data audit.
2. In a real Moderator Staff Portal session against a controlled live
   API/database, import a Recipe containing `3/4 lb. spaghetti`, `8 OZ pancit
   canton noodles`, `1 TbSp. soy sauce`, `2 g. salt`, and representative
   existing aliases.
3. Confirm the resolver returns `0.75 / lb / spaghetti`, `8 / oz / pancit
   canton noodles`, and canonical lower-case values for dotted/cased aliases.
   Confirm source text remains visible and no Recipe or Ingredient write occurs
   before explicit confirmation.
4. Exercise unsupported `1 fl oz milk`, `1 lb.. spaghetti`, `1 lb, spaghetti`,
   and `1 stone beef`. Confirm the unsupported token is retained in the name
   hint and no false canonical unit is produced.
5. Confirm a canonical Ingredient selection plus explicit confirmation creates
   an ordinary authoring row and sends only `unit: "lb"` or `unit: "oz"` in
   Draft/PATCH/Publish bodies. Confirm direct bodies using aliases, punctuation,
   or uppercase are rejected with the normal validation response.
6. Reload the saved Draft and Published Recipe. Verify MongoDB and API responses
   contain only canonical `lb`/`oz`, exact quantities, and unchanged Ingredient
   names. Verify archive/restore and publication completeness remain intact.
7. Verify Staff authoring dropdowns and review display show `lb` and `oz`, and
   every existing unit remains available with unchanged labels and `toTaste`
   behavior.
8. On a real supported mobile build, verify Recipe Detail and Cook Mode render
   `lb`/`oz`; add the Recipe to Shopping List and confirm exact-unit merge
   behavior, no conversion, correct serialization, and correct display.
9. In the mobile manual picker, add canonical `lb` and `oz` items, verify the
   payloads and persisted values, then add the same Ingredient in a different
   unit and confirm it remains a separate item.
10. Verify keyboard/focus/accessibility labeling for the added Admin options and
    mobile unit chips, supported themes, responsive layout, and clean browser,
    Metro, API, and device logs.

Do not claim runtime PASS until every applicable item is measured. No runtime,
live MongoDB, browser, Android/iOS device, or visual verification was performed
during this read-only audit.

## 12. Blockers, stop conditions, and deferred work

There is no present implementation blocker.

Stop implementation and amend this audit if:

- a live distinct-value scan finds noncanonical stored units;
- adding `lb`/`oz` requires a Recipe or Shopping List migration, conversion, or
  production edit outside the exact allowlist;
- alias normalization cannot remain isolated to the ING1 read-only parser;
- punctuation normalization would remove a token that is not an exact frozen
  alias or would modify Ingredient-name matching;
- the Admin or mobile mirrors cannot remain exactly aligned with backend
  canonical order/values; or
- implementation would touch, unblock, or otherwise modify parked ING2 work.

Deferred and not authorized:

- any ING2 UI, missing-Ingredient creation, IngredientDraft, catalog mutation,
  auto-selection, or auto-confirmation;
- unit conversion, density-aware conversion, serving conversion beyond the
  existing numeric scaling, or merging across different canonical units;
- `fl oz` or any unit beyond the exact two additions;
- natural-language quantities, ranges, Unicode fractions, note/preparation
  extraction, plural stemming, fuzzy matching, or AI inference;
- cleanup or migration of unexpected stored values discovered by the runtime
  scan; and
- changes to protected handoff documentation. It still records the historical
  15-value contract and requires separate explicit authorization if a current
  handoff refresh is desired.

## 13. Final audit verdict

**AUDIT PASS — READY FOR IMPLEMENTATION**

Implementation is authorized only within sections 8 and 9 and remains subject
to the automated, data-scan, and runtime gates above. This audit does not
authorize application implementation now, staging, commit, push, package
changes, data mutation, or any ING2 modification.

## 14. Final implementation summary

RECIPE-UNIT1 is implemented within the exact production, test, and architecture
documentation allowlists in sections 8 and 9. The final implementation:

- expands the shared backend canonical Recipe and Shopping List unit contract
  from 15 to exactly 17 values by adding `lb` and `oz` after `kg`;
- keeps the Admin and mobile unit mirrors in the same exact order with the
  canonical `lb` and `oz` labels;
- adds `lb`, `lbs`, `pound`, `pounds`, `oz`, `ounce`, and `ounces` only as
  ING1 import aliases and accepts exactly one optional terminal ASCII period
  on every frozen base alias after the existing leading-quantity parse;
- preserves unsupported or malformed tokens in the Ingredient-name hint and
  does not add generic request normalization, unit inference, or conversion;
- preserves canonical `lb`/`oz` unchanged through Recipe validation, model,
  create/PATCH/service/serialization, Shopping List validation, model, manual
  add, Recipe import, merge, serialization, and mobile display paths; and
- updates the three allowlisted architecture documents to describe the current
  17-value, no-conversion contract.

No Recipe or Shopping List production consumer outside the shared authority,
no Ingredient catalog model or data, no package/lockfile, no deployment file,
no migration, no protected document, and no ING2 file was changed.

## 15. Review findings, fixes, and final re-review

The independent review inspected the complete UNIT1 diff for allowlist scope,
canonical-order drift, alias leakage into persisted request contracts,
over-broad punctuation handling, conversion behavior, existing-unit regression,
and insufficient boundary coverage. Review closure is reflected in the final
diff as follows:

1. Canonical contract assertions now prove the exact 17-value backend, Admin,
   and mobile order rather than checking only that the two new values exist.
2. Parser coverage exhaustively exercises every frozen alias with case folding
   and exactly one optional terminal period, while proving `fl oz`, `lb..`,
   `lb,`, and unknown units remain unconsumed in the name hint.
3. Recipe and Shopping List model, validation, route, and service coverage now
   proves exact canonical acceptance, alias/case/punctuation rejection,
   positive finite quantities, unchanged serialization, exact-unit merging,
   and no conversion.
4. Admin confirmation and mobile contract tests now trace the new values
   through the actual authoring/display helpers and bounded render wiring.
5. The catalog-audit failure-path test now supplies an explicit empty `argv`
   so ambient Node test-runner arguments cannot alter the isolated command
   behavior under verification.

Final independent re-review result: **PASS**. No open `BLOCKER`, `MAJOR`,
`MEDIUM`, or `MINOR` findings remain. The final diff remains inside the frozen
UNIT1 implementation, test, architecture-documentation, and milestone scope.

## 16. Final automated verification

Final repository verification on 2026-09-28 produced:

```text
Focused backend Recipe/Shopping List/parser: 295 passed, 0 failed
Focused Admin authoring/ING1 confirmation:      40 passed, 0 failed
API authority regressions:                     129 passed, 0 failed
Admin authoring/catalog regressions:             14 passed, 0 failed
Focused mobile contract/rendering:               82 passed, 0 failed
Admin production build:                        PASS (1,653 modules transformed)
```

The Admin build first hit the documented Windows sandbox esbuild `spawn EPERM`.
The identical read-only build was rerun outside the sandbox and passed. Existing
dynamic-import and chunk-size warnings remain non-blocking and unrelated to
UNIT1.

## 17. Development and production Mongo data gates

The required read-only distinct-value/count gates were completed against both
development and production Mongo data before finalization.

```text
Development recipes.ingredients.unit:       PASS - canonical pre-expansion values only
Development shoppinglists.items.unit:       PASS - canonical pre-expansion values only
Production recipes.ingredients.unit:        PASS - canonical pre-expansion values only
Production shoppinglists.items.unit:        PASS - canonical pre-expansion values only
Unexpected or noncanonical stored values:   NONE FOUND
Data writes or cleanup performed by gates:  NONE
```

The supplied final gate results are **DEVELOPMENT DATA GATE: PASS** and
**PRODUCTION DATA GATE: PASS**. No historical alias, dotted, case-variant, or
otherwise out-of-contract unit requires cleanup. The scans were read-only and
did not mutate either environment.

## 18. Runtime verification

The controlled runtime checklist in section 11 was completed after
implementation. The supplied final result is:

**RUNTIME VERIFICATION: PASS**

This covers the Staff Portal import/resolution and confirmation path, strict
API rejection of noncanonical request values, saved Draft/Published Recipe
round trips, canonical Mongo/API values, existing-unit and `toTaste` behavior,
Recipe-to-Shopping-List and manual Shopping List behavior, mobile Recipe Detail
and Cook Mode display, accessibility/theme/responsive checks, and clean runtime
logs. The milestone records this completed runtime result without treating
automated tests as a substitute for it.

## 19. Migration decision

**MIGRATION REQUIRED: NO**

The change is an additive enum expansion. Both Mongo data gates found no value
outside the valid pre-expansion 15-value contract, and no existing canonical
value is renamed, reinterpreted, or converted. Existing Recipe and Shopping
List documents remain valid unchanged.

## 20. Repository-finalization readiness

The implementation, review fixes, final independent re-review, development and
production data gates, runtime verification, and no-migration decision are
complete. UNIT1 is ready for complete-diff verification, exact-path staging,
commit on a UNIT1 feature branch, and push with upstream tracking. It is not
authorized for merge to `main` in this finalization step.

The ING2 stash remains parked and must not be inspected, applied, popped,
dropped, restored, or modified. Pre-existing unrelated untracked files remain
outside the UNIT1 staging allowlist.

## 21. Final milestone verdict

**UNIT1 FINALIZATION PASS - READY FOR EXACT COMMIT/PUSH**
