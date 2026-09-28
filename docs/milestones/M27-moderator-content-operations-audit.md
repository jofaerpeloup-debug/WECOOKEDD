# M27 — Moderator Content Operations Audit

Status: complete — runtime verified and ready for commit/push

Audit date: 2026-09-28

Audited branch: `main`

Audited commit: `107523a633849edb8916d847612701afb57cf755`

## 1. Purpose and decision

This milestone records the live repository state for moderator-managed Recipes,
Ingredients, and Substitutions and selects the smallest automation slice that
can attach to the existing architecture.

The repository already has a Recipe model, an explicit Draft/Published
lifecycle, a resumable Staff Portal authoring wizard, a canonical Ingredient
catalog, and a directed Substitution model. A new `RecipeDraft`,
`IngredientDraft`, publishing lifecycle, catalog, or generic review queue would
duplicate existing authority and is prohibited.

The recommended next milestone is **Moderator Structured Recipe Prefill**: a
Staff Portal-only, pasted JSON-LD intake helper that fills safe fields in the
existing unsaved authoring form. It must not fetch URLs, persist an import
record, create Ingredients, assign canonical Ingredient IDs, infer controlled
fields, save a Draft automatically, or publish. The Moderator reviews the
prefill, resolves every ingredient through the existing picker, explicitly
saves through `POST /recipes/drafts` plus `PATCH /recipes/:id`, and publishes
through the existing confirmed Publish command.

## 2. Baseline verification

Commands run before the audit:

```text
git status --short --branch
git rev-parse HEAD
git branch --show-current
git merge-base HEAD main
git log -1 --oneline
git rev-parse --verify refs/remotes/origin/main
git rev-list --left-right --count HEAD...refs/remotes/origin/main
```

Verified result:

- Branch: `main`.
- HEAD: `107523a633849edb8916d847612701afb57cf755`.
- Merge base with `main`: the same commit.
- Latest commit: `107523a Merge pull request #68 from klaynn/feat/mobile-p3-advanced-discovery-filters`.
- The reported P3 merge commit is exactly the audited HEAD, not merely an
  ancestor.
- The local tracked `origin/main` ref is also that commit; the ahead/behind
  count is `0 0`. No network fetch was performed, so this comparison is to the
  available tracked remote ref.
- There were no tracked changes. Pre-existing untracked files were left
  untouched: `AGENTS.md`, `app.json`, `apps/api/audit-result.json`,
  `apps/mobile/.tmp-expo-config-error.txt`, four protected documentation files,
  and `docs/milestones/M25-email-verification.md`.
- No prior `docs/milestones/M27-moderator-content-operations-audit.md` existed.

The baseline therefore does not trigger a stop condition.

## 3. Repository areas inspected

- Root `AGENTS.md`, Git baseline, package scripts, and v1 route mounting.
- `apps/api/src/modules/recipes/`: model, validation, routes, controller,
  service, repository, serializers, and visibility helper.
- `apps/api/src/modules/ingredients/`: model, validation, routes, controller,
  service, repository, serializer, and dependency guard.
- `apps/api/src/modules/substitutions/`: model, validation, routes, controller,
  service, repository, and serializer.
- `apps/api/src/shared/security/capabilities.js`, authentication/capability and
  catalog-read middleware, and recipe-image upload routing.
- `apps/admin/src/App.jsx`, `portalPolicy.js`, the three catalog tabs, feature
  API clients, shared Ingredient picker, and all recipe-authoring modules.
- `packages/contracts/index.js` for the canonical Ingredient taxonomy.
- Focused API and Admin tests covering lifecycle, validation, RBAC, forms,
  conflict handling, and catalog freshness.
- Relevant architecture and current milestone documents. Older role wording in
  some historical architecture text was not treated as authority where live
  capability code differs.
- Targeted application searches for authoring import/parser, canonical
  resolution, duplicate assistance, and exception/review-queue code.

## 4. Current verified state — roles and authority

`apps/api/src/shared/security/capabilities.js:13-28` is the role/capability
authority:

- User: consumer only.
- Moderator: consumer, `catalog.read_all`, `catalog.write`, and
  `recipe_image.upload`.
- Admin: consumer, `catalog.read_all`, user/staff management, and monitoring;
  Admin deliberately does not have `catalog.write` or recipe-image upload.

Every catalog mutation route authenticates and requires `catalog.write`.
`authenticate` supplies the current database-backed role before
`requireCapability` checks it. The Staff Portal mirrors this policy in
`portalPolicy.js:18-38`: Moderator can write and upload; Admin sees the same
catalog screens read-only. The Moderator navigation contains only Overview,
Recipes, Ingredients, and Substitutions (`App.jsx:1276-1365`).

Consequences:

- Moderator, not Admin, owns Recipe/Ingredient/Substitution content mutation.
- Admin can inspect active, archived, Draft, and Published catalog data but
  cannot directly change it.
- There is no per-record author ownership gate. Any current Moderator with
  `catalog.write` may edit or transition any catalog record.
- No future automation may broaden Moderator into user/staff administration or
  grant Admin catalog writes indirectly.

## 5. Verified Recipe workflow

### 5.1 Model and states

