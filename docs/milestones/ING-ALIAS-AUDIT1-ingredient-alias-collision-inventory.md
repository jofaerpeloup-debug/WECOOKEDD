# ING-ALIAS-AUDIT1 - Ingredient Alias Collision Inventory

## 1. Goal and baseline

Freeze the smallest read-only extension of the existing M23 catalog consistency
audit that inventories exact normalized Ingredient alias collisions. The audit
reports ambiguity for later Moderator-policy decisions; it does not identify a
winner, repair data, or change write-time behavior.

The audited live-repository baseline is `main` at
`f3656596fd7db98713947161f442531c10e61c82`, aligned with `origin/main`.

This milestone is a contract freeze only. No application or audit
implementation and no live database scan is authorized here.

## 2. Existing authority and protections

### 2.1 Canonical Ingredient identity

`apps/api/src/modules/ingredients/ingredient.model.js` is the sole Ingredient
schema. It declares required `name`, required internal `normalizedName`,
`aliases`, `category`, `allergenTags`, and `isActive` fields. The schema:

- trims canonical names and limits them to 100 characters;
- requires `normalizedName`, excludes it from default projections, and declares
  a unique ascending index on it;
- trims alias array items, limits each alias to 100 characters, and limits the
  array to 20 values;
- has no alias index and no schema-level uniqueness rule for aliases.

`ingredient.service.js` derives `normalizedName` on both create and rename by
trimming, lowercasing, and collapsing whitespace. MongoDB's unique
`normalizedName` index therefore rejects canonical names that differ only by
case or spacing, and the service maps duplicate-key failures to the stable
`INGREDIENT_ALREADY_EXISTS` conflict. Existing model, service, and route tests
lock these behaviors.

Canonical-to-canonical duplication is already protected by this authority and
is not a collision type in ING-ALIAS-AUDIT1. This milestone does not create a
second canonical duplicate detector, index, or enforcement path. The later
runtime inventory is not evidence that a particular deployment has the
declared index unless that index is verified separately; this audit neither
creates nor repairs indexes.

### 2.2 Alias normalization and deduplication

The create/update service normalizes each submitted alias by trimming and
collapsing whitespace, deduplicates case-insensitively within that Ingredient,
and preserves the first-seen display spelling. Request validation rejects
blank aliases and enforces the existing count and length bounds.

Those service guarantees cover normal current writes. They do not make aliases
unique across Ingredients, compare aliases with canonical names, or reject a
self-alias. The Mongoose array schema also does not enforce normalized alias
uniqueness, so direct, historical, or otherwise corrupt stored documents can
still contain duplicate normalized aliases within one Ingredient. Collision D
therefore remains applicable as a legacy/corrupt-data observation only.

### 2.3 ING1 resolver behavior

The implemented ING1 resolver reads the complete active Ingredient catalog
with only `_id`, `name`, `aliases`, and `category`, sorted by
`normalizedName` and `_id`. Its exact matcher normalizes names and aliases by
trim, lowercase, and whitespace collapse. It counts each Ingredient once,
prefers canonical evidence within one Ingredient, and returns `ambiguous` when
an exact normalized value belongs to more than one active Ingredient.

ING1 is advisory resolution for supplied source lines, not a catalog
inventory. It excludes archived Ingredients and its one-candidate-per-
Ingredient behavior deliberately does not expose self-aliases or duplicate
aliases within one stored Ingredient. ING-ALIAS-AUDIT1 reuses its exact
normalization semantics but does not change its endpoint or matching behavior.

### 2.4 M23 catalog consistency audit and latest catalog-gap evidence

`apps/api/scripts/audit-catalog-consistency.js` is the existing read-only audit
command (`npm run audit:catalog --workspace=apps/api`). It uses raw projected
MongoDB reads, connects with `autoIndex: false` and `autoCreate: false`, emits
deterministically sorted human or JSON reports, and has tests that fail if a
write or index-creation method is called. It currently reads Recipes,
Substitutions, and only the Ingredients referenced by those records; a complete
projected Ingredient read is therefore required for an alias inventory.

