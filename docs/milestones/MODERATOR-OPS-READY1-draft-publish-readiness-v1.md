# MODERATOR-OPS-READY1 - Server-Derived Draft Publish-Readiness v1

**Freeze date:** 2026-09-30

**Phase:** Read-only audit and milestone freeze; no implementation

**Branch:** `main`

**Baseline:** `3e86ab3b2ba0fa627eadbd6e8331690fcd457477`

**STATUS:** `READY1 AUDIT PASS - READY FOR IMPLEMENTATION`

## 1. Goal and authority

READY1 adds one Moderator-only, server-derived projection that answers whether
the current saved Draft Recipe satisfies the server-side requirements for
publication and, when it does not, identifies the blocking requirements with
stable machine-readable codes and useful paths.

READY1 does not create a second validation system. The actual Publish service
and the readiness projection must call the same internal evaluators for:

1. Draft and archive lifecycle state;
2. the existing complete-Published Recipe schema;
3. canonical Ingredient existence and activity; and
4. the existing DUP1 fresh comparison and acknowledgement rules.

The `Recipe` document, current MongoDB state, canonical Ingredient records,
`publishedRecipeBodySchema`, the Draft-to-Published service transition, and
DUP1 remain authoritative. The projection is advisory only in the sense that
it performs no mutation: Publish must rerun the shared evaluators immediately
before its atomic write and never trust an earlier projection.

## 2. Audit boundary and verified baseline

The live checkout was audited at the exact requested baseline:

```text
3e86ab3b2ba0fa627eadbd6e8331690fcd457477
```

At audit time, `HEAD`, `main`, and `origin/main` were aligned at that commit.
The audit covered the live Recipe validation, service, repository, model,
serializer, routes, controller, capability authority, focused Recipe tests,
DUP1 milestone, and META1/META2 only where they affect publication semantics.

No application or test file was modified. This milestone document is the only
READY1 file created by this phase.

## 3. Existing publication authority

Publication requirements currently live in several deliberately layered parts
of the existing path:

| Authority | Current responsibility |
|---|---|
| `apps/api/src/modules/recipes/recipe.validation.js` | `publishedRecipeBodySchema` is the authoritative new-publication completeness contract. `publishRecipeSchema` also requires the request-only Filipino-cuisine confirmation and validates optional `expectedUpdatedAt` and DUP1 acknowledgement input. |
| `apps/api/src/modules/recipes/recipe.service.js` | `publishRecipe` loads the current Recipe, checks the optimistic precondition, rejects archived/non-Draft state, calls `assertPublishedComplete`, checks every canonical Ingredient reference for existence/activity, reruns DUP1, enforces review freshness/acknowledgement, then requests the atomic transition. |
| `apps/api/src/modules/recipes/recipe.repository.js` | `publishById` atomically requires `_id`, current `updatedAt`, `isActive: true`, and `publicationStatus: "draft"` before setting publication state/attribution. The same repository also supplies DUP1's bounded read-only candidate universe. |
| `apps/api/src/modules/recipes/recipe.model.js` | Mongoose preserves storage constraints, including canonical enums, numeric bounds, Ingredient usage shape, instruction shape, image consistency, and the conditional Published cook-time requirement. It is not a substitute for service completeness. |
| `apps/api/src/modules/recipes/recipe-duplicate.js` plus existing service orchestration | DUP1 deterministically computes the current comparison result and digest. It has no persistence and is rerun before Publish. |
| current capability middleware | The route order is `authenticate -> requireCapability(catalog.write) -> validate -> controller -> service -> repository`; current MongoDB role/status, not JWT role claims, is authoritative. |

`legacyPublishedRecipeBodySchema` is not READY1's Draft publication contract.
It remains the compatibility authority for already-Published legacy records,
consumer eligibility, restore, and Published edits. A Draft moving to Published
continues to use the stricter `publishedRecipeBodySchema`.

