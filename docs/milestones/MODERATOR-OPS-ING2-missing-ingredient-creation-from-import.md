# MODERATOR-OPS-ING2 - Missing Ingredient Creation from Import

Status: final verification passed - ready for commit/push

Audit date: 2026-09-28

Audited branch: `main`

Audited commit: `d753d28a05c057ded0cafd736cc0061b6257aac8`

Application code status: read-only during this audit

## 1. Goal and verdict

Add the smallest safe Moderator-only bridge from an ING1 unresolved imported
ingredient line to the existing canonical Ingredient creation authority. The
bridge may offer `+ Create Ingredient` only after the current complete-catalog
resolver has authoritatively classified the line as `none`, open the existing
Ingredient creation modal with a narrowly bounded name suggestion, and return
the successful server-created Ingredient to that same unresolved line as a
selection.

Creation and Recipe use remain two separate explicit decisions. Opening or
cancelling the modal performs no mutation. The Moderator must review the
Ingredient form, choose required catalog metadata, and explicitly submit the
existing `POST /api/v1/ingredients` contract. A successful response selects the
new canonical Ingredient for the source line but does not confirm it into the
Recipe. The existing `Confirm ingredient` action and quantity/unit validation
remain required before the ordinary Recipe row is created. Existing Save Draft,
PATCH, Publish, conflict, reload, archive/restore, and active-Ingredient checks
remain authoritative.

No backend production change, Ingredient model change, Recipe schema change,
migration, package, second lifecycle, or background work is required.

Verdict: **AUDIT PASS - READY FOR IMPLEMENTATION**.

## 2. Verified current-main baseline

The audit used current local and remote-tracking `main` after ING1 was merged:

```text
git branch --show-current
main

git rev-parse HEAD
d753d28a05c057ded0cafd736cc0061b6257aac8

git rev-parse main
d753d28a05c057ded0cafd736cc0061b6257aac8

git rev-parse origin/main
d753d28a05c057ded0cafd736cc0061b6257aac8

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
```

HEAD is `d753d28 Merge pull request #71 from
klaynn/feat/moderator-ops-ing1-canonical-ingredient-resolution`. The untracked
files above pre-date this audit and were not modified. This ING2 milestone file
did not previously exist.

## 3. Verified current architecture

### 3.1 Imported Recipe ingredient resolution

The live ING1 path is:

```text
M27/URL1 Recipe JSON-LD Preview
  -> recipeIngredient strings enter the existing authoring reducer as a local,
     unresolved, generation-keyed queue
  -> explicit Find catalog matches
  -> POST /api/v1/ingredients/resolve
  -> complete active-catalog deterministic classification
  -> explicit candidate/manual-picker selection
  -> explicit quantity/unit validation and Confirm ingredient
  -> ordinary local Recipe ingredient row containing canonical { id, name }
  -> existing explicit Save Draft / PATCH / Publish
```

The resolver is read-only and Moderator-only. It returns `exact`, `ambiguous`,
`possible`, `none`, or `unparsed`; never preselects a candidate; ignores stale
generations; and retains source text only in transient authoring state. A
confirmed line copies only canonical Ingredient ID/name and Recipe usage fields
into the form. Resolver metadata never enters Recipe request bodies.

`LOAD_SUCCESS`, including confirmed conflict reload, clears unresolved local
source state. Draft creation, no-PATCH saves, unrelated PATCHes, and step
navigation preserve it. Closing with unresolved lines is treated as discarding
unsaved local work. ING2 must preserve those boundaries.

### 3.2 Existing Ingredient creation authority

There is already one canonical creation path:

```text
Moderator Ingredients tab / IngredientModal
  -> validateIngredientForm + ingredientFormValues
  -> ingredientApi.createIngredient
  -> POST /api/v1/ingredients
  -> authenticate
  -> requireCapability(catalog.write)
  -> validate(createIngredientSchema)
  -> ingredient.controller.createIngredient
  -> ingredient.service.createIngredient
  -> ingredient.repository.createIngredient
  -> Ingredient model / MongoDB unique index
  -> toPublicIngredient
  -> 201 { ingredient }
```

`ingredientApi.createIngredient` already returns the public Ingredient from the
201 response. `IngredientModal` already owns the matching client validation,
field-error mapping, safe error presentation, loading state, and explicit submit
button. It is the UI authority to reuse. Copying its fields or validation into
the Recipe panel would create a second lifecycle and is forbidden.