The latest Moderator catalog-gap audit,
`docs/milestones/M27-moderator-content-operations-audit.md`, already records
that canonical normalized-name uniqueness exists while cross-Ingredient alias
uniqueness and alias-to-canonical checks do not. ING1 later made active-catalog
ambiguity visible during explicit resolution, but it did not add catalog-wide
alias enforcement. This milestone fills only the read-only inventory gap.

## 3. Frozen collision definitions

Every collision is evaluated by one non-empty normalized value. A document may
participate in more than one collision type for the same value; each applicable
type is reported separately.

### A. `ALIAS_TO_CANONICAL`

At least one alias on an Ingredient normalizes to the canonical name of a
different Ingredient. The alias owner and every different matching canonical
owner participate. An alias equal to its own Ingredient's canonical name is
excluded here and reported as type C.

### B. `ALIAS_TO_ALIAS`

Aliases on at least two different Ingredient IDs normalize to the same value.
All cross-Ingredient alias owners participate. Multiple occurrences within
only one Ingredient do not satisfy type B; they are type D.

### C. `SELF_ALIAS_TO_CANONICAL`

An Ingredient alias normalizes to that same Ingredient's canonical name. The
canonical occurrence and every matching alias occurrence on that Ingredient
participate.

### D. `DUPLICATE_ALIASES_WITHIN_INGREDIENT`

At least two stored alias entries on the same Ingredient normalize to the same
value. This reports legacy/corrupt stored data that bypassed or predates the
current service deduplication. It does not add write-time enforcement.

Canonical-to-canonical equality is deliberately not an ING-ALIAS-AUDIT1
collision. Empty/non-string malformed values do not participate in collision
classification; auditing general malformed Ingredient documents is separate
work.

## 4. Frozen normalization rules

Use the existing ING1 exact-name normalizer from
`ingredient-resolution.js`; do not add a competing normalizer. For canonical
names and aliases:

1. Convert the stored value to its string representation only after confirming
   it is a string.
2. Trim leading and trailing whitespace.
3. Lowercase with JavaScript `toLowerCase()`.
4. Collapse every internal JavaScript whitespace run (`\s+`, Unicode mode) to
   one ASCII space.
5. Ignore an empty result for collision purposes.

Case and whitespace variants therefore form one value. Do not strip
punctuation, remove diacritics, stem, singularize/pluralize, transliterate,
apply locale-specific folding, infer synonyms, or use fuzzy/semantic matching.
Array position and original display spelling do not change equality.

Canonical comparison is recomputed from the canonical display `name` with the
same normalizer. The audit does not expose `normalizedName` and does not turn
stored-key drift or canonical duplication into a new collision class.

## 5. Frozen report shape and ordering

Extend the existing catalog audit report rather than creating another command.
Keep the existing `findings`, `summary`, exit-code rules, counts, observation,
and human sections semantically intact. Add these top-level fields to the JSON
report and an equivalent bounded section to the human report:

```json
{
  "ingredientAliasCollisionSummary": {
    "total": 1,
    "affectedIngredients": 2,
    "byType": {
      "ALIAS_TO_CANONICAL": 1,
      "ALIAS_TO_ALIAS": 0,
      "SELF_ALIAS_TO_CANONICAL": 0,
      "DUPLICATE_ALIASES_WITHIN_INGREDIENT": 0
    }
  },
  "ingredientAliasCollisions": [
    {
      "normalizedValue": "scallion",
      "collisionType": "ALIAS_TO_CANONICAL",
      "participants": [
        {
          "ingredientId": "...",
          "canonicalName": "Green Onion",
          "status": "active",
          "source": "alias",
          "sourceValue": "scallion",
          "sourceIndex": 0
        },
        {
          "ingredientId": "...",
          "canonicalName": "Scallion",
          "status": "archived",
          "source": "canonical",
          "sourceValue": "Scallion"
        }
      ]
    }
  ]
}
```