The existing Admin `publicationReadiness(form)` helper is presentation-time
client validation. It cannot be READY1 authority because it sees working local
state rather than the saved Recipe, cannot verify Ingredient records, and
cannot authoritatively evaluate lifecycle or current DUP1 state. READY1 does
not remove or expand that helper; REVIEW1 owns its later consumption change.

## 4. Audited publication requirements

### 4.1 Required Recipe content

The existing strict new-publication schema requires:

- `title`: normalized current title contract;
- non-empty `description`;
- `difficulty`;
- `cookTimeMinutes` within the current integer bounds;
- `servings` within the current integer bounds;
- at least one structurally valid canonical Ingredient usage; and
- at least one structurally valid ordered instruction.

Every populated canonical Ingredient reference, including an optional usage,
must exist and be active at publication time. This requirement already exists
in `publishRecipe`; READY1 does not invent Ingredient-resolution policy. Raw or
unresolved ING1/ING2 import rows exist only in local Admin authoring state and
are not Recipe data. They cannot appear in server readiness. If none have been
confirmed and saved, the saved Recipe is simply missing the corresponding
canonical usage and the ordinary `ingredients` completeness issue applies.

### 4.2 Optional content

READY1 must not make any optional field mandatory:

- `prepTimeMinutes`, `region`, `category`, `dietaryTags`, `imageUrl`, and
  `imageAssetId` remain optional under their current contracts;
- META1 `region`, `category`, and `dietaryTags` absence is meaningful and is
  never a readiness issue;
- if optional content is present but invalid, the existing strict publication
  schema may report it as `RECIPE_INCOMPLETE`; and
- META2 source disclosures and unaccepted suggestions are transient Admin
  intake state, not publication requirements and not readiness issues.

### 4.3 Lifecycle and request-only requirements

Only an active Draft can be ready. An archived Draft is blocked by
`RECIPE_ARCHIVED`; an effective Published/non-Draft Recipe is blocked by
`RECIPE_NOT_DRAFT`. Restore semantics do not change: restoring an incomplete
Draft remains allowed, while publication is evaluated separately.

`confirmFilipinoCuisine: true` remains mandatory on the actual Publish request
under the existing `publishRecipeSchema`. It is deliberately not a READY1
issue because READY1 is a projection of server-derived Recipe and comparison
state, while that confirmation is a transient human declaration that the
server cannot derive from the Recipe. Therefore `ready: true` means the saved
Draft satisfies every server-derived publication gate for the supplied DUP1
context; it does not make an otherwise malformed Publish request valid.
REVIEW1 must retain the existing explicit confirmation and send it on Publish.

`expectedUpdatedAt` is a projection precondition, not an issue. READY1 requires
it in the request. A mismatch returns the existing `409 RECIPE_EDIT_CONFLICT`
and no readiness projection, forcing the caller to reload rather than receiving
a claim about a different Recipe version.

## 5. Frozen readiness semantics

For a matching saved Recipe version, the service returns exactly one projection
for that Recipe version:

```json
{
  "ready": false,
  "recipeId": "507f1f77bcf86cd799439099",
  "recipeUpdatedAt": "2026-09-30T00:00:00.000Z",
  "issues": [
    {
      "code": "RECIPE_INCOMPLETE",
      "path": "servings",
      "message": "Invalid input: expected number, received undefined"
    }
  ],
  "duplicateReview": null
}
```

The example message is illustrative only; the authoritative Zod issue message
must pass through. The response uses the repository's standard success envelope
as described in section 8.

The exact semantics are:

1. `ready` is exactly `issues.length === 0`.
2. `recipeId` is the canonical string form of the evaluated Recipe `_id`.
3. `recipeUpdatedAt` is the evaluated stored version as an ISO-8601 string.
4. `issues` is always an array and contains no success/warning entries.
5. `path` is always a dotted API field path. Array indices are zero-based, for
   example `ingredients.2.ingredientId`. It is not a MongoDB update path.