The current standalone Add Ingredient modal starts new records with the first
shared category (`produce`) selected. That existing behavior remains unchanged
for the Ingredients tab. It must not be inherited by the imported-line entry
point because imported `recipeIngredient` text contains no safe category signal.

### 3.3 Role and navigation authority

`capabilities.js` grants `catalog.write` to Moderator and deliberately withholds
it from Admin. `authenticate` reloads the current database-backed user/session
before `requireCapability` runs. `portalPolicy.js` exposes authoring and Add
Recipe only to Moderator; Admin catalog screens remain read-only.

ING2 adds no capability, role check, navigation destination, or client-supplied
authority. Direct User/Admin `POST /ingredients` calls remain 403. Admin cannot
reach the Recipe authoring/resolution UI and must not receive the new action.

## 4. Frozen canonical Ingredient creation contract

The strict request is unchanged:

```http
POST /api/v1/ingredients
Content-Type: application/json

{
  "name": "required canonical name",
  "aliases": [],
  "category": "required controlled category",
  "allergenTags": []
}
```

Frozen validation and persistence rules:

- `name` is required, trimmed, nonblank, and at most 100 characters.
- The service derives internal `normalizedName` as trim, lowercase, and
  whitespace collapse. It is required, excluded from public output, and has a
  global unique MongoDB index across active and archived records.
- `aliases` defaults to `[]`, allows at most 20 entries, and limits each entry
  to 100 trimmed characters. The service trims/collapses whitespace and removes
  case-insensitive duplicates within the new Ingredient while keeping the
  first spelling.
- Aliases are not globally unique. They may equal another Ingredient's
  canonical name or alias. ING2 does not change that existing catalog rule.
- `category` is required and must be one of the shared controlled Ingredient
  categories. Legacy `other` is readable but cannot be newly written.
- `allergenTags` defaults to `[]`, accepts only the controlled enum, and is
  de-duplicated by the service. Category never implies an allergen.
- The create body is strict. Unknown keys, including client-supplied
  `isActive`, are rejected. A successfully created Ingredient uses the model's
  `isActive: true` default.
- Mongo duplicate-key failures are translated to stable
  `409 INGREDIENT_ALREADY_EXISTS`; Mongo/index internals are not exposed.
- The public response contains `id`, `name`, `aliases`, `category`,
  `allergenTags`, `isActive`, and timestamps; it never contains
  `normalizedName`, `_id`, or `__v`.

ING2 must call this exact API through the shared authenticated client. It must
not add a create endpoint, resolver mutation mode, relaxed schema, alternate
normalizer, client-generated ID, or local persistence authority.

## 5. Frozen unresolved -> create -> return contract

The exact sequence is:

```text
current unresolved imported source line
  -> successful current-generation ING1 classification: none
  -> explicit + Create Ingredient
  -> reused IngredientModal with safe imported prefill
  -> Moderator reviews/edits name, chooses category, reviews aliases/allergens
  -> explicit Add ingredient submit
  -> existing POST /ingredients validation and catalog.write authority
  -> 201 public canonical Ingredient
  -> bind returned { id, name } to the same generation + source-entry key
  -> modal closes; source line remains unresolved and selected
  -> explicit Confirm ingredient
  -> existing quantity/unit validation
  -> ordinary local Recipe ingredient row
  -> existing explicit Save Draft / PATCH / Publish only
```

The server response is the only return authority. The client must not synthesize
an ID or treat request values as a created record. The reducer action must carry
the unresolved entry's stable `key` and current resolution `generation`; it may
select the returned Ingredient only if both still identify the current line.
A stale return is ignored rather than attached to a replacement source line.

Successful creation selects only `{ id, name }`. It must not remove the source
line, insert a Recipe row, click/dispatch confirmation, create/save a Draft,
PATCH, Publish, upload, or infer quantity/unit/note/optional. `Confirm ingredient`
remains a separate explicit Moderator action. Existing confirmation copies a
valid selection plus quantity/unit into the Recipe form and initializes `note`
blank and `optional` false.

Canonical Ingredient creation is an independent durable catalog mutation. If
the Moderator later cancels or discards the Recipe, the explicitly created
Ingredient remains. ING2 must not roll it back, archive it, or couple it to
Recipe persistence.

