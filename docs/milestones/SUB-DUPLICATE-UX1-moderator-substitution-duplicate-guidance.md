# SUB-DUPLICATE-UX1 - Moderator Substitution Duplicate Guidance

## 1. Goal and baseline

Freeze the smallest Moderator-facing duplicate warning and guidance flow for
Substitution create and edit. An exact existing directed pair must be surfaced
before a Moderator relies on the save-time conflict response, while MongoDB's
existing unique compound index remains the final authority.

The audited live-repository baseline is `main` at
`f23c4aa9a33b7e5cdc9464ca99b285aed73b56eb`, aligned with `origin/main`.

This phase is a contract freeze only. No application or test implementation,
development or production database mutation, staging, commit, push, branch
operation, package change, or stash operation is authorized.

## 2. Current Substitution uniqueness contract

`Substitution` stores one directed relationship per ordered pair:

```text
sourceIngredientId -> substituteIngredientId
```

The model owns a unique compound index on:

```js
{ sourceIngredientId: 1, substituteIngredientId: 1 }
```

The order is significant. `Butter -> Margarine` and
`Margarine -> Butter` are different keys and may both exist. The index is not
partial, so it covers both active and archived records. Archiving only changes
`isActive` to `false`; it does not free the ordered pair for another document.

Create and update both translate Mongo duplicate-key error `11000` into the
stable `409 SUBSTITUTION_ALREADY_EXISTS` response with the safe message
`This substitution relationship already exists.` The index and this service
translation remain unchanged and authoritative. UX1 is pre-save assistance,
not a replacement for either control.

Duplicate detection is frozen to exact public Ingredient IDs in their entered
direction. Do not compare names, aliases, contexts, ratios, notes, or semantic
meaning. Do not infer that the reverse direction is a duplicate.

## 3. Existing reusable capabilities

### 3.1 Exact staff list lookup

The existing authenticated list endpoint already accepts both
`sourceIngredientId` and `substituteIngredientId`. The service applies both to
one Mongo filter. With `status=all`, it returns active and archived
Substitutions without the consumer-only active visibility trim. Moderator owns
both `catalog.read_all` and `catalog.write`, so the current route and capability
gates already support this read.

The exact UX lookup is therefore:

```text
GET /api/v1/substitutions
  ?sourceIngredientId=<source id>
  &substituteIngredientId=<substitute id>
  &status=all
  &page=1
  &limit=1
```

The unique compound index means at most one legitimate document can match.
The existing serializer supplies everything the guidance needs: the
Substitution `id`, both Ingredient `{ id, name }` summaries, and `isActive`.
The Admin downloads neither the full Substitution catalog nor extra Ingredient
records.

### 3.2 Existing Admin flow

`apps/admin/src/SubstitutionsTab.jsx` already owns:

- the exact source/substitute server filters;
- `active`, `inactive`, and `all` status views;
- create and minimal-PATCH edit through one `SubstitutionModal`;
- row-level edit, archive, and restore actions;
- the `listSubstitutions` feature-service call;
- stale-request protection for list and picker reads; and
- structured `ApiError` fields including `code`, `status`, and `isConflict`.

The current list can therefore become the destination for guidance: close the
modal and apply the exact source and substitute filters with `status=all` and
`page=1`. The matching row then exposes Edit when writable and Restore when
archived. No new detail screen, navigation destination, restore endpoint, or
client data store is required.

### 3.3 Archive and restore behavior

Archive is the existing `DELETE /substitutions/:id` soft archive. Restore is
the existing `PATCH /substitutions/:id { isActive: true }`; the service
revalidates both referenced Ingredients before reactivation. UX1 must route a
Moderator to these existing explicit actions and must never restore, merge,
archive, or rewrite a record automatically.

## 4. Frozen duplicate semantics

For a proposed ordered pair `(sourceId, substituteId)`:

- an exact record with those IDs is a duplicate regardless of `isActive`;
- `(substituteId, sourceId)` is not a duplicate;
- an edit ignores a match whose public `id` equals the record being edited;
- an edit still detects an exact match owned by any other record; and
- a same-Ingredient pair remains the existing local/server validation error,
  not a duplicate lookup.

The lookup must use IDs already selected by the canonical Ingredient pickers.
It adds no normalization, name comparison, alias comparison, fuzzy matching,
reciprocal inference, contextual scoring, or equivalence rules.

## 5. Active duplicate behavior

When the current exact directed pair is owned by another active record:

- render a clear advisory stating that this directed Substitution already
  exists and is Active;
- show the exact `Source name -> Substitute name` pair returned by the server;
- identify it as the existing Substitution, without exposing Mongo internals;
- disable the modal's create/save action for that still-current confirmed
  pair, because the authoritative write cannot succeed; and
- offer `Show existing substitution`, which closes the modal and applies the
  exact source/substitute filters with `status=all` so the Moderator can use
  the existing Edit action.

No acknowledgement or override is needed for a confirmed exact duplicate.
Changing either Ingredient invalidates the warning immediately and begins a
check for the new ordered pair.

## 6. Archived duplicate behavior

When the exact directed pair is owned by an archived record:

- state that the directed Substitution already exists and is Archived;
- show the exact pair and explain that a new record cannot be created while
  the archived record owns it;
- disable create/save for that still-current confirmed pair; and
- offer the same `Show existing substitution` action. The exact `status=all`
  list result exposes the existing explicit Restore and Edit actions.

Do not silently create a second record. Do not automatically restore the
archived record. Restore remains a separate, explicit Moderator action and
retains the server's active-Ingredient validation.

## 7. Edit behavior and self-exclusion

The edit modal sends the current Substitution's public `id` only to local
matching logic; it is not added to the API query or mutation payload.

If the exact lookup returns that same `id`, treat it as self and render no
duplicate warning. This covers an unchanged `A -> B` edit and an edit that
changes only ratio, contexts, notes, or status. The existing unchanged-form
no-op remains intact.

If the Moderator changes the pair and the exact lookup returns a different
record, active or archived, render and enforce the corresponding guidance in
sections 5 or 6. Reversing `A -> B` to `B -> A` is checked in that new direction
and remains allowed when that ordered pair is unowned.

## 8. Chosen API architecture

Reuse the existing list endpoint and its current route -> validation ->
controller -> service -> repository -> Mongoose path. Do not add a dedicated
endpoint or change the model, validation, repository, service, controller,
routes, serializer, indexes, capabilities, or response envelope.

The Admin calls its existing `listSubstitutions` feature service with exactly:

```js
{
  sourceIngredientId,
  substituteIngredientId,
  status: 'all',
  page: 1,
  limit: 1,
  sort: 'newest'
}
```

The response remains the existing
`{ substitutions, pagination }` shape. A result is classified by its existing
`isActive` boolean. The current record is excluded by exact public `id` in edit
mode. The request is read-only, bounded to one returned row, authorized by the
existing `catalog.read_all` gate, and uses the ordered compound-index query
shape.

## 9. UI and request timing contract

Add one compact status region in the existing create/edit modal immediately
after the two Ingredient controls. Associate it with both controls through
`aria-describedby` and use a polite live region. Status must be conveyed in
text, not color alone. Do not redesign the table or modal.

Meaningful states are:

- `idle`: one or both Ingredients are missing, or both IDs are the same; make
  no request and make no duplicate claim;
- `checking`: a request is in flight for the current ordered pair;
- `clear`: the current successful exact lookup found no other owner; no
  positive "clean" message is required;
- `duplicate-active` or `duplicate-archived`: render the blocking guidance
  and action frozen above; and
- `unavailable`: state that duplicate status could not be checked and that the
  server will still protect the save; never display or imply a clean result.

Start the advisory lookup only after both picker selections exist and are
different. Picker selections are discrete rather than free-typed pair values,
so no keystroke debounce is necessary. Associate every lookup with the exact
ordered-pair signature and a monotonic generation; a changed pair, closed
modal, older success, or older failure must not update the current state.

Use a five-second client deadline for both advisory and pre-save reads so a
non-settling assistance request cannot hold the form indefinitely. A late
result is ignored by the signature/generation guard.

Immediately before every non-no-op create or update, perform one fresh exact
lookup for the submitted pair. This small bounded preflight is justified
because it narrows the interval between advisory evidence and the write. If it
finds another record, render guidance and do not call the existing mutation.
If it finds no other record, continue the existing save in the same submit. A
write can still race after that lookup; the unique index remains final.

## 10. Save-time 409 behavior

Handle only `ApiError.code === 'SUBSTITUTION_ALREADY_EXISTS'` as this exact
duplicate condition; do not classify every 409 or generic failure as a
duplicate.

If create/update returns that code after a clean preflight, keep the modal open
and translate it into the same directed-pair guidance instead of the current
generic form error. Perform one bounded exact lookup to recover the existing
record's `id` and Active/Archived state:

- on lookup success, render the same active or archived guidance and
  `Show existing substitution` action;
- if that recovery lookup fails, retain the authoritative server-conflict
  state, say that the exact pair already exists but its status could not be
  loaded, block another unchanged save, and still offer the exact-filter
  action so the Moderator can find it in `status=all`.

Do not retry the mutation automatically. Do not expose `E11000`, collection
names, index names, or raw server details.

## 11. Failure behavior

An advisory lookup error, timeout, malformed response, or authorization loss
must never become `clear` and must never erase a current warning by pretending
there is no duplicate. Render a proportional unavailable message. Invoke the
existing `onAuthorityLost` callback for a forbidden response.

Because the lookup is assistance rather than integrity enforcement, an
unavailable initial or final pre-save lookup does not block the existing save
attempt. The database unique index and stable server 409 remain authoritative.
If the save succeeds, preserve the current close/reload behavior. If it returns
the exact duplicate code, section 10 applies. All other validation, ingredient,
permission, network, and not-found errors retain their current handling.

## 12. Exact implementation allowlist

Production file permitted to change:

```text
apps/admin/src/SubstitutionsTab.jsx
```

Documentation file permitted in this freeze and for later status/evidence
updates:

```text
docs/milestones/SUB-DUPLICATE-UX1-moderator-substitution-duplicate-guidance.md
```

`SubstitutionsTab.jsx` already imports and uses `listSubstitutions`, owns the
modal and list filters, and receives structured `ApiError`s. Keeping the
bounded helper, request state, guidance UI, exact-filter action, pre-save
check, and 409 mapping there is the smallest architecture-consistent change.

No API, model, schema, index, validation, repository, service, controller,
route, serializer, capability, shared client, package, lockfile, mobile,
Recipe, Ingredient, migration, or configuration file is allowlisted. If
implementation proves another production path necessary, stop and amend this
contract before editing it.

## 13. Exact test allowlist and contract

Test file permitted to be added:

```text
apps/admin/test/substitutionDuplicateGuidance.test.js
```

No existing backend or Admin test file may be modified for UX1. Use the
existing dependency-free mounted React harness pattern; do not add jsdom or
another package. Focused behavior must prove:

- the lookup sends the exact ordered source/substitute IDs with `status=all`,
  `page=1`, and `limit=1` only after both valid, different selections exist;
- an active exact duplicate is identified, labelled Active, blocks the
  mutation callback, and can route to the exact existing-record list;
- an archived exact duplicate is identified, labelled Archived, blocks the
  mutation callback, and guides the Moderator to explicit restore/edit;
- the reverse pair is queried in reverse order and is not treated as the same
  record;
- edit excludes the current record by `id` and allows same-pair non-pair edits;
- edit still detects another record that owns the proposed pair;
- changed signatures and monotonic generations reject stale success and stale
  failure responses;
- lookup failure/timeout renders unavailable, never claims clean, and permits
  the existing save path;
- the fresh pre-save lookup stops a newly discovered duplicate before the
  create/update callback, proving no duplicate write is attempted;
- a raced `SUBSTITUTION_ALREADY_EXISTS` response maps to the same useful
  guidance, including the status-unavailable fallback when recovery fails;
- unrelated 400/403/404/network handling and authority-loss behavior remain
  intact; and
- existing create/edit validation, minimal PATCH/no-op, archive, restore,
  filtering, and pagination wiring remain intact.

Run the new focused test plus the unchanged regression authorities:

```text
node --test --test-isolation=none apps/admin/test/substitutionDuplicateGuidance.test.js
node --test --test-isolation=none apps/admin/test/ingredientSubstitutionFormValidation.test.js
node --test --test-isolation=none apps/api/test/substitution-model.test.js
node --test --test-isolation=none apps/api/test/substitution-validation.test.js
node --test --test-isolation=none apps/api/test/substitution-service.test.js
node --test --test-isolation=none apps/api/test/substitution-routes.test.js
npm run build --workspace=apps/admin
git diff --check
git status --short --branch
```

The unchanged backend tests remain regression gates for the unique index,
ordered filters, create/update duplicate translation, archive, and restore
contracts. Automated tests do not by themselves prove browser rendering,
accessibility announcement, MongoDB index presence in a deployed database, or
zero runtime mutation.

## 14. Development runtime gates

No runtime or database mutation is performed during this freeze. After
implementation, focused verification, and independent review pass, use only a
development environment with a real current Moderator session and temporary,
uniquely named fixtures:

1. Record the exact pre-test Ingredient/Substitution fixture state and counts.
2. With an active `A -> B` fixture, open Add, select `A` then `B`, verify the
   Active warning appears before save, use `Show existing substitution`, and
   confirm Edit opens the existing record.
3. Archive that fixture explicitly, repeat the pair selection, verify Archived
   guidance, navigate to the existing row, and verify Restore is offered but
   not automatic.
4. Restore the fixture explicitly and select `B -> A`; verify no forward-pair
   warning and create the reverse relationship as a distinct temporary record.
5. Edit `A -> B` without changing the pair and verify self-exclusion. Then
   change a separate editable fixture to an ordered pair owned by another
   active or archived record and verify it is blocked.
6. Attempt the known duplicate path and inspect API/database evidence that no
   second `A -> B` document was created. Also exercise a controlled raced 409
   and verify the useful fallback guidance.
7. Force the advisory lookup to fail and verify no clean claim is shown and the
   normal save attempt remains available under server protection.
8. Remove only the uniquely identified temporary reverse/edit fixtures and
   restore every pre-existing fixture to its recorded state. Confirm final
   counts and exact records match the pre-test snapshot.

Do not run this plan against production. Do not claim browser, accessibility,
network, or database runtime proof until it is actually measured. Temporary
fixture cleanup is a mandatory gate, not a best-effort follow-up.

## 15. Explicitly out of scope

- Changing or weakening the compound unique index or 409 contract.
- Fuzzy Ingredient matching, alias matching, semantic equivalence, synonyms,
  reciprocal-pair inference, or context-based duplicate scoring.
- Treating `A -> B` and `B -> A` as the same record.
- Automatic restore, merge, archive, deletion, or record rewriting.
- A new Substitution endpoint, schema field, index, migration, transaction,
  lock, acknowledgement workflow, or bulk operation.
- Downloading the Substitution catalog into Admin.
- Ingredient alias work, allergen filtering, ranking, scoring, Recipe rewrite,
  Recipe intake changes, mobile changes, or Substitution recommendations.
- Redesigning the Substitution screen or adding a new detail route.
- Production runtime or production data mutation.
- Package installation/update, staging, commit, push, branch manipulation, or
  Cook Mode stash inspection/manipulation.

MongoDB credential rotation remains deferred security debt. UX1 neither
rotates nor verifies credentials and must not repeat, persist, or expose any
credential previously seen in command output.

## 16. Blockers and verdict

No implementation blocker was found at the audited baseline. The current list
endpoint, serializer, Moderator capabilities, exact filters, Admin modal/list
state, and explicit archive/restore actions are sufficient for the frozen
design. Development runtime evidence is intentionally deferred until after
implementation and separate authorization. The protected Cook Mode stash must
remain untouched.

**SUB-DUPLICATE-UX1 CONTRACT FROZEN - READY FOR IMPLEMENTATION**

## 17. Implementation evidence (2026-10-01)

Implementation is present on `feat/sub-duplicate-ux1-guidance` from baseline
`f23c4aa9a33b7e5cdc9464ca99b285aed73b56eb` in the frozen production and test
paths only:

- `apps/admin/src/SubstitutionsTab.jsx` now performs the bounded exact ordered-
  pair advisory lookup and a fresh pre-save lookup, using a signature that
  includes both Ingredient IDs and the edited public Substitution `id` (or the
  create marker), plus monotonic generation protection and a five-second
  deadline.
- Active, Archived, and save-time Unknown duplicate states render the exact
  directed pair in a polite live region, block a known-impossible mutation,
  and route `Show existing substitution` into the existing exact filters with
  `status=all`. No automatic restore or edit was added.
- Edit self-matches are excluded by public `id`; reverse ordered pairs remain
  independent. Advisory failure remains visibly unavailable and permits the
  existing server-authoritative save path.
- Only `SUBSTITUTION_ALREADY_EXISTS` is translated into duplicate guidance.
  One exact recovery lookup obtains Active/Archived status when possible and
  retains authoritative Unknown guidance if recovery fails.
- `apps/admin/test/substitutionDuplicateGuidance.test.js` adds dependency-free
  mounted behavioral coverage for create/edit, active/archived guidance,
  incomplete/same-pair request suppression, reverse direction, self-exclusion,
  stale success/failure rejection, timeout/unavailable behavior, pre-save
  blocking/permitted save behavior, 409 recovery/fallback, navigation data,
  unrelated errors, and authority loss.