6. Lifecycle evaluation preserves Publish's current fail-fast order: inactive
   state produces only `RECIPE_ARCHIVED`; otherwise non-Draft state produces
   only `RECIPE_NOT_DRAFT`. For an active Draft, completeness issues follow in
   authoritative Zod issue order, Ingredient-record issues follow in saved
   usage order, and any DUP1 issue is last.
7. Completeness issues come only from
   `publishedRecipeBodySchema.safeParse(toPublishedValidationInput(recipe))`.
   READY1 must not restate field rules in another schema, constants table, or
   hand-written predicate set.
8. Ingredient issues come from one shared Ingredient eligibility evaluator.
   The existing `assertIngredientsActive` behavior and Publish must consume the
   same result; READY1 may not perform an independent lookup policy.
9. The DUP1 comparator runs only when the subject is an active Draft, the
   complete-Published schema passes, and every referenced Ingredient is current
   and active. Otherwise `duplicateReview` is `null` and no potentially
   misleading duplicate-clear result is returned.
10. When DUP1 runs, `duplicateReview` is the exact existing public DUP1 result,
    including version, digest, bounded-count/truncation fields, candidates,
    classification, and evidence. No READY1 score or summary is added.
11. The supplied optional `duplicateReview` acknowledgement is evaluated with
    the exact existing DUP1 order: an incomplete acknowledgement when review is
    required produces `RECIPE_DUPLICATE_REVIEW_REQUIRED`; only a semantically
    complete acknowledgement can then be tested for staleness.
12. A matching digest plus literal `confirmDistinctRecipe: true` removes the
    DUP1 issue for that projection only. It is never persisted.
13. When the bounded result has no candidates and is not truncated, no
    acknowledgement is required. A supplied non-current digest still produces
    `RECIPE_DUPLICATE_REVIEW_STALE`, matching current Publish enforcement.
14. Readiness performs no create, update, publish, archive, restore, audit-log,
    review-task, fingerprint, acknowledgement, or other persistence operation.
15. An earlier `ready: true` never authorizes a later write. Actual Publish
    reloads current state, reruns the same evaluators and DUP1 comparison, and
    retains the atomic repository precondition.

For an inactive Recipe, READY1 returns only `RECIPE_ARCHIVED`, matching the
current Publish guard order, and does not continue into completeness,
Ingredient, or DUP1 evaluation. For an active non-Draft, READY1 returns only
`RECIPE_NOT_DRAFT`; it does not assess legacy-Published completeness as though
the Recipe were a publishable Draft.

## 6. Exact readiness issue codes

Only these issue codes may be emitted by READY1 v1:

| Code | Exact condition | Path | Message authority |
|---|---|---|---|
| `RECIPE_ARCHIVED` | `isActive !== true`; evaluated before publication state, exactly as current Publish. | `isActive` | Existing `An archived recipe cannot be published.` message. |
| `RECIPE_NOT_DRAFT` | The target is active and effective publication state is not `draft`. | `publicationStatus` | Existing `Only an active Draft can be published.` message. |
| `RECIPE_INCOMPLETE` | One issue emitted by the existing `publishedRecipeBodySchema` against the service's existing published-validation input. One readiness issue is returned per Zod issue. | Dotted form of that Zod issue path. | That Zod issue's current message; clients key on code/path, not message text. |
| `RECIPE_INGREDIENT_NOT_FOUND` | A saved `ingredients[n].ingredientId` does not resolve through `IngredientService`. | `ingredients.n.ingredientId` for every affected saved usage, in usage order. | Existing `One or more referenced ingredients do not exist.` message. |
| `RECIPE_INGREDIENT_INACTIVE` | A saved `ingredients[n].ingredientId` resolves to an inactive Ingredient. | `ingredients.n.ingredientId` for every affected saved usage, in usage order. | Existing `One or more referenced ingredients are not active.` message. |
| `RECIPE_DUPLICATE_REVIEW_REQUIRED` | Fresh DUP1 result has candidates or is truncated, and acknowledgement is absent or semantically incomplete. | `duplicateReview` | Existing `Review the current duplicate and variant evidence before continuing.` message. |
| `RECIPE_DUPLICATE_REVIEW_STALE` | A semantically complete supplied acknowledgement has a digest different from the fresh DUP1 result, or a digest is supplied for a changed zero-candidate result. | `duplicateReview` | Existing `Recipe duplicate review is stale. Review the current candidates before continuing.` message. |

