# MODERATOR-OPS-DUP1 — Recipe Duplicate + Variant Detection v1

Status: finalized — ready for exact staging, commit, and push

Freeze date: 2026-09-29

Audited branch: `main`

Audited commit: `38d1686431cebc46dc385dd9636ebfd98d623648`

## 1. Purpose and authority

DUP1 adds deterministic, Moderator-only duplicate/variant assistance to the
existing Recipe authoring and publication paths. It does not create a second
Recipe authority. `Recipe`, its Draft/Published lifecycle, canonical
Ingredient references, existing request validation, and the existing
Moderator `catalog.write` capability remain authoritative.

This is advisory classification with an explicit publication acknowledgement,
not title uniqueness or an automatic content decision. A Moderator may review
the evidence and explicitly continue with a distinct Recipe or variant. DUP1
never merges, deletes, archives, renames, or otherwise mutates another Recipe.

The live repository currently has no duplicate comparator, persisted Recipe
fingerprint, duplicate-check endpoint, or duplicate-review UI. The existing
Recipe schema has no title uniqueness constraint, intentionally preserves
repeated canonical Ingredient usages, and has an index suitable for bounded
lifecycle retrieval: `{ publicationStatus: 1, isActive: 1, updatedAt: -1 }`.

## 2. Frozen product rules

- Same normalized title alone is insufficient duplicate evidence. When no
  stronger v1 predicate matches, the correct statement is **no qualifying v1
  evidence**, not proof that two Recipes are unrelated.
- Every compared pair receives exactly one deterministic internal
  classification: `exact_duplicate`, `near_exact_duplicate`,
  `possible_variant`, or `unrelated`/no qualifying evidence.
- The API returns only the three qualifying classifications. It does not return
  every unrelated Recipe.
- There is no aggregate percentage, confidence value, weighted total, or
  hidden similarity score. The UI shows the exact component evidence.
- Review-step checking is advisory, but a current result and explicit
  acknowledgement are required before publication when the bounded comparison
  returns candidates or is truncated.
- Publish and legacy immediate-create both rerun the same server comparator.
  The client can never make its earlier result authoritative.
- A matching candidate never causes an automatic merge, delete, archive,
  rename, title rewrite, or title-uniqueness rejection.
- DUP1 creates no persistent review/fingerprint record and changes no Recipe
  schema field.

## 3. Candidate universe and bounded retrieval

For both an existing Draft and legacy `POST /recipes`, the comparison universe
is:

1. all explicit Published Recipes, active or archived;
2. all legacy Recipes with physically missing/null `publicationStatus`, treated
   as Published, active or archived; and
3. active Drafts only.

The subject Recipe is excluded by `_id` when it already exists. Archived Drafts
are excluded. Archived Published and archived legacy-Published candidates are
retained because publication history remains relevant; every returned
candidate exposes effective `publicationStatus`, whether that status came from
legacy compatibility, and `isActive`, so the UI must visibly label states such
as **Published · Archived** and **Published · Legacy status**.

`DUP1_CANDIDATE_LIMIT` is fixed at **500**. Retrieval uses five bounded branches
over the existing `{ publicationStatus: 1, isActive: 1, updatedAt: -1 }` index:

- explicit Published + active;
- explicit Published + archived;
- null/missing legacy-Published + active;
- null/missing legacy-Published + archived; and
- Draft + active.

Each branch requests newest `updatedAt` first with `limit + 1`; the repository
merges them deterministically by `updatedAt` descending then `_id` ascending,
excludes self, and compares at most 500 Recipes. `candidateUniverseCount` is the
sum of counts for the same five filters after self-exclusion. `truncated` is
true when that count exceeds the number compared. The response always includes
`candidateLimit`, `candidateUniverseCount`, `comparedCount`, and `truncated`.

Truncation is a product state, not a logging detail. A truncated result must
say that only the newest bounded window was checked. It must never produce the
unqualified message “no duplicates found,” even when `candidates` is empty.

## 4. Deterministic comparison and classification

### 4.1 Component normalization

Comparison uses only validated Recipe content and these versioned rules:

- `titleKey`: Unicode NFC, outer trim, internal whitespace collapse, then
  Unicode-aware lowercase. There is no accent removal, transliteration,
  stemming, tokenization, edit distance, synonym handling, or fuzzy matching.
- `ingredientMultiset`: one tuple per persisted usage:
  `[lowercase canonicalIngredientId, quantityOrNull, exactUnit]`. Tuples are
  sorted only to make multiset equality deterministic. Repeated identical
  tuples remain repeated; they are never deduplicated. Notes and `optional`
  are display/persistence details and are not v1 comparison inputs.
- Quantity equality is exact numeric equality after existing request/model
  validation. `null` is distinct from every number. Unit equality is exact
  canonical-string equality. There is no `kg`↔`g`, `lb`↔`oz`, or other unit or
  quantity conversion.
- `instructionSequence`: the persisted ordered instruction strings after the
  existing trim validation, compared exactly and case-sensitively. Order is
  significant. No word or semantic normalization occurs.

Canonical Ingredient IDs—not names, aliases, imported text, or resolver
suggestions—are authoritative. This means unresolved local ING1/ING2 source
rows cannot participate until the Moderator explicitly confirms them into
ordinary canonical Recipe ingredient usages.

### 4.2 Classification precedence

The following precedence is exhaustive and deterministic:

1. `exact_duplicate`: exact fingerprint equality.
2. `near_exact_duplicate`: exact ingredient-multiset equality **and** exact
   instruction-sequence equality, but different `titleKey`.
3. `possible_variant`: equal `titleKey` and exactly one of ingredient-multiset
   equality or instruction-sequence equality. If both are equal, rule 1 has
   already applied.
4. `unrelated` / no qualifying evidence: every other combination, including
   same title alone.

For each returned candidate, `evidence` contains only the booleans
`titleExact`, `ingredientMultisetExact`, `instructionSequenceExact`, and
`fingerprintEqual`. No number may be presented as similarity or confidence.