## 6. Exact `+ Create Ingredient` eligibility

Render the action only when every condition is true:

1. The user is already in writable Moderator Recipe authoring.
2. The entry belongs to the current unresolved queue and current generation.
3. A successful resolver response exists for that entry.
4. `match.kind === "none"`.
5. `totalCandidates === 0`, `candidates` is empty, and `truncated === false`.
6. `parsed.name` is a string whose trimmed length is 1 through 100 characters.
7. The line does not already have a selected canonical Ingredient.

The action is not rendered for `exact`, `ambiguous`, `possible`, `unparsed`, a
truncated/inconsistent response, an excluded line, a resolver error, a stale
result, a missing/overlength parsed name, or a line already satisfied through
the candidate/manual picker. During resolver loading, Recipe mutation activity,
or Ingredient submission, relevant controls are disabled.

This intentionally prefers duplicate avoidance over convenience. A possible
candidate must be reviewed through existing choices/manual search; ING2 does not
offer creation beside it. If the Moderator determines a possible/unparsed or
overlength source truly needs a new canonical record, that remains an explicit
Ingredients-tab workflow and is not silently widened here.

## 7. Safe imported prefill contract

Only one imported value may enter the creation form:

- `name`: the current resolver's `parsed.name`, with outer trim only, provided
  it meets the 1-to-100-character create boundary. It is a visible suggestion,
  not a claim that descriptor/preparation text is a correct canonical name.

The modal should also display the original `sourceText` as read-only context,
clearly separate from submitted fields. It must not submit that context.

All other fields are initialized as follows:

- `category`: empty `Choose a category` placeholder. The Moderator must choose
  a controlled category before submission. Do not reuse the standalone modal's
  `produce` default and do not infer from Recipe category, resolver candidates,
  words, or neighboring lines.
- `aliases`: empty. Do not turn the raw source, parsed name, plurals, synonyms,
  descriptors, brand/variety text, or preparation text into aliases.
- `allergenTags`: empty. Do not infer allergens from the name or category.
- `isActive`: not a form/request prefill; the existing create contract controls
  the active default.
- Recipe `quantity`, `unit`, `note`, and `optional`: remain only on the unresolved
  Recipe line and never enter Ingredient creation.
- Images, region, dietary tags, substitutions, and all Recipe metadata: absent.

The Moderator may edit the suggested name and explicitly add valid aliases or
allergen tags through the existing form. Existing client and server validation
remain authoritative; no imported value bypasses them.

## 8. Duplicate, normalized-name, and alias behavior

The ING1 `none` classification reduces obvious active-catalog duplicates but is
not a uniqueness reservation. The following behavior is frozen:

- If another request creates the same normalized canonical name after
  resolution, the Mongo unique index wins and the existing stable 409 is shown.
- If an archived Ingredient already owns the normalized canonical name, create
  also returns the same 409 because the unique index is not active-only.
- On 409, keep the creation modal open, preserve the reviewed form values, keep
  the Recipe source line unresolved, select nothing, and explain that the
  Moderator should review the Ingredient catalog (including archived records).
- Never auto-use, auto-restore, rename, merge, update, alias, or expose the ID of
  the conflicting Ingredient. The 409 response is not a canonical selection.
- Do not client-check uniqueness as authority. Resolver/list results can race;
  server validation and the unique index remain final.
- Existing aliases remain non-global and non-unique. ING2 prepopulates no alias
  and adds no alias-conflict rule, normalized-alias column/index, or catalog
  cleanup. Any aliases the Moderator manually enters follow the existing form,
  service normalization, and validation exactly.

A later archive between creation/selection and Recipe save is handled by the
existing Recipe create/PATCH/Publish active-Ingredient checks. ING2 must not
weaken or cache around those checks.

## 9. Modal choice, cancellation, errors, and retry

Use the existing `IngredientModal` as a focused modal above the Recipe authoring
dialog. Do not duplicate it inline and do not navigate to the Ingredients tab,
which would discard or strand transient Recipe work. The reusable modal may gain
initial-value/context and successful-result callbacks, but the Ingredients-tab
entry point must retain its current behavior.

Required interaction behavior:

- Opening the modal and cancelling before submit perform no request and leave
  the unresolved line unchanged.
