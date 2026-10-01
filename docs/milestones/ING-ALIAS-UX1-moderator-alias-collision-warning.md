# ING-ALIAS-UX1 - Moderator Alias Collision Warning

## 1. Goal and baseline

Freeze a Moderator-facing, advisory warning for exact normalized Ingredient
alias ambiguity during Ingredient create and edit. The warning helps a
Moderator judge catalog ambiguity before saving, but it does not enforce alias
uniqueness or change the existing create/update authority.

The audited live-repository baseline is `main` at
`e3ae9ffac499dd14a71751def2eeabd521de51e0`, aligned with `origin/main`.

This phase is a contract freeze only. No application implementation, live
runtime exercise, database mutation, staging, commit, push, branch operation,
or stash operation is authorized.

## 2. Existing reusable capabilities and gaps

### 2.1 Admin Ingredient flow

`apps/admin/src/IngredientsTab.jsx` owns the REST-backed Ingredient list and
the shared `IngredientModal` used by ordinary catalog create/edit and ING2
missing-Ingredient creation. The form already:

- accepts a comma-separated alias field;
- trims and collapses whitespace in each alias;
- removes case-insensitive duplicates while preserving first-seen spelling;
- reports how many within-form duplicates will be removed;
- validates the existing 20-alias and 100-character-per-alias bounds; and
- submits normalized aliases through `ingredientApi.js` to the authoritative
  create/update endpoints.

`submitIngredientForm` preserves PATCH semantics by sending only fields that
changed. The collision warning must wrap, not replace, this path. The current
within-form duplicate hint already covers
`DUPLICATE_ALIASES_WITHIN_INGREDIENT`; UX1 adds no second warning for that
case.

### 2.2 API, validation, service, and model

The Ingredient API follows route -> authorization/validation -> controller ->
service -> repository -> Mongoose. Create and update require
`catalog.write`. Moderator has `catalog.write` and `catalog.read_all`; Admin
and User do not have `catalog.write` in the current capability map.

Request validation already freezes canonical-name and alias type/length/count
bounds. The service trims/collapses alias whitespace and deduplicates aliases
case-insensitively. `normalizedName` has a unique index for canonical names,
but aliases have no index or cross-Ingredient uniqueness rule. Create/update
therefore do not currently detect an alias matching another canonical name or
another Ingredient's alias, and they allow a self-alias.

### 2.3 Existing reads are not a safe warning API

`GET /api/v1/ingredients` can include active and archived records for staff,
but search is case-insensitive substring matching, results are paginated, and
the endpoint has a maximum page size of 100. Using it would require one or
more client requests per alias, exact reclassification in the Admin app, and
potentially downloading multiple catalog pages. A short page could not prove
that no owner exists.

`POST /api/v1/ingredients/resolve` already uses the correct exact
normalization and complete deterministic catalog read, but it intentionally:

- reads active Ingredients only;
- parses source lines and also returns possible substring candidates;
- caps candidates at 10;
- collapses evidence to one candidate per Ingredient; and
- cannot expose archived ownership or self-alias redundancy.

It must remain the ING1 Recipe-intake resolver and must not be widened for this
form warning.

### 2.4 Reusable ING-ALIAS-AUDIT1 logic

`apps/api/scripts/audit-catalog-consistency.js` already classifies the four
frozen alias-collision types across active and archived Ingredients, using
ING1's `normalizeResolverName`. Its CLI classifier is pure, deterministic,
and read-only, but the audit script itself is not an HTTP service dependency.

Implementation must extract the alias-only normalization, occurrence
indexing, status mapping, deterministic ordering, and collision
classification into a small pure Ingredient-domain module. The audit command
must import and re-export that shared logic without changing AUDIT1 report
shape, schema version, ordering, exit behavior, or read-only guarantees. The
UX lookup must use the same module to evaluate only the proposed aliases. This
avoids a second normalization or collision contract while keeping CLI wiring
out of the request path.

## 3. Frozen warning semantics