## 5. Exact fingerprint contract

`fingerprintVersion` is the literal `recipe-duplicate-v1`. The canonical
fingerprint payload is deterministic JSON with fixed key order:

```text
{
  "version": "recipe-duplicate-v1",
  "titleKey": <normalized title>,
  "ingredientMultiset": <sorted tuples with repetitions preserved>,
  "instructionSequence": <ordered exact strings>
}
```

The exact fingerprint is lowercase hexadecimal SHA-256 of the UTF-8 canonical
payload. SHA-256 is only an equality digest; it is not a similarity algorithm,
security claim, identifier, or authorization token. The fingerprint is
computed on demand, never written to Recipe or another collection, never
indexed, and never used as a uniqueness constraint. A digest match is accepted
as `exact_duplicate` only after the implementation also compares the canonical
payloads for equality; this avoids treating a theoretical digest collision as
content equality.

## 6. API contract

All DUP1 routes preserve the existing order `authenticate ->
requireCapability(catalog.write) -> validate -> controller -> service ->
repository`. Admin and User are denied by the existing capability authority.

### 6.1 Check endpoint

`POST /api/v1/recipes/duplicate-check`

The strict request body has exactly one subject form:

```text
Existing Draft review:
{
  "recipeId": <ObjectId>,
  "expectedUpdatedAt": <ISO-8601 timestamp>
}

Legacy immediate-create preflight:
{
  "candidate": <the existing complete published Recipe fields,
                excluding confirmFilipinoCuisine and duplicateReview>
}
```

The two forms cannot be combined. The existing-Draft form loads the saved
Recipe, requires an active Draft, requires `expectedUpdatedAt` to match, and
validates stored publication completeness before comparison. It never accepts
client-supplied canonical content for that Draft. The candidate form reuses the
same complete Recipe validation/normalization as `POST /recipes` and validates
active Ingredient references without persisting anything.

Success is `200`:

```text
{
  "duplicateReview": {
    "fingerprintVersion": "recipe-duplicate-v1",
    "resultDigest": <64 lowercase hexadecimal SHA-256>,
    "candidateLimit": 500,
    "candidateUniverseCount": <non-negative integer>,
    "comparedCount": <0..500>,
    "truncated": <boolean>,
    "candidates": [
      {
        "recipe": {
          "id": <string>,
          "title": <string>,
          "publicationStatus": "draft" | "published",
          "publicationStatusSource": "explicit" | "legacy",
          "isActive": <boolean>,
          "updatedAt": <timestamp>
        },
        "classification": "exact_duplicate" |
                          "near_exact_duplicate" |
                          "possible_variant",
        "evidence": {
          "titleExact": <boolean>,
          "ingredientMultisetExact": <boolean>,
          "instructionSequenceExact": <boolean>,
          "fingerprintEqual": <boolean>
        }
      }
    ]
  }
}
```

Candidates sort by classification priority in section 4.2, then title, then
Recipe ID. No description, instructions, Ingredient names, actor IDs, internal
Mongo fields, or fingerprint is returned.

### 6.2 `resultDigest`

`resultDigest` is lowercase hexadecimal SHA-256 of deterministic canonical JSON
containing:

- `fingerprintVersion` and the subject's canonical fingerprint payload;
- candidate-bound metadata (`candidateLimit`, `candidateUniverseCount`,
  `comparedCount`, and `truncated`); and
- the ordered qualifying results, each containing candidate ID, candidate
  canonical fingerprint payload, classification, effective/legacy publication
  state, `isActive`, and canonical `updatedAt`.

It is an opaque optimistic review token, not a fingerprint exposed separately,
not a score, and not proof of exhaustive comparison. `checkedAt` and other
wall-clock values are excluded so unchanged inputs reproduce the same digest.
Any subject-content, qualifying-candidate content/lifecycle, qualifying-result
set, or bound-metadata change changes the digest. Changes wholly outside a
truncated 500-record window are not claimed detectable in v1.

## 7. Publish and stale-review contract

The strict optional request member added to both `POST
/recipes/:recipeId/publish` and legacy `POST /recipes` is:

```text
"duplicateReview": {
  "resultDigest": <64 lowercase hexadecimal SHA-256>,
  "confirmDistinctRecipe": true
}
```

The member remains request-only and is never persisted or serialized as Recipe
content.

Immediately before mutation, both service paths normalize their final subject,
rerun candidate retrieval and the same comparator, and compute a fresh result.
The rules are:

- If `candidates` is empty and `truncated` is false, duplicate acknowledgement
  is not required; the server's rerun is itself the current check.
- If candidates exist or `truncated` is true, missing `duplicateReview`, a
  missing/false `confirmDistinctRecipe`, or a missing digest returns `409
  RECIPE_DUPLICATE_REVIEW_REQUIRED` with the fresh `duplicateReview` result.
- If a supplied digest differs from the fresh digest, return `409
  RECIPE_DUPLICATE_REVIEW_STALE` with message “Recipe duplicate review is stale.
  Review the current candidates before continuing.” and the fresh
  `duplicateReview` result.
- A matching digest plus literal `confirmDistinctRecipe: true` authorizes only
  the ordinary create/publish mutation. It does not mutate candidates.

Every required-review or stale-review 409 occurs before `Recipe.create` or the
atomic Draft-to-Published update. Tests must prove zero mutation. Existing
Ingredient-active checks, completeness checks, Filipino-cuisine confirmation,
Draft state, archive guard, and `expectedUpdatedAt` conflict protection remain
required. A later database write race may still add/change another Recipe
after the advisory rerun; DUP1 is deliberately not a uniqueness constraint.

Legacy `POST /recipes` therefore uses the identical comparator and explicit
acknowledgement contract: its first request may succeed immediately only for an
untruncated zero-candidate result; otherwise it receives the 409 result and may
be explicitly retried with the returned digest and acknowledgement.

## 8. Moderator Review-step UX

The existing five-step wizard remains unchanged: `Basics -> Ingredients ->
Instructions -> Details -> Review`.