- Escape, backdrop, close, and Cancel dismiss only the Ingredient modal and
  return focus to that line's creation action; they must not bubble into or
  close the Recipe authoring dialog.
- The modal is an accessible labeled modal. Its stacking, focus, keyboard, and
  small-screen behavior must work inside Recipe authoring.
- While the create request is in flight, submit cannot run twice and modal
  dismissal is disabled. Recipe controls behind the modal remain inaccessible.
- A 400 maps existing backend field details to the same fields and retains the
  form for correction.
- `409 INGREDIENT_ALREADY_EXISTS` retains the form and unresolved row, with no
  selection or Recipe mutation.
- Network and safe 5xx errors retain the form and allow explicit retry. A retry
  is another explicit submit; there is no background retry.
- The shared API client's existing single 401 refresh/retry remains unchanged.
  A final 401 shows the session-expired behavior; a 403 triggers the existing
  authority-refresh callback. Neither selects or confirms an Ingredient.
- On 201, invoke the return callback exactly once, then close the Ingredient
  modal. The unresolved row stays visible with the new canonical selection and
  still requires `Confirm ingredient`.

If a request succeeds after the Recipe wizard was legitimately unmounted or its
source generation was replaced, the Ingredient remains a valid explicit catalog
creation but is not attached to stale Recipe state. It will be available through
the normal active Ingredient picker. No compensating delete/archive occurs.

## 10. Authorization, security, and data-integrity invariants

- Database-backed current role/session and server `catalog.write` enforcement
  remain authoritative. UI visibility is defense in depth only.
- Admin remains catalog read-only: no Add Recipe, no ING2 action, no Ingredient
  create modal, and direct create remains 403.
- User remains forbidden from catalog creation. No client role/body/header can
  grant authority.
- Use the shared authenticated API client and its bounded safe error envelope.
  Do not expose tokens, Mongo errors, internal fields, or normalizedName.
- Use only the current `POST /ingredients` route, schema, controller, service,
  repository, model, serializer, and unique index.
- Do not add IngredientDraft, automatic/background/bulk creation, autosave,
  localStorage, queue, cache, AI/fuzzy inference, second lifecycle, or new
  package/environment/deployment authority.
- Do not change Recipe model, validation, serializer, service, repository,
  routes, or request bodies. Resolver/source/create-modal state remains local.
- Do not infer category, allergens, aliases, images, region, dietary tags,
  substitutions, notes, or optionality.
- Existing Draft, optimistic PATCH, Publish acknowledgement, conflict reload,
  catalog freshness, and final active-Ingredient validation remain unchanged.
- One imported source line may create at most one Ingredient per explicit
  successful submit. Duplicate source lines remain independent and are never
  bulk-created or deduplicated into Recipe rows.

## 11. Exact implementation allowlist

Admin production only:

```text
apps/admin/src/IngredientsTab.jsx                                     (modify)
apps/admin/src/recipeAuthoring/recipeIngredientResolution.js          (modify)
apps/admin/src/recipeAuthoring/recipeAuthoringState.js                 (modify)
apps/admin/src/recipeAuthoring/RecipeAuthoringSteps.jsx                (modify)
apps/admin/src/recipeAuthoring/RecipeAuthoringWizard.jsx               (modify)
apps/admin/src/recipeAuthoring/recipeAuthoring.css                     (modify)
```

Allowed responsibilities:

- make the existing Ingredient creation modal reusable with explicit imported
  initial values/context, return the server-created object, preserve existing
  form validation/error behavior, and lock dismissal/double submit in flight;
- compute the strict creation eligibility and safe prefill contract;
- render the action and reused modal for an eligible unresolved line;
- bind a successful server response to the current generation + source key
  without confirming it;
- thread the existing authority-loss callback and add only necessary nested
  modal/focus/responsive presentation.

`ingredientApi.js` is deliberately not allowlisted: its current
`createIngredient` method and return contract are already sufficient.

No backend source, Ingredient/Recipe model, validation, route, controller,
service, repository, serializer, resolver implementation, M27 parser, URL1
service, shared contract, App/portal policy, package/lockfile, environment,
migration, mobile, deployment, or protected documentation file is allowlisted.
If safe implementation requires another production file, stop and amend this
audit before editing it.

## 12. Exact test allowlist

