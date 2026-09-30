# MODERATOR-OPS-YIELD1 - Deterministic Recipe Yield / Servings Normalization v1

Status: runtime passed - ready for finalization

Audit date: 2026-09-30

Audited branch: `main`

Audited commit: `bc6f5129761cda41931497130eadded6fd62f30a`

Application code status: read-only during this audit; only this milestone
document was created

## 1. Goal and verdict

Prevent Schema.org `recipeYield` values that describe loaves, cookies, cakes,
or another produced item from being mapped into the WeCooked Recipe
`servings` field. Preserve only a small, deterministic vocabulary that
explicitly describes servings or people.

This is an Admin intake normalization correction. It does not change Recipe
storage, API validation, URL retrieval, Recipe publication, mobile scaling, or
the existing explicit Save Draft/PATCH/Publish lifecycle.

Verdict: **YIELD1 AUDIT PASS — READY FOR IMPLEMENTATION**.

## 2. Audit boundary and authorities

The audit inspected the live repository at the commit above, including:

- `apps/admin/src/recipeAuthoring/recipeIntake.js` as the sole M27 JSON-LD
  mapping and blank-only Apply authority;
- `apps/admin/src/recipeAuthoring/recipeUrlImport.js` as the URL1 bridge into
  that same parser;
- the Admin intake, integration, URL-import, and authoring-model tests;
- the Recipe model, request validation, service completeness checks,
  serializer, and focused API tests; and
- the META1 milestone only for its recorded servings finding: the current
  parser misclassifies one-number non-person yields and deferred the correction
  to YIELD1.

No application file, test, package, lockfile, migration, database record, or
stash was changed. The Cook Mode stash was listed only; it was not inspected,
applied, popped, dropped, or otherwise manipulated.

## 3. Verified current parser behavior

`parseRecipeIntake` currently handles `recipeYield` as follows:

1. A JavaScript number is accepted by the extractor when it is a safe integer.
2. A string is trimmed and NFKC-normalized.
3. The extractor rejects a limited set of spelled-number, sign, fraction,
   decimal, and range patterns.
4. It then accepts any remaining string containing exactly one ASCII decimal
   digit run.
5. The caller maps the extracted number only when it is from 1 through the
   mirrored `MAX_SERVINGS` value of 100.

The string grammar is not anchored to a servings/person vocabulary. That is
why approximation text and arbitrary product nouns currently pass whenever
they contain one otherwise-valid integer.

For a structurally valid Recipe object, an invalid `recipeYield` does not make
the whole preview fatal: `result.ok` stays `true`, no `values.servings` key is
created, and `invalid` receives:

```text
recipeYield: Expected one positive whole number from 1 to 100.
```

Other valid source fields may still preview and apply. A missing
`recipeYield` is ignored without an invalid entry. A present blank string,
`null`, boolean, object, array, non-integer number, or out-of-bounds number is
invalid and does not map. Malformed JSON is a fatal preview error and Apply is
a no-op.

## 4. Required audit matrix

Direct execution of the live parser produced this baseline. The YIELD1 column
is the frozen implementation requirement.

| `recipeYield` | Current parser | YIELD1 decision |
| --- | --- | --- |
| `"4"` | maps `servings: 4` | reject as unitless/ambiguous |
| `"4 servings"` | maps `servings: 4` | accept and map `4` |
| `"Serves 4"` | maps `servings: 4` | accept and map `4` |
| `"6 people"` | maps `servings: 6` | accept and map `6` |
| `"1 loaf"` | maps `servings: 1` | reject as a non-person yield |
| `"12 cookies"` | maps `servings: 12` | reject as a non-person yield |
| `"Makes 2 cakes"` | maps `servings: 2` | reject as a non-person yield |
| `"4-6 servings"` | invalid; does not map | reject as a range |
| `"4–6 servings"` | invalid; does not map | reject as a range |
| `"about 4 servings"` | maps `servings: 4` | reject as approximate |
| `"serves four"` | invalid; does not map | reject; no word-number inference |

The same unitless rule applies to JSON numeric `recipeYield: 4`: it currently
maps, but YIELD1 must reject it because the source supplies no person/serving
semantics. This intentional safety tightening is limited to imported preview
suggestions; it does not make numeric `Recipe.servings` invalid.

## 5. Frozen YIELD1 accepted contract

### 5.1 Normalization

Only string `recipeYield` values are eligible in v1. Before matching, trim
leading/trailing whitespace and apply Unicode NFKC normalization. Matching is
case-insensitive. Token separators may be one or more whitespace characters.
Do not delete punctuation, qualifiers, nouns, or any other source text to make
a value match.

Let `N` be one ASCII decimal whole-number token after normalization whose
numeric value is from 1 through 100. Leading zeroes do not change its numeric
value; the same 1-100 bound remains authoritative.

