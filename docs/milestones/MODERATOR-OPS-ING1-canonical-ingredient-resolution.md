# MODERATOR-OPS-ING1 - Canonical Ingredient Resolution

Status: implementation and runtime verification complete - ready for repository finalization

Audit date: 2026-09-28

Audited branch: `main`

Audited commit: `d712899e36a3dbfee9a18509137c8e5df13a00d6`

Application code status: read-only during this audit

## 1. Goal and verdict

Add the smallest safe Moderator-only helper for resolving imported
Schema.org `recipeIngredient` strings against existing active canonical
WeCooked Ingredients. It may parse a conservative quantity, controlled unit,
and remaining ingredient name; classify exact, ambiguous, possible, or absent
catalog matches; and offer the existing catalog picker as a fallback.

The helper is advisory. It does not create or mutate an Ingredient, does not
write a Recipe, and does not choose a candidate. A Recipe ingredient row is
created only after the Moderator explicitly selects a canonical Ingredient and
confirms a valid quantity/unit pair. Existing Draft, PATCH, Publish, conflict,
archive/restore, and catalog-freshness behavior remains authoritative.

The existing paginated `GET /ingredients?search=...` picker is the correct
manual fallback, but it cannot authoritatively classify ambiguity across the
complete active catalog. A bounded, read-only backend resolution endpoint is
therefore required. No model, migration, second Recipe lifecycle, or package
change is required.

Verdict: **AUDIT PASS - READY FOR IMPLEMENTATION**.

## 2. Verified main baseline

The audit began from current `main` after URL1 was merged:

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
d712899e36a3dbfee9a18509137c8e5df13a00d6

git branch --show-current
main

git merge-base HEAD main
d712899e36a3dbfee9a18509137c8e5df13a00d6

git rev-parse origin/main
d712899e36a3dbfee9a18509137c8e5df13a00d6

git rev-list --left-right --count HEAD...origin/main
0  0
```

HEAD is `d712899 Merge pull request #70 from
klaynn/feat/moderator-ops-url1-structured-url-recipe-import`. The untracked
files above pre-date this audit and were not modified. This milestone document
did not previously exist.

## 3. Verified current architecture

### 3.1 Recipe authoring and intake

The live write path is unchanged:

```text
Moderator Recipes tab
  -> RecipeAuthoringWizard / useRecipeAuthoring
  -> recipeApi / shared authenticated apiClient
  -> /api/v1/recipes
  -> authenticate -> requireCapability(catalog.write) -> validate
  -> recipe.controller -> recipe.service -> recipe.repository
  -> Recipe -> MongoDB
```

M27 intake and URL1 attach before that path:

```text
pasted JSON-LD or safe URL1 candidate
  -> sole parseRecipeIntake mapping authority
  -> local Preview / blank-only Apply
  -> recipeIngredient strings remain unresolved guidance
  -> existing explicit Save Draft / PATCH / Publish only
```

`RecipeAuthoringSteps.jsx` exposes intake only for a new Recipe. Its current
intake preview is component-local and displays unresolved strings on the Basics
step. It does not carry those strings into the Ingredients step. The ING1 slice
must move only the unresolved source-line working state into the existing
authoring reducer; it must not introduce another draft or persistence layer.

`recipeAuthoringState.js` already distinguishes working form state from the
last server-authoritative form. `DRAFT_CREATED`, no-PATCH `SAVE_SUCCESS`, and
unrelated-section saves preserve working state. A real PATCH replaces only its
authoritative section. `LOAD_SUCCESS` and confirmed conflict reload replace
local state with server truth. ING1 must follow the same boundaries.

### 3.2 Ingredient catalog and picker

The current catalog path is:

```text
IngredientPicker / IngredientsTab -> ingredientApi
  -> GET /api/v1/ingredients
  -> authenticate -> validate -> conditional catalog.read_all
  -> ingredient.controller -> ingredient.service
  -> ingredient.repository -> Ingredient -> MongoDB