```text
apps/admin/test/recipeIngredientCreation.test.js                      (new)
apps/admin/test/recipeIngredientResolution.test.js                    (modify)
apps/admin/test/recipeAuthoringState.test.js                           (modify)
apps/admin/test/recipeIntakeIntegration.test.js                        (modify)
apps/admin/test/ingredientSubstitutionFormValidation.test.js           (modify)
```

All backend tests and other Admin tests in the commands below are regression
commands only and are not allowlisted for modification. If a backend production
or test change appears necessary, stop and re-audit instead of widening scope.

## 13. Required automated coverage

The allowlisted tests must prove:

- creation eligibility is true only for a current successful `none` result with
  zero/untruncated candidates, valid 1-to-100 trimmed parsed name, and no current
  selection; every forbidden state hides the action;
- the displayed source is context only; only parsed name is prefilled;
  category starts blank; aliases/allergens start empty; nothing is inferred or
  truncated;
- the existing Ingredient modal validation and strict payload builder are used,
  including exact name/alias bounds and controlled category/allergen fields;
- open/cancel sends no request; submit sends exactly one existing
  `POST /ingredients` body; in-flight double submit/dismissal is blocked;
- 400, stable duplicate 409, 401/403, network, and safe 5xx paths retain or close
  state exactly as frozen and never alter the Recipe row;
- a 201 uses the returned public ID/name, targets the stable source key and
  generation, leaves the line unresolved, and still requires explicit Recipe
  confirmation;
- stale generation/key returns cannot attach to another line; duplicate source
  lines remain independent;
- confirmation continues to validate canonical selection and quantity/unit,
  creates only the ordinary Recipe row, and removes only that source entry;
- actual Preview/resolution/create/return/confirm/save integration performs no
  Ingredient mutation before explicit submit and no Recipe mutation before the
  existing save action;
- source replacement, authoritative reload, Draft creation, no-PATCH saves,
  unrelated PATCHes, conflict behavior, and request-body isolation remain
  unchanged;
- Admin renders no creation/authoring path and backend regression coverage keeps
  Admin/User create requests forbidden.

Static source-string presence alone is insufficient. The integration test must
exercise the actual creation eligibility, callback, reducer return action, and
existing Recipe confirmation/save path. Mutation-test at least the `none` gate,
blank category, generation/key guard, and no-auto-confirm boundary.

## 14. Exact test commands for implementation

Focused pure Admin creation/resolution/lifecycle:

```text
node --test --test-isolation=none apps/admin/test/recipeIngredientResolution.test.js apps/admin/test/recipeAuthoringState.test.js apps/admin/test/recipeIntakeIntegration.test.js
```

Focused rendered reusable modal and ING2 integration:

```text
node --test --test-isolation=none apps/admin/test/recipeIngredientCreation.test.js
node --test --test-isolation=none apps/admin/test/ingredientSubstitutionFormValidation.test.js
```

ING1/intake/Recipe authoring regressions:

```text
node --test --test-isolation=none apps/admin/test/recipeIntake.test.js apps/admin/test/recipeUrlImport.test.js apps/admin/test/recipeAuthoringModel.test.js apps/admin/test/recipeAuthoringApiContract.test.js apps/admin/test/recipeAuthoringAcknowledgement.test.js apps/admin/test/recipeCatalogFreshness.test.js apps/admin/test/portalPolicy.test.js
```

Existing backend creation/resolver/authority regressions:

```text
node --test --test-isolation=none apps/api/test/ingredient-model.test.js apps/api/test/ingredient-validation.test.js apps/api/test/ingredient-service.test.js apps/api/test/ingredient-routes.test.js apps/api/test/ingredient-resolution.test.js apps/api/test/catalog-authority-routes.test.js apps/api/test/capabilities.test.js apps/api/test/require-capability-middleware.test.js
```

Recipe persistence/active-Ingredient regressions:

```text
node --test --test-isolation=none apps/api/test/recipe-model.test.js apps/api/test/recipe-validation.test.js apps/api/test/recipe-update-validators.test.js apps/api/test/recipe-service.test.js apps/api/test/recipe-routes.test.js apps/api/test/recipe-authoring.test.js
```

Build and final checks:

```text
npm run build --workspace=apps/admin
git diff --check
git diff --stat
git status --short --branch
```