On Review for an active complete Draft:

- Show a **Check for duplicates and variants** action. Do not check on every
  keystroke and do not run on import Preview/Apply, Draft creation, PATCH, or
  ordinary navigation.
- States are `idle`, `checking`, `results`, `no_qualifying_evidence`, `stale`,
  and `error`. Only one request may be in flight. The control exposes
  `aria-busy`; result/status text uses an appropriate live status region and
  failures use an alert.
- `results` groups candidates by the three classifications and shows title plus
  explicit publication/archive/legacy state and component evidence. It never
  displays a score.
- `no_qualifying_evidence` says “No qualifying duplicate or variant evidence
  was found in the checked candidate window.” It must not claim that same-title
  Recipes are unrelated or that no duplicates exist.
- If `truncated`, always show “Checked the newest 500 of
  {candidateUniverseCount} eligible Recipes. Older eligible Recipes were not
  compared.” The no-results wording remains conditional.
- When candidates exist or the result is truncated, show a required unchecked
  control: **I reviewed this result and want to continue as a distinct Recipe
  or variant.** Checking it stores only the current result digest and explicit
  acknowledgement in local authoring state.
- Any content change, authoritative reload, source replacement, saved-section
  response that changes comparison inputs, lifecycle change, or newer check
  invalidates the local result and acknowledgement. Step navigation alone does
  not.
- Publish first preserves the existing Filipino-cuisine acknowledgement and
  completeness checks, then enforces DUP1 review state. A stale-review 409
  replaces displayed results with the server's fresh result, clears the
  acknowledgement, returns focus to the duplicate-review heading/control, and
  performs no automatic retry.
- Network/server errors retain editable Recipe work and provide an explicit
  retry. They do not permit publication based on an old or failed result.

If unresolved local ING1/ING2 rows exist, the panel must also say: “This check
uses only saved canonical Recipe ingredients. Unresolved imported ingredient
rows were not compared.” The action may still inspect the saved Recipe, but no
message may claim the Recipe was comprehensively cleared. DUP1 never compares
raw imported strings or resolver suggestions and never auto-confirms them.

The direct `POST /recipes` path has no Staff Portal control in v1, but API
callers receive the same structured 409 result and must send the same explicit
acknowledgement on retry.

## 9. Frozen production allowlist

Only these production files may be added or modified:

| File | Change | Concrete responsibility |
|---|---|---|
| `apps/api/src/modules/recipes/recipe-duplicate.js` | add | Pure v1 normalization, fingerprint, classification, result ordering, and resultDigest logic; no database access. |
| `apps/api/src/modules/recipes/recipe.validation.js` | modify | Strict duplicate-check union request and request-only duplicate-review acknowledgement on Publish and legacy create. |
| `apps/api/src/modules/recipes/recipe.routes.js` | modify | Mount the Moderator-only check endpoint before parameterized routes using existing auth/capability/validation order. |
| `apps/api/src/modules/recipes/recipe.controller.js` | modify | Adapt the validated check request and serialize the structured response through existing HTTP conventions. |
| `apps/api/src/modules/recipes/recipe.service.js` | modify | Load/validate subjects, orchestrate comparison, and enforce the fresh server rerun before both publish mutations. |
| `apps/api/src/modules/recipes/recipe.repository.js` | modify | Implement the five bounded lifecycle queries/counts and self-exclusion using the existing index; no writes. |
| `apps/api/src/modules/recipes/recipe.serializer.js` | modify | Add the minimal safe candidate Recipe projection and explicit lifecycle/legacy fields. This belongs here by live convention: this file already owns field-by-field Recipe API projection and prevents internal-field leakage. |
| `apps/admin/src/recipeApi.js` | modify | Add the duplicate-check request and preserve structured 409 details for authoring recovery. |
| `apps/admin/src/recipeAuthoring/recipeAuthoringModel.js` | modify | Build the request-only Publish duplicateReview member without placing it in Recipe content patches. |
| `apps/admin/src/recipeAuthoring/recipeAuthoringState.js` | modify | Hold check/result/stale/error state, bind acknowledgement to one digest, and invalidate it on comparison-input changes. |
| `apps/admin/src/recipeAuthoring/useRecipeAuthoring.js` | modify | Run single-flight checks, gate Publish, and adopt fresh stale-review results without retrying mutation. |
| `apps/admin/src/recipeAuthoring/RecipeAuthoringSteps.jsx` | modify | Pass the existing authoring state/actions and unresolved-row context into the Review UI. |
| `apps/admin/src/recipeAuthoring/RecipeReview.jsx` | modify | Render the accessible states, lifecycle labels, evidence, truncation/unresolved warnings, retry, and acknowledgement. |
| `apps/admin/src/recipeAuthoring/recipeAuthoring.css` | modify | Add responsive/theme-compatible presentation for the bounded Review panel and states. |

`recipe.serializer.js` is retained after re-evaluation because candidate Recipe
serialization is an API projection of Recipe documents and the live repository
already centralizes safe public/staff projections there. Classification and
digest logic do not belong there and remain in `recipe-duplicate.js`.

`recipe.model.js` is deliberately removed from scope: no field or index change
is required. `RecipeAuthoringWizard.jsx`, `RecipesTab.jsx`, packages, lockfiles,
shared contracts, URL1/ING1/ING2 code, and all other production files have no
concrete DUP1 responsibility. If implementation needs another production file,
stop and amend this milestone before editing it.

## 10. Frozen test allowlist

Only these tests may be added or modified:

```text
apps/api/test/recipe-duplicate.test.js                    (new)
apps/api/test/recipe-validation.test.js                   (modify)
apps/api/test/recipe-service.test.js                      (modify)
apps/api/test/recipe-routes.test.js                       (modify)
apps/api/test/recipe-authoring.test.js                    (modify)
apps/admin/test/recipeDuplicateReview.test.js              (new)
apps/admin/test/recipeAuthoringApiContract.test.js         (modify)
apps/admin/test/recipeAuthoringState.test.js               (modify)
apps/admin/test/recipeAuthoringAcknowledgement.test.js     (modify)
apps/api/test/recipe-image-lifecycle.test.js               (modify)
```