`status` is `active` for stored `isActive === true`, `archived` for
`isActive === false`, and `unknown` only when corrupt/missing state makes either
claim unsafe. `sourceIndex` is present only for an alias and identifies its
stored array position, including duplicate occurrences. No category,
allergens, timestamps, internal `normalizedName`, Recipe/Substitution content,
or other document fields may enter these collision records.

One record represents one normalized value plus one collision type. Participants
contain only the occurrences relevant to that type. Summary totals count
collision records, not pairwise combinations; `affectedIngredients` counts
distinct Ingredient IDs across all collision records. This grouping reports
ambiguity without implying which Ingredient is correct.

Order collision records by normalized value, then by the frozen type order A,
B, C, D. Within a record, order participants by printable Ingredient ID,
canonical before alias, normalized source value, exact source value, and alias
array index. Object/map construction must not affect output. Existing M23
findings retain their current deterministic order.

Because the JSON contract gains fields, increment the audit `schemaVersion`
from 1 to 2. Alias collisions are inventory observations, not enforcement
errors: they do not enter the existing severity `findings` array, do not change
its summary, and do not change the command exit code. Existing M23 errors still
control exit code exactly as before.

## 6. Read-only guarantee

Implementation and every later runtime execution must:

- use only projected `find`/`countDocuments`-style reads already allowed by the
  M23 audit architecture;
- keep `autoIndex: false` and `autoCreate: false`;
- call no model or collection create, insert, update, replace, bulk-write,
  delete, index-create/drop/sync, migration, or repair operation;
- modify no Ingredient, Recipe, or Substitution;
- perform no merge, delete, rename, archive, restore, or winner selection;
- create no migration and no index;
- remain non-transactional observation with the existing rerun-before-
  remediation warning; and
- fail safely on connection/read/formatting errors through the existing M23
  error path.

The complete Ingredient scan must project only `_id`, `name`, `aliases`, and
`isActive`. It must include active and archived Ingredients. No database write
credential is logically required by the audit, and production use should use a
read-only database principal when available.

## 7. Exact implementation allowlist

The cleanest and smallest implementation is a pure classifier added directly
to the existing audit script and reused by that command. A second command or a
new general-purpose helper is not justified by this bounded logic.

Production:

```text
apps/api/scripts/audit-catalog-consistency.js                       (modify)
```

Documentation:

```text
docs/milestones/ING-ALIAS-AUDIT1-ingredient-alias-collision-inventory.md (already created; implementation-status updates only)
```

No other production or documentation file is allowlisted. If implementation
requires another file, stop and amend this contract before editing it.

## 8. Exact test allowlist and contract

```text
apps/api/test/catalog-consistency-audit.test.js                     (modify)
```

Focused tests must prove:

- alias-to-different-canonical collision detection;
- alias-to-alias detection across different Ingredients;
- case and whitespace normalization, with variants grouped once;
- a self-alias matching its own canonical name is detected as type C;
- duplicate normalized aliases within one stored Ingredient are detected as
  type D, including distinct stored occurrences;
- unrelated aliases produce no collision records;
- active, archived, and fail-closed unknown ownership statuses are reported;
- collision records and participants are deterministic across shuffled
  document input while alias source positions remain accurate;
- output contains only the frozen collision fields;
- the complete Ingredient read uses only the frozen projection and includes
  active plus archived records;
- collection/model write and index-mutation methods are never invoked,
  including successful, no-collision, collision, and failure paths;
- existing Recipe/Substitution catalog findings, summaries, human/JSON
  reporting, safe failures, and exit behavior remain intact; and
- the JSON schema version and new human/JSON collision sections match this
  contract.

Implementation verification command:

```text
node --test --test-isolation=none apps/api/test/catalog-consistency-audit.test.js
```