If a Vite/esbuild-backed Admin command hits the established Windows sandbox
`spawn EPERM` or worker-teardown hang, stop the hung process and rerun the
identical read-only command outside the sandbox. Record both attempts; do not
weaken tests or treat the environment failure as a product failure.

## 15. Runtime verification requirements

Automated tests do not prove browser interaction, focus behavior, or a real
Mongo unique-index race. After implementation, use a controlled live API/database
and real Staff Portal browser sessions:

1. Prepare active catalog cases for exact, ambiguous alias, possible, and none;
   an archived Ingredient with the same normalized name as one `none` source;
   and a source whose parsed name exceeds 100 characters.
2. Sign in as Moderator, import/paste the Recipe, Preview, explicitly resolve,
   and verify `+ Create Ingredient` appears only for the eligible `none` line.
   Confirm it is absent for exact/ambiguous/possible/unparsed/error/excluded,
   overlength, stale, and already-selected lines.
3. Open creation and verify the original source is read-only context, only the
   parsed name is suggested, category is unselected, and aliases/allergens are
   empty. Verify no request occurs on open or cancel.
4. Verify modal keyboard/focus behavior: focus enters the name field, Tab stays
   within the modal, Escape/backdrop/close affects only this modal, focus returns
   to its action, and dismissal/double submit is blocked while saving.
5. Submit invalid fields and verify existing client/server field errors. Exercise
   a network failure and safe server failure, then explicitly retry without
   losing the reviewed values.
6. Trigger the archived-name and concurrent-create conflicts. Verify stable 409,
   no internal Mongo detail, no selection/Recipe mutation, and guidance to review
   active/archived Ingredients. Verify no auto-restore or auto-use.
7. Complete a valid creation and inspect one authenticated `POST /ingredients`
   with only name/aliases/category/allergenTags. Verify the 201 response supplies
   the selection and the line still remains unresolved.
8. Before confirming, verify no Draft/PATCH/Publish request occurred. Explicitly
   confirm with valid quantity/unit, then verify one ordinary Recipe row is added
   and only that source entry leaves the queue.
9. Save a new Draft, an existing Draft PATCH, and a Published Recipe PATCH; then
   Publish through the current acknowledgement path. Verify no source/create
   metadata enters any Recipe body and reload/resume uses only persisted Recipe
   rows.
10. Archive the newly selected Ingredient before Recipe save and verify the
    existing server active-Ingredient validation rejects the Recipe mutation.
11. Cancel the Recipe after a successful Ingredient creation and verify the
    canonical Ingredient remains while no Recipe was created/changed. Reopen and
    verify it is available in the normal active picker.
12. Sign in as Admin: confirm catalog screens remain read-only, no Add Recipe or
    ING2 action exists, and a direct create request is 403. Repeat direct denial
    for User and verify stale-role demotion fails closed.
13. Verify responsive layout, both supported themes, status/error announcements,
    and a clean browser console.

Do not claim runtime PASS until these measurements are complete. No ING2 runtime
verification was performed during this read-only audit.

## 16. Audit-time automated evidence

Current-main focused verification during this audit produced:

```text
API Ingredient/resolver/authority regression: 132 passed, 0 failed
Admin intake/resolution/authoring regression:    58 passed, 0 failed
Rendered Ingredient/Substitution validation:    14 passed, 0 failed
```

Expected controlled 4xx `AppError` diagnostics appeared in API output and are
asserted negative-path evidence. The rendered Vite-backed validation command's
worker hung during teardown inside the Windows sandbox and was terminated. The
identical read-only command was rerun outside the sandbox and exited normally
with 14/14 passing. This is environment evidence, not a product failure.

## 17. Blockers, stop conditions, and deferred work

There is no present implementation blocker.

Stop implementation and amend this audit if:

- safe creation requires any backend production change or any file outside the
  exact production/test allowlists;
- the existing Ingredient modal/validation cannot be reused without a second
  create lifecycle;
- a create action would need to appear for anything other than the frozen
  complete-catalog `none` case;
- the successful server result cannot be bound by current generation and stable
  source key without auto-confirming or persisting resolver state;
- implementation would preselect a category, infer metadata/aliases, truncate a
  source name, weaken validation/authority, auto-retry, auto-create, auto-restore,
  or auto-use a conflicting Ingredient;
- implementation requires Recipe schema/request changes, IngredientDraft,
  fuzzy/AI behavior, local persistence, packages, migration, or infrastructure.