`apps/api/src/modules/recipes/recipe.model.js` defines the sole `Recipe` model.
Ingredient usages are embedded subdocuments containing a canonical
`ingredientId` ObjectId reference plus quantity, unit, note, and optional flag
(`recipe.model.js:31-70`). Recipe content and lifecycle fields are stored on the
same document.

The two independent state axes are:

- `publicationStatus`: `draft | published`. A physically missing value is an
  explicit legacy compatibility case treated as Published by
  `effectivePublicationStatus` (`recipe.service.js:81-86`). New writes always
  set a state.
- `isActive`: active/archived availability. Archive/restore does not change
  publication state.

Attribution fields are server-owned `createdBy`, `updatedBy`, `publishedBy`,
and `publishedAt`. `expectedUpdatedAt` supplies optimistic mutation conflict
protection; it is not persisted as recipe content.

### 5.2 Lifecycle and permissions

The API mounts under `/api/v1/recipes` and exposes:

| Operation | Route | Verified behavior |
|---|---|---|
| List/detail | `GET /`, `GET /:recipeId` | Authenticated; non-active list states require `catalog.read_all`; staff receive lifecycle metadata. |
| Create Draft | `POST /drafts` | Moderator only; creates active Draft; title is required and supplied optional content is structurally validated. |
| Legacy complete create | `POST /` | Moderator only; creates Published content directly after full validation and confirmation. It remains an API compatibility route; the active Staff Portal does not call it. |
| Edit content | `PATCH /:recipeId` | Moderator only; strict content allowlist; optional optimistic timestamp. |
| Publish | `POST /:recipeId/publish` | Moderator only; active Draft only; explicit `confirmFilipinoCuisine: true`; complete validation; atomic state/actor/time update. |
| Archive | `POST /:recipeId/archive` | Moderator only; sets `isActive: false`; preserves Draft/Published state. |
| Restore | `POST /:recipeId/restore` | Moderator only; restores availability; a Published recipe is revalidated, while a Draft may remain incomplete. |
| Compatibility archive | `DELETE /:recipeId` | Moderator only; soft archive, never physical deletion. |

Publication is not reversible: there is no Published-to-Draft/unpublish
transition. Availability is reversible through archive/restore. Physical delete
does not exist.

### 5.3 Draft and Publish validation

The request schemas are strict (`recipe.validation.js:394-481`). Draft creation
requires only a normalized title; description, classifications, difficulty,
times, servings, Ingredients, instructions, tags, and image metadata may be
absent. Any supplied field must already satisfy its structural contract.

Publish requires the stored active Draft to satisfy the authoritative complete
Recipe contract (`recipe.service.js:595-611`):

- title with 2–150 characters and at least two Unicode letters;
- nonblank description, difficulty, cook time of 3–1440 whole minutes,
  servings of 1–100;
- optional prep time, when supplied, of 1–1440 whole minutes;
- 1–50 structurally valid ingredient usages, all resolving to active canonical
  Ingredients;
- 1–50 trimmed instructions, each 3–1000 characters with text;
- controlled units/dietary tags and valid optional slugs/image consistency;
- explicit, request-only Filipino-cuisine confirmation.

`instructions: string[]` is the stored authority. The API may also accept
ordered `steps`, validates a contiguous sequence, and normalizes it to
`instructions`. Draft edits may remain incomplete. Published edits are checked
against the legacy-compatible complete contract so a Published Recipe cannot be
made incomplete. Ingredient list replacement is whole-array, resolves every ID
through `IngredientService`, and rejects missing/inactive references.

Recipe ingredient entries are intentionally not deduplicated because the same
canonical Ingredient may have multiple uses in one Recipe. There is no Recipe
title uniqueness constraint, probable-duplicate check, or similarity service.

### 5.4 Staff Portal experience

`RecipesTab` provides debounced title/description search, region/category,
difficulty, dietary tag, canonical Ingredient, max-prep, active/archive status,
sort, pagination, and archive/restore controls. The displayed state combines
publication and availability.

The Add action opens the existing five-step `RecipeAuthoringWizard`:

```text
Basics -> Ingredients -> Instructions -> Details -> Review
```

The first Save creates a title-only Draft, then subsequent section saves use
strict PATCH requests. Existing Draft rows display **Resume**, load the latest
detail, and continue at the first incomplete step. Existing Published Recipes
open the same wizard; saved edits are immediately consumer-visible. The wizard
has unsaved-change confirmation, a single-flight mutation fence, authoritative
reload on conflicts, and explicit recovery for ambiguous create/publish network
outcomes.

Verified trace:

```text
ModeratorWorkspace -> RecipesTab -> RecipeAuthoringWizard/useRecipeAuthoring
  -> recipeApi (GET, POST /drafts, PATCH, POST /publish|archive|restore)
  -> /api/v1/recipes routes
  -> authenticate -> validate -> requireCapability(catalog.write), where applicable
  -> recipe.controller -> recipe.service -> recipe.repository -> Recipe -> MongoDB
```

There is no authoring import/paste/URL parser. The repository's separate
shopping-list “recipe import” copies ingredients from an already published,
usable Recipe into a user's Shopping List (`shopping-list.service.js:197-217`);
it is not Recipe intake and is not reusable as an authoring parser.

## 6. Verified Ingredient workflow

### 6.1 Canonical model and taxonomy

