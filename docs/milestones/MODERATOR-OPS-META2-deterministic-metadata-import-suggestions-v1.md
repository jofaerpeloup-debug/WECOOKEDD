# MODERATOR-OPS-META2 - Deterministic Recipe Metadata Import Suggestions v1

**Contract date:** 2026-09-30

**Phase:** Implementation complete; independent review pending

**Branch:** `feat/moderator-ops-meta2-metadata-import-suggestions`

**Baseline:** `6f37a4628ed095886b636f14d6f22c05ae50360e`

**STATUS:** `IMPLEMENTATION COMPLETE - READY FOR INDEPENDENT REVIEW`

## 1. GOAL

Extend the existing Moderator-only Recipe JSON-LD intake preview with
deterministic, explicitly accepted suggestions for canonical Recipe category
and dietary tags. Preserve the existing paste/URL intake architecture and the
normal Draft save boundary.

Region source data is disclosed but does not produce a v1 suggestion because
the audited repository and domain contract do not support a safe
`recipeCuisine`-to-administrative-region crosswalk.

This milestone freezes a later implementation. It does not change application
or test code, persist data, stage, commit, push, or manipulate the Cook Mode
stash.

## 2. CURRENT VERIFIED STATE

- `main` and `origin/main` are aligned at
  `6f37a4628ed095886b636f14d6f22c05ae50360e`, the META1 merge.
- `packages/contracts/index.js` is the shared authority for the 18 Recipe
  regions, four Recipe categories, six dietary tags, and their display labels.
- The Admin Details form already holds controlled `region`, `category`, and
  `dietaryTags` values in ordinary authoring form state. `category` and `region`
  are optional scalars; `dietaryTags` is an array.
- `parseRecipeIntake` is the sole client mapping authority. Paste calls it
  directly. URL import returns one raw Recipe candidate, serializes it, and
  calls the same parser. URL import has no separate field mapper.
- Intake is mounted only for a new, unsaved Recipe. Preview and Apply mutate
  local form state only. Draft creation, step PATCH, and Publish remain separate
  explicit actions.
- The current parser classifies `recipeCuisine`, `recipeCategory`, and
  `suitableForDiet` as unsupported. The repository's focused intake fixture
  encounters scalar `"Filipino"`, `"Dinner"`, and `"VeganDiet"`
  respectively. No repository intake fixture establishes arrays,
  comma-separated categories, multiple categories, or regional cuisine names
  as supported input.
- Schema.org defines `recipeCategory` and `recipeCuisine` as Text. It defines
  `suitableForDiet` for Recipe/MenuItem with RestrictedDiet identities and uses
  canonical `https://schema.org/...` identifiers in JSON-LD examples:
  - <https://schema.org/recipeCategory>
  - <https://schema.org/recipeCuisine>
  - <https://schema.org/suitableForDiet>

## 3. CATEGORY MAPPING CONTRACT

The only category mappings are:

| Accepted source after normalization | Suggested canonical value |
| --- | --- |
| `breakfast` | `breakfast` |
| `lunch` | `lunch` |
| `dinner` | `dinner` |
| `snack` | `snack` |

Normalization is deliberately narrow:

1. The JSON-LD value must be one string.
2. Remove leading and trailing whitespace with JavaScript `trim()`.
3. Compare the resulting ASCII word case-insensitively.
4. Do not apply NFKC conversion, punctuation removal, stemming, synonym
   expansion, token splitting, or internal-whitespace collapse.

Therefore `" Breakfast "`, `"LUNCH"`, `"Dinner"`, and `"snack"` are
eligible. Empty strings, non-strings, arrays (including a one-item array),
comma-separated text, slash/semicolon lists, and compound wording are not
eligible. An array with multiple entries or a comma-separated value is reported
as ambiguous; another unsupported shape/value is reported as unsupported.

`Dessert`, `Soup`, `Main Course`, `Brunch`, `appetizer`, `entree`, `ulam`, and
every value outside the four META1 meal occasions remain unresolved. A source
containing both a canonical term and any additional word is not reduced to the
canonical term.

Category yields at most one suggestion.

## 4. DIETARY MAPPING CONTRACT

The only dietary mappings are:

| Exact Schema.org identity | Suggested canonical tag |
| --- | --- |
| `VegetarianDiet` | `vegetarian` |
| `VeganDiet` | `vegan` |
| `GlutenFreeDiet` | `glutenFree` |

Schema.org describes these as distinct RestrictedDiet members with canonical
identifiers:

- <https://schema.org/VegetarianDiet>
- <https://schema.org/VeganDiet>
- <https://schema.org/GlutenFreeDiet>

Each `suitableForDiet` item may use exactly one of these representations:

- the exact, case-sensitive bare member name, such as `VeganDiet`;
- the exact canonical HTTPS URL, such as
  `https://schema.org/VeganDiet`; or
- an object whose only key is `@id` and whose value is that exact canonical
  HTTPS URL.

Leading/trailing whitespace around a string is ignored. The member name and
URL are otherwise exact. HTTP URLs, `www` hosts, case variants, trailing
slashes, fragments, query strings, compact prefixes, relative IRIs, objects
with additional keys, and other text are unsupported; META2 does not implement
a JSON-LD context/IRI resolver.

A scalar item or a top-level array of items is accepted. Array items are
evaluated independently. A supported item can produce a suggestion even when a
different item is unsupported; all unsupported items remain disclosed.
Nested arrays and an empty array are unsupported. Duplicate canonical results
are deduplicated by tag while preserving first source occurrence. Multiple
different supported identities produce multiple independently accepted
suggestions in source order.

`LowLactoseDiet` is not mapped to `dairyFree`; Schema.org defines it as a diet
appropriate for lactose intolerance, not as an exact dairy-free identity:
<https://schema.org/LowLactoseDiet>. No mapping is frozen for `pescatarian`,
`dairyFree`, or `nutFree`. `VeganDiet` suggests only `vegan`; it does not imply
`vegetarian` or any other tag.

## 5. REGION MAPPING CONTRACT

META2 v1 freezes an empty region crosswalk.

`recipeCuisine` is Schema.org Text describing cuisine, while META1 Region is
one specific Philippine administrative region of Recipe/cuisine origin. The
live repository contains only the generic intake fixture `"Filipino"`; it
contains no audited imported corpus or approved source vocabulary proving that
external regional or locality wording carries the exact META1 meaning.

Consequently no `recipeCuisine` value suggests `region`, including:

- `Filipino`, `Philippine`, `Asian`, and `Southeast Asian`;
- `Luzon`, `Visayas`, and `Mindanao`;
- localities, provinces, cities, municipalities, barangays, and districts;
- demonyms/cuisine names such as `Ilocano`, `Bicolano`, `Kapampangan`, and
  `Cebuano`; and
- even text resembling a canonical Region slug or display label.

Present `recipeCuisine` input is recognized and disclosed as unsupported for
Region suggestion rather than being left as an unknown property. Arrays with
multiple values may additionally be labelled ambiguous, but no array member is
mapped. A future region crosswalk requires a separately audited explicit
source-value allowlist and a milestone amendment; it is not an implementation
blocker for Category and Dietary suggestions.

## 6. UNSUPPORTED / AMBIGUOUS BEHAVIOR

`parseRecipeIntake` remains fail-closed and gains a metadata-disclosure result
alongside the existing `mapped`, `unsupported`, `invalid`, and `unresolved`
collections. Each metadata disclosure identifies:

- source property;
- a safe display of the source JSON-LD value;
- status: `suggested`, `unsupported`, or `ambiguous`;
- canonical field/value/label only for `suggested`; and
- a fixed Moderator-safe explanation.

For display, a string is shown as JSON string text and any other value is shown
with `JSON.stringify`. Display text is capped at 200 characters with an
explicit truncation marker. The full input remains visible in the existing
textarea; disclosure must not render an object directly, inject markup, or add
remote content.

Metadata properties handled by this contract are not also repeated in the
generic unsupported list. Absence produces no disclosure. Empty/malformed
values never produce a suggestion. Unsupported or ambiguous metadata does not
make otherwise valid intake fail and does not block safe existing mappings,
ingredient resolution, or other independent dietary suggestions.

## 7. SOURCE DISCLOSURE

Reuse the existing Preview panel. Add a distinct `Metadata suggestions`
section and an `Unsupported or ambiguous metadata` section. Each suggested row
shows, in this order:

1. source property and safe source-value display;
2. arrow/text to the canonical field, slug, and shared display label;
3. the current acceptance state and an explicit acceptance control when
   eligible.

Unsupported/ambiguous rows show the source property/value, status, and fixed
reason, with no acceptance control. The UI must not claim that the source value
is verified, persisted, or semantically inferred.

## 8. MODERATOR ACCEPTANCE UX

- The existing `Apply blank fields` action continues to apply only the existing
  M27 mapped fields. It does not accept metadata suggestions.
- Every category or dietary suggestion has its own `Accept suggestion` button.
  Category acceptance is independent from every dietary tag; dietary tags are
  individually accepted.
- Selecting `Accept suggestion` calls the existing local `change(field, value)`
  path only after rechecking the current form. It makes no API request.
- A suggestion remains visually in Preview after acceptance but changes to a
  non-action state such as `Accepted in current form`. It is never presented as
  already saved.