The following remain ordinary endpoint errors and are not embedded as readiness
issues: `RECIPE_NOT_FOUND`, `RECIPE_EDIT_CONFLICT`, authentication/authorization
errors, request `VALIDATION_ERROR`, and unexpected infrastructure failures.
That boundary prevents a caller from mistaking inability to evaluate for a
valid negative readiness result.

No field-specific parallel code such as `SERVINGS_REQUIRED` is introduced.
`RECIPE_INCOMPLETE` plus the authoritative dotted path is the stable existing
contract and avoids copying the publication schema into an issue-code table.

## 7. DUP1 integration

READY1 reuses `compareRecipeSubject`, the existing bounded candidate universe,
the current `recipe-duplicate-v1` fingerprint/result digest, and the existing
`enforceDuplicateReview` semantics. It does not add a second comparator,
persist a fingerprint, broaden the candidate universe, change the 500-record
bound, add uniqueness, or mutate any candidate.

The endpoint request may carry the same strict request-only object used by
Publish:

```json
{
  "resultDigest": "<64 lowercase hexadecimal SHA-256>",
  "confirmDistinctRecipe": true
}
```

The response's `duplicateReview` member is the existing DUP1 public projection,
not a new READY1 representation. This lets REVIEW1 later render one current
server result and submit the same acknowledgement to both readiness and actual
Publish. A fresh result is still advisory under DUP1's documented database-race
boundary; actual Publish reruns it.

## 8. Frozen API and service surface

### 8.1 Endpoint

```text
POST /api/v1/recipes/:recipeId/publish-readiness
```

`POST` is used because the caller may submit request-only DUP1 acknowledgement
context. The operation is read-only and must never mutate data.

The strict request body is:

```json
{
  "expectedUpdatedAt": "<required ISO-8601 timestamp>",
  "duplicateReview": {
    "resultDigest": "<optional 64 lowercase hexadecimal SHA-256>",
    "confirmDistinctRecipe": "<optional boolean>"
  }
}
```

`duplicateReview` itself is optional and reuses the existing strict schema.
Unknown body keys are rejected. `confirmFilipinoCuisine` is not accepted here;
it remains exclusively an actual Publish request requirement.

A successful evaluation returns HTTP 200 through `sendSuccess`:

```json
{
  "success": true,
  "data": {
    "publishReadiness": {
      "ready": true,
      "recipeId": "507f1f77bcf86cd799439099",
      "recipeUpdatedAt": "2026-09-30T00:00:00.000Z",
      "issues": [],
      "duplicateReview": {
        "fingerprintVersion": "recipe-duplicate-v1",
        "resultDigest": "<digest>",
        "candidateLimit": 500,
        "candidateUniverseCount": 0,
        "comparedCount": 0,
        "truncated": false,
        "candidates": []
      }
    }
  }
}
```

Expected domain blockers return HTTP 200 with `ready: false`. Missing Recipe,
stale `expectedUpdatedAt`, invalid request shape, lack of authority, and
infrastructure failure retain the existing error envelope and status codes.

The route must be mounted before `/:recipeId` and preserve the existing order:

```text
authenticate
-> requireCapability(CAPABILITIES.CATALOG_WRITE)
-> validate(publishReadinessSchema)
-> recipeController.getRecipePublishReadiness
-> recipeService.getRecipePublishReadiness
```

### 8.2 Shared service design