`apps/api/src/modules/ingredients/ingredient.model.js` defines the sole
`Ingredient` catalog. Required fields are `name`, internal `normalizedName`, and
`category`; optional arrays are aliases and allergen tags. `isActive` supplies
soft archive state.

Canonical identity is enforced by a unique index on `normalizedName`, computed
from the canonical display name by trim + lowercase + whitespace collapse
(`ingredient.service.js:15-17,70-86`). This prevents names differing only by
case/spacing. Aliases are supported, normalized for whitespace, and deduplicated
case-insensitively within one Ingredient, but:

- aliases are not unique across Ingredients;
- an alias is not checked against another Ingredient's canonical name;
- `normalizedName` is internal and is not serialized;
- no exact/possible/ambiguous resolution API exists.

The controlled taxonomy comes from `@wecooked/contracts` and currently contains
18 values (`packages/contracts/index.js:6-46`). Legacy `other` values can still
hydrate but cannot be selected on new writes; the Staff Portal requires an
approved replacement when editing such a record. Allergen tags are controlled
and are explicitly set, never inferred.

### 6.2 API, UI, archive, and dependency protection

Routes under `/api/v1/ingredients` provide authenticated list/detail and
Moderator-only create, strict partial edit, and soft archive. Restore is
`PATCH { isActive: true }`. There is no physical delete.

List search performs an escaped, case-insensitive substring match across
canonical `name` and `aliases` (`ingredient.service.js:107-135`). The Staff
Portal exposes that search plus category/status/sort filters, pagination, a
create/edit modal, comma-separated aliases, controlled taxonomy/allergens, and
archive/restore. The Recipe and Substitution pickers reuse this catalog search
and persist public canonical IDs, not typed Mongo IDs.

Both deactivation paths—DELETE and `PATCH { isActive: false }`—go through the
same service guard. An active Ingredient cannot be archived when referenced by
an active Published/legacy-Published Recipe or by an active Substitution on
either side (`ingredient-dependency.guard.js:13-21`). Draft-only references,
archived content, and Shopping List items do not block archive. The final
active-state write is conditional and retried in a bounded way to avoid a
generic PATCH bypass. Nothing cascades or physically deletes dependents.

Verified trace:

```text
ModeratorWorkspace -> IngredientsTab -> ingredientApi
  -> /api/v1/ingredients routes
  -> authenticate -> validate -> requireCapability(catalog.write), where applicable
  -> ingredient.controller -> ingredient.service
  -> ingredient.repository -> Ingredient -> MongoDB
  -> on active-to-inactive: ingredient-dependency.guard
       -> Recipe/Substitution repository existence checks
```

### 6.3 Unknown imported ingredient answer

Existing architecture can safely handle unknown imported text only through
Moderator resolution against the existing Ingredient catalog:

```text
Imported ingredient text
  -> existing authenticated Ingredient search over name + aliases
  -> Moderator selects one active canonical Ingredient ID
  -> existing Recipe ingredient picker/validation persists that reference
```

If search finds no trustworthy match, the Moderator must leave the Recipe row
unresolved and use the existing Ingredients screen to create the canonical
Ingredient with an explicit name, category, aliases, and allergens, then return
to the Recipe Draft and select it. Automatic canonical creation is unsafe and
unsupported. Current search can provide candidates but cannot authoritatively
classify exact, ambiguous, or unknown matches; that is useful later, not a
reason to create `IngredientDraft`.

## 7. Verified Substitution workflow

`apps/api/src/modules/substitutions/substitution.model.js` defines the sole
`Substitution` model. Each document represents one directed ordered pair:
`sourceIngredientId -> substituteIngredientId`. Both are required canonical
Ingredient ObjectId references. The cardinality is many-to-many across
Ingredients, with one document per ordered pair.

Required content is the two Ingredient references and a ratio subdocument with
finite positive `sourceAmount` and `substituteAmount`. The ratio means parts of
replacement per parts of source; no unit or quantity conversion is supported.
Contexts (up to 10, 40 characters each) and notes (up to 500 characters) are
optional. Contexts are free text and normalized/deduplicated
case-insensitively within the relationship.

Validation and safeguards:

- Source and replacement must differ; checked in request validation and again
  after merging an update with stored state.
- Both references must exist and be active on create; a changed side is
  rechecked on update; both sides are rechecked on restore.
- A unique compound Mongo index prevents duplicate ordered pairs and maps the
  race-safe duplicate to `409 SUBSTITUTION_ALREADY_EXISTS`.
- The reverse pair is deliberately distinct and allowed.
- No transitive circularity check, compatibility inference, reciprocal-pair
  creation, unit conversion, or bulk edit exists.
- DELETE is soft archive. Restore is `PATCH { isActive: true }`. There is no
  physical delete and no dependent content model below Substitution.

The Staff Portal supports source and replacement canonical pickers, exact
context filter, status/sort/pagination, create/edit, ratio/context/notes entry,
and archive/restore. It inlines enough list data to edit without a separate
detail call.

Verified trace:

```text
ModeratorWorkspace -> SubstitutionsTab -> substitutionApi + ingredientApi pickers
  -> /api/v1/substitutions and /api/v1/ingredients
  -> authenticate -> validate -> requireCapability(catalog.write), where applicable
  -> substitution.controller -> substitution.service
  -> substitution.repository -> Substitution -> MongoDB
  -> IngredientService validates referenced canonical records
```