- Ignoring means taking no action. No persistent Reject/Dismiss state or review
  queue is added. Replacing the paste source, importing a replacement URL, or
  closing the unsaved authoring flow removes the unaccepted preview.
- Source replacement clears the prior preview/application as today, so an old
  suggestion cannot be accepted from the rendered UI after a new candidate is
  previewed.
- Controls use native buttons, remain keyboard reachable, inherit the existing
  busy disablement, and expose text that identifies the canonical value.

## 9. NON-OVERWRITE RULES

Acceptance rechecks current form state at click time; preview-time state is not
trusted.

- **Category:** accept only when `form.category` is blank. Any existing
  Moderator value wins. If it already equals the suggestion, report `Already
  selected` without mutation. If it differs, report `Existing category
  preserved` and provide no enabled acceptance action.
- **Region:** no v1 suggestion exists and no Region mutation is possible.
- **Dietary tags:** never replace or remove the existing array. If the suggested
  tag is absent, append it once after all existing tags. If already present,
  report `Already selected` without mutation. Acceptance of one tag does not
  accept any other tag.
- A manual edit after Preview always wins. Accepting a stale suggestion must
  not overwrite a newly entered category or re-add/remove a tag contrary to
  the current form.

Accepted metadata is ordinary dirty local Details form state. Only the existing
Details Save Draft/PATCH path may persist it; Publish behavior is unchanged.

## 10. PASTE / URL PARITY

The architecture remains:

```text
Paste JSON-LD ------------------------------+
                                             |
URL -> existing server fetch/extract         |
    -> raw Recipe candidate -> JSON.stringify|
                                             v
                                  parseRecipeIntake
                                             |
                                common Preview/disclosure
                                             |
                         explicit per-suggestion acceptance
                                             |
                              local authoring form state
                                             |
                         normal Details Save Draft / PATCH
```

All normalization, mapping, status, and source-disclosure rules live in
`recipeIntake.js`. `recipeUrlImport.js`, the API URL-import route/service, and
the extractor remain transport/extraction only. They must not copy metadata
maps, normalize values, accept suggestions, or persist Recipe data.

## 11. EXACT IMPLEMENTATION ALLOWLIST

Only these production files may be modified by the later META2 implementation:

- `apps/admin/src/recipeAuthoring/recipeIntake.js`
- `apps/admin/src/recipeAuthoring/RecipeAuthoringSteps.jsx`

The implementation reuses the shared metadata options/labels already exposed
by `apps/admin/src/recipeOptions.js` and existing intake/button/preview styles;
that file and CSS are not allowlisted. No backend, contract, model, schema,
validation, serializer, API, mobile, package, lockfile, URL-import, authoring
state/save, or migration file is allowlisted.

If compliant behavior requires another production file, stop and amend this
milestone before editing.

## 12. EXACT TEST ALLOWLIST

Only these tests may be modified by the later META2 implementation:

- `apps/admin/test/recipeIntake.test.js`
- `apps/admin/test/recipeIntakeIntegration.test.js`
- `apps/admin/test/recipeUrlImport.test.js`

Required coverage:

- all four category successes with casing/surrounding-whitespace variants;
- category empty/non-string/array/comma/list/compound/unsupported cases and no
  partial-token matches;
- every accepted dietary representation, scalar/array behavior, order and
  deduplication;
- exact rejection of HTTP/case/trailing/query/fragment/prefix/extra-object-key
  near misses;
- no `LowLactoseDiet`, `pescatarian`, `dairyFree`, or `nutFree` inference and
  no Vegan-to-Vegetarian implication;
- empty Region suggestion set for generic, island-group, locality, demonym,
  canonical-looking, array, and non-string cuisine input;
- bounded/escaped source disclosure and suggested/unsupported/ambiguous status;
- rendered explicit acceptance, ignored suggestions, accepted-state display,
  busy controls, and source replacement;
- category click-time non-overwrite and tag append-only/idempotent behavior;
- zero fetch/create/PATCH/publish/upload calls during Preview, Apply, or
  acceptance;
- URL and paste candidates producing identical metadata parser results; and
- ordinary Details payload generation persisting only metadata explicitly
  accepted into local form state.

Existing `recipeMetadataContract.test.js`, authoring-state/model suites, and API
URL-import suites are regression commands only and are not thereby allowlisted
for modification.

## 13. RUNTIME GATES

Automated implementation gates:

```text
node --test --test-isolation=none apps/admin/test/recipeIntake.test.js apps/admin/test/recipeIntakeIntegration.test.js apps/admin/test/recipeUrlImport.test.js
node --test --test-isolation=none apps/admin/test/recipeMetadataContract.test.js apps/admin/test/recipeAuthoringModel.test.js apps/admin/test/recipeAuthoringState.test.js
npm run build --workspace=apps/admin
git diff --check
```