`recipe.service.js` owns one internal readiness evaluator. The exact names may
follow local style, but the responsibilities are frozen:

- `getRecipePublishReadiness(id, input)` loads the raw Recipe, checks the
  required `expectedUpdatedAt`, and returns the projection without writing;
- an internal evaluator produces lifecycle, schema, Ingredient, and DUP1
  results from that loaded version;
- `publishRecipe` calls that same evaluator immediately before
  `recipeRepository.publishById` and translates a blocking result to the
  existing Publish `AppError` contract; and
- the legacy immediate-create path, Published edit/restore compatibility, and
  consumer visibility keep using their appropriate existing strict/legacy
  helpers. Refactoring shared primitives must not weaken those paths.

No repository method is required. READY1 reuses `findRawById`, the Ingredient
service lookups, and DUP1's existing read-only candidate query. No serializer
change is required because the readiness projection is a dedicated controller
response, not a Recipe representation.

## 9. Authorization

READY1 uses `CAPABILITIES.CATALOG_WRITE`, exactly like Publish and DUP1.
Under the current capability map this permits active Moderators only. Users and
Admins are denied with the existing `403 FORBIDDEN`; unauthenticated/invalid
sessions receive existing authentication errors. `authenticate` must continue
to hydrate role and status from current MongoDB state, so stale token role
claims cannot authorize readiness.

There is no consumer/mobile readiness route and no public projection of Draft
content or duplicate candidates.

## 10. Exact implementation allowlist

Only these production files may be modified by READY1 implementation:

| File | Change | Exact responsibility |
|---|---|---|
| `apps/api/src/modules/recipes/recipe.validation.js` | modify | Add the strict readiness request schema by reusing `expectedUpdatedAtSchema` and `duplicateReviewAcknowledgementSchema`; export it. |
| `apps/api/src/modules/recipes/recipe.routes.js` | modify | Mount the Moderator-only read-only endpoint before the parameterized detail route. |
| `apps/api/src/modules/recipes/recipe.controller.js` | modify | Adapt validated params/body and return `{ publishReadiness }` through `sendSuccess`. |
| `apps/api/src/modules/recipes/recipe.service.js` | modify | Add the shared readiness evaluator/projection, attach paths to existing Ingredient eligibility results, and make actual Draft Publish consume the same authority. |
| `docs/milestones/MODERATOR-OPS-READY1-draft-publish-readiness-v1.md` | modify | Append implementation, review, and runtime evidence only; do not change the frozen contract silently. |

No model, repository, serializer, capability, shared contract, migration,
index, package, lockfile, Admin, mobile, META2, Ingredient-module, or DUP1
comparator file is allowlisted. If implementation evidence proves another
production file necessary, stop and amend this milestone before editing it.

## 11. Exact test allowlist

Only these test files may be added or modified:

```text
apps/api/test/recipe-validation.test.js   (modify)
apps/api/test/recipe-service.test.js      (modify)
apps/api/test/recipe-routes.test.js       (modify)
```

Tests must prove at minimum:

1. strict request validation, required timestamp, optional existing DUP1 shape,
   unknown-key rejection, and parameter validation;
2. exact success-envelope/projection shape and dotted paths;
3. every frozen issue code and deterministic issue ordering;
4. required fields, servings, instructions, optional prep time, optional META1
   absence, and invalid populated optional metadata through the real
   `publishedRecipeBodySchema`;
5. empty ingredients plus missing/inactive canonical Ingredient records,
   including repeated usages and exact zero-based paths;
6. archived Draft, Published, and missing Recipe behavior;
7. matching and stale `expectedUpdatedAt`, including zero writes on conflict;
8. DUP1 no-candidate, candidate, truncated, incomplete acknowledgement, matching
   acknowledgement, stale acknowledgement, and changed-result cases;
9. zero create/update/publish/archive/restore operations for every readiness
   request, including `ready: true`;
10. actual Publish and readiness parity from the same saved snapshot, including
    proof that Publish still reruns the comparator and retains its atomic write
    precondition;