`apps/api/test/recipe-image-lifecycle.test.js` is allowlisted because DUP1
intentionally changed the legacy `POST /recipes` authority path, so this
existing managed/direct-create regression fixture must provide the mandatory
duplicate-retrieval dependency.

Static source-string presence is insufficient. Coverage must mutation-test the
classification precedence, repeated-usage multiset behavior, exact quantity and
unit rules, same-title-only negative case, digest invalidation, truncation
wording/gating, lifecycle universe, legacy status exposure, both pre-mutation
409 paths, direct-create parity, unresolved-row wording, and no automatic
retry/mutation. All other tests are regression commands only and are not
allowlisted for modification.

## 11. Runtime, data, query-plan, and accessibility gates

Implementation is not complete until all of these are measured:

1. In a controlled Mongo dataset, create exact, near-exact, possible-variant,
   same-title-only, repeated-Ingredient, reordered-Ingredient, changed-unit,
   changed-quantity, active/archived Published, legacy Published, active Draft,
   archived Draft, and self cases. Prove the frozen classes and universe.
2. Include `1 kg` versus `1000 g` and `1 lb` versus `16 oz`; prove they do not
   compare as equal. Include duplicate identical Ingredient usages and prove
   multiplicity changes the result.
3. Seed more than 500 eligible Recipes. Prove the deterministic newest window,
   counts, visible truncation, required acknowledgement, and absence of any
   unconditional “no duplicates found” message.
4. Capture Mongo `explain('executionStats')` for all five retrieval branches on
   representative volume. Each winning plan must use the existing
   `publicationStatus_1_isActive_1_updatedAt_-1` index (index name may be
   deployment-generated), return at most 501 documents per branch, avoid an
   unbounded `COLLSCAN`, and keep `totalDocsExamined` bounded by that branch's
   matching lifecycle slice. Any blocking sort must operate only on the
   bounded result and show no disk spill. Record query timings and dataset
   cardinality; do not claim production performance from unit mocks.
5. With two Moderator sessions, check then change a qualifying candidate or the
   Draft. Prove Publish returns `409 RECIPE_DUPLICATE_REVIEW_STALE`, exposes the
   fresh result, clears acknowledgement, and performs no Recipe mutation.
6. Exercise legacy `POST /recipes`: untruncated zero-result success, required
   review 409, matching acknowledged retry, stale retry, Ingredient failure,
   and no mutation on every rejected request.
7. In a real Staff Portal browser, verify keyboard-only operation, logical focus
   order, focus return after stale/error results, visible focus, checkbox label,
   status/alert announcements, candidate groups, long-title wrapping, 200%
   zoom, narrow layout, and both supported themes.
8. With live ING1/ING2 unresolved rows, verify the saved-canonical-only warning
   remains visible and no comprehensive-clear wording appears. Confirming a row
   and saving must invalidate the prior result.
9. Verify Admin/User direct denial and stale-role demotion, and confirm browser
   console/network logs contain no raw fingerprint payload, internal Mongo
   fields, or hidden similarity score.

Automated or mocked checks do not satisfy the Mongo query-plan, browser,
accessibility, concurrency, or live-data gates. Record those as deferred until
actually measured.

## 12. Explicitly excluded scope

- AI/LLM classification, fuzzy matching, edit distance, phonetics, token
  similarity, stemming, synonym inference, translation, or transliteration.
- Aggregate percentages, confidence scores, thresholds, ranking scores, or
  hidden scoring inputs.
- Ingredient-name/alias comparison, raw ING1/ING2 source-text comparison,
  inferred Ingredients, or unit/quantity conversion.
- Provenance/source matching. `sourceUrl` is not persisted in v1; DUP1 does not
  expand Recipe schema to add it.
- Persisted fingerprints, fingerprint indexes, uniqueness constraints, Recipe
  title uniqueness, migrations, new collections, caches, queues, or packages.
- Automatic merge, delete, archive, restore, rename, canonical selection,
  variant linking, parent/child relationships, or duplicate remediation.
- Mobile duplicate UI, consumer-facing warnings, bulk catalog scans, background
  jobs, analytics, deployment changes, and infrastructure work.
- Any change to M27 intake, URL1 transport/parsing, ING1 resolution, UNIT1
  units, ING2 creation, Ingredient/Substitution schemas, or protected docs.

## 13. Stop conditions

Stop and amend this milestone before implementation if safe delivery requires a
new Recipe field/index, another collection/package, another production/test
file, an unbounded candidate scan, a different classification predicate, or a
claim that same-title/no-result or a truncated window proves absence of a
duplicate.

## 14. Freeze verdict

**DUP1 MILESTONE FROZEN — READY FOR IMPLEMENTATION**

This freeze authorizes no production/test implementation, staging, commit,
push, or stash operation.

## 15. Implementation record — 2026-09-29

Implementation phase status: **findings fix complete — ready for independent
review**. The production and allowlisted focused-test implementation is present
locally; no runtime/query-plan claim is made.

### Implemented architecture

- Added a pure `recipe-duplicate-v1` comparator with NFC/title normalization,
  canonical Ingredient-ID multisets that preserve repetition, exact numeric/unit
  equality, exact ordered instructions, SHA-256 equality fingerprints with
  canonical-payload confirmation, deterministic classification/order, and a
  result digest bound to the subject, qualifying candidates, lifecycle state,
  timestamps, and bounded-window metadata.
- Added five indexed lifecycle retrieval branches. Each branch sorts by
  `updatedAt` descending and `_id` ascending, reads at most 501 records, excludes
  the current Recipe, and contributes to an exact eligible-universe count. The
  merged comparison window remains fixed at 500.
- Added strict Moderator/`catalog.write` `POST /api/v1/recipes/duplicate-check`
  validation, controller/service orchestration, safe candidate projection, and
  structured success/error evidence.