The observable repetitive work is two separate Ingredient searches plus manual
ratio, context, and note entry for every directed relationship. Creating the
reverse direction, when domain-correct, requires a separate complete record.
The list can filter either direction but offers no combined free-text search,
reciprocal helper, bulk edit, or compatibility suggestion. Repository evidence
does not establish that reciprocal creation is always valid, so it must not be
automated by assumption.

## 8. Current pain points and reusable architecture

### Demonstrated workflow friction

- Recipe authoring requires manual entry of every field and instruction; there
  is no paste/import attachment despite a mature Draft wizard.
- Recipe Ingredient rows require one-at-a-time catalog searches. When a source
  name is unknown, the Moderator must leave the wizard, create the canonical
  Ingredient, return to the Draft, search again, and select it.
- Recipe duplicate assistance is absent. Search is available, but the authoring
  flow does not warn about a same/similar title.
- Ingredient exact canonical-name duplication is rejected only on write. Search
  covers aliases, but alias/canonical collisions and ambiguity are not modeled.
- Substitution entry repeats both canonical searches and all relationship
  metadata per directed pair. Existing duplicate rejection happens on submit.
- Validation feedback is generally explicit and field-scoped; no evidence
  justifies replacing it with a separate validation system.

### Architecture future automation must reuse

- `Recipe` plus `publicationStatus`/`isActive`; `POST /recipes/drafts`, strict
  content PATCH, explicit Publish, archive/restore, attribution, and optimistic
  conflicts.
- The existing Staff Portal authoring form/state/readiness/review components.
- Canonical `Ingredient` IDs, normalized unique names, aliases, taxonomy,
  authenticated search, Moderator create/edit, and dependency guard.
- Directed `Substitution` pairs, unique ordered-pair index, active-reference
  validation, and archive/restore.
- Capability-based role authority and feature API client layers.
- Server-side validation as authority; client checks remain UX assistance only.

## 9. Automation opportunity decision matrix

| Capability | Current state | Existing attachment point | Moderator friction | Backend change needed | UI change needed | Candidate next milestone |
|---|---|---|---|---|---|---|
| Recipe intake/import | `MISSING` for authoring. Shopping-list import is unrelated. | Existing unsaved authoring form, then current Draft/PATCH lifecycle. | All recipe fields/instructions are entered manually. | No for narrow pasted JSON-LD prefill; yes for later server URL fetching. | Add local paste/preview/apply interaction to existing wizard. | **Moderator Structured Recipe Prefill** |
| Ingredient resolution | `PARTIAL`: name/alias substring search and canonical picker exist; exact/possible/ambiguous classification does not. | `GET /ingredients?search=...` and existing `IngredientPicker`. | Each source line needs manual lookup; unknowns require leaving the Recipe workflow. | None for manual resolution; a trustworthy batch resolver would need a new service/API contract later. | Show imported ingredient strings as unresolved guidance; keep canonical picker authoritative. | Useful later after intake evidence |
| Substitution assistance | `PARTIAL`: filtering, pickers, validation, duplicate rejection, and CRUD exist. | Existing Substitutions tab/API/service/index. | Repeated pair searches and manual ratio/context/notes; reverse relationship is separate. | Not for presentation-only helpers; yes for any new atomic/bulk contract. | Potential reciprocal/duplicate preview only after product evidence. | Not next |
| Recipe duplicate detection | `MISSING`; titles deliberately have no unique constraint. | Existing Recipe list search could support a non-authoritative warning. | Moderator must search separately; no authoring warning. | No for simple advisory title search; yes for authoritative similarity semantics. | Optional advisory later. | Useful later; not required for prefill |
| Ingredient duplicate detection | `PARTIAL`: canonical name normalization + unique index; alias ambiguity is not prevented. | `normalizedName`, create/update conflict, name/alias search. | Collision may be found only on submit; alias matches can be ambiguous. | Yes for authoritative resolution/ambiguity results. | Candidate display/resolution UI later. | Useful later |
| Substitution duplicate detection | `EXISTS` for exact directed pair through unique index and stable 409. Reverse pairs remain distinct by design. | Existing model index/service error. | Duplicate is learned on submit, but integrity is protected. | No for integrity; optional read/check endpoint only if justified. | Optional pre-submit notice later. | Already exists; no milestone |
| Validation assistance | `EXISTS` for strict API validation, form guards, Publish readiness, conflict handling, and field errors. | Existing Zod/service/model plus authoring model/review. | Manual correction remains, but no second validator is needed. | No for prefill; parsed fields must still pass existing contracts. | Reuse current errors/readiness. | Included only as reuse |
| Review/exception workflow | `NOT CURRENTLY JUSTIFIED`. | Existing Draft and Review step already retain incomplete work. | Likely intake exceptions are local unresolved fields, not independent durable jobs. | A queue would add a new model/API without evidence. | Inline unresolved summary is enough for the next slice. | Do not build |

## 10. Missing-capability classification

### Required for the next milestone

- A small, deterministic parser for pasted Recipe JSON-LD.
- A local preview/apply surface inside the existing new-Recipe wizard.
- Explicit field mapping and rejection/warning results.
- An unresolved-ingredient summary that never assigns or creates canonical
  Ingredients.