11. Moderator success, User/Admin denial, unauthenticated denial, and stale-role
    demotion using current database authority; and
12. fail-closed propagation of repository, Ingredient, and comparator failures
    rather than returning `ready: false`.

Assertions that only search source text are insufficient. The focused tests
must execute the route/service behavior and mutation-test the shared-authority
wiring: replacing either readiness or Publish with a permissive independent
predicate must fail the suite.

Existing `recipe-authoring.test.js`, `recipe-duplicate.test.js`,
`catalog-authority-routes.test.js`, and Admin authoring suites are regression
commands only and are not thereby allowlisted for modification.

## 12. Runtime gate

READY1 implementation is not complete until all of the following are measured:

1. Run focused API tests for the three allowlisted test files, followed by the
   existing Recipe authoring, duplicate, and catalog-authority regressions.
2. Run the full API suite. If Windows sandbox worker creation produces
   `spawn EPERM`, rerun the identical focused command with
   `--test-isolation=none` or outside that environment boundary and report the
   distinction; do not treat the environment failure as a product failure.
3. Against a controlled development MongoDB dataset, call readiness for a
   complete Draft, incomplete Draft, archived Draft, Published Recipe,
   missing/inactive Ingredient, zero-candidate DUP1 result, qualifying
   candidate, truncation, matching acknowledgement, and stale acknowledgement.
4. Before and after each runtime call, verify the Recipe document, candidates,
   Ingredient documents, collection counts, and target `updatedAt` are
   unchanged. A `ready: true` call must also make zero writes.
5. For a controlled matching snapshot, prove readiness and actual Publish have
   the same decision. Then change the Recipe or qualifying DUP1 candidate and
   prove stale precondition/review handling before mutation.
6. Verify active Moderator access, User/Admin denial, unauthenticated denial,
   and stale-role demotion using current database role authority.
7. Confirm the actual Publish transition remains atomic under a concurrent
   Recipe edit and that an earlier readiness response grants no authority.

No Admin browser, touch, responsive, or accessibility runtime claim belongs to
READY1 because this milestone has no Admin implementation. Those gates belong
to REVIEW1 if it adds a visible readiness consumer.

## 13. Explicit exclusions

READY1 does not add or change:

- a review-task collection, assignment, ownership, priority, queue, SLA, or
  workflow status;
- AI, fuzzy validation, semantic scoring, or content generation;
- Recipe fields, publication requirements, model indexes, migrations, or data
  backfills;
- META2 mappings, source disclosures, suggestions, acceptance, or UI;
- automatic publication, automatic duplicate acknowledgement, uniqueness,
  merge, archive, delete, or candidate mutation;
- persistence of readiness, issues, fingerprints, comparison results, or
  acknowledgement;
- readiness for unsaved local Admin edits or unresolved local import rows; or
- Admin/mobile UI implementation.

## 14. REVIEW1 boundary

READY1 is server-only. The current Admin remains unchanged and continues its
existing local section checks, duplicate-review flow, explicit Filipino-cuisine
acknowledgement, and Publish request until REVIEW1 is separately audited and
authorized.

REVIEW1 may consume `publishReadiness` to present a derived Draft review view,
route issue paths to existing authoring sections, render the returned DUP1
result, bind acknowledgement to its digest, and refresh after saved content or
lifecycle changes. REVIEW1 must keep the server projection authoritative and
must not copy READY1 rules into another frontend readiness engine.

REVIEW1 may decide how to retire or narrow the current local
`publicationReadiness(form)` and separate duplicate-check orchestration after
behavioral verification. READY1 does not remove
`POST /api/v1/recipes/duplicate-check`; compatibility/removal requires an
explicit later decision. REVIEW1 also may not introduce persistence, a generic
review queue, assignment/priority workflow, META2 changes, or AI.

## 15. Blockers and residual boundaries