### 5.2 Exact accepted forms

The entire normalized string must match one of these forms:

```text
N serving
N servings
N person
N people
serves N
serves N serving
serves N servings
serves N person
serves N people
makes N serving
makes N servings
```

Examples that safely map include `1 serving`, `4 servings`, `1 person`,
`6 people`, `Serves 4`, `Serves 4 people`, and `Makes 100 servings`.
Singular/plural agreement is not used as a second inference rule: every listed
noun explicitly denotes a person/serving count, and the numeric range remains
authoritative.

No synonym is implied. In particular, `portion`, `plate`, `guest`, and `feed`
are not accepted vocabulary in v1.

## 6. Frozen rejected and ambiguous contract

Every present `recipeYield` that is not an exact accepted string is reported as
invalid and contributes no `values.servings` entry. It must never be treated as
unsupported, silently coerced, or mapped to another Recipe field.

The following are rejected:

- bare/unitless strings and JSON numbers, including `"4"` and numeric `4`;
- non-person output nouns such as loaf/loaves, cookie/cookies, cake/cakes,
  batch/batches, piece/pieces, jar/jars, and pan/pans;
- any unlisted noun, even if it might sometimes mean a portion;
- ranges expressed with ASCII hyphen, en dash, em dash, `to`, `through`, `or`,
  or any other range notation;
- approximate/qualified counts such as `about`, `approximately`, `approx.`,
  `around`, `up to`, `at least`, or `~`;
- fractions, decimals, mixed numbers, negative/signed values, zero, and values
  over 100;
- word numbers such as `four`, multiplicative words such as `dozen`, and any
  value containing more than one numeric token;
- punctuation-bearing or extra-text variants that do not match the complete
  accepted grammar; and
- arrays, booleans, `null`, objects, and Schema.org `QuantitativeValue` objects.

YIELD1 does not choose a range endpoint, midpoint, average, floor, or ceiling.
It does not parse word numbers, perform unit conversion, or infer meaning from
arbitrary nouns. `QuantitativeValue` support may be audited in a later
milestone; v1 fails closed rather than creating another partially supported
shape.

The invalid preview message should describe the actual accepted contract, for
example:

```text
Expected an exact serving/person count from 1 to 100, such as "4 servings" or "Serves 4".
```

## 7. M27 and URL1 Preview/Apply behavior

The existing shared path remains:

```text
pasted JSON-LD Recipe
  OR URL1 { sourceUrl, candidate }
    -> JSON.stringify(candidate) for URL1
    -> parseRecipeIntake
    -> local Preview categories
    -> explicit Apply blank fields
    -> local authoring form only
    -> explicit existing Save Draft / PATCH / Publish
```

URL1 must continue to call `parseRecipeIntake(input)` and must not add a
server-side yield mapper. Paste and URL imports therefore receive identical
YIELD1 behavior. URL retrieval remains a preview operation and does not mutate
a Recipe.

For accepted yields, Apply converts the mapped number to the existing form
string and fills `form.servings` only when its current normalized value is
blank. Any nonblank Moderator-entered value is preserved and reported as
skipped. Repeated Apply cannot replace the now-nonblank value.

For rejected yields, no servings value exists to apply. Existing Moderator
servings remain untouched, and a blank servings field remains blank. Rejection
must not clear a value, generate a default, or block other independently valid
preview fields.

Preview and Apply remain local-only. They must not call create Draft, PATCH,
Publish, upload, Ingredient mutation, or any generic persistence API. A mapped
servings suggestion can reach persistence only after explicit existing
authoring actions and validation.

## 8. Existing Recipe servings contract and schema impact

The persisted/API contract is unchanged:

- `Recipe.servings` is a number constrained by Mongoose to an integer from 1
  through 100 when present.
- The strict API Zod schema uses the same integer and range limits.
- Draft creation may omit servings.
- Complete Published Recipe creation and the publication completeness check
  require servings.
- PATCH accepts omission as unchanged, a bounded integer as replacement, and
  `null` as a Draft-only clear. The service prevents a Published Recipe from
  becoming incomplete.
- Admin authoring uses a numeric 1-100 input and matching client validation.
- The serializer returns the stored number; mobile consumers continue using
  that authoritative number for Recipe display/scaling.

YIELD1 requires no Recipe model, Zod schema, service, repository, controller,
route, serializer, shared contract, Admin form-model, mobile, migration, index,
package, lockfile, or environment change. It adds no serving-range schema and
no Recipe field. Existing stored values cannot reveal whether their historical
source was a person count or a product count, so this prevention milestone must
not guess at or automatically rewrite old Recipes.

## 9. Exact implementation allowlist

Production implementation is limited to:

```text
apps/admin/src/recipeAuthoring/recipeIntake.js
```