- Publish and legacy immediate create now perform the same fresh server-side
  comparison before their first mutation. Required and stale review failures
  return pre-mutation 409 errors with fresh evidence. The acknowledgement,
  result digest, fingerprint payloads, and evidence are request/response-only
  and are not persisted.
- Added Review-step saved-content checking, incomplete-window warning,
  explainable grouped evidence, explicit lifecycle/legacy labels, Compare and
  View existing Recipe actions, digest-bound acknowledgement, stale-result
  adoption without automatic retry, focus return, retry/error states, and the
  exact unresolved-import saved-canonical-only warning.

### Exact production files changed

- `apps/api/src/modules/recipes/recipe-duplicate.js` (new)
- `apps/api/src/modules/recipes/recipe.validation.js`
- `apps/api/src/modules/recipes/recipe.routes.js`
- `apps/api/src/modules/recipes/recipe.controller.js`
- `apps/api/src/modules/recipes/recipe.service.js`
- `apps/api/src/modules/recipes/recipe.repository.js`
- `apps/api/src/modules/recipes/recipe.serializer.js`
- `apps/admin/src/recipeApi.js`
- `apps/admin/src/recipeAuthoring/recipeAuthoringModel.js`
- `apps/admin/src/recipeAuthoring/recipeAuthoringState.js`
- `apps/admin/src/recipeAuthoring/useRecipeAuthoring.js`
- `apps/admin/src/recipeAuthoring/RecipeAuthoringSteps.jsx`
- `apps/admin/src/recipeAuthoring/RecipeReview.jsx`
- `apps/admin/src/recipeAuthoring/recipeAuthoring.css`

### Exact test files changed or created

- `apps/api/test/recipe-duplicate.test.js` (new)
- `apps/api/test/recipe-validation.test.js`
- `apps/api/test/recipe-service.test.js`
- `apps/api/test/recipe-routes.test.js`
- `apps/api/test/recipe-authoring.test.js`
- `apps/admin/test/recipeDuplicateReview.test.js` (new)
- `apps/admin/test/recipeAuthoringApiContract.test.js`
- `apps/admin/test/recipeAuthoringState.test.js`
- `apps/admin/test/recipeAuthoringAcknowledgement.test.js`

### Verification evidence

- Focused API command: 189 tests passed, 0 failed.
- Focused Admin command: 26 tests passed, 0 failed.
- Unmodified Recipe model/publication/update-validator regressions: 55 passed,
  0 failed.
- Unmodified Ingredient-resolution and Recipe-image-upload route regressions:
  26 passed, 0 failed.
- Unmodified Admin intake integration: 12 passed, 0 failed.
- Unmodified Admin URL-import integration: 11 passed, 0 failed.
- Unmodified Admin ING2 Ingredient-creation integration: 11 passed, 0 failed.
- Admin production build passed outside the Windows sandbox after the sandboxed
  attempt hit `spawn EPERM`; Vite transformed 1,653 modules. Existing chunk-size
  and mixed static/dynamic import warnings remain non-blocking.
- `git diff --check` passed; only Git line-ending notices were emitted.

### Permitted implementation decisions

- The existing Admin API client retains only array-shaped error details, so the
  fresh 409 review is carried as one safe detail entry with field
  `duplicateReview`; the authoring hook extracts that entry and adopts the fresh
  evidence without retrying Publish.
- A no-candidate, non-truncated Review result is still submitted on Publish with
  its digest so a candidate/bound change can produce the frozen stale-review
  response. The visible acknowledgement control remains required only when
  candidates exist or the result is truncated.
- Existing Recipe details are loaded only after the Moderator explicitly uses
  **View existing Recipe**; DUP1 candidate projection itself remains minimal.

### Resolved regression fixture

Before the findings fix, the unmodified
`apps/api/test/recipe-image-lifecycle.test.js` result was 13 passed and 1
failed. Its `managed create persists imageUrl and immutable imageAssetId`
fixture directly invoked `recipeService.createRecipe` and stubbed Recipe
creation and Ingredient lookup, but it did not stub the newly mandatory
`recipeRepository.findDuplicateCandidates`. With no live Mongo connection, the
test timed out at `recipes.find()` before its existing image assertion.

The product path must not skip DUP1 merely because this older unit fixture calls
the service directly. The frozen test allowlist was therefore amended before
the fixture edit to include `apps/api/test/recipe-image-lifecycle.test.js`.
DUP1 intentionally changed the legacy `POST /recipes` authority path, so the
existing managed/direct-create regression fixture must provide the mandatory
duplicate-retrieval dependency.

The exact narrow fix stubs `findDuplicateCandidates` only in that managed-create
fixture with `candidates: []`, `candidateUniverseCount: 0`, `comparedCount: 0`,
and `truncated: false`. The real service still builds the deterministic empty
review/result digest, enforces DUP1, and only then reaches the existing Recipe
create stub. No image lifecycle assertion or production file was changed.

### Findings-fix verification — 2026-09-29

- Reproduction before the fix: 13 passed, 1 failed; the sole failure was the
  managed-create case with `recipes.find()` buffering timeout after 10 seconds.
- Affected `recipe-image-lifecycle.test.js`: 14 passed, 0 failed.
- Frozen focused DUP1 API tests: 189 passed, 0 failed.
- Frozen focused DUP1 Admin tests: 26 passed, 0 failed. The default isolated
  runner first hit Windows sandbox `spawn EPERM`; the same four files passed
  with `--test-isolation=none`.
- Recipe model/publication/update-validator authority regressions: 55 passed, 0
  failed.
- Ingredient-resolution and image provider/upload/lifecycle regressions: 43
  passed, 0 failed.
- Direct legacy `POST /recipes` duplicate-review tests: 2 passed, 0 failed,
  covering pre-mutation required/stale review enforcement and current explicit
  retry success.
- Admin production build: passed outside the Windows sandbox after the
  sandboxed attempt hit `spawn EPERM`; Vite transformed 1,653 modules. Existing
  mixed static/dynamic import and chunk-size warnings remain non-blocking.