```

The list endpoint supports authenticated literal substring search over `name`
and `aliases`, active/inactive/all status, category, allergen, fixed sorting,
and pagination. Search regex metacharacters are escaped. The shared Recipe
picker requests active results, page 1, limit 10, sorted by name, and returns a
selected `{ id, name }` pair. It is suitable for manual fallback.

The existing list endpoint is not a resolver because:

- substring results are paginated and the picker displays only the first ten;
- it does not parse source text;
- it does not distinguish canonical-name equality from alias equality;
- aliases are not globally unique and may identify multiple Ingredients;
- it does not classify a unique exact result, multiple exact results, possible
  lexical results, or no result across the complete active catalog.

### 3.3 Role authority

`capabilities.js` grants `catalog.write` to Moderator and deliberately withholds
it from Admin. `portalPolicy.js` mirrors that policy: Moderator can author,
while Admin sees catalog screens read-only and has no Add Recipe entry point.
`authenticate` reloads current database-backed role/session authority before
capability enforcement.

ING1 is an authoring helper even though its endpoint is read-only. Both its UI
and endpoint must require `catalog.write`. User and Admin requests must be
rejected before catalog resolution work. Normal authenticated Ingredient list
reads remain unchanged.

## 4. Frozen current Recipe ingredient data contract

There is one Recipe model and one ingredient-usage representation. Each stored
usage is an embedded subdocument with:

```json
{
  "ingredientId": "ObjectId -> Ingredient",
  "quantity": 1.5,
  "unit": "cup",
  "note": "optional free text",
  "optional": false
}
```

Frozen rules:

- `ingredientId` is required and references an existing canonical Ingredient.
- A Recipe may use the same canonical Ingredient more than once for distinct
  uses; ING1 must not deduplicate Recipe rows.
- Units are exactly `g`, `kg`, `ml`, `l`, `tsp`, `tbsp`, `cup`, `piece`,
  `clove`, `slice`, `can`, `pack`, `bunch`, `pinch`, and `toTaste`.
- Every unit except `toTaste` requires a finite numeric quantity greater than
  zero. `toTaste` requires quantity to be absent/null.
- The Staff Portal currently accepts positive integers, decimals, simple ASCII
  fractions, and mixed ASCII fractions, then sends the numeric value.
- `note` is optional, trimmed, and at most 200 characters. `optional` defaults
  to false.
- Drafts may have zero ingredient usages. Published Recipes require at least
  one and allow at most 50.
- Create, replacement, Publish, and restore paths verify that every referenced
  Ingredient exists and is active. Resolution does not weaken or replace that
  final server check.
- HTTP serialization returns each usage as `ingredient: { id, name } | null`,
  quantity, unit, note, and optional; internal `ingredientId` is not exposed in
  the public Recipe representation.
- Raw imported text, resolution candidates, match classifications, and parser
  diagnostics are not Recipe fields and must not enter Draft/PATCH/Publish
  bodies.

No Recipe model/schema/serializer/service change is allowed for ING1.

## 5. Frozen current canonical Ingredient contract

The sole canonical `Ingredient` model contains:

- required `name`, trimmed, maximum 100 characters;
- required internal `normalizedName`, unique and excluded from normal output;
- up to 20 aliases, each trimmed and at most 100 characters;
- required category from the shared Ingredient taxonomy;
- controlled allergen tags;
- `isActive` plus timestamps.

Current write normalization is authoritative:

- canonical-name uniqueness key: trim, lowercase, collapse whitespace;
- aliases: trim, collapse whitespace, and remove case-insensitive duplicates
  within the same Ingredient while preserving first-seen casing;
- canonical names are unique by `normalizedName` and Mongo unique index;
- aliases are not globally unique and may equal another Ingredient name or
  alias;
- create/update duplicate-key races return `409 INGREDIENT_ALREADY_EXISTS`;
- archive is soft, dependency guarded, and never cascades Recipe rewrites.

The public Ingredient serializer returns `id`, `name`, `aliases`, `category`,
`allergenTags`, `isActive`, and timestamps, never `normalizedName`.

ING1 may read only active Ingredients. It must not create, update, restore,
archive, or infer catalog metadata.

## 6. Frozen source parsing contract

Parsing is deterministic assistance, not Recipe validation. It returns hints
for every source line and never invents a missing value.

### 6.1 Input bounds

The resolution request is strict `{ lines: string[] }`:

- 1 to 50 lines, preserving input order and duplicates;
- every line must be nonblank after trim and at most 500 characters;
- no unknown body keys;
- the existing global JSON limit remains authoritative.

M27 may display more/longer unresolved source values within its existing
256 KiB intake ceiling, but ING1 must not silently truncate them. Values outside
the resolution request bounds remain visible and manually unresolved; the UI
must explain why they were not submitted.

### 6.2 Quantity grammar

Only a leading quantity using the existing Staff Portal grammar is parsed:

- positive integer: `2`;
- positive decimal: `0.5` or `.5`;
- positive simple fraction: `1/2`;
- positive mixed fraction: `1 1/2`.

The parsed result is a finite number greater than zero. Zero, negatives,
division by zero, signs, ranges, multiple numbers, words, Unicode vulgar
fractions, malformed separators, and non-finite values are not parsed.
Unparsed content is preserved in `sourceText`; it is never discarded to make a
row appear valid.

### 6.3 Unit grammar

After a valid leading quantity, recognize only these explicit tokens and map
them to the current controlled unit value:

| Accepted source tokens | Canonical unit |
|---|---|
| `g`, `gram`, `grams` | `g` |
| `kg`, `kilogram`, `kilograms` | `kg` |
| `ml`, `milliliter(s)`, `millilitre(s)` | `ml` |
| `l`, `liter(s)`, `litre(s)` | `l` |
| `tsp`, `teaspoon(s)` | `tsp` |
| `tbsp`, `tablespoon(s)` | `tbsp` |
| `cup`, `cups` | `cup` |
| `piece(s)` | `piece` |
| `clove(s)` | `clove` |
| `slice(s)` | `slice` |
| `can(s)` | `can` |
| `pack(s)` | `pack` |
| `bunch`, `bunches` | `bunch` |
| `pinch`, `pinches` | `pinch` |

An exact optional `of` immediately after a recognized unit may be removed.
Exact trailing `to taste` maps to `toTaste` with no quantity. No conversion,
abbreviation guessing, density conversion, plural stemming, or unsupported
unit mapping is allowed.

A leading quantity without a recognized unit may still be returned as a
quantity hint, but unit remains null and the Moderator must choose one. A
measurable unit without a valid quantity is not a valid row and cannot be
confirmed into the Recipe form.

### 6.4 Name and other fields

The remaining nonblank text is the name query. Parsing must not infer or strip:

- preparation notes such as chopped, divided, room temperature, or for garnish;
- optional status;
- category or allergen tags;
- brand, variety, substitutions, or equivalence;
- punctuation, diacritics, singular/plural forms, or synonyms.

`note` remains blank and `optional` remains false when a resolved row is added;
the Moderator may edit them through the existing Recipe controls. If no safe
nonblank name remains, match kind is `unparsed` and manual entry remains.

## 7. Frozen matching and normalization contract

Use one shared resolver normalization function for parsed names and catalog
names/aliases:

```text
trim -> lowercase -> collapse Unicode whitespace to one ASCII space
```

This mirrors the existing canonical-name and alias normalization semantics.
Do not remove punctuation, fold diacritics, transliterate, stem/pluralize,
calculate edit distance, use phonetics, infer synonyms, consult Substitutions,
or use AI.

The backend must scan the complete active catalog projection (`_id`, `name`,
`aliases`, and category) through the Ingredient repository. It may stream the
projection and retain only bounded top candidates; it must not import the
Mongoose model directly into the controller or Admin client. A single query
snapshot is advisory, not a transaction: the existing Recipe save/publish path
still rechecks selected IDs and active state.

Classify each line as follows:

1. `unparsed`: no safe nonblank parsed name; no candidates.
2. `exact`: exactly one distinct active Ingredient has a normalized canonical
   name or alias equal to the normalized parsed name.
3. `ambiguous`: more than one distinct active Ingredient has such an exact
   name/alias equality.
4. `possible`: no exact result, and at least one active name/alias has the
   parsed-name whitespace-token sequence as a contiguous subsequence, or is
   itself a contiguous subsequence of the parsed name.
5. `none`: no exact or possible candidate.

The same Ingredient is counted once even if its name and aliases match. For a
candidate's evidence, exact outranks possible and canonical name outranks
alias. Possible matching is literal lexical containment, not fuzzy matching.
For example, `boneless chicken breast` may offer `Chicken breast`; `tomatoes`
must not be treated as `Tomato` without an explicit alias.

Candidate ordering is deterministic:

- exact before possible;
- smaller token-count difference first for possible candidates;
- canonical-name evidence before alias evidence;
- normalized canonical name, then canonical ID, as tie-breakers.

Return at most 10 candidates per line plus `totalCandidates` and `truncated`.
Classification must be based on the complete active catalog even when the
returned candidate list is truncated. A truncated or ambiguous result can
never be treated as unique.

## 8. Proposed read-only resolution endpoint

Freeze one endpoint:

```text
POST /api/v1/ingredients/resolve
Content-Type: application/json