- Tests proving there is no network fetch, persistence, automatic save, or
  automatic publication.

### Useful later

- An authoritative canonical Ingredient resolution contract returning exact,
  possible/ambiguous, and unresolved results across the complete active catalog.
- Advisory Recipe title duplicate search with product-approved matching rules.
- Evidence-driven Substitution reciprocal/duplicate assistance.
- URL intake only after an explicit outbound-request/SSRF, content-size,
  redirect, timeout, and provenance design.
- Plain-text parsing only after a clear deterministic grammar and error model.

### Already exists

- Recipe Draft/Published lifecycle, resumption, Publish validation, review,
  archive/restore, attribution, and optimistic conflicts.
- Canonical Ingredient catalog, aliases, taxonomy, search, duplicate-name
  integrity, Moderator workflows, and dependency protection.
- Directed Substitution model, ratio/context/notes, exact pair uniqueness,
  active-reference checks, filters, and archive/restore.
- Role separation and Staff Portal/API paths for all three domains.

### Not justified

- `RecipeDraft` or `IngredientDraft` models.
- A second authoring UI, catalog, publication lifecycle, or Substitution model.
- Automatic Ingredient creation, automatic publication, or inferred taxonomy,
  allergens, dietary tags, region/category, difficulty, ratio, or cuisine
  confirmation.
- A persistent generic review/exception queue.
- AI/LLM extraction, nutrition enrichment, bulk Substitution automation, or a
  schema/migration/package change.

## 11. Candidate next milestone — Moderator Structured Recipe Prefill

### Goal

Let a Moderator paste one JSON-LD Recipe object into the existing new-Recipe
wizard, preview deterministic mappings/warnings, and apply safe values to the
current unsaved form. Saving and publishing remain explicit existing actions.

### Frozen behavior

- Input is pasted text only, capped at 256 KiB measured as JavaScript string
  UTF-8 bytes before `JSON.parse`. No URL field, browser fetch, backend fetch,
  redirects, external image download, or new package.
- Accept one JSON object or a JSON array/`@graph` containing exactly one
  unambiguous object whose `@type` includes `Recipe`; reject none/multiple.
- Map only:
  - `name` -> title;
  - `description` -> description;
  - valid ISO-8601 `prepTime`/`cookTime` -> existing minute fields;
  - an unambiguous positive whole-number `recipeYield` within the existing
    limit -> servings;
  - string or `HowToStep.text` instructions -> existing ordered instructions.
- Extract `recipeIngredient` strings only for an unresolved summary. Never
  parse them into quantity/unit/canonical IDs and never place them in the saved
  `ingredients` array.
- Do not map external image URLs, `recipeCuisine`, `recipeCategory`, keywords,
  dietary/suitability values, ratings, nutrition, author, dates, or unknown
  fields. Do not infer region, category, difficulty, tags, allergens, or the
  Filipino-cuisine confirmation.
- Applying a preview changes only local form state. It must not call any API,
  upload, create a Draft, or publish.
- Existing form validation, Ingredient picker, Review step, Save Draft,
  optimistic PATCH, and explicit Publish remain authoritative and unchanged.
- Applying uses a blank-only rule: title/description/servings/prep time are
  filled only when their current normalized form values are blank; cooking time
  is filled only when both current hour/minute fields are blank; instructions
  are filled only when every current instruction row is blank. Existing
  nonblank values are kept and reported as skipped. There is no replace-all
  action in this slice.
- Parser output must distinguish mapped, unsupported, invalid, and unresolved
  fields. No durable queue is created.

This slice is useful without backend work because it removes repeated entry for
safe structured fields while leaving the riskiest problem—canonical Ingredient
identity—under existing Moderator control. Usage evidence from unresolved
ingredient strings can then justify or reject a later resolver milestone.

## 12. Exact implementation allowlist for the next milestone

Production:

```text
apps/admin/src/recipeAuthoring/recipeIntake.js                         (new)
apps/admin/src/recipeAuthoring/RecipeAuthoringSteps.jsx                (modify)
apps/admin/src/recipeAuthoring/recipeAuthoring.css                     (modify)
```

Tests:

```text
apps/admin/test/recipeIntake.test.js                                   (new)
apps/admin/test/recipeIntakeIntegration.test.js                        (new)
```

No API, model, schema, repository, route, shared contract, package, lockfile,
environment, migration, mobile, or existing test file is allowlisted. Existing
tests listed below are regression commands only. If the implementation cannot
meet the frozen behavior inside this allowlist, stop and amend/re-audit this
milestone before coding.

## 13. Verification evidence and future commands

Audit-time focused tests run against the audited commit:

```text
node --test --test-isolation=none apps/api/test/recipe-model.test.js apps/api/test/recipe-validation.test.js apps/api/test/recipe-update-validators.test.js apps/api/test/recipe-service.test.js apps/api/test/recipe-routes.test.js apps/api/test/recipe-authoring.test.js apps/api/test/ingredient-model.test.js apps/api/test/ingredient-validation.test.js apps/api/test/ingredient-service.test.js apps/api/test/ingredient-routes.test.js apps/api/test/substitution-model.test.js apps/api/test/substitution-validation.test.js apps/api/test/substitution-service.test.js apps/api/test/substitution-routes.test.js apps/api/test/catalog-authority-routes.test.js
```