Warnings are advisory. They never make a create or update request invalid,
disable the save override after the Moderator has seen the current result, or
change the create/update service.

| Collision type | UX severity | Exact meaning |
| --- | --- | --- |
| `ALIAS_TO_CANONICAL` | strong | A proposed alias normalizes to the canonical name of a different Ingredient. |
| `ALIAS_TO_ALIAS` | strong | A proposed alias normalizes to an alias owned by a different Ingredient. |
| `SELF_ALIAS_TO_CANONICAL` | lightweight cleanup | A proposed alias normalizes to the proposed Ingredient's own canonical name. |
| `DUPLICATE_ALIASES_WITHIN_INGREDIENT` | existing inline hint only | Current form and service normalization remove duplicates within the submitted Ingredient; add no redundant collision warning. |

A proposed alias may produce both strong warning types when other catalog
records supply both canonical and alias evidence. Each applicable type is
returned separately. A conflict is an observation, not a declaration that
either Ingredient is wrong or should win.

## 4. Frozen normalization

All server collision comparisons must call the shared ING1/AUDIT1
normalization authority. For a canonical name or alias:

1. Accept it only when it is a string.
2. Trim leading and trailing whitespace.
3. Lowercase with JavaScript `toLowerCase()`.
4. Collapse every internal JavaScript whitespace run (`\s+`, Unicode mode)
   to one ASCII space.
5. Ignore an empty normalized result.

Do not strip punctuation or diacritics, transliterate, stem, singularize,
pluralize, infer synonyms, apply locale-specific folding, or use fuzzy or
semantic matching.

The Admin form may retain its existing display cleanup and within-form
deduplication, but it must not independently decide catalog collisions. The
server response is authoritative.

## 5. Create and edit behavior

On create, compare every submitted alias with every active and archived
Ingredient in the catalog.

On edit:

- send the edited Ingredient's public `id` as `ingredientId`;
- exclude that entire Ingredient from cross-Ingredient canonical and alias
  ownership before classification;
- compare against every other active and archived Ingredient;
- use the proposed current form name, not only the stored name, for
  `SELF_ALIAS_TO_CANONICAL`; and
- continue to detect self-alias redundancy even when the edited Ingredient is
  archived.

Exclusion applies only to cross-Ingredient ownership. It must not suppress a
self-alias warning. The lookup does not prove that the record will still exist
or remain unchanged when a later PATCH occurs; normal create/update responses
remain authoritative for the write.

## 6. Chosen API architecture

Add one dedicated read-only endpoint before the parameterized Ingredient
routes:

```text
POST /api/v1/ingredients/alias-collisions
authenticate -> requireCapability(catalog.write) -> validate -> controller -> service -> repository
```

It uses POST only because the bounded proposed name/alias set is a structured
request body. It performs no create, update, delete, index, audit-log, Recipe,
or Substitution operation.

### 6.1 Request

```json
{
  "name": "Green Onion",
  "aliases": ["scallion", "spring onion"],
  "ingredientId": "507f1f77bcf86cd799439011"
}
```

- `name` is required and uses the existing Ingredient name contract: trimmed,
  non-empty string, maximum 100 characters.
- `aliases` is required, contains 0-20 string items, and reuses the existing
  non-blank/trimmed/maximum-100-character alias item contract.
- `ingredientId` is optional. Omit it on create; on edit it must be a valid
  ObjectId and identifies the one owner excluded from cross-collisions.
- The body is strict; unknown keys are rejected.

The service applies the same first-seen normalized alias deduplication used by
current writes before classification. Request bounds mean at most 20 proposed
alias results and at most three warning records per distinct proposed alias.

### 6.2 Catalog read

Add one repository method that reads the complete Ingredient catalog,
including active and archived records, with only this projection:

```js
{ _id: 1, name: 1, aliases: 1, isActive: 1 }
```

The query is deterministic (`normalizedName`, then `_id`), unpaginated, and
lean. It is the server-side equivalent of the bounded AUDIT1 Ingredient read;
the catalog is never downloaded into the Admin app. It must not call a write
or index method.