Then run the existing relevant API regression selected during implementation,
followed by `git diff --check` and `git status --short --branch`. No test file
outside the exact allowlist may be modified.

## 9. Later runtime plan

No database scan was performed during this contract freeze.

After implementation, focused tests, and independent review pass, obtain
explicit authorization for each environment. Run the existing catalog audit in
JSON mode first against `wecooked-dev`, verify the report identifies the
database as exactly `wecooked-dev`, and retain only aggregate collision counts
and the frozen collision records. Confirm the command made zero writes and that
the ordinary M23 findings remain present and structurally unchanged.

Only after the development read proves bounded, deterministic, and read-only,
obtain separate production authorization. Run the identical committed command
against `wecooked-production`, preferably with a read-only database principal;
verify the reported database name is exactly `wecooked-production`. Record
counts by collision type, affected Ingredient count, and the deterministic
collision records. Do not run any apply, repair, migration, index, merge,
rename, archive, delete, or follow-up mutation command.

Treat each run as a non-transactional observation. If investigation or a later
policy decision depends on current data, rerun the audit; do not infer that an
older count remains current. Production runtime remains a gate, not evidence
claimed by this document.

## 10. Explicitly out of scope

- Ingredient schema, validation, indexes, and write-time enforcement changes.
- A second canonical duplicate system or live index repair/creation.
- Admin, Staff Portal, mobile, or other UI changes and warning surfaces.
- ING1 resolver, Recipe intake, Ingredient creation, or picker behavior.
- Recipe, Substitution, Shopping List, or other domain semantics.
- Migration, cleanup, merge, delete, rename, archive/restore, or automatic
  winner selection.
- Blocking a Moderator create/update because of an alias collision.
- Deciding that any collision is erroneous; terminology may be genuinely
  ambiguous.
- Fuzzy, punctuation-insensitive, accent-insensitive, morphological, synonym,
  category, allergen, locale, or semantic matching.
- General malformed Ingredient validation beyond the four collision types.
- Live `wecooked-dev` or `wecooked-production` execution during this freeze.
- Staging, commit, push, branch manipulation, or stash manipulation.

## 11. Follow-up decision rule

Inventory results authorize no enforcement by themselves. After separately
authorized development and production observations, classify the actual
findings by collision type and active/archived ownership. Propose Moderator
warnings or write-time enforcement only in a new frozen milestone when the
observed collisions show a concrete, recurring safety or workflow problem and
the proposal defines legacy handling, archived-record policy, race-safe server
authority, and false-positive treatment. Ambiguous food terminology remains a
reportable fact, not proof that either record should win.

If no material collisions are found, close with the inventory evidence and do
not add UI or write-time policy. If cleanup is desired, it requires its own
explicitly authorized plan and cannot be hidden inside this audit.

## 12. Final evidence

Implementation is complete and independent review passed. Verification retained
the frozen read-only contract and produced the following results:

- catalog audit tests: **32/32 PASS**;
- ING1 regression: **10/10 PASS**;
- the development inventory exited `0`, scanned 17 Ingredients in
  `wecooked-dev`, and found 0 collisions;
- the production inventory exited `0`, scanned 86 Ingredients in
  `wecooked-production`, and found 23 collision records affecting 32
  Ingredients:
  - `ALIAS_TO_CANONICAL`: 7;
  - `ALIAS_TO_ALIAS`: 6;
  - `SELF_ALIAS_TO_CANONICAL`: 10; and
  - `DUPLICATE_ALIASES_WITHIN_INGREDIENT`: 0.

Both database inventories were read-only and performed zero database writes.
The observed production inventory justifies a later Moderator alias-warning UX.
Alias enforcement, merge, repair, and cleanup remain deferred and require their
own frozen contracts and authorization.

MongoDB credential rotation is deferred security debt because a credential
appeared in command output during inventory. Rotation was not performed or
verified during this phase.

## 13. Final verdict

**ING-ALIAS-AUDIT1 FINALIZED - READY TO MERGE**