{
  "lines": [
    "1 1/2 cups rice",
    "2 large eggs",
    "salt to taste"
  ]
}
```

Route order:

```text
authenticate
  -> requireCapability(catalog.write)
  -> dedicated per-user limiter
  -> validate strict body
  -> ingredient.controller
  -> ingredient.service
  -> ingredient.repository active-catalog projection
```

Use a dedicated per-user budget of 30 requests per 15 minutes. The existing
global API limiter remains the per-IP outer bound. The current deployment's
in-memory limiter is acceptable for its documented single process; multiple
instances require a shared store before relying on the limit globally.

Successful response:

```json
{
  "success": true,
  "data": {
    "resolutions": [
      {
        "index": 0,
        "sourceText": "1 1/2 cups rice",
        "parsed": {
          "quantity": 1.5,
          "unit": "cup",
          "name": "rice"
        },
        "match": {
          "kind": "exact",
          "totalCandidates": 1,
          "truncated": false,
          "candidates": [
            {
              "ingredient": {
                "id": "507f1f77bcf86cd799439011",
                "name": "Rice",
                "category": "grain"
              },
              "matchedOn": "name",
              "matchedText": "Rice"
            }
          ]
        }
      }
    ]
  }
}
```

Response invariants:

- one result per input line, in the same order, with the original source text;
- parsed quantity/unit/name may be null independently;
- candidates expose only public ID, name, category, and bounded match evidence;
- no normalizedName, Mongo internals, timestamps, allergens, or inactive data;
- no candidate is marked selected or recommended for automatic application;
- normal safe error envelopes apply; raw database errors are never exposed.

The endpoint performs no Recipe, Ingredient, Substitution, upload, image,
intake, or publication mutation. It does not call Ingredient create/update
services and has no write repository method.

## 9. Exact vs ambiguous vs no-match UI behavior

The UI attaches to the current new-Recipe intake and Ingredients step:

```text
M27/URL1 Preview
  -> copy unresolved recipeIngredient values into authoring working state
  -> Moderator opens Ingredients
  -> explicit Find catalog matches
  -> POST /ingredients/resolve
  -> show parser hints and candidate evidence per original source line
  -> Moderator explicitly selects a candidate or uses IngredientPicker
  -> Moderator confirms quantity/unit
  -> add one normal Recipe ingredient row
  -> existing Save Draft / PATCH / Publish