Result: 375 passed, 0 failed.

```text
node --test --test-isolation=none apps/admin/test/portalPolicy.test.js apps/admin/test/recipeAuthoringModel.test.js apps/admin/test/recipeAuthoringState.test.js apps/admin/test/recipeAuthoringApiContract.test.js apps/admin/test/recipeAuthoringAcknowledgement.test.js apps/admin/test/recipeCatalogFreshness.test.js
```

Result: 33 passed, 0 failed.

```text
node --test --test-isolation=none apps/admin/test/ingredientSubstitutionFormValidation.test.js
```

Result: 14 passed, 0 failed. The sandboxed Vite/esbuild-backed invocation did
not complete and was terminated; the identical focused command passed outside
the sandbox. This is environment evidence, not a product failure.

Required commands for the next implementation milestone:

```text
node --test --test-isolation=none apps/admin/test/recipeIntake.test.js apps/admin/test/recipeIntakeIntegration.test.js
node --test --test-isolation=none apps/admin/test/recipeAuthoringModel.test.js apps/admin/test/recipeAuthoringState.test.js apps/admin/test/recipeAuthoringApiContract.test.js apps/admin/test/recipeAuthoringAcknowledgement.test.js apps/admin/test/recipeCatalogFreshness.test.js
node --test --test-isolation=none apps/admin/test/portalPolicy.test.js apps/admin/test/ingredientSubstitutionFormValidation.test.js
npm run build --workspace=apps/admin
node --test --test-isolation=none apps/api/test/recipe-authoring.test.js apps/api/test/recipe-routes.test.js apps/api/test/catalog-authority-routes.test.js
git diff --check
git diff --stat
git status --short --branch
```

The new tests must cover malformed JSON; none/multiple Recipe candidates;
string/array `@type`; direct and `@graph` forms; safe field mappings and bounds;
instruction variants/order; unsupported fields; unresolved ingredient strings;
no canonical IDs; no external image mapping; no network/API call on parse/apply;
conflict handling for existing form values; and explicit preservation of the
current Save Draft and Publish paths.

## 14. Runtime verification plan for the future implementation

Automated tests do not prove browser interaction. After implementation, use a
real Staff Portal session for a Moderator and verify:

1. Open Recipes -> Add recipe; paste valid JSON-LD; inspect mapped, skipped,
   invalid, and unresolved output before applying.
2. Confirm applying changes local fields only and creates no Recipe/API request.
3. Confirm existing nonblank values follow the frozen conflict rule and are not
   silently overwritten.
4. Confirm ingredient strings remain unresolved guidance and every persisted
   Recipe ingredient still comes from the canonical picker.
5. Save the prefilled form and verify the existing Draft appears/resumes after
   reload; inspect request bodies for `POST /recipes/drafts` and subsequent
   strict PATCH only.
6. Verify malformed/multiple/oversized or unsupported content fails safely with
   useful inline feedback and no partial API mutation.
7. Verify Publish remains unavailable until current completeness checks and the
   explicit Filipino-cuisine acknowledgement succeed.
8. Verify Admin sees the same catalog read-only and has no prefill-driven write
   path; User/mobile behavior is unchanged.
9. Check browser console, focus/keyboard behavior, responsive layout, and both
   supported themes. Do not claim these until measured.

Live provider delivery, external URL fetching, device behavior, and production
deployment are outside this candidate and must not be claimed.

## 15. Runtime-finding audit and allowlist amendment

This section records the audit that superseded the earlier
implementation-readiness verdict for the then-current uncommitted prefill
implementation. At the time of this audit, the runtime correction had not yet
been implemented. Application code and tests remained read-only during that
audit; Section 16 records the completed correction and final verification.

### 15.1 Verified checkout and focused evidence

The audit ran on branch `main` at
`107523a633849edb8916d847612701afb57cf755`. The working tree already contained
the uncommitted prefill implementation and unrelated untracked work; none was
cleaned, staged, or otherwise changed by this audit.

The focused current tests passed (46 passed, 0 failed):

```text
node --test --test-isolation=none apps/admin/test/recipeIntake.test.js apps/admin/test/recipeIntakeIntegration.test.js apps/admin/test/recipeAuthoringState.test.js apps/admin/test/recipeAuthoringModel.test.js apps/admin/test/recipeAuthoringApiContract.test.js apps/admin/test/recipeAuthoringAcknowledgement.test.js apps/admin/test/recipeCatalogFreshness.test.js
```

That green result does not close the finding. The current integration test
dispatches `LOAD_SUCCESS` and then manually reapplies the preview; it does not
exercise the production create/save/no-PATCH lifecycle.

### 15.2 Corrected runtime root cause

The initial Draft creation hypothesis is disproved by the production code:

1. `createDraftBody` sends only the normalized title.
2. `DRAFT_CREATED` replaces `saved` with the created server form but deliberately
   does not replace `state.form`, so intake values for later steps remain in the
   working form.
3. The initial save then reaches the common final `SAVE_SUCCESS` with the created
   recipe, the current step, and `preserveWorking: true`. The reducer copies the
   authoritative Basics section into a clone of the working form and preserves
   Details and Instructions values.