### 6.3 Response and bounds

Return the ordinary success envelope with:

```json
{
  "warnings": [
    {
      "alias": "scallion",
      "collisionType": "ALIAS_TO_CANONICAL",
      "conflicts": [
        {
          "ingredientName": "Scallion",
          "status": "archived",
          "matchedOn": "canonical"
        }
      ],
      "totalConflicts": 1,
      "truncated": false
    },
    {
      "alias": "Green Onion",
      "collisionType": "SELF_ALIAS_TO_CANONICAL",
      "conflicts": [],
      "totalConflicts": 0,
      "truncated": false
    }
  ]
}
```

Freeze these response rules:

- `alias` preserves the first submitted display spelling after current trim
  and whitespace collapse.
- `collisionType` is one of the three UX1 types above.
- `status` is exactly `active`, `archived`, or fail-closed `unknown` for a
  malformed legacy activity value.
- `matchedOn` is exactly `canonical` or `alias`.
- Conflicts are distinct Ingredient owners, not stored alias occurrences.
- Return at most 10 conflict owners per warning. `totalConflicts` is the full
  distinct-owner count and `truncated` is true when more than 10 exist.
- A truncated strong warning remains a strong warning and the UI states that
  additional owners exist.
- Proposed aliases retain their first-seen order; warning types use AUDIT1
  order (`ALIAS_TO_CANONICAL`, `ALIAS_TO_ALIAS`, then
  `SELF_ALIAS_TO_CANONICAL`). Conflicts use the shared deterministic owner
  order with `_id` only as an internal tie-break.
- An exact no-collision result is `{ "warnings": [] }`.
- Do not return Ingredient IDs, MongoDB keys, `normalizedName`, normalized
  comparison values, categories, allergens, timestamps, or stored alias
  values.

The endpoint does not need a new index in UX1. The current catalog is small,
the request is Moderator-only and bounded, and the exact normalizer cannot be
represented safely by the existing alias storage/index shape. Indexing or
persisting normalized aliases requires a separate data contract.

## 7. Warning UI and request timing

Render one collision-status region directly below the alias control and add
its id to that control's `aria-describedby`. Use a polite live region so
results are announced without turning an advisory warning into a blocking
validation error.

Strong warning copy must identify:

- the entered alias;
- each returned conflicting canonical Ingredient name;
- `Active`, `Archived`, or `Status unknown` in text, not color alone; and
- whether the owner matched by canonical name or alias.

The lightweight warning says that the entered alias is the same as this
Ingredient's canonical name and is redundant. No automatic remove, merge,
archive, rename, or fix button is included.

After a locally valid name/alias change, debounce lookup for 400 ms. Do not
request while aliases are empty or while the local name/alias count or length
contract is invalid. A name change must also recheck because it can create or
remove a self-alias. Any relevant change immediately marks the previous
result stale. Associate each request with the normalized form signature and a
monotonic generation; only the newest response for the still-current
signature may render.

The save control remains available when current warnings are visible. The
warning region does not set a field validation error and warnings are not
included in the create/update payload.

## 8. Failure and staleness behavior

The debounced check has four meaningful states: checking, current success,
stale/idle, and unavailable. Do not render a positive "clean" claim for
stale, skipped, or failed lookup. On failure show:

> Alias conflicts could not be checked. You can still save, but review the
> catalog when the check is available.

Preserve any previously displayed warnings as explicitly stale rather than
replacing them with an empty result. Authorization failure also invokes the
existing `onAuthorityLost` flow. A failed or timed-out check never becomes
`warnings: []`.

Immediately before create/update, perform one lightweight recheck for the
exact current form signature unless that signature is already in a final
override state. Freeze this advisory acknowledgement behavior:

1. If the recheck succeeds with no warnings, continue the existing save in
   the same submit.
2. If it succeeds with warnings already displayed for the same signature,
   continue the existing save in the same submit.