```

Frozen behavior by match kind:

- `exact`: show the sole exact candidate prominently, but leave it unselected.
- `ambiguous`: show the bounded exact candidates and require an explicit choice;
  no default, first-result, or highest-rank assignment.
- `possible`: label every result as possible and require explicit choice.
- `none` or `unparsed`: show no suggested candidate and keep the manual active
  catalog picker available.
- `truncated`: explain that more matches exist and direct the Moderator to the
  manual picker; never imply the displayed subset is complete.

Every line keeps its source text visible until the Moderator confirms a valid
canonical selection plus quantity/unit. Candidate selection alone is not row
creation. A bare parsed count such as `2 eggs` must leave unit unselected; the
Moderator must explicitly choose `piece` or another valid unit. `toTaste`
clears quantity. Invalid or incomplete quantity/unit state blocks confirmation
and uses the existing quantity grammar/messages.

On confirmation, fill the first truly blank Recipe ingredient row or append a
new one, respecting the 50-row limit. The inserted row contains only selected
`{ id, name }`, confirmed numeric text/unit, blank note, and `optional: false`.
The source line is then removed from the unresolved working queue. Same-ID
Recipe rows remain allowed.

Changing the JSON-LD/URL source does not replace the queue until the Moderator
successfully previews the new source. A successful new Preview replaces the
prior unresolved queue, including with an empty queue. Resolution requests
carry a local generation identifier; a late response for an older source must
be ignored.

The queue lives in the existing authoring reducer so it survives step changes,
initial Draft creation, no-PATCH navigation, and unrelated section saves. It is
unsaved local work, so close/reload confirmation must account for it. A server-
authoritative `LOAD_SUCCESS`, confirmed conflict reload, Publish replacement,
or explicit discard clears it. It is not restored after closing and reopening
a Draft because it is not server data. Durable unresolved-source persistence
is explicitly deferred rather than hidden in a Recipe field or browser store.

## 10. Security and data-integrity invariants

- Current database role/session authority is mandatory. Never trust a client
  role, candidate classification, Ingredient object, or active-state claim.
- `catalog.write` is checked before limiter/validation/catalog work. User and
  Admin are denied; Admin remains read-only.
- Resolution reads active Ingredients only. Archived records are neither
  suggested nor exposed.
- Every returned ID is advisory. Existing Recipe validation/service checks are
  still authoritative at save, Publish, and restore time.
- Exact does not mean auto-selected. Ambiguous, possible, none, and truncated
  results never assign anything.
- The Admin sends only a selected canonical ID through the established Recipe
  payload; it never sends source text or a client-produced match kind as
  authority.
- Preserve input ordering and duplicates. Never merge two source lines or
  deduplicate legitimate repeated Recipe uses.
- Bound line count, line length, candidates, response fields, and request rate.
- Use fixed sorting and field projection. Do not accept raw regex, Mongo
  filters, sort syntax, or projection from the client.
- Keep business logic in the Ingredient service/pure resolver and database
  access in the Ingredient repository. The route/controller remain thin.
- No logs may include full imported lines or catalog bodies. Standard endpoint
  path/status logging is sufficient.
- No new package, secret, environment variable, cache, queue, background job,
  localStorage authority, or outbound network request.

## 11. Backend endpoint requirement decision

**Required.** Client-only matching over the current picker would either inspect
only the first ten substring hits or issue an unbounded sequence of paginated
requests per line. It would duplicate catalog classification in the browser,
cannot safely prove unique-vs-ambiguous aliases without complete traversal, and
would make stale responses/source replacement harder to bind.

The new endpoint remains narrowly read-only and reuses the Ingredient module.
It centralizes the parser/matcher, makes complete-catalog classification
testable, bounds its response, and leaves final selection and Recipe integrity
checks in their current authorities.

## 12. Exact implementation allowlist

Backend production:

```text
apps/api/src/middleware/rate-limiter.js                              (modify)
apps/api/src/modules/ingredients/ingredient.routes.js               (modify)
apps/api/src/modules/ingredients/ingredient.controller.js           (modify)
apps/api/src/modules/ingredients/ingredient.validation.js           (modify)
apps/api/src/modules/ingredients/ingredient.repository.js           (modify)
apps/api/src/modules/ingredients/ingredient.service.js              (modify)
apps/api/src/modules/ingredients/ingredient.serializer.js           (modify)
apps/api/src/modules/ingredients/ingredient-resolution.js           (new)
```

Admin production:

```text
apps/admin/src/ingredientApi.js                                     (modify)
apps/admin/src/recipeAuthoring/recipeIngredientResolution.js        (new)
apps/admin/src/recipeAuthoring/recipeAuthoringModel.js               (modify)
apps/admin/src/recipeAuthoring/recipeAuthoringState.js               (modify)
apps/admin/src/recipeAuthoring/RecipeAuthoringSteps.jsx              (modify)
apps/admin/src/recipeAuthoring/recipeAuthoring.css                   (modify)
```

No Recipe backend model, validation, serializer, service, repository, or route;
no Ingredient model; no M27 parser; no URL1 fetch/import service; no shared
contract; no API client core; no App/portal policy; no package/lockfile; no
environment, migration, mobile, deployment, or protected documentation file is
allowlisted. If implementation needs another production file, stop and amend
this audit before editing it.

## 13. Exact test allowlist

Backend:

```text
apps/api/test/ingredient-resolution.test.js                          (new)
apps/api/test/ingredient-validation.test.js                          (modify)
apps/api/test/ingredient-service.test.js                             (modify)
apps/api/test/ingredient-routes.test.js                              (modify)
apps/api/test/rate-limiter.test.js                                   (modify)
```

Admin:

```text
apps/admin/test/recipeIngredientResolution.test.js                   (new)
apps/admin/test/recipeIntakeIntegration.test.js                      (modify)
apps/admin/test/recipeUrlImport.test.js                              (modify)
apps/admin/test/recipeAuthoringState.test.js                         (modify)
```

All other tests below are regression commands only and are not allowlisted for
modification.

## 14. Required automated coverage

### 14.1 Parser and matcher

Cover exact boundaries for line count/length; ordering and duplicates; integers,
decimals, fractions, mixed fractions, invalid quantities; every unit token and
canonical mapping; exact `to taste`; quantity without unit; `of`; blank name;
and preservation of unsupported text.

Cover name/alias exact equality; one Ingredient matching through multiple
fields counted once; cross-Ingredient alias ambiguity; canonical name versus
alias evidence; contiguous token containment in both directions; noncontiguous
tokens; punctuation, diacritics, plurals, and spelling differences not folded;
active-only input; deterministic ordering; ten-candidate boundary; accurate
total/truncated classification; and no mutation call.

### 14.2 Endpoint and authority

Cover missing/invalid token; current Moderator accepted; User/Admin rejected
before repository resolution; strict validation; per-user rate boundary;
standard envelope; projection without normalizedName/internal fields; service
and repository wiring; active-only scan; repository failure safety; and proof
that Recipe/Ingredient/Substitution/upload mutation boundaries are never
called.

### 14.3 Admin integration

Cover explicit resolve action through shared authenticated `ingredientApi`;
loading, safe error, retry, and stale-generation suppression; exact,
ambiguous, possible, none, unparsed, and truncated rendering; no preselection;
manual picker fallback; quantity/unit editing; bare count requiring a unit;
`toTaste` clearing quantity; invalid pair blocking confirmation; first blank row
reuse; append/50-row handling; duplicates preserved; and removal of only the
confirmed source line.

Use the actual authoring reducer/save path to prove unresolved lines survive
step changes, Draft creation, no-PATCH actions, and unrelated real PATCHes;
source B replaces source A only on successful Preview; stale A resolution
cannot overwrite B; confirmed reload clears local source state; close detects
it as unsaved; and Draft/PATCH/Publish bodies never contain source text,
candidates, match kinds, aliases, category, or resolver metadata.

Prove M27 Preview/Apply remains local-only until the explicit resolve action;
URL1 performs only its existing import request before that action; Admin has no
authoring/resolver UI; and direct Admin endpoint use is 403.

## 15. Exact test commands for implementation

Focused backend resolver:

```text
node --test --test-isolation=none apps/api/test/ingredient-resolution.test.js apps/api/test/ingredient-validation.test.js apps/api/test/ingredient-service.test.js apps/api/test/ingredient-routes.test.js apps/api/test/rate-limiter.test.js
```

Focused Admin resolver and real intake/save integration:

```text
node --test --test-isolation=none apps/admin/test/recipeIngredientResolution.test.js apps/admin/test/recipeIntake.test.js apps/admin/test/recipeIntakeIntegration.test.js apps/admin/test/recipeUrlImport.test.js apps/admin/test/recipeAuthoringState.test.js
```

Recipe/Ingredient authority regression:

```text
node --test --test-isolation=none apps/api/test/ingredient-model.test.js apps/api/test/catalog-authority-routes.test.js apps/api/test/recipe-model.test.js apps/api/test/recipe-validation.test.js apps/api/test/recipe-update-validators.test.js apps/api/test/recipe-service.test.js apps/api/test/recipe-routes.test.js apps/api/test/recipe-authoring.test.js
node --test --test-isolation=none apps/admin/test/recipeAuthoringModel.test.js apps/admin/test/recipeAuthoringApiContract.test.js apps/admin/test/recipeAuthoringAcknowledgement.test.js apps/admin/test/recipeCatalogFreshness.test.js apps/admin/test/portalPolicy.test.js apps/admin/test/ingredientSubstitutionFormValidation.test.js
```

Build and final checks:

```text
npm run build --workspace=apps/admin
git diff --check
git diff --stat
git status --short --branch
```

If the Vite-backed Admin tests/build hit the established Windows sandbox
`spawn EPERM`/worker hang, rerun the identical read-only command outside the
sandbox. Record both attempts; do not treat the environment failure as a
product failure or weaken the test.

## 16. Runtime verification requirements

Automated tests do not prove browser interaction or behavior against a real
catalog. After implementation, use a controlled live API/database and a real
Staff Portal browser session:

1. Seed or identify active Ingredients that produce a unique canonical-name
   exact match, unique alias exact match, cross-Ingredient ambiguous alias,
   literal possible match, and no match. Include an archived near-match.
2. Sign in as Moderator, import/paste a Recipe with those source lines, Preview,
   navigate between Basics and Ingredients, and confirm the original text is
   still visible.
3. Confirm Preview itself sends no resolution, Recipe, Ingredient, Publish, or
   upload request. Trigger Find catalog matches and observe exactly one bounded
   authenticated resolver request.
4. Verify the archived record is absent; exact is not preselected; ambiguous
   has no default; possible is labeled; and none/unparsed retains the manual
   active Ingredient picker.
5. Exercise `1 1/2 cups rice`, `2 eggs`, `salt to taste`, an unsupported unit,
   punctuation/descriptor text, and an invalid fraction. Confirm only safe
   hints are filled and bare `2 eggs` cannot be added until a unit is chosen.
6. Confirm a candidate selection alone changes no Recipe row. Explicitly
   confirm quantity/unit, then verify one ordinary canonical Ingredient row is
   added and only that source line leaves the unresolved queue.
7. Start resolution for source A, Preview source B before A completes, and
   confirm a late A response cannot replace B.
8. Create the initial Draft and exercise unchanged Next/Save Draft plus an
   unrelated section PATCH. Confirm unresolved source lines survive in the open
   wizard and no resolver metadata enters the network payload.
9. Save the Ingredients section and verify the request contains only canonical
   IDs plus current quantity/unit/note/optional fields. Archive a selected
   Ingredient before save and confirm existing server validation rejects it.
10. Confirm close warns about unresolved local source work. Confirm explicit
    discard or authoritative conflict reload clears it and adopts server truth.
11. Confirm direct User/Admin resolver requests return 403 before catalog work;
    Admin has no Add Recipe/resolver UI; normal Admin catalog reads stay intact.
12. Verify keyboard/focus behavior, candidate labels, error/status announcements,
    50-row boundary, retry, supported themes, responsive layout, and a clean
    browser console.

Do not claim runtime PASS until all applicable items are measured. No runtime
verification was performed during this read-only audit.

## 17. Audit-time automated evidence

Current-main verification during this audit produced:

```text
API Ingredient/Recipe/authority regression: 305 passed, 0 failed
Admin intake/authoring/policy regression:      42 passed, 0 failed
Vite-backed URL1/Admin authority regression:   6 passed, 0 failed
```

Expected controlled 4xx-path `AppError` diagnostics appeared in API output.
The first sandboxed Vite-backed `recipeUrlImport` invocation was reported
failed and its worker hung; it was stopped. The identical read-only command
passed outside the sandbox with 6/6 tests. This is environment evidence, not a
product failure.

## 18. Blockers, stop conditions, and deferred work

There is no present implementation blocker.

Stop implementation and amend this audit if:

- complete active-catalog exact/ambiguity classification cannot be provided
  without hidden truncation or an unsafe unbounded response;
- acceptable catalog scale requires a new index, normalized-alias field,
  migration, cache, search service, or infrastructure change;
- safe behavior needs any production/test file outside the exact allowlists;
- source strings cannot survive the frozen authoring state transitions without
  changing Recipe persistence;
- implementation would auto-select a unique match, select the first ambiguous
  result, create/restore an Ingredient, or grant Admin a write path;
- implementation requires fuzzy/AI matching, IngredientDraft, a second Recipe
  lifecycle, or a changed Recipe ingredient contract.

Deferred:

- durable unresolved-source persistence after closing/reopening or an
  authoritative reload; this requires a separate Recipe provenance/schema
  decision and is not hidden in localStorage;
- inline Ingredient creation, IngredientDraft, bulk catalog creation, alias
  uniqueness enforcement, normalized-alias storage/indexing, and catalog data
  cleanup;
- Unicode fractions, ranges, natural-language amounts, note/preparation
  extraction, pluralization/stemming, typo distance, transliteration, synonyms,
  brand/variety understanding, and unit/density conversion;
- AI/LLM extraction, automatic substitutions, category/allergen inference, and
  automatic Ingredient selection or creation;
- source provenance/history, analytics, background jobs, caching, mobile work,
  generic review queues, and multi-instance shared rate-limit storage.

## 19. Final audit verdict

**AUDIT PASS - READY FOR IMPLEMENTATION**

Implementation is authorized only within sections 12 and 13 and remains
subject to the automated and runtime gates above. This audit does not authorize
staging, commit, push, dependency changes, or application changes now.

## 20. Final implementation summary

ING1 is implemented within the exact production and test allowlists in sections
12 and 13. The implementation adds:

- a strict Moderator-only `POST /api/v1/ingredients/resolve` route guarded by
  current `catalog.write` authority, a dedicated 30-requests-per-15-minutes
  per-user limiter, and bounded request validation;
- a read-only active-catalog repository projection and deterministic pure
  parser/matcher that preserves source ordering and duplicates, returns exact,
  ambiguous, possible, none, and unparsed classifications, and limits returned
  candidates without hiding the complete-catalog candidate count;
- a public resolver candidate serializer that exposes only canonical ID, name,
  and category plus bounded match evidence;
- Staff Portal unresolved-source state attached to the existing authoring
  reducer, explicit resolution requests, stale-generation rejection, safe
  retry/manual-picker behavior, and explicit confirmation into the existing
  canonical Recipe ingredient row shape; and
- focused backend and Admin coverage for parsing, matching, authority, rate
  limiting, mutation isolation, reducer lifetimes, payload exclusion, rendered
  states, and confirmation boundaries.

No Recipe backend contract, Ingredient model, M27 parser, URL1 service, shared
contract, package, lockfile, environment, migration, mobile, deployment, or
protected documentation file was changed. Resolution remains advisory: no
candidate is preselected, no catalog or Recipe mutation occurs during
resolution, and existing Recipe save/publish active-Ingredient checks remain
authoritative.

## 21. Independent review findings and fixes

The independent diff review inspected the complete implementation and test
surface for scope creep, architecture drift, security weakening, hidden mocks,
state/race behavior, contract drift, insufficient tests, and forbidden file
changes. The following closure findings were addressed in the final diff:

1. Malformed numeric prefixes could not be allowed to produce a misleading
   partial quantity hint. The parser now rejects ranges, multiple numbers,
   malformed fractions, signed values, and other unsafe numeric continuations
   as a whole while preserving the original trimmed source as the name query.
2. Resolver controls could not remain mutable while a request was in flight.
   The rendered selection, manual picker, quantity/unit controls, and confirm
   action are disabled while loading, and reducer mutation/confirmation actions
   also fail closed during that interval.
3. Failed resolver requests needed a safe, recoverable presentation. The UI now
   exposes a bounded error, an explicit retry path, and the existing manual
   active-catalog picker without leaking backend details or losing source work.
4. The read-only boundary needed direct proof. Service tests now fail on any
   Ingredient, Recipe, Substitution, or upload mutation call, and repository
   tests prove one complete active-only lean projection with no pagination
   truncation.
5. Transient resolver state needed explicit lifecycle and payload isolation.
   Tests prove it survives step changes, Draft creation, no-PATCH saves, and
   unrelated PATCHes; successful source replacement invalidates stale replies;
   authoritative load clears it; close treats remaining source work as unsaved;
   and Draft/PATCH/Publish payloads exclude all resolver metadata.

Final independent re-review result: **PASS**. No open `BLOCKER`, `MAJOR`,
`MEDIUM`, or `MINOR` findings remain. The final diff stays within the frozen
ING1 allowlists and preserves backend, Recipe, catalog, and role authority.

## 22. Final automated verification

Final verification on 2026-09-28 produced:

```text
Focused backend resolver:                 116 passed, 0 failed
Focused Admin resolver/intake integration: 47 passed, 0 failed
Recipe/Ingredient authority regression:   212 passed, 0 failed
Admin authoring/policy regression:          42 passed, 0 failed
Admin production build:                   PASS (1,653 modules transformed)
git diff --check:                          PASS
```

The two Vite-backed Admin test commands completed their visible assertions but
their workers hung during teardown inside the Windows sandbox. The workers were
stopped and the identical read-only commands were rerun outside the sandbox;
they exited normally with 47/47 and 42/42 passing. The first Admin build attempt
failed inside the sandbox with the documented esbuild `spawn EPERM`; the
identical build outside the sandbox passed. Existing dynamic-import and chunk
size warnings remain non-blocking and are unrelated to ING1.

Expected controlled 4xx-path `AppError` diagnostics appeared in API test output.
They are asserted negative-path evidence, not product failures.

## 23. Runtime verification and readiness

Runtime verification result supplied after completion of the controlled live
API/database and real Staff Portal browser checklist in section 16:

**RUNTIME PASS - READY FOR COMMIT/PUSH**

The implementation, independent re-review, automated gates, and runtime gate
are complete. ING1 is ready for exact-path staging, commit on its feature
branch, push with upstream tracking, and subsequent pull-request review. It is
not authorized for merge to `main` in this finalization step.

## 24. Final milestone verdict

**ING1 FINALIZATION PASS - READY FOR EXACT COMMIT/PUSH**