Deferred and explicitly out of scope:

- creation from `possible`, `ambiguous`, `unparsed`, resolver-error/excluded, or
  overlength lines;
- inline/bulk/background Ingredient creation, IngredientDraft, approval queues,
  provisional IDs, transactional Recipe+Ingredient creation, or rollback when a
  Recipe is discarded;
- duplicate merge, auto-use/restore of archived records, catalog cleanup, global
  alias uniqueness, normalized-alias storage/indexes, or changing alias rules;
- semantic parsing of preparation notes, brand/variety, singular/plural,
  synonyms, punctuation/diacritics, fuzzy/AI matching, or metadata enrichment;
- image, category, region, dietary/allergen, substitution, nutrition, provenance,
  analytics, mobile, deployment, and multi-instance infrastructure work;
- durable unresolved-source persistence after close/reopen or authoritative
  reload. Existing local ING1 lifetime remains frozen.

## 18. Final audit verdict

**AUDIT PASS - READY FOR IMPLEMENTATION**

Implementation is authorized only within sections 11 and 12 and remains subject
to the automated and runtime gates above. This audit does not authorize staging,
commit, push, dependency changes, or application implementation now.

## 19. Runtime finding amendment - punctuated unit tokens

This amendment records the read-only runtime finding for imported source
`3/4 lb. spaghetti`. It supersedes the section 18 readiness verdict for this
finding only.

The current ING1 parser correctly parses the quantity as `0.75`, then performs
an exact, case-insensitive lookup of the next whitespace-delimited token. It
does not remove a trailing period. The resulting current response is therefore
`{ quantity: 0.75, unit: null, name: "lb. spaghetti" }`. ING2 correctly takes
the resolver's `parsed.name`, applies outer trim only, and supplies that value
to the reused Ingredient creation modal. No ING2 UI-side parser or production
change is authorized.

The punctuation defect also affects punctuated forms of abbreviations that are
already in the controlled contract: `g.`, `kg.`, `ml.`, `l.`, `tsp.`, and
`tbsp.`. A parser fix must be limited to explicit trailing-period forms of
already allowlisted unit tokens. It must not strip general ingredient-name
punctuation or infer unsupported units.

`lb` is independently unsupported. The authoritative Recipe unit set is
exactly `g`, `kg`, `ml`, `l`, `tsp`, `tbsp`, `cup`, `piece`, `clove`, `slice`,
`can`, `pack`, `bunch`, `pinch`, and `toTaste`; there is no canonical `lb`
value in the backend contract or Admin mirror. Recognizing `lb.` as `lb` would
therefore require a separate cross-application unit-contract expansion, not
only punctuation normalization in ING1. That expansion is outside this
milestone and this amendment. Do not map pounds to another unit or perform a
conversion.

### 19.1 Exact additional allowlist

For a later narrow fix of punctuated forms of units already in the controlled
contract, add only:

```text
apps/api/src/modules/ingredients/ingredient-resolution.js                (modify)
apps/api/test/ingredient-resolution.test.js                              (modify)
```

These are the ING1 parser and its direct test. They do not authorize adding
`lb` to the shared unit contract. All ING2 Admin production paths remain
unchanged for this finding. If the required outcome remains canonical `lb`,
stop and separately audit/amend the backend unit source of truth, Admin/mobile
mirrors, persistence/API compatibility, and their tests before implementation.

### 19.2 Exact automated regressions required

In `apps/api/test/ingredient-resolution.test.js`:

- prove each supported punctuated abbreviation (`g.`, `kg.`, `ml.`, `l.`,
  `tsp.`, and `tbsp.`) returns the same canonical unit and remaining name as its
  existing unpunctuated spelling;
- preserve quantity parsing, optional `of`, case-insensitive lookup, and every
  existing malformed-number boundary;
- prove unsupported punctuated tokens such as `oz.` and `lb.` are not inferred,
  converted, or silently discarded while those units remain outside the
  controlled contract; and
- retain the existing complete parser/matcher regression suite.

Existing ING2 tests must continue proving that creation eligibility and prefill
use the server-returned `parsed.name` unchanged except for outer trim. No new
client parser test or UI parsing implementation is required.

### 19.3 Runtime regression requirement and blocker