3. If it finds a new or changed warning set, render it and require one more
   explicit submit with the unchanged signature; the save button remains
   enabled.
4. If it fails or exceeds five seconds, render the unavailable state and arm
   one unchanged-signature override; the next explicit submit proceeds
   without requiring lookup success.
5. Any form change clears the override and restarts the debounced check.

This makes the Moderator see a newly discovered warning or an honest lookup
failure before choosing to proceed, while never making create/update depend on
a clean or successful warning result. The five-second client deadline bounds
the advisory wait; late responses are ignored by generation/signature checks.

Warnings remain a non-transactional observation. A different write may occur
after the recheck, and UX1 introduces no uniqueness guarantee, transaction,
lock, or server-side write rejection.

## 9. Exact implementation allowlist

Production:

```text
apps/api/src/modules/ingredients/ingredient-alias-collisions.js   (new shared pure classifier)
apps/api/scripts/audit-catalog-consistency.js                     (import/re-export shared classifier; no report change)
apps/api/src/modules/ingredients/ingredient.repository.js         (complete projected read)
apps/api/src/modules/ingredients/ingredient.validation.js         (bounded strict request)
apps/api/src/modules/ingredients/ingredient.service.js            (read-only warning orchestration)
apps/api/src/modules/ingredients/ingredient.controller.js         (success envelope)
apps/api/src/modules/ingredients/ingredient.routes.js             (authorized route)
apps/admin/src/ingredientApi.js                                   (read-only client call)
apps/admin/src/IngredientsTab.jsx                                 (debounce, stale guards, warning UI, save recheck)
```

Documentation:

```text
docs/milestones/ING-ALIAS-UX1-moderator-alias-collision-warning.md (status/evidence updates only)
```

No model, serializer, capability, rate-limiter, package, lockfile, Recipe,
Substitution, mobile, migration, or audit-output file is allowlisted. If the
implementation requires another production or documentation path, stop and
amend this contract before editing it.

## 10. Exact test allowlist and contract

Test files that may be added or modified:

```text
apps/api/test/ingredient-validation.test.js                       (modify)
apps/api/test/ingredient-service.test.js                          (modify)
apps/api/test/ingredient-routes.test.js                           (modify)
apps/admin/test/ingredientAliasCollisionWarning.test.js           (new)
apps/admin/test/recipeIngredientCreation.test.js                  (authorized ING2 compatibility update)
```

Focused automated coverage must prove:

- alias-to-canonical and alias-to-alias strong warnings;
- self-alias lightweight warning;
- string-only trim/lowercase/Unicode-whitespace-collapse equality, with no
  punctuation, synonym, fuzzy, or semantic matching;
- create includes active and archived ownership;
- edit excludes the current Ingredient from cross-collisions but retains its
  self-alias check;
- active, archived, and fail-closed unknown status serialization;
- deterministic distinct-owner results, 10-owner truncation, total counts,
  and omission of IDs/internal fields;
- no collision returns an empty warning array;
- strict request fields and existing 20/100 bounds;
- unauthenticated, User, and Admin callers cannot use the endpoint while a
  current Moderator can;
- repository lookup is complete, projected, deterministic, lean, and calls no
  mutation/index method;
- debouncing avoids a request per keystroke, stale responses cannot render,
  and name changes recheck self-aliases;
- active/archived status and canonical/alias source are visibly rendered;
- lookup failure never renders a clean state and still permits the explicit
  unchanged-form save override;
- a visible warning does not block create or edit after acknowledgement;
- the final pre-save recheck follows the four outcomes in section 8; and
- existing create/edit payloads, unchanged-edit behavior, validation,
  authority-loss handling, ING2 shared-modal creation, and save errors remain
  intact.

The pre-existing AUDIT1 tests must continue to pass unchanged and prove that
extracting shared logic did not alter its classifier/report contract. Run the
focused files separately on Windows when Vite or Node mocking isolation makes
a combined invocation unreliable:

```text
node --test --test-isolation=none apps/api/test/ingredient-validation.test.js
node --test --test-isolation=none apps/api/test/ingredient-service.test.js
node --test --test-isolation=none apps/api/test/ingredient-routes.test.js
node --test --test-isolation=none apps/api/test/catalog-consistency-audit.test.js
node --test --test-isolation=none apps/admin/test/ingredientAliasCollisionWarning.test.js
node --test --test-isolation=none apps/admin/test/ingredientSubstitutionFormValidation.test.js
node --test --test-isolation=none apps/admin/test/recipeIngredientCreation.test.js
npm run build --workspace=apps/admin
git diff --check
git status --short --branch
```

The Ingredient form regression remains a read-only regression gate. The ING2
compatibility test is an authorized scope expansion because the shared modal
now performs the mandatory advisory pre-save request. The build is also a
read-only gate.

## 11. Runtime gates

No Moderator browser/runtime check or database mutation was performed during
this freeze. After implementation, focused tests, and independent review pass,
use only `wecooked-dev` with a real current Moderator session and exact,
reversible fixture handling:

1. Record the original fixture documents before any setup and arrange exact
   restoration/removal; do not leave archived collision fixtures behind.
2. In the create form, enter an alias matching an existing canonical name and
   verify the strong warning names the owner and status; cancel without
   creating the Ingredient.
3. In the edit form, enter an alias matching another Ingredient's alias and
   verify the other owner and active/archived status are shown while the
   current Ingredient is excluded.
4. Enter the edited Ingredient's own canonical name as an alias and verify the
   lightweight self-alias warning.
5. Verify Save remains enabled. Exercise the acknowledged save path on the
   reversible edit fixture, then restore the original document exactly.
6. Force the collision endpoint to fail and verify the UI reports unavailable,
   never claims clean, and permits the unchanged-form override.
7. Inspect network/database evidence to prove each
   `/ingredients/alias-collisions` call performs only the projected read and
   causes zero mutation. Distinguish deliberate create/update test writes from
   the lookup itself.
8. Rerun the read-only catalog audit after fixture cleanup and confirm the
   development collision inventory is restored to its pre-test state.

Do not run this runtime plan against production and do not use production data
for the freeze. Browser rendering, accessibility behavior, and database
zero-mutation remain gates until actually measured; automated tests alone do
not prove them.

## 12. Explicitly out of scope

- Blocking Ingredient create or update because of an alias warning.
- Alias uniqueness indexes, normalized-alias persistence, or schema changes.
- Transactions, locks, or a concurrency guarantee.
- Ingredient merge, winner selection, rename, archive, delete, or cleanup.
- Automatic alias removal or any v1 fix button.
- Recipe or Substitution rewriting.
- Allergen filtering, dependency UX, Substitution duplicate UX, Recipe intake
  resolver changes, or picker changes.
- Fuzzy, synonym, punctuation-insensitive, diacritic-insensitive,
  morphological, locale, or semantic matching.
- Downloading the complete Ingredient catalog into Admin.
- Changing AUDIT1 report shape, inventory semantics, schema version, or exit
  behavior.
- Production runtime or production data mutation.
- Package installation/update, staging, commit, push, branch manipulation, or
  Cook Mode stash inspection/manipulation.

MongoDB credential rotation remains deferred security debt because AUDIT1
recorded that a credential appeared in command output. UX1 neither rotates nor
verifies that credential, and implementation must not repeat or persist it.

## 13. Blockers and verdict

No implementation blocker was found at the audited baseline. Runtime evidence
is intentionally deferred until implementation and explicit development
authorization. The existing protected Cook Mode stash must remain untouched.

**ING-ALIAS-UX1 CONTRACT FROZEN - READY FOR IMPLEMENTATION**

## 14. Implementation evidence

Implemented on `feat/ing-alias-ux1-collision-warning` from baseline
`e3ae9ffac499dd14a71751def2eeabd521de51e0`.