There is no blocker to the frozen server-only implementation within the exact
allowlists.

The following are explicit boundaries, not blockers:

- readiness applies to saved server state, not unsaved Admin form work;
- the Filipino-cuisine confirmation remains an actual Publish request gate and
  is not server-derived readiness;
- DUP1 remains bounded and advisory, and actual Publish must rerun it;
- infrastructure failures are errors, never readiness issues; and
- runtime/no-write/concurrency evidence is deferred to implementation.

## 16. Audit-time Git and stash state

The final audit commands required for this freeze are:

```text
git diff --check
git status --short --branch
```

`git diff --check` passed with no output. Because Git does not include an
untracked file in that check, the new milestone was also checked directly with
`git diff --no-index --check`; it reported no whitespace error (only the
expected Windows LF-to-CRLF notice and the expected nonzero status for a new
file diff).

Final status:

```text
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
?? docs/milestones/MODERATOR-OPS-READY1-draft-publish-readiness-v1.md
```

The checkout began aligned at the requested baseline with the first nine
untracked files above. This milestone is the only additional untracked file.
There are no tracked changes, and no file was staged, committed, or pushed.

Stash status:

```text
stash@{0}: On feat/cook-mode-timer-ui: WIP cook mode timer UI
```

The protected Cook Mode stash was listed only to report status and was not
inspected, applied, popped, dropped, or otherwise manipulated.

## 17. Verdict

**READY1 AUDIT PASS - READY FOR IMPLEMENTATION**

## 18. Implementation evidence (2026-09-30)

Implementation was performed from baseline
`3e86ab3b2ba0fa627eadbd6e8331690fcd457477` on
`feat/moderator-ops-ready1-publish-readiness` and remained within the frozen
production and test allowlists.

The implementation adds the strict `publishReadinessSchema`, mounts
`POST /api/v1/recipes/:recipeId/publish-readiness` behind
`authenticate -> requireCapability(CATALOG_WRITE) -> validate`, and returns
the frozen `{ publishReadiness }` success payload through the existing response
helper. The service loads one raw saved Recipe, enforces the required
`expectedUpdatedAt` precondition, and performs no repository mutation.

`evaluatePublishReadiness` is the shared internal publication evaluator used
by readiness and actual Publish. It derives completeness issues directly from
`publishedRecipeBodySchema`, consumes one shared Ingredient eligibility result,
and reuses the existing DUP1 comparison and acknowledgement logic. Readiness
collects deterministic schema and Ingredient issues. Publish preserves its
existing completeness-first fail-fast error behavior, reruns Ingredient and
DUP1 evaluation, and retains the atomic `publishById` updatedAt precondition.

Automated evidence:

- focused READY1 validation/service/route tests: 182 passed, 0 failed;
- frozen Recipe authoring, duplicate, and catalog-authority regressions:
  40 passed, 0 failed;
- ordinary full API command: blocked before assertions by the Windows sandbox
  `spawn EPERM` worker boundary;
- identical full API suite outside that boundary: 1,712 passed, 0 failed; and
- zero-write tests fail every Recipe create/update/publish/archive/restore
  repository call from readiness, including `ready: true`, blockers, and
  stale-version cases.

Focused coverage includes all seven frozen issue codes, exact deterministic
dotted paths and ordering, optional META1 absence, invalid populated optional
fields, missing/inactive repeated Ingredient usages, DUP1 candidate/truncation/
acknowledgement/staleness/changed-result behavior, readiness/Publish decision
parity, Publish comparator reruns, atomic conflict behavior, Moderator success,
User/Admin/unauthenticated denial, stale-role demotion, and fail-closed
infrastructure errors.

Controlled-development-database runtime evidence remains unavailable in this
checkout: `127.0.0.1:27017` did not accept a connection, and neither `mongod`
nor Docker is installed. No live MongoDB, document before/after, or concurrent
runtime claim is made. This is the remaining section 12 gate before the
milestone can be declared runtime-complete.