- No production source file changed during this findings fix.

### Deferred runtime/query-plan gates

All section 11 gates remain deferred: controlled live Mongo classification and
500+ data, five-branch `explain('executionStats')`, real concurrent Moderator
sessions, live legacy-create exercises, real Staff Portal keyboard/focus/screen
reader/zoom/theme checks, live ING1/ING2 unresolved-row behavior, stale-role
demotion, and browser console/network disclosure inspection. No live Mongo
writes were performed.

## 16. Independent-review required findings fix — 2026-09-29

Review verdict before this fix: **PASS WITH REQUIRED FIXES**.

### Finding 1 — duplicate-review acknowledgement contract

Root cause: `duplicateReviewAcknowledgementSchema` required both acknowledgement
members and modeled `confirmDistinctRecipe` as `z.literal(true)`. Consequently,
an empty/partial object or literal `false` failed request validation with 400
before the existing fresh server comparison and service acknowledgement gate
could return the frozen required-review 409 evidence.

The narrow fix keeps the acknowledgement object strict while making its two
known members optional at the validation boundary. `resultDigest`, when
present, must still be a 64-character lowercase hexadecimal SHA-256 digest;
`confirmDistinctRecipe`, when present, must still be boolean; unknown members
and non-object values remain invalid. Service enforcement now checks semantic
completeness first when review is required. Missing `duplicateReview`, an empty
or partial object, a missing digest, a missing confirmation, and literal
`false` all return `409 RECIPE_DUPLICATE_REVIEW_REQUIRED` with the fresh result
before create/publish mutation. A complete acknowledgement with a non-current
digest still returns `409 RECIPE_DUPLICATE_REVIEW_STALE`.

This behavior is covered for both Draft Publish and legacy direct create,
including zero-mutation assertions. Direct create also has an explicit
truncated/zero-candidate route counterexample proving review is required and
no create occurs. Create and Publish route counterexamples prove malformed
digests, non-boolean confirmation, and unknown acknowledgement members remain
400 validation errors before mutation. Authorization, Filipino-cuisine acknowledgement, Recipe
completeness, Ingredient checks, Draft state, archive state, and optimistic
publication protections are unchanged.

### Finding 2 — Admin test quality

Root cause: `recipeDuplicateReview.test.js` tested reducer/model behavior but
used one broad source-text scan for the Review UI, so inverted render
conditions or disconnected controls could pass.

The source scan was replaced with bounded rendered tests using the existing
Vite SSR/React conventions. A small exported render-only result component lets
the tests inspect the actual checkbox props and invoke its real `onChange`
wiring without changing product behavior. The tests now prove:

- truncated results visibly render the incomplete-window status, suppress the
  no-evidence clearance, and render the acknowledgement control;
- unresolved ING1/ING2 context renders the saved-canonical-content-only text;
- candidate title, lifecycle/archive/legacy state, and evidence come from the
  supplied result data;
- acknowledgement checked state is digest-bound and its rendered handler
  forwards the actual checkbox value;
- checking, stale, error, retry/review, status, alert, and `aria-busy` states
  are rendered from their actual state inputs; and
- a stale publication 409 adopts the fresh result, clears acknowledgement, and
  makes exactly one publication request, proving no automatic retry.

### Additional requested counterexamples

- The merged five-branch candidate window now has an explicit equal-timestamp
  test proving ascending Recipe-ID tie ordering before the limit is applied.
- Comparator tests now explicitly prove Ingredient usage reordering preserves
  multiset equality while instruction reordering breaks ordered-instruction
  equality.

### Exact narrow findings-fix files

- `apps/api/src/modules/recipes/recipe.validation.js`
- `apps/api/src/modules/recipes/recipe.service.js`
- `apps/admin/src/recipeAuthoring/RecipeReview.jsx`
- `apps/api/test/recipe-validation.test.js`
- `apps/api/test/recipe-service.test.js`
- `apps/api/test/recipe-routes.test.js`
- `apps/api/test/recipe-duplicate.test.js`
- `apps/admin/test/recipeDuplicateReview.test.js`
- `docs/milestones/MODERATOR-OPS-DUP1-recipe-duplicate-variant-detection-v1.md`

### Final automated evidence

- Focused DUP1 API suites: 193 passed, 0 failed.
- Focused DUP1 Admin suites: 30 passed, 0 failed. The Vite-backed command ran
  outside the Windows sandbox because the sandboxed process hit `spawn EPERM`.
- `recipe-image-lifecycle.test.js`: 14 passed, 0 failed.
- Recipe model/publication/update-validator authority regressions: 55 passed,
  0 failed.
- Ingredient-resolution and image provider/upload/lifecycle regressions: 43
  passed, 0 failed.
- Direct-create duplicate-review selection: 3 passed, 0 failed, including the
  truncated empty-window counterexample.
- Admin production build: passed; Vite transformed 1,653 modules. Existing
  mixed static/dynamic import and chunk-size warnings remain non-blocking.

This findings fix does not change the frozen DUP1 product scope. No runtime or
live Mongo gate was performed; the section 11 gates remain deferred.

**DUP1 FINDINGS FIX COMPLETE — READY FOR INDEPENDENT RE-REVIEW**

## 17. Second narrow findings fix — 2026-09-29

Second re-review verdict before this fix: **PASS WITH REQUIRED FIXES**.

### Finding 1 — mount the real Recipe Review path

Root cause: the first findings fix rendered the default `RecipeReview` for
some panel states, but its acknowledgement proof directly invoked the named
`DuplicateReviewResultState` child. That bypassed the production parent and
could still pass if `RecipeReview` stopped forwarding
`onAcknowledgeDuplicateReview` or other duplicate-review props.

The narrow fix mounts the default production `RecipeReview` with React DOM,
finds the real rendered checkbox, and invokes its actual React `onChange` path.
It proves a mismatched prior digest is unchecked, the current digest is
checked, and the checkbox value reaches the supplied parent handler. All
rendering assertions now enter through the default production component.