Verification recorded during implementation:

- focused duplicate-guidance test: 8/8 passed;
- unchanged Admin form-validation regression: 15/15 passed;
- unchanged API model/validation/service/routes regressions: 70/70 passed;
- Admin production build passed; existing dynamic-import and large-chunk
  warnings remained non-failing.

This evidence does not claim independent review, browser/accessibility runtime
verification, deployed MongoDB index verification, development fixture
exercise, or final milestone closure. No database or runtime fixture mutation
was performed.

## 18. Required findings fix (2026-10-01)

The latest independent review returned **NO-GO** with these required findings:

- **MAJOR:** a save-time `SUBSTITUTION_ALREADY_EXISTS` response from a pending
  old pair could increment the advisory generation, start recovery, and replace
  duplicate state belonging to a newer pair;
- a successful lookup whose expected `substitutions` collection was malformed
  could be treated as a clean result;
- the active and archived duplicate tests did not make their forms otherwise
  mutation-capable, so zero mutation was not conclusive;
- `Show existing substitution` had callback-only rather than mounted parent
  state coverage; and
- selected Ingredient guidance association existed on a wrapper rather than
  the focusable Clear control.

The targeted findings fixes remain inside the frozen production/test/document
allowlist:

- submit now captures its immutable pair signature and generation. The 409
  path checks both before it changes guidance or starts recovery, and recovery
  checks them again before committing. Pair changes and closed sessions leave
  the newer session authoritative and do not start an already-stale old-pair
  recovery lookup;
- the exact lookup now rejects a present non-array `substitutions` collection,
  entering the existing unavailable state without implying a clean result;
- active edit and archived create duplicate tests now populate valid,
  mutation-capable forms and prove exactly zero update/create mutations;
- mounted regression coverage exercises the pending A -> B mutation, a newer
  C -> D advisory result, the old A -> B 409, and absence of an old-pair
  recovery request;
- 409 coverage proves only the stable duplicate code enters recovery, exactly
  one recovery lookup runs for a current pair, Archived recovery is surfaced,
  failed recovery retains Unknown guidance, and unrelated conflict handling is
  unchanged;
- mounted parent coverage proves the guidance action closes the modal, applies
  the exact source/substitute filters, sets `status=all`, resets `page=1`, and
  clears the incompatible context filter;
- selected source and substitute Clear buttons now reference the duplicate
  guidance element through `aria-describedby`, while unselected search inputs
  retain the relationship; and
- focused async coverage now includes stale success, stale failure, stale
  timeout, five-second deadline behavior, timer cleanup, pair/session
  isolation, and close/reopen isolation.

Focused verification after these fixes:

- `apps/admin/test/substitutionDuplicateGuidance.test.js`: **13/14 passed**.
  The required missing-collection HTTP regression fails because
  `apps/admin/src/substitutionApi.js` currently normalizes a missing
  `data.substitutions` field to `[]` before the allowlisted component can
  distinguish it from a valid empty collection;
- `apps/admin/test/ingredientSubstitutionFormValidation.test.js`: **15/15
  passed**; and
- Admin production build: **passed**, with the pre-existing dynamic-import and
  large-chunk warnings remaining non-failing.

Completing the missing-collection fix requires either changing that
non-allowlisted feature service to preserve/reject the malformed shape or
departing from the frozen feature-service boundary inside the component. This
phase did neither. Backend suites were not rerun because this findings-fix
phase changed no backend file. Browser, assistive-technology, deployed-index,
and development database runtime verification remain unclaimed. This is not
milestone closure, finalization, release, or merge evidence.

**SUB-DUPLICATE-UX1 STILL BLOCKED**

## 19. Authorized service-boundary fix (2026-10-01)

This phase explicitly expands the authorized production scope to
`apps/admin/src/substitutionApi.js`. The expansion is required because the
existing general `listSubstitutions` helper intentionally normalizes a missing
`data.substitutions` collection to `[]`, so the component cannot distinguish a
malformed successful response from a valid empty duplicate result after that
boundary.

Caller audit found that `SubstitutionsTab.jsx` is the only Admin production
caller of `listSubstitutions`. Its table path relies on the existing general
list contract. That helper and its permissive fallback remain unchanged.
Instead, `listExactSubstitutionPair` now owns the bounded UX1 request shape
(`sourceIngredientId`, `substituteIngredientId`, `status=all`, `sort=newest`,
`page=1`, `limit=1`) and accepts only an actual `data.substitutions` array.
Missing `data`, a missing collection, `null`, objects, and strings reject at the
service boundary. `SubstitutionsTab.jsx` maps those failures to the existing
safe unavailable guidance and still permits the authoritative server save.
No raw parsing or internal error is rendered.