The destructive path is the later no-PATCH branch in `saveCurrent`. When the
current section normalizes to the same value as `state.saved`, it dispatches
`SAVE_SUCCESS` with only a notice. In the reducer, the absent recipe makes
`serverForm` equal `state.saved`, and the absent `preserveWorking` makes
`form = serverForm`. This replaces the complete working form with the last
server snapshot and erases unsaved values belonging to other steps.

The reproduced normal path is:

```text
Apply intake
  -> create title-only Draft
  -> DRAFT_CREATED preserves the working form
  -> initial SAVE_SUCCESS preserves the working form and accepts server Basics
  -> open Ingredients with only its ignored blank placeholder row
  -> buildStepPatch returns {}
  -> no-PATCH SAVE_SUCCESS replaces form with saved
  -> unsaved prep time, cooking time, servings, and instructions disappear
```

Both `Save Draft` and `Next` call `saveCurrent`, so both reach the defect. It is
not intake-specific: any unsaved edits in sections other than the current
no-PATCH section can be lost.

### 15.3 Narrow architectural correction

The no-PATCH branch in `useRecipeAuthoring.js` must dispatch `SAVE_SUCCESS` with
`preserveWorking: true`. It should not provide a recipe or current `step`: no
request occurred and there is no new authoritative server section to copy.
`state.saved` and the optimistic-concurrency token therefore remain unchanged,
while the complete current `state.form` remains intact. Navigation may then
advance exactly as it does today.

Do not change the reducer's default `SAVE_SUCCESS` semantics globally. Other
callers intentionally use authoritative replacement, including load/publish
flows. A new reducer action is also unnecessary; the existing explicit
`preserveWorking` contract already expresses the required behavior.

This correction preserves existing behavior as follows:

- New Drafts retain the already-correct `DRAFT_CREATED` plus final
  `preserveWorking` flow.
- Resumed Drafts and Published Recipe edits retain working state only when the
  selected section produces no PATCH.
- Real PATCH saves remain authoritative: the returned recipe replaces `saved`,
  updates `updatedAt`, and replaces only the saved section in the working form.
- Dirty-state tracking still compares normalized `saved` and `form`; future-step
  edits remain dirty, while the unchanged current section remains clean.
- Section validation/completion continues to read the preserved working form.
- Optimistic concurrency is unchanged because a no-PATCH save sends no request
  and does not change `updatedAt`.
- `LOAD_SUCCESS`, including confirmed conflict reload, still replaces both
  `saved` and `form` with server truth and clears retained upload state.

No backend, API, schema, model, package, or authoring-state redesign is needed.

### 15.4 Remove the intake reapply workaround

Remove the pending-preview retention/reapply mechanism from
`RecipeAuthoringSteps.jsx`. The authoring lifecycle must preserve the working
form; intake must not maintain a second recovery source.

The workaround does not repair the verified later no-PATCH loss because its
pending preview is normally consumed immediately after initial creation, before
the Moderator reaches the later section. It also retains the entire parsed
preview outside the form and conditionally applies it after an asynchronous
state transition. That permits stale values to return when a previously skipped
field is later cleared, when an imported value is manually cleared, when the
pasted source changes without a new Apply, or when a create-follow-up conflict
is resolved by an authoritative reload. Manual Moderator edits, deliberate
clears, changed source, and conflict reload must remain authoritative.

Remove only the reapply-specific refs, effect, callback, helper, and
`applyRecipeIntake` import. Keep the local Preview/Apply UI and its single
blank-only application through `createRecipeIntakeHandlers`.

### 15.5 Exact amended allowlists

The cumulative M27 production allowlist becomes:

```text
apps/admin/src/recipeAuthoring/recipeIntake.js                         (new; unchanged by runtime correction)
apps/admin/src/recipeAuthoring/RecipeAuthoringSteps.jsx                (modify; remove reapply workaround)
apps/admin/src/recipeAuthoring/recipeAuthoring.css                     (modify; unchanged by runtime correction)
apps/admin/src/recipeAuthoring/useRecipeAuthoring.js                   (modify; preserve working form on no-PATCH save)
```

The exact production delta allowlist for the runtime correction is therefore:

```text
apps/admin/src/recipeAuthoring/useRecipeAuthoring.js
apps/admin/src/recipeAuthoring/RecipeAuthoringSteps.jsx
```

`recipeAuthoringState.js`, `recipeAuthoringModel.js`, the wizard, API client,
backend, and contracts are not allowlisted for modification.

The cumulative M27 test allowlist becomes:

```text
apps/admin/test/recipeIntake.test.js                                   (new; existing parser coverage)
apps/admin/test/recipeIntakeIntegration.test.js                        (new; replace the false LOAD_SUCCESS/reapply lifecycle test)
apps/admin/test/recipeAuthoringState.test.js                           (modify; explicit preservation and authoritative-reload invariants)
```

The exact test delta allowlist for the runtime correction is:

```text
apps/admin/test/recipeIntakeIntegration.test.js
apps/admin/test/recipeAuthoringState.test.js
```

No package or test dependency may be added merely to create the lifecycle
coverage. If the production `saveCurrent` path cannot be exercised truthfully
inside this allowlist, stop and re-amend the milestone instead of restoring a
simulation that bypasses the branch under test.

### 15.6 Corrected lifecycle invariant and required regression contract

The invariant is:

> A save may replace only state for which it received new authoritative server
> data. Draft creation preserves the full working form; a real PATCH accepts the
> returned server state for the saved section; a no-PATCH save preserves the
> full working form; an explicit authoritative reload replaces the full form.

The implementation gate must execute the production path for:

```text
Apply intake
  -> explicit create Draft
  -> DRAFT_CREATED
  -> initial SAVE_SUCCESS
  -> working state still contains prep time, cooking time, servings, instructions
  -> unchanged Ingredients Save Draft and unchanged Ingredients Next
  -> no PATCH
  -> all four future-step values are still present
```

The regression suite must additionally prove:

- imported title and description remain correct through initial creation;
- Preview and Apply issue no API call and do not save or publish;
- pre-existing Moderator values skipped by blank-only Apply remain authoritative;
- Moderator edits made after Apply remain authoritative;
- deliberate clears are not resurrected from retained intake data;
- changing the pasted source cannot restore values from the prior source;
- confirmed conflict reload discards local/imported state and adopts server truth;
- resumed Draft no-PATCH behavior remains unchanged except for preserving other
  legitimate working edits;
- Published Recipe no-PATCH editing remains unchanged except for preserving
  other legitimate working edits;
- real PATCH saves still adopt server truth for the saved section, refresh the
  token, and preserve unrelated working sections;
- section completion and dirty-state results remain correct;
- blank Ingredient rows remain non-persisting, unresolved source strings never
  become Recipe ingredients, and canonical Ingredient IDs still come only from
  the existing picker.

The old test named `pending intake survives the first Draft-created authoritative
reconstruction` must be removed or replaced. `LOAD_SUCCESS` is an authoritative
full replacement and must not be followed by intake reapplication.

### 15.7 Files inspected for this amendment

```text
AGENTS.md
docs/milestones/M27-moderator-content-operations-audit.md
apps/admin/src/recipeAuthoring/useRecipeAuthoring.js
apps/admin/src/recipeAuthoring/recipeAuthoringState.js
apps/admin/src/recipeAuthoring/recipeAuthoringModel.js
apps/admin/src/recipeAuthoring/RecipeAuthoringWizard.jsx
apps/admin/src/recipeAuthoring/RecipeAuthoringSteps.jsx
apps/admin/src/recipeAuthoring/RecipeReview.jsx
apps/admin/src/recipeAuthoring/recipeIntake.js
apps/admin/src/recipeCatalogMutations.js
apps/admin/src/recipeApi.js
apps/admin/test/recipeIntake.test.js
apps/admin/test/recipeIntakeIntegration.test.js
apps/admin/test/recipeAuthoringState.test.js
apps/admin/test/recipeAuthoringModel.test.js
apps/admin/test/recipeAuthoringApiContract.test.js
apps/admin/test/recipeAuthoringAcknowledgement.test.js
apps/admin/test/recipeCatalogFreshness.test.js
```

### 15.8 Work required by the amendment

At this amendment checkpoint, the remaining work was procedural: application
code and tests had intentionally remained read-only. The two-file production
correction and two-file test amendment above still required implementation,
independent review, and runtime verification. Section 16 records completion of
those gates. No backend/API/schema change, state-architecture redesign, or
weakening of conflict/reload semantics was required.

Canonical batch Ingredient resolution, Recipe duplicate semantics, URL and
plain-text intake, Substitution assistance, and any durable exception workflow
remain deferred and require separate evidence and scope.

## 16. Final implementation, review, and runtime closure

The original Moderator Structured Recipe Prefill implementation is complete.
Four findings from the initial independent review were fixed. Subsequent
physical runtime verification discovered a state-loss defect in the authoring
lifecycle. The corrected root cause was the no-PATCH `SAVE_SUCCESS` path, not
initial Draft creation.

The cumulative implementation allowlist was amended to include
`apps/admin/src/recipeAuthoring/useRecipeAuthoring.js`. The unsafe
retained-preview workaround was removed from `RecipeAuthoringSteps.jsx`, and the
no-PATCH path now preserves the complete working form without claiming new
authoritative server state. The misleading no-PATCH notice was corrected. A
behavioral source-replacement regression now exercises the production
create/save/no-PATCH lifecycle instead of simulating it through an
authoritative `LOAD_SUCCESS` replacement.

The final targeted independent review returned **PASS with no findings**. The
final physical/browser runtime verification also passed. Verified runtime
evidence:

1. Valid JSON-LD Preview/Apply — **PASS**.
2. Preview/Apply caused zero API mutation — **PASS**.
3. Initial Draft creation — **PASS**.
4. Unchanged Ingredients Save/Next preserved future-step state — **PASS**.
5. Instructions preserved — **PASS**.
6. Prep time, cooking time, and servings preserved — **PASS**.
7. No-PATCH notice was truthful — **PASS**.
8. Existing/manual values preserved — **PASS**.
9. Deliberate clears preserved — **PASS**.
10. Ingredient canonical boundary preserved — **PASS**.
11. Draft reload/resume — **PASS**.
12. Publish validation and acknowledgement unchanged — **PASS**.
13. Admin remained read-only — **PASS**.
14. Browser sanity checks — **PASS**.

No measurements beyond the verification listed above are claimed.

## Verdict

`RUNTIME PASS — READY FOR COMMIT/PUSH`