The change must replace only the `recipeYield` extraction/validation behavior
needed for the frozen grammar and its invalid message. Existing Recipe
selection, other field mapping, preview categories, apply order, blank-only
logic, and handler mutation boundaries remain unchanged.

If implementation requires any other production file, stop and amend/re-audit
this milestone before coding.

## 10. Exact test allowlist

Implementation-time test edits are limited to:

```text
apps/admin/test/recipeIntake.test.js
apps/admin/test/recipeIntakeIntegration.test.js
apps/admin/test/recipeUrlImport.test.js
```

No new test file is required. Tests must cover, at minimum:

1. Every value in the required matrix in section 4, asserting both the mapped
   value or its absence and the `recipeYield` invalid classification.
2. JSON numeric `4`, absent `recipeYield`, blank/whitespace, `null`, boolean,
   array, object/`QuantitativeValue`, zero, 101, decimal, fraction, sign, and
   multiple-number rejection.
3. Case and surrounding-whitespace normalization for every accepted grammar
   family, plus 1 and 100 boundaries.
4. Exact accepted vocabulary and rejection of unlisted synonyms/nouns.
5. Blank servings receives an accepted imported count; a nonblank
   Moderator-entered servings value is preserved and reported as skipped.
6. A rejected yield neither fills nor clears servings and does not prevent
   another valid field from applying.
7. Preview/Apply performs no persistence call.
8. A raw URL1 candidate passes through the sole M27 parser so safe and rejected
   yields have the same classifications as pasted JSON-LD.

Existing API and authoring tests below are regression commands only and are not
allowlisted for modification.

## 11. Runtime and verification plan

Implementation verification must run:

```text
node --test --test-isolation=none apps/admin/test/recipeIntake.test.js apps/admin/test/recipeIntakeIntegration.test.js apps/admin/test/recipeUrlImport.test.js
node --test --test-isolation=none apps/admin/test/recipeAuthoringModel.test.js apps/admin/test/recipeAuthoringState.test.js apps/admin/test/recipeAuthoringApiContract.test.js apps/admin/test/portalPolicy.test.js
node --test --test-isolation=none apps/api/test/recipe-model.test.js apps/api/test/recipe-validation.test.js apps/api/test/recipe-authoring.test.js
npm run build --workspace=apps/admin
git diff --check
git status --short --branch
```

Then perform an authenticated Moderator browser check against the real Staff
Portal/API:

1. On a new Recipe, paste each section 4 value and confirm the Preview maps only
   the three explicit person-count examples.
2. With servings blank, Apply `"4 servings"` and confirm local form value `4`.
3. Enter a Moderator value such as `8`, preview/apply `"6 people"`, and confirm
   `8` remains with the existing-value-preserved result.
4. With servings blank, preview/apply `"12 cookies"` and confirm the invalid
   warning, no servings fill, and no Recipe mutation request in the network
   log.
5. Use controlled URL-import fixtures containing one accepted yield and one
   non-person yield; confirm the same Preview decisions and that import itself
   performs only the existing import request.
6. Explicitly save only after reviewing the form. Confirm an accepted applied
   value persists through the existing Draft/PATCH path, while a rejected blank
   value remains a Draft blocker for Publish until the Moderator supplies a
   valid serving count.

No Android/device, Cook Mode, physical-cooking, migration, or live-data repair
claim is required because the production change is confined to the Admin
intake parser and leaves downstream Recipe contracts unchanged. Do not claim
browser or URL-fixture runtime verification until it is actually performed.

## 12. Audit-time verification evidence

The required matrix was executed directly against the live
`parseRecipeIntake`. It confirmed the current results in section 4, including
the three unsafe noun mappings and unsafe approximation mapping.

Focused current-baseline tests:

```text
node --test --test-isolation=none apps/admin/test/recipeIntake.test.js apps/admin/test/recipeIntakeIntegration.test.js
```

Result: 21 passed, 0 failed.

The Vite-backed URL-import test did not start/terminate correctly in the
sandboxed combined invocation. The identical focused command was rerun outside
the sandbox:

```text
node --test --test-isolation=none apps/admin/test/recipeUrlImport.test.js
```

Result: 11 passed, 0 failed. This distinction is environment evidence, not a
product failure.

Focused Recipe persistence/request regression:

```text
node --test --test-isolation=none apps/api/test/recipe-model.test.js apps/api/test/recipe-validation.test.js apps/api/test/recipe-authoring.test.js
```

Result: 98 passed, 0 failed.

No authenticated browser, controlled live URL fixture, Android/device, or
database mutation was performed during this read-only audit.

## 13. Explicit non-goals

YIELD1 does not introduce:

- AI, LLM extraction, probabilistic classification, or noun inference;
- a serving-range schema, range selection, or a new Recipe field;
- unit conversion or output-unit storage;
- word-number parsing or locale-wide natural-language parsing;
- `QuantitativeValue` support;
- automatic overwrite of Moderator-entered servings;
- backend URL-import mapping, persistence during Preview/Apply, or a second
  parser;
- migration or guessed repair of existing Recipe records; or
- package/dependency changes.

## 14. Blockers and residual risk

There is no blocker to the narrow implementation inside the exact allowlists.

Residual risk is explicit: already-persisted numeric servings have no source
provenance, so the repository cannot deterministically identify historical
loaf/cookie/cake misclassifications. Any live-data assessment or repair would
require a separate read-only data audit and separately approved remediation.
It is not part of YIELD1 and must not delay preventing new unsafe mappings.

## 15. Git and stash state

At audit start:

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
?? docs/milestones/MODERATOR-OPS-META1-canonical-recipe-metadata-contract-v1.md
```

Those pre-existing untracked files were preserved. This milestone adds only:

```text
?? docs/milestones/MODERATOR-OPS-YIELD1-recipe-yield-servings-normalization-v1.md
```

Stash list:

```text
stash@{0}: On feat/cook-mode-timer-ui: WIP cook mode timer UI
```

The Cook Mode stash was not manipulated.

## 16. Implementation evidence

Implementation date: 2026-09-30

Implementation branch: `feat/moderator-ops-yield1-servings-normalization`

Baseline: `bc6f5129761cda41931497130eadded6fd62f30a`

The production change is confined to
`apps/admin/src/recipeAuthoring/recipeIntake.js`. It replaces the permissive
single-number extraction with the frozen anchored serving/person grammar after
trim and Unicode NFKC normalization. Numeric and other non-string values fail
closed. The existing 1-100 bound, invalid classification, shared paste/URL
parser, blank-only Apply behavior, and Recipe persistence contract remain
unchanged.

Focused coverage was added only in the three approved test files. It covers
all accepted forms, the section 4 matrix, 1/100 boundaries, leading zeroes,
case and whitespace normalization, unsupported shapes and vocabulary,
non-person yields, ranges, approximations, fractions/decimals, word and
multiple-number values, and blank-only/non-overwrite behavior through paste
and URL-import previews.

Verification results:

```text
Focused Admin intake/integration/URL import: 37 passed, 0 failed
Admin authoring/policy regression: 31 passed, 0 failed
API Recipe regression: 98 passed, 0 failed
Admin production build: passed (1653 modules transformed)
```

The focused command and Admin build required identical outside-sandbox reruns:
the sandboxed Vite-backed test did not terminate, and sandboxed esbuild failed
to spawn with `EPERM`. Both completed successfully outside the sandbox. The
build reported only the pre-existing dynamic/static import and chunk-size
warnings.

No authenticated browser or controlled live URL-fixture runtime check was
performed during implementation. No file was staged, committed, or pushed,
and the protected Cook Mode stash was not inspected or manipulated.

Implementation verdict: **YIELD1 IMPLEMENTATION COMPLETE — READY FOR
INDEPENDENT REVIEW**.

## 17. Runtime gate disposition

Runtime date: 2026-09-30

The original runtime report recorded **FAIL** because the manual browser
non-overwrite scenario in section 11 could not be completed. That browser gate
was incorrectly specified for the current product architecture:

- Recipe intake is available only before Draft creation.
- The normal servings control is reachable only after Draft creation.
- Intake disappears after the Draft exists.

Consequently, the current UI exposes no user path that can first establish an
existing manually entered servings value and then run JSON-LD intake. The
manual browser sequence `existing servings -> JSON-LD intake -> Apply` is
therefore **N/A in the current UI architecture**, not a YIELD1 parser failure.
YIELD1 must not add UI solely to expose this test.

The non-overwrite invariant is unchanged and remains required: Apply must
never replace a nonblank Moderator-entered servings value. It has passed at
all applicable layers:

- direct behavioral tests;
- integration tests; and
- the live application Apply handler with servings already set to `8`, which
  preserved `8` and reported `Existing value preserved`.

All user-reachable runtime checks passed:

- valid pasted JSON-LD yield mapped and applied correctly;
- rejected non-person pasted yield remained invalid and did not fill servings;
- controlled URL-import yield followed the shared parser decisions;
- Preview and Apply remained local-only;
- normal explicit Draft persistence succeeded; and
- runtime and network behavior remained sane.

The original FAIL is superseded by this architecture-corrected disposition.
No production or test change was required for the disposition; only this
milestone documentation was updated. The non-overwrite requirement is not
waived or weakened, and no UI was added to manufacture reachability.

## 18. Final verdict

**YIELD1 RUNTIME PASS — READY FOR FINALIZATION**