After the supported-punctuation parser fix, repeat real import/resolution for at
least `1 tsp. salt` and `1 tbsp. oil`; require the canonical `tsp`/`tbsp` unit,
the parsed name without the unit token, and the same name in any eligible ING2
creation prefill. Confirm/save must still use the ordinary controlled Recipe
unit contract and no resolver metadata may enter a Recipe request.

The reported `3/4 lb. spaghetti` case cannot satisfy the stated expected result
under the live contract. Do not mark this runtime finding passed until either
the expected result is corrected to treat pounds as unsupported, or a separate
unit-contract audit explicitly authorizes canonical `lb` end to end and runtime
verification proves `{ quantity: 0.75, unit: "lb", name: "spaghetti" }` plus
Ingredient creation prefill `spaghetti` and successful confirm/save behavior.

**RUNTIME FINDING BLOCKED**

## 20. Post-UNIT1 regression and finalization - 2026-09-29

This section supersedes the section 19 runtime blocker. RECIPE-UNIT1 expanded
the canonical Recipe unit contract to include `lb` and `oz`, added the matching
Admin/mobile mirrors, and taught the ING1 resolver to normalize the supported
punctuated unit tokens. It is merged into `main` at baseline
`30fabebb3828eb7eef13d5a0d270fd08ef2ded14` (merge of PR #72). ING2 was restored
cleanly on top of that exact commit without changing its frozen production or
test allowlists.

Post-UNIT1 runtime verification passed for the former blocker:

```text
3/4 lb. spaghetti
  -> quantity: 0.75
  -> unit: lb
  -> parsed name: spaghetti
```

The actual missing-Ingredient lifecycle also passed: an authoritative `none`
result exposed `+ Create Ingredient`; the reused modal received only the safe
name prefill; explicit submission created the canonical Ingredient; the same
generation/key row received the returned server ID/name; and the unresolved
row still required the separate `Confirm ingredient` action. The modal saving
lock prevented dismissal and duplicate submission while the request was in
flight.

### 20.1 Post-UNIT1 automated evidence

All frozen commands from section 14 passed on the UNIT1 baseline:

```text
Focused ING2 creation/resolution/lifecycle:       58 passed, 0 failed
  pure resolution/state/intake integration:      32 passed, 0 failed
  rendered reusable modal/ING2 integration:      11 passed, 0 failed
  rendered Ingredient form validation:           15 passed, 0 failed

Approved Admin authoring/intake regressions:      50 passed, 0 failed
API Ingredient/resolver/authority regressions:   134 passed, 0 failed
API Recipe persistence/active-Ingredient:        205 passed, 0 failed
```

The sandboxed rendered Admin commands entered the established Windows
Vite/esbuild worker-teardown failure pattern and were stopped. Their identical
read-only commands were rerun outside the sandbox and exited normally with the
passing results above. Expected controlled 4xx and 409 `AppError` diagnostics
in the API output were asserted negative-path evidence, not failures.

The Admin production build also passed outside the sandbox after the initial
sandboxed attempt failed with the established `spawn EPERM` restriction:

```text
vite v6.4.3
1653 modules transformed
built in 5.58s
```

Vite reported only its existing dynamic/static import and large-chunk
warnings. No package, lockfile, build configuration, or production scope change
was made in response.

### 20.2 UNIT1 compatibility and scope assessment

UNIT1 introduced no ING2 regression or scope drift. Its canonical `lb`/`oz`
contract and punctuated-token resolver normalization resolve the dependency
that parked ING2. ING2 continues to consume the server-returned parsed name and
the shared Admin Recipe unit options; it adds no client-side parser, conversion,
unit authority, backend mutation, or Recipe persistence field. The frozen
creation eligibility, safe prefill, current generation/key binding,
no-auto-confirm boundary, Moderator authority, Admin/User denial, and active
Ingredient persistence checks all remain covered by the passing focused and
regression suites.

Tracked ING2 production and test changes remain entirely within sections 11
and 12. The new ING2 test and this milestone remain the only ING2 untracked
files. The protected pre-existing untracked files were not modified. No stash
was applied, popped, dropped, or changed; the ING2 backup stash remains in
place.

### 20.3 Final readiness

`git diff --check` passes after this milestone finalization. No blocking or
non-blocking product finding remains from the post-UNIT1 verification.

**ING2 FINAL VERIFICATION PASS - READY FOR COMMIT/PUSH**