Manual browser/runtime gates for both paste and URL intake:

1. Confirm source value, canonical suggestion, and unsupported/ambiguous status
   are legible and visually distinct from form controls and saved data.
2. Confirm no metadata changes on Preview or `Apply blank fields` alone.
3. Accept category and tags individually; confirm only eligible local fields
   change and existing values remain untouched.
4. Change the source and verify old suggestions/actions disappear.
5. Verify keyboard operation, focus visibility, accessible button names,
   screen-reader ordering/status, narrow viewport layout, dark mode, and browser
   console cleanliness.
6. Use Save Draft on Details and verify only then does the existing PATCH carry
   accepted values. Confirm ignored/unsupported values never enter the request.

Automated/static tests do not constitute browser, accessibility, or live URL
runtime proof. Live public-provider behavior is not required to prove mapping
parity because both sources converge on the same raw-candidate parser, but the
existing URL1 controlled-runtime gates remain applicable.

## 14. IN SCOPE

- deterministic Category suggestions for the four META1 values;
- deterministic Dietary suggestions for three exact Schema.org identities;
- explicit per-suggestion Moderator acceptance into local form state;
- source value and suggested/unsupported/ambiguous disclosure;
- click-time non-overwrite and tag append-only behavior;
- one parser authority and paste/URL parity;
- an explicitly empty Region mapping contract for v1;
- exact implementation/test allowlists and future gates; and
- this milestone document only.

## 15. OUT OF SCOPE

- automatic acceptance or persistence;
- fuzzy matching, token guessing, synonyms, AI/LLM classification, or semantic
  inference;
- a Region crosswalk, locality lookup, geocoder, demonym mapping, or inference
  from title, description, ingredients, author, URL host, or source location;
- META1 vocabulary expansion, new Recipe fields, schema changes, migrations,
  or backfills;
- remote image import, YIELD1/servings changes, nutrition, duplicate logic,
  Ingredient resolution/creation changes, or Filipino-cuisine confirmation;
- a second intake system, durable suggestion/rejection state, or Recipe Review
  Queue;
- API/mobile/package/lockfile changes; and
- staging, committing, pushing, branch operations, or stash manipulation.

## 16. RISKS / BLOCKERS

- **No implementation blocker:** Category and Dietary suggestions can ship
  within the two production files while Region remains unsupported.
- `recipeCategory` is free Text whose ordinary Schema.org examples include
  course terms such as appetizer/entree; META2 must resist widening WeCooked's
  distinct meal-occasion vocabulary.
- JSON-LD supports broader context/IRI representations than this v1 parser. The
  narrow accepted diet forms are intentional; adding context resolution would
  be a separate parser/security scope.
- Dietary tags can be interpreted as health/allergen assurances. UI copy must
  call them source suggestions requiring Moderator acceptance, never verified
  safety claims.
- The existing intake UI is local component state. Rendered interaction tests
  must cover source replacement and click-time form rechecks so a stale closure
  cannot overwrite Moderator work.
- A future Region suggestion milestone remains blocked on explicit product/domain
  evidence for each source-to-canonical pair; this does not block META2 v1.

## 17. IMPLEMENTATION EVIDENCE

Implemented on
`feat/moderator-ops-meta2-metadata-import-suggestions` from the frozen baseline
`6f37a4628ed095886b636f14d6f22c05ae50360e`.

Production changes remain limited to the exact two-file allowlist. The shared
parser now emits bounded metadata disclosures for Category, Dietary tags, and
unsupported/ambiguous Region source information. The Preview UI renders source
values separately from canonical suggestions and requires an individual local
acceptance action for every eligible value. Category acceptance rechecks blank
state; dietary acceptance appends once; `Apply blank fields` remains metadata-
neutral; and no Preview/Apply/acceptance path invokes persistence.

Test changes remain limited to the exact three-file allowlist. Verification on
2026-09-30:

- focused frozen command: 51 passed, 0 failed;
- metadata-contract/authoring-model/authoring-state regressions: 28 passed,
  0 failed;
- Admin production build: passed (existing Vite dynamic-import and chunk-size
  warnings only); and
- `git diff --check`: passed.

The Vite-backed test and build commands required execution outside the Windows
sandbox after the sandbox denied helper-process creation with `spawn EPERM`.
No dependency or generated-file change was made. Manual browser, keyboard,
screen-reader, responsive, dark-mode, console, and live save/PATCH runtime gates
remain for the later runtime-verification phase; automated/static results do not
claim those gates.

No files were staged, committed, or pushed. The protected Cook Mode stash was
not inspected or manipulated.

## 18. FINAL VERDICT

**META2 IMPLEMENTATION COMPLETE - READY FOR INDEPENDENT REVIEW**