Final focused verification for this service fix:

- `apps/admin/test/substitutionDuplicateGuidance.test.js`: **16/16 passed**,
  including valid `[]` as clean, a missing collection as unavailable, and
  `null`/object/string collections as malformed;
- `apps/admin/test/ingredientSubstitutionFormValidation.test.js`: **15/15
  passed**; and
- Admin production build: **passed**, with the pre-existing dynamic-import and
  large-chunk warnings remaining non-failing.

The initial sandbox attempts for these Vite-backed checks hit Windows
`spawn EPERM`; the identical commands passed outside the sandbox. Backend
suites were not rerun, as directed, and no backend file changed. Browser,
assistive-technology, deployed-index, and database runtime verification remain
unclaimed. This is service-fix evidence for closure review, not milestone
closure, finalization, release, or merge evidence.

**SUB-DUPLICATE-UX1 SERVICE FIX COMPLETE - READY FOR CLOSURE REVIEW**

## 20. Final closure and runtime evidence (2026-10-01)

Implementation is **COMPLETE**.

The initial independent review returned **NO-GO** and required correction of:

- the stale save-time `409` race;
- malformed successful responses being treated as clean;
- weak, non-discriminating blocking tests;
- incomplete navigation proof; and
- the selected-control accessibility association.

The required fixes are complete:

- submitted pair and session identity now protect newer advisory state;
- a stale `409` cannot cancel or overwrite a newer pair;
- no unnecessary stale-pair recovery is performed;
- `apps/admin/src/substitutionApi.js` now provides the strict exact-pair
  service helper authorized by the scope expansion;
- malformed or missing `substitutions` collections become unavailable rather
  than clean;
- active and archived blocking tests are mutation-capable;
- mounted navigation behavior is proved;
- selected Clear controls reference the guidance; and
- async, stale, timeout, and session coverage is strengthened.

The closure review returned **PASS**.

Final focused verification:

- `apps/admin/test/substitutionDuplicateGuidance.test.js`: **16/16 PASS**;
- Admin validation regression: **15/15 PASS**;
- Admin production build: **PASS**; and
- `git diff --check`: **PASS**.

Development runtime verification passed against exactly `wecooked-dev`.
Production was untouched. Runtime evidence established:

- active exact duplicate guidance: **PASS**;
- active existing-record navigation: **PASS**;
- archived duplicate guidance: **PASS**;
- archived navigation: **PASS**;
- reverse directed pair remains distinct: **PASS**;
- edit self-exclusion: **PASS**;
- edit-to-other-owned-pair blocking: **PASS**;
- live `SUBSTITUTION_ALREADY_EXISTS` recovery: **PASS**;
- recovery performed exactly one lookup;
- recovered existing status: **Active**;
- lookup failure behavior: **PASS**;
- accessibility spot check: **PASS**; and
- isolated lookup zero-mutation: **PASS**.

Stale-response manual runtime is not applicable because artificial delay was
not introduced; the mounted async regression remains authoritative.
Malformed-response manual runtime is also not applicable; focused automated
coverage remains authoritative.

Runtime cleanup restored `wecooked-dev` exactly:

- Ingredients: **23**;
- Substitutions: **5**;
- Users: **39**;
- Sessions: **262**;
- temporary Ingredients remaining: **0**;
- temporary Substitutions remaining: **0**;
- temporary Moderator remaining: **0**; and
- temporary Sessions remaining: **0**.

The final milestone scope is exactly:

- production: `apps/admin/src/SubstitutionsTab.jsx` and
  `apps/admin/src/substitutionApi.js`;
- test: `apps/admin/test/substitutionDuplicateGuidance.test.js`; and
- documentation:
  `docs/milestones/SUB-DUPLICATE-UX1-moderator-substitution-duplicate-guidance.md`.

Duplicate semantics remain exact ordered-pair only. `A -> B` and `B -> A`
remain distinct. Existing server and database uniqueness remain authoritative.
There are no backend, schema, or index changes; no automatic restore, edit, or
merge; no reciprocal inference; and no production mutation.

MongoDB credential rotation remains deferred security debt.

**SUB-DUPLICATE-UX1 CLOSURE PASS - READY FOR PR FINALIZATION**