- The catalog audit and Moderator lookup now share the pure
  `ingredient-alias-collisions.js` normalization and classifier. The existing
  AUDIT1 report contract remains unchanged.
- `POST /api/v1/ingredients/alias-collisions` is authorized with
  `catalog.write`, strictly validates the bounded request, reads the complete
  projected active and archived catalog, and returns bounded public warning
  evidence without writes.
- Proposed canonical names participate in analysis, including canonical name
  to another Ingredient's alias. Edit lookup excludes the stored owner while
  preserving proposed self-alias detection.
- The shared Admin modal debounces lookups, rejects stale responses, renders
  accessible strong/lightweight/unavailable states, and performs the frozen
  pre-save recheck and unchanged-signature continuation flow.
- Focused API, audit, and Admin interaction checks pass, as does the Admin
  production build.
- Expansion of the ING2 compatibility test was explicitly authorized.
  `apps/admin/test/recipeIngredientCreation.test.js` was updated for the
  mandatory pre-save advisory request/failure acknowledgement, and the ING2
  regression now passes 11/11.

The separately authorized development runtime gate later passed against
`wecooked-dev`; production remained untouched. Section 16 records the final
runtime evidence.

## 15. Independent review and required findings fix

The latest independent review found no production defect and returned
**PASS WITH REQUIRED FIXES**. It required these targeted test-quality and
evidence corrections before closure review:

1. Make the service edit fixture discriminating so the current Ingredient's
   stored `scallion` alias would create a false cross-owner collision if
   `ingredientId` exclusion were removed, while retaining other-owner and
   proposed self/cross warning coverage.
2. Add async ordering coverage proving an older failed request cannot replace
   the warning or clean state produced by a newer successful request.
3. Add focused five-second advisory deadline coverage proving a non-settling
   lookup becomes unavailable rather than clean and its deadline timer is
   cleared after settlement.

This narrow findings-fix phase was limited to the two focused test files and
this milestone evidence update. The service regression passes 48/48, the
Admin warning interaction regression passes 7/7, and the authorized ING2
compatibility regression remains green at 11/11. No production file was
changed in this phase. The subsequent closure review returned **PASS**.

**ING-ALIAS-UX1 FINDINGS FIX COMPLETE - READY FOR CLOSURE REVIEW**

## 16. Final evidence and closure

Implementation is **complete**.

Independent review returned **PASS WITH REQUIRED FIXES**. All required fixes
were completed:

- discriminating edit-owner-exclusion coverage was added;
- the stale-failure regression was added;
- the five-second deadline regression was added; and
- ING2 compatibility tests were updated under the authorized scope expansion.

Closure review returned **PASS**.

Final focused evidence:

- Ingredient validation: 25/25 PASS;
- Ingredient service: 48/48 PASS;
- Ingredient routes: 34/34 PASS;
- AUDIT1: 32/32 PASS;
- ING1 resolver: 10/10 PASS;
- UX1 Admin: 7/7 PASS;
- Ingredient form regression: 15/15 PASS;
- ING2 regression: 11/11 PASS; and
- Admin build: PASS.

The development runtime gate passed against `wecooked-dev`; production was
untouched. Runtime evidence confirmed:

- alias to canonical warning: PASS;
- proposed canonical to existing alias warning: PASS;
- alias to alias warning: PASS;
- self-alias redundancy warning: PASS;
- edit owner exclusion: PASS;
- pre-save recheck and unchanged acknowledgement: PASS;
- lookup failure behavior: PASS;
- stale response protection: PASS;
- lookup performs zero mutations: PASS;
- temporary fixtures, session, and user cleanup: PASS; and
- the Ingredient count was restored to 17.

Warnings remain advisory. UX1 introduces no alias enforcement, merge,
cleanup, schema or index change, or production mutation. MongoDB credential
rotation remains deferred security debt because AUDIT1 previously recorded
that a credential appeared in command output; this finalization neither
rotates nor verifies that credential and does not repeat or persist it.

**ING-ALIAS-UX1 FINALIZED - READY TO MERGE**