Mounted/rendered counterexamples cover active Published, active Draft, and
archived Published lifecycle labels; independently supplied true and false
evidence values; truncated empty results with incomplete-window wording, no
unconditional clearance, and required acknowledgement; unresolved ING1/ING2
saved-canonical-content-only wording; and checking, stale, error, status,
alert, retry, disabled acknowledgement, and `aria-busy` states. The lifecycle
and evidence cases use different values in one result so hardcoded output
fails the test.

The test-only named export of `DuplicateReviewResultState` was removed. The
component remains private, and no replacement hook, export, or ref was added.

### Finding 2 — comparator mutation-resistant counterexamples

The existing allowlisted comparator suite now independently proves:

- a quantity-only change breaks Ingredient multiset equality;
- a unit-only change breaks Ingredient multiset equality;
- `null` quantity remains distinct from a numeric quantity;
- equal unique Ingredient values with different repeated-use multiplicities
  are not equal;
- Ingredient order remains irrelevant while instruction order remains
  significant;
- equal title and instructions with a different Ingredient multiset selects
  the `possible_variant` arm; and
- equal title alone still returns no qualifying classification.

No production classification logic changed.

### Finding 3 — result-digest field binding

Starting from one stable exact-duplicate result, the comparator suite now
changes one input field at a time and proves a different `resultDigest` for
`candidateLimit`, `candidateUniverseCount` (the frozen API name for the
re-review's total-candidate count), `comparedCount`, `truncated`, qualifying
candidate ID, candidate classification, candidate lifecycle state, candidate
`updatedAt`, and subject canonical content. Recreated value-equivalent inputs
and a differently ordered candidate input reproduce the same digest.

The digest and fingerprint remain computed on demand only; neither is
persisted.

### Exact second-fix files

- `apps/admin/src/recipeAuthoring/RecipeReview.jsx`
- `apps/admin/test/recipeDuplicateReview.test.js`
- `apps/api/test/recipe-duplicate.test.js`
- `docs/milestones/MODERATOR-OPS-DUP1-recipe-duplicate-variant-detection-v1.md`

### Second-fix verification evidence

- Focused DUP1 API suites: 195 passed, 0 failed.
- Focused DUP1 Admin suites: 31 passed, 0 failed. The Vite-backed command ran
  outside the Windows sandbox after the sandboxed helper process hit
  `spawn EPERM`.
- `recipe-image-lifecycle.test.js`: 14 passed, 0 failed.
- Recipe model/publication/update-validator authority regressions: 55 passed,
  0 failed.
- Ingredient resolution and image provider/upload regressions: 29 passed, 0
  failed; together with the separately run image-lifecycle suite, 43 passed,
  0 failed.
- Direct-create DUP1 selections: 3 passed, 0 failed.
- Admin production build: passed outside the Windows sandbox after the
  sandboxed attempt hit `spawn EPERM`; Vite transformed 1,653 modules. The
  existing mixed static/dynamic import and chunk-size warnings remain
  non-blocking.

The second fix changes test reach and counterexample coverage only, plus
removal of the test-only export. Frozen product behavior, comparator rules,
API fields, persistence, authorization, and runtime scope are unchanged. No
live Mongo, query-plan, browser, or other runtime gate was performed; section
11 remains deferred.

**DUP1 SECOND FINDINGS FIX COMPLETE — READY FOR FINAL INDEPENDENT RE-REVIEW**

## 18. Final narrow test-evidence fix — 2026-09-29

Final re-review verdict before this fix: **PASS WITH REQUIRED FIXES**. The
review found no new production-authority defect; this phase changed tests and
milestone evidence only.

### Finding 1 — digest classification and subject isolation

Root cause: the prior candidate-classification digest case changed the
candidate title, which also changed its canonical payload. The prior subject
case changed an exact match into a different classification, so neither case
isolated the field it claimed to bind.

The API comparator test now runs the public `createDuplicateReview` production
path from the real production module under a controlled one-field
classification mutation. Subject input, candidate ID and canonical payload,
lifecycle, `updatedAt`, candidate ordering, and all bound-window metadata stay
identical; only the qualifying result classification changes, and the test
proves `resultDigest` changes. The test does not recreate the digest algorithm
or add a production export.

A separate subject-only counterexample holds one unrelated candidate and all
candidate/bound-window data constant. Both comparisons retain the same null
classification and empty qualifying-result set; changing only the subject's
canonical title changes `resultDigest`.

### Finding 2 — Admin acknowledgement and status mutation resistance

All added assertions render the default production `RecipeReview`; no internal
child component is exported or invoked directly.

- The mounted acknowledgement case now invokes the rendered checkbox with
  `checked=true`, rerenders the current digest as checked, then invokes it with
  `checked=false`. The supplied production callback must receive `[true,
  false]`, so hardcoding either value fails.
- A bounded, non-truncated result with no qualifying candidates renders the
  frozen no-evidence status and no checkbox or continue-distinct
  acknowledgement text.
- A legacy candidate fixture renders the frozen `Published · Legacy status`
  label.
- Exact-duplicate and possible-variant candidates are located within their
  respective rendered classification sections. Each scoped assertion rejects
  the other candidate, so headings without the correct candidate association
  cannot pass.

### Finding 3 — null quantity isolation

The comparator counterexample now keeps canonical Ingredient ID, canonical
`piece` unit, note, optional state, title, instructions, and all other content
constant while varying only `quantity: null` versus `quantity: 1`. The equal
null control is an `exact_duplicate`; the isolated null-versus-number case
breaks Ingredient-multiset equality and selects `possible_variant`. No unit
conversion or production special case was introduced.

### Exact final-fix files

- `apps/api/test/recipe-duplicate.test.js`
- `apps/admin/test/recipeDuplicateReview.test.js`
- `docs/milestones/MODERATOR-OPS-DUP1-recipe-duplicate-variant-detection-v1.md`

No production file changed during this final phase.

### Final verification evidence

- Focused DUP1 API suites: 197 passed, 0 failed.
- Focused DUP1 Admin suites: 34 passed, 0 failed. The Vite-backed command ran
  outside the Windows sandbox after the sandboxed process hit the known
  `spawn EPERM`/helper-process limitation.
- `recipe-image-lifecycle.test.js`: 14 passed, 0 failed.
- Recipe model/publication/update-validator authority regressions: 55 passed,
  0 failed.
- Ingredient-resolution and image provider/upload regressions: 29 passed, 0
  failed; together with image lifecycle, 43 passed and 0 failed.
- Direct-create DUP1 selections: 3 passed, 0 failed.
- Admin production build: passed outside the Windows sandbox; Vite transformed
  1,653 modules. Existing mixed static/dynamic import and chunk-size warnings
  remain non-blocking.

No live Mongo, query-plan, browser, or other runtime gate was performed; the
section 11 gates remain deferred.

**DUP1 FINAL TEST FIX COMPLETE — READY FOR CLOSURE RE-REVIEW**

## 19. Final closure and runtime record — 2026-09-30

### Implementation and independent review

- The implementation remains the bounded architecture recorded in section 15:
  one on-demand comparator, the five existing-index lifecycle branches, the
  Moderator-only check route, fresh server-side create/publish rechecks, and
  the saved-canonical-content Review UI. No second Recipe authority or
  persistent duplicate-review state was introduced.
- Independent review completed through the three narrow findings-fix rounds in
  sections 16–18. The fixes made partial acknowledgement objects reach the
  required-review service gate, strengthened rendered Admin coverage, added
  mutation-resistant comparator and digest counterexamples, removed the
  temporary test-only component export, and corrected the final isolation
  cases.
- Final closure re-review verdict: **PASS**, with no unresolved production,
  authority, persistence, contract, or test-evidence finding.

### Final automated and build evidence

- Focused DUP1 API suites: **197 passed, 0 failed**.
- Focused DUP1 Admin suites: **34 passed, 0 failed**.
- `recipe-image-lifecycle.test.js`: **14 passed, 0 failed**.
- Recipe model/publication/update-validator authority regressions: **55
  passed, 0 failed**.
- Ingredient-resolution and image provider/upload regressions: **29 passed, 0
  failed**; together with image lifecycle: **43 passed, 0 failed**.
- Direct-create DUP1 selections: **3 passed, 0 failed**.
- Admin production build: **PASS**; Vite transformed 1,653 modules. The
  existing mixed static/dynamic import and chunk-size warnings remained
  non-blocking.

### Development backend, data, and query-plan runtime

- The runtime gate verified `NODE_ENV=development` and the `wecooked-dev`
  database before fixture writes. No production-database fixture write was
  used.
- Real development data verified every qualifying classification and the
  same-title-only no-qualifying-evidence case against the API contract.
- The lifecycle universe passed for active and archived explicit Published,
  active and archived legacy-Published, and active Draft candidates; archived
  Drafts were excluded and an existing subject was excluded by ID.
- A universe above 500 eligible Recipes verified the deterministic newest
  **500-candidate** comparison window, exact universe/compared counts,
  `truncated: true`, and incomplete-window response behavior.
- `explain('executionStats')` verification passed for all five bounded query
  branches using the existing
  `publicationStatus_1_isActive_1_updatedAt_-1` index contract. No new index was
  required.
- Runtime stale checks passed for changed subject content, a changed qualifying
  candidate, and a newly qualifying candidate. Required/stale responses
  occurred before mutation and returned fresh review evidence.
- Concurrent Moderator sessions verified that one session's intervening change
  invalidates the other session's review without an automatic retry or
  candidate mutation.
- Legacy `POST /recipes` runtime verification passed for the fresh comparator,
  required acknowledgement, stale digest, and explicit current retry paths.
- Moderator authorization, Admin/User denial, and stale-role demotion passed
  against database-authoritative capability checks.
- Persistence-safety inspection verified that review acknowledgements,
  digests, fingerprints, comparator evidence, and unresolved import/resolver
  state were not written as Recipe fields or to another collection.
- Runtime fixtures were removed exactly by their unique marker: remaining
  marker count was zero and the development Recipe count returned to its
  baseline of **36**.

### Admin browser, integration, and accessibility runtime

- Real Admin browser verification passed for idle, checking, bounded
  no-evidence, candidate/evidence, acknowledgement, stale/error, retry, focus,
  and publication-gating states. Network/console inspection found no duplicate
  uncontrolled request, forbidden candidate field, persisted fingerprint, raw
  unresolved resolver state, secret disclosure, or unexpected console error.
- The real `URL1 -> ING1 -> ING2 -> DUP1` flow passed: unresolved imported input
  displayed the saved-canonical-content-only warning; Ingredient creation and
  separate confirmation produced canonical saved Recipe content; DUP1 then
  invalidated/rechecked against that saved content only.
- Keyboard-only operation passed for duplicate checking, candidate actions,
  Compare, View existing Recipe, acknowledgement, Publish gating, and
  stale/error retry, with visible focus retained or returned as designed.
- Desktop, narrow layout, light/dark theme, and **200% browser zoom** checks
  passed without clipped evidence, lost controls, or unreachable actions.
- Browser accessibility-tree inspection passed the required status, alert,
  `aria-busy`, label, action-name, and non-color-only lifecycle semantics.
  Screen-reader execution itself was unavailable and is not claimed.
- Ordinary Draft save/reload/edit/Review/Publish behavior passed, including the
  no-candidate path.

### Schema, migration, index, and package decision

No Recipe schema/model field, migration, collection, persisted fingerprint,
uniqueness constraint, new index, package, lockfile, or runtime harness is
required or included. The existing compound Recipe index remains the query
authority for the five bounded reads.

### Final readiness

All frozen acceptance gates are complete, runtime data is restored, and the
implementation remains within the frozen/amended production, test, and
documentation allowlists.

**DUP1 FINALIZED — READY FOR EXACT STAGING, COMMIT, AND PUSH**
