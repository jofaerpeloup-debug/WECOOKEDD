# MOBILE-RANK1 — Recipe Ranking Foundation

**Phase:** AMENDED CONTRACT FROZEN — IMPLEMENTATION AUTHORIZED; PRODUCTION RELEASE HELD

**Audit:** COMPLETE

**Contract:** AMENDED CONTRACT FROZEN — IMPLEMENTATION AUTHORIZED; PRODUCTION RELEASE HELD

**Status:** AMENDED CONTRACT FROZEN — IMPLEMENTATION AUTHORIZED; PRODUCTION RELEASE HELD

**Final independent contract verification:** PASS — 2026-10-11; the missing-versus-zero `__v` test-spec finding is corrected.

**Baseline:** `origin/main @ 11e788427166f5c2e7c5b456bef80b205639a61f`

**Current-main integration baseline:** `c66cf82f357d953668e03ee419198103f6beab85`

**Roadmap authority:** `docs/milestones/MOBILE-PARITY-AUDIT2-final-product-parity-audit.md`

**Verdict:** `RANK1 AMENDED CONTRACT FROZEN — IMPLEMENTATION AUTHORIZED; PRODUCTION RELEASE HELD`

The previously frozen portions of this document remain the RANK1 implementation
authority. The first independent current-main integration review identified the
three narrow findings recorded in this amendment. The backend and MongoDB remain
authoritative for Recipe visibility, filtering, ranking, Review-derived rating
data, totals, and pagination. Mobile renders server order and never invents or
recomputes rank.

This freeze changes only this milestone document. It authorizes implementation
within the production and test allowlists below, but no production release,
database or index write, push, or merge.

### Narrow post-freeze ordering amendment — Unicode relevance ties

The relevance tie-break is amended to Recipe `_id` ascending after the
full-precision weighted MongoDB text score descending. No lowercase-title
computation, `titleSortKey`, additional derived field, or backfill is
authorized. MongoDB must apply this ranking before skip and limit; application
code must not sort results after pagination. Top Rated and Trending semantics
are unchanged. Every existing eligibility, CAS, migration, authorization, and
release requirement remains in force.

### First independent integration review amendment — nutrition source parity

Current-main Recipe validation stores the optional nutrition source URL at
`nutritionProvenance.sourceUrl`. A present source URL must pass the same
`isPublicHttpsUrl` helper used by image URL validation. Nutrition, when present,
requires valid server-owned source material; absent/null optional nutrition does
not require a source. The Recipe model also rejects provenance without nutrition.
The current ranking aggregation cannot reproduce WHATWG URL normalization for
stored source URLs, just as the earlier image URL regex could not. It also omits
the image/asset and nutrition/source cross-field completeness checks. The
independent review therefore requires one additional internal Recipe field,
`nutritionSourceUrlIsPublicHttps`, derived only by the server from the stored,
trimmed `nutritionProvenance.sourceUrl` with `isPublicHttpsUrl`. It is `false` for
an absent, null, non-string, or invalid URL. A present source URL is eligible
only when this field is exactly `true`; a missing/null optional source URL needs
no `true` value. The field is distinct from `imageUrlIsPublicHttps`, is rejected
from client input, and is never serialized. Existing nutrition and provenance
fields, source attribution, and staff authoring behavior remain unchanged.

Counterfactuals must include valid public HTTPS, numeric-loopback and
percent-encoded-localhost hosts, other invalid/nonpublic URLs, missing required
source material, and canonically valid absent nutrition. No Mongo URL regex or
post-page filtering substitutes for the authoritative derived fact.

### Current-main integration test allowlist amendment

The current-main Dashboard regression test assumes one Recipe list request.
RANK1 intentionally adds a second, independent `topRated` request for the
six-item Trending rail. To verify both requests while preserving the existing
Shopping behavior and navigation assertions, current-main integration
additionally authorizes exactly one test path:
`apps/mobile/__tests__/dashboardInteraction.test.js`. The approved scope is
15 production paths and 19 test paths. This amendment changes no production
allowlist, ranking rule, API contract, migration authorization, or runtime gate.

### Closure blocker amendment — authoritative image eligibility

The original implementation attempted to reproduce `isPublicHttpsUrl` with a
Mongo regular expression inside the consumer-completeness aggregation. Closure
review proved that approach cannot be equivalent to WHATWG URL normalization:
integer/hex/octal and shortened private IPv4 forms, percent-encoded localhost,
backslash-delimited private hosts, and normalized Unicode host forms can differ.
No further regex expansion is authorized.

RANK1 therefore adds one internal persisted Recipe field,
`imageUrlIsPublicHttps`. It is server-derived from the stored trimmed
`imageUrl` by the authoritative `isPublicHttpsUrl` helper. A string URL is
consumer-eligible only when this field is exactly `true`; a missing or null
URL remains eligible under the existing optional-image rule. The field is not
accepted from any client, is never serialized, and does not replace any other
completeness, lifecycle, visibility, or active-Ingredient rule.

All frozen Recipe write paths maintain the field. Complete create and Draft
create set it, update recomputes it from the merged stored state, and publish
and restore refresh it atomically from their validated snapshot. Archive does
not change `imageUrl` and preserves the derived value. A mandatory guarded,
idempotent backfill in the existing RANK1 migration establishes the invariant
for legacy documents before the database query is activated. Production
backfill remains an explicit release gate and is not authorized here.

### Narrow test-allowlist amendment

The approved architecture makes two existing regression tests stale without
changing their protected behavior. RANK1 therefore additionally authorizes
only `apps/api/test/recipe-authoring.test.js` to replace retired consumer
`findMany`/`countByFilter` mocks with bounded `findConsumerPage` expectations,
and `apps/api/test/recipe-image-lifecycle.test.js` to expect the server-derived
`imageUrlIsPublicHttps` update. This amendment authorizes no production change,
no weakened assertion, and no other test path.

## 1. Baseline and verified current state

- Contract freeze used the clean detached worktree
  `wecooked-mobile-rank1-audit` at the latest live `origin/main`.
- On 2026-10-05, `HEAD`, the locally recorded `origin/main`, and the live
  remote `refs/heads/main` were all
  `11e788427166f5c2e7c5b456bef80b205639a61f`.
- Current `GET /api/v1/recipes` supports `search`, `region`, `category`,
  `difficulty`, `dietaryTag`, `ingredientId`, `maxPrepTimeMinutes`, role-safe
  status/publication filtering, paging, and the existing Recipe sorts.
- Current non-relevance search is escaped case-insensitive substring matching
  against Recipe `title` or `description`.
- Current Recipe list sorts do not all have deterministic `_id` tie-breakers,
  and consumer usability filtering currently happens after the database page.
  RANK1 corrects both defects for this query path.
- Authoritative ratings exist only as `Review` rows. Recipe does not persist a
  rating aggregate. The existing Review indexes are
  `{ userId: 1, recipeId: 1 }` unique and
  `{ recipeId: 1, createdAt: -1 }`.
- Live source declares no Recipe text index. Existing Recipe indexes are
  ordinary field indexes, including `{ title: 1 }`; none conflicts with the
  frozen text-index declaration below. Physical index-catalog drift remains a
  mandatory fail-closed migration preflight check.

## 2. Owned API extension

Extend the existing authenticated endpoint:

`GET /api/v1/recipes`

with:

- `sort=relevance`;
- `sort=topRated`; and
- optional `excludeRecipeId=<24-character ObjectId>`.

Unknown query keys remain rejected. `excludeRecipeId` uses the repository's
strict ObjectId validation: no coercion, truncation, alternate identifier, or
client-generated Recipe identity is accepted.

RANK1 does not add a separate Trending endpoint. Dashboard Trending Meals and
the dedicated Trending screen use this same Recipe list endpoint with
`sort=topRated`.

## 3. Relevance contract

`sort=relevance` is valid only when the trimmed `search` value is non-empty and
passes the existing search length bound. Missing or blank search with
`sort=relevance` is a `400 VALIDATION_ERROR` and must not silently fall back to
another sort.

Relevance is server-authoritative weighted MongoDB full-text ranking over the
stored Recipe fields `title` and `description` only. An equivalent title match
must outrank an equivalent description match. The frozen text index uses title
weight `10` and description weight `1`.

The exact order is:

1. full-precision text relevance score descending;
2. Recipe `_id` ascending as the deterministic tie-break.

The raw score is an implementation detail: it is neither accepted from the
client nor serialized in a Recipe response. Relevance needs no lowercase-title
computation or `titleSortKey`.

`sort=relevance` composes with every currently supported Recipe filter and
with `excludeRecipeId`. All eligibility and filter stages precede scoring,
counting, skip, and limit.

Existing non-relevance sorts retain the current escaped case-insensitive
title/description substring semantics when `search` is present. In particular,
RANK1 must not replace, broaden, or reinterpret search for `titleAsc`,
`titleDesc`, `newest`, `oldest`, `prepTimeAsc`, `prepTimeDesc`, `updatedDesc`,
or `topRated`. A later frozen milestone is required to change those semantics.

No fuzzy scorer, local corpus, client-side ranking, Ingredient-name inference,
or relevance-score exposure is permitted.

## 4. Top Rated contract

`sort=topRated` derives its ranking only from authoritative `Review` rows at
read time. Review create, update, and delete must affect the next ranked read;
mobile state or a persisted Recipe aggregate must not become authority.

Recipes with `ratingCount === 0` are ineligible for `topRated` and excluded
before `pagination.total`, skip, and limit.

The exact order is:

1. raw full-precision average Review rating descending;
2. `ratingCount` descending; then
3. Recipe `_id` ascending.

Ranking must never use a rounded display value. Rounding may occur only after
the raw average has been used for ordering.

Every `topRated` response item must include:

```js
ratingSummary: {
  averageRating,
  ratingCount,
}
```

`averageRating` is derived from the same authoritative Review rows and rounded
to one decimal for display, matching the existing Review-summary contract;
`ratingCount` is the exact contributing Review-row count. The unrounded average
still controls ordering. A ranked result may not contain a missing, null,
stale, client-computed, or fabricated summary.

## 5. Trending Meals contract

Dashboard Trending Meals and the dedicated Trending screen use the exact
`sort=topRated` server query and ordering from section 4. They may use different
page limits for their layouts, but they must agree on the ordered prefix for
the same filters and exclusion.

The Dashboard rail contains up to six server-ordered results. The dedicated
Trending screen is paginated and preserves server order across pages. Both
surfaces navigate to the ordinary API-backed Recipe Detail route using the
authoritative Recipe id.

Trending Meals is intentionally an all-time Top Rated ranking. Product evidence
does not establish a time window, view signal, Favorite signal, cooking signal,
recency decay, or composite popularity score. RANK1 must not invent one. A
future time-sensitive Trending definition requires a separately reviewed and
frozen contract.

Mobile must not locally sort, splice in mock rows, calculate scores, fabricate
ratings/counts/totals, or use AsyncStorage as ranking authority. Loading,
refresh, empty, error/retry, load-more, account-change, unmount, and stale
response behavior must preserve the existing guarded server-read principles.

## 6. Eligibility, visibility, totals, and pagination

For every Recipe list sort on this query path, the following must be applied in
this order:

1. existing role/capability-safe Recipe visibility and publication rules;
2. active/completeness and required-active-Ingredient eligibility for consumer
   results;
3. all supplied Recipe filters;
4. optional `excludeRecipeId`;
5. sort-specific eligibility, including `ratingCount > 0` for `topRated`;
6. ranking/order;
7. `pagination.total`; and
8. skip and limit.

The implementation may combine equivalent database stages, but it must
preserve these observable semantics. Consumer-invalid Recipes must not occupy
a page slot or inflate `pagination.total`. Existing staff capability and
draft/inactive visibility must not be weakened or silently converted to the
consumer view.

The image portion of completeness must be database-bounded without attempting
to parse URLs in Mongo. For a string `imageUrl`, the aggregation requires the
persisted server-derived `imageUrlIsPublicHttps` value to be exactly `true`, in
addition to the existing type and length rules. Missing/null images retain the
existing optional-image behavior. A present `imageAssetId` additionally
requires a valid, eligible `imageUrl`; a missing, null, or invalid URL cannot be
rescued by asset metadata.

For present nutrition, consumer completeness requires the canonical complete
nutrition shape and valid server-owned `nutritionProvenance`: `sourceKind` is
`manual` or `jsonLd`; `sourceLabel` is a nonempty trimmed string within the
canonical 500 UTF-16-unit bound; `acceptedBy` is a present BSON ObjectId; and
`acceptedAt` is a present valid BSON Date with a finite representable time.
These are the model's required source and attribution fields, not replacement
client-provided attribution. Missing or invalid `acceptedBy` or `acceptedAt`
excludes the Recipe. If `nutritionProvenance.sourceUrl` is present, it must meet
the canonical type and length rules and `nutritionSourceUrlIsPublicHttps` must
be exactly `true`. Missing/null source URLs remain optional and need no `true`
flag, but missing/invalid required source material or attribution does not.
Absent/null nutrition remains eligible only under the canonical optional-
nutrition and provenance cross-field rules. Legacy missing derived-field values
fail closed when their corresponding URL is present. These checks occur before
ranking, the total-count facet, skip, and limit; private attribution is never
serialized in a public Recipe response.
Publication visibility, active-Ingredient dependency, filters, and staff
visibility retain their existing authority. Every consumer completeness check
must precede ranking and the single count/page facet; none may be repaired by
filtering an already paged result.

All string-length predicates used for consumer completeness must match the
canonical JavaScript schema's UTF-16 code-unit lengths after its canonical
trim. In particular, the legacy stored-title maximum is 150 UTF-16 units:
150 ASCII units and 75 supplementary-plane characters are at the boundary;
151 ASCII units and 76 supplementary-plane characters exceed it. Mixed BMP and
non-BMP boundaries and relevant related string fields require parity proof.
MongoDB `$strLenCP` counts Unicode code points and `$strLenBytes` counts UTF-8
bytes, so neither directly implements that rule. The implementation must prove
an aggregation-safe expression on the supported MongoDB runtime before use;
this contract freezes no expression. `$regexFindAll` can return per-match results
and is a candidate for counting supplementary code points alongside
`$strLenCP`, but the deployed MongoDB version, Unicode-range matching, BSON
edge cases, and exact UTF-16 parity are not yet verified. Server-side
JavaScript, a new derived length field, and a changed canonical limit are not
authorized by this amendment.

`pagination.total` is the exact eligible result-set count for the complete
query before skip and limit. `totalPages` continues to derive from that total
and the validated limit.

`excludeRecipeId` is applied before total and pagination for every sort. If the
Recipe is absent or already ineligible, exclusion is an ordinary successful
no-op. A malformed id is a validation error.

Add `_id` ascending as the final deterministic tie-breaker to every Recipe list
sort touched by this endpoint:

- `titleAsc`: title ascending, `_id` ascending;
- `titleDesc`: title descending, `_id` ascending;
- `newest`: created time descending, `_id` ascending;
- `oldest`: created time ascending, `_id` ascending;
- `prepTimeAsc`: prep time ascending, `_id` ascending;
- `prepTimeDesc`: prep time descending, `_id` ascending;
- `updatedDesc`: updated time descending, `_id` ascending;
- `relevance`: full-precision weighted text score descending, `_id` ascending;
  and
- `topRated`: raw average descending, rating count descending, `_id`
  ascending.

Mobile may deduplicate repeated Recipe ids defensively while merging pages and
must retain generation guards, but it must never reorder a server page or use
deduplication to conceal unstable backend pagination.

## 7. DISC6 and adjacent milestone boundaries

RANK1 is **not blocked by MOBILE-DISC6** and may be implemented against the
current Recipe filter contract. This decision supersedes the roadmap row and
lane text that described DISC6 as a RANK1 prerequisite.

RANK1 must compose correctly with all current Recipe filters listed in section
1. DISC6 may later add authoritative taxonomy fields and filter composition,
and those new filters must compose with the frozen RANK1 query pipeline. DISC6
must not redefine relevance weighting/order, Top Rated eligibility/order,
Trending semantics, ratingSummary authority, or stable pagination.

MOBILE-HOME2 owns cart, craving, and recently-viewed behavior. RANK1 owns only
the Dashboard Trending Meals rail. Because both milestones touch Dashboard,
their implementation should be sequenced or reconciled explicitly; neither
milestone absorbs the other's product behavior.

MOBILE-COMM7 owns Community Trending and For You ranking/personalization.
RANK1 does not add Community feed modes, score Community posts, expose private
bookmark counts, or freeze a Community freshness window. COMM7 may reuse the
server-authority, pre-pagination visibility, and deterministic-ordering
principles, but it requires its own frozen score/window and moderation rules.

## 8. ratingSummary scope

`ratingSummary` is required on every Recipe item returned by
`sort=topRated`, including Dashboard Trending Meals and dedicated Trending
pages.

RANK1 does not force Review aggregation or `ratingSummary` serialization onto
relevance or any existing unrelated Recipe list sort. If implementation proves
that a shared query/serializer path cannot safely preserve this scope, stop and
amend the contract before broadening response work or query cost.

Recipe Detail's existing Review summary remains authoritative and compatible,
but RANK1 does not redefine the Recipe Detail or Review-list API contract.

## 9. Data model, text index, and migration

Do not add or persist any Recipe field named or serving as:

- `rating`;
- `ratingCount`;
- `popularity`;
- `trendingScore`;
- `viewCount`; or
- `rank`.

Do not denormalize Review aggregates into Recipe under another name. Do not add
a Review index without measured query-plan or latency evidence and a contract
amendment. The existing Review index set is the frozen starting point.

Declare and migrate exactly one Recipe text index:

```js
{
  key: { title: 'text', description: 'text' },
  options: {
    name: 'recipe_title_description_text_v1',
    weights: { title: 10, description: 1 },
    default_language: 'english',
    language_override: 'language',
  },
}
```

The index is non-unique, non-sparse, has no TTL, and has no partial filter.
Only `title` and `description` are text-indexed. The ordinary `{ title: 1 }`
index is not a conflicting text index and is not dropped by RANK1.

Add one migration script named
`apps/api/scripts/migrate-recipe-ranking-index.js` and one package script named
`migrate:recipe-ranking-index`.

The same migration owns the two-field Recipe backfill for
`imageUrlIsPublicHttps` and `nutritionSourceUrlIsPublicHttps`; no second
migration path is added. It imports and calls the authoritative
`isPublicHttpsUrl` helper separately for each stored string URL, after trimming
that URL, and derives `false` for missing/null/non-string or invalid URLs. It
never infers a `true` value from client input, image-asset metadata, provenance
presence, hostname prefixes, or a Mongo regular expression. Both fields are
internal, have no permissive default for legacy rows, and must be recomputed
when the corresponding canonical URL helper semantics change.

Complete create and Draft create set both facts from the stored Recipe state.
Recipe update recomputes both from the merged state, including nutrition/source
replacement and clearing. Publish and restore refresh both atomically from
their validated Recipe snapshot; archive preserves them because it changes
neither URL. No client may submit either field, and neither enters a public
Recipe response. An unrelated Recipe edit must not leave a stale fact behind.

The mandatory concurrency mechanism for ordinary Recipe writes is the existing
Mongoose `__v` revision key, not `updatedAt` alone. `Recipe.create` establishes
the revision for new rows. For legacy rows with `__v` absent, a writer matches
`{ __v: { $exists: false } }` and atomically increments it to `1`; a present
revision must be a nonnegative safe integer below the increment limit and is
matched exactly. An invalid present revision fails closed for repair. Every
update, publish, restore, and archive must use an atomic Recipe-id-plus-
snapshot-revision predicate and increment
`__v` in the same document write. Mongoose `findOneAndUpdate` does not advance
`__v` automatically, so the repository must include the increment explicitly.
The caller's optional `expectedUpdatedAt` remains an additional existing API
precondition, never the sole concurrency guard. Equal timestamps, including
writes within one timestamp resolution interval, cannot bypass the revision
predicate. Any source change or eligibility refresh persists both derived facts
with that change in the same successful atomic Recipe write.

`recipe.service.js` must read the Recipe before update, publish, restore, or
archive and pass the observed revision to `recipe.repository.js`. Update merges
and validates against that snapshot; update, publish, and restore derive both
facts from its image URL and nutrition source URL. Archive preserves both facts.
The repository's four mutation methods must apply the revision predicate and
increment. Archive participates even though it preserves both URLs and facts,
so a stale publish, restore, or update cannot
silently cross an archive. A failed predicate is the existing `409
RECIPE_EDIT_CONFLICT`, including when the client omitted `expectedUpdatedAt`;
it never becomes a not-found result for a Recipe that still exists. There is no
automatic retry or blind replay of an authoring patch. A later client request
may re-read, revalidate, and submit a new edit under the existing API. Any
internal retry proposed later requires a separate reviewed contract and must
re-read, merge, revalidate, recompute both facts, and remain bounded. This
changes no public request or response shape, capability check, or staff
authoring rule and adds no Recipe field or collection.

The API's competing Recipe writes are the complete and Draft creates plus the
four repository mutations above. Older direct-write Recipe nutrition, metadata,
and publication migrations do not advance `__v`; they may run only under a
Recipe-writer freeze or before this protocol is activated, and may not race an
API Recipe writer. The RANK1 backfill remains the separate two-derived-field-only
write: its exact source-and-fact snapshot guard, required writer maintenance or
freeze, and full postcondition protect it without changing `__v` or any other
Recipe field. A rollout must block an unversioned or older API writer from
writing during and after backfill. The separately approved Recipe nutrition
migration's ordering and subsequent maintenance restriction below still apply.

The required race proof starts with A reading absent `sourceUrl`; B adds a valid
public HTTPS source URL and commits `nutritionSourceUrlIsPublicHttps: true`; A's
stale unrelated edit must conflict without overwriting B's source, flag, or
unrelated fields. Reverse completion order must leave the facts matching the
winning stored state. Apply the same proof to image URL versus title edits,
nutrition clear versus unrelated edits, publish/restore versus updates or
archive, equal-`updatedAt` concurrent writes, and legacy valid Recipes with
missing `__v`. A conflict must leave a valid persisted Recipe, and a deliberate
new request after re-read must derive both facts from the newly current state.

The separately approved Recipe nutrition migration can change
`nutritionProvenance.sourceUrl` without maintaining this new fact. It must finish
before the RANK1 backfill and query activation; it may not run afterward until
separately reviewed maintenance is in place or the RANK1 backfill is rerun under
the required writer freeze. This sequencing requirement does not authorize an
edit to that migration or broaden this implementation allowlist.

Migration behavior is frozen as follows:

- default invocation is dry-run and performs zero writes;
- preflight reads the complete physical Recipe index catalogue;
- an exact existing index is an aligned no-op;
- any existing text index with another shape, the frozen name with another
  shape, or a same-key definition with incompatible options is a blocker;
- dry-run reports whether apply would create the one missing index;
- apply requires explicit `--apply` and creates only the frozen index;
- apply rereads the catalogue and verifies the exact logical key fields/order,
  name, weights, language options, and absence of unique/sparse/TTL/partial
  options;
- preflight scans every Recipe using a bounded projection of both URLs,
  provenance, and both derived facts; it reports aligned, missing, stale, valid,
  invalid, and would-modify counts separately for each fact and in total;
- dry-run performs zero index or document writes;
- apply updates only the derived fact or facts that need correction, guarded by
  Recipe id plus the exact preflight image URL, complete nutrition provenance,
  and both derived-field presence/value snapshots; it stops on a concurrent
  mismatch or write failure without overwriting the newer state;
- apply rereads every Recipe and recomputes both authoritative values as a
  mandatory postcondition before reporting alignment; a missing/invalid legacy
  source URL is never silently marked valid;
- a second apply is idempotent and creates or modifies nothing;
- no automatic migration or index creation occurs at API startup;
- no automatic index drop, rename, rebuild, repair, or replacement is allowed;
- no Recipe field other than the two named derived facts and no Review document
  may be changed; and
- no production migration execution is authorized during implementation.

An apply report must distinguish no mutation attempted/applied, successful
index creation, Recipe document updates, failed index or derived-field
postconditions, and partial completion. A successfully created index is apply
progress even if zero Recipes were updated before a later failure. The
`partialApply` indicator is true whenever an index was created or any Recipe
document was updated before failure. A sanitized CLI failure report includes
the actual error code, index creation state, document update counts, failed
postcondition category, and partial-apply indicator. It never logs a connection
URI, credentials, sensitive environment value, or unsanitized error text. No
automatic retry of a failed write or index operation is permitted; a later
explicit apply must pass the same preflight, guards, postconditions, and
idempotence rules.

Implementation closure may exercise apply only against an isolated
non-production `RECIPE_RANKING_MONGO_URI` whose database name contains `rank1`
and either `test` or `isolated`. Production index alignment and production
migration execution remain explicit release-stage gates. Query activation
requires writer maintenance to be active and the complete backfill
postcondition to pass, using a two-phase rollout or a Recipe-write freeze so an
older writer cannot create a missing or stale derived value between backfill
and activation. This applies to both derived facts and to the separately
approved nutrition migration's sequencing. Any future semantic change to
`isPublicHttpsUrl` requires a fresh complete recomputation before the changed
predicate is activated. The isolated database name alone does not prove that
its credentials are restricted: verify a dedicated non-production deployment
and least-privilege, database-scoped grants before any physical gate.

## 10. Mobile surfaces

Discover adds `Relevance` and `Top Rated` to the existing six sort choices.
Selecting Relevance without a non-empty search must not send an invalid request;
the UI must prevent or truthfully explain the required search without silently
substituting another sort. All filters and the current search must be sent in
one server request.

Dashboard adds a Trending Meals rail backed by `sort=topRated`, limited to six
items, plus navigation to the dedicated Trending screen. The new Trending
screen owns paginated list, loading, empty, error/retry, refresh, and load-more
states. Both surfaces show real `ratingSummary` values and preserve exact
Recipe Detail navigation.

## 11. Production allowlist

Only these production paths may change during RANK1 implementation.

Backend existing files:

- `apps/api/package.json`
- `apps/api/src/modules/recipes/recipe.model.js`
- `apps/api/src/modules/recipes/recipe.validation.js`
- `apps/api/src/modules/recipes/recipe.repository.js`
- `apps/api/src/modules/recipes/recipe.service.js`
- `apps/api/src/modules/recipes/recipe.serializer.js`
- `apps/api/src/modules/recipes/recipe.controller.js`

Backend new file:

- `apps/api/scripts/migrate-recipe-ranking-index.js`

Mobile existing files:

- `apps/mobile/src/api/recipeService.js`
- `apps/mobile/src/api/recipeOptions.js`
- `apps/mobile/src/utils/discoverFilters.js`
- `apps/mobile/src/screens/DiscoverScreen.js`
- `apps/mobile/src/screens/DashboardScreen.js`
- `apps/mobile/src/navigation/RootNavigator.js`

Mobile new file:

- `apps/mobile/src/screens/TrendingScreen.js`

No other production path is authorized. In particular, RANK1 does not authorize
changes to Review production files or indexes, Community production files,
HOME2 state, dependencies, lockfiles, deployment files, protected
documentation, or unrelated Recipe authoring/detail behavior. If another
production path is required, stop and amend this contract before editing it.

This amendment adds no production path. The existing Recipe model, validation,
service, repository, and ranking migration paths cover declaration, rejection,
write-path maintenance, bounded pre-facet eligibility, and the guarded backfill
of both named derived facts. The existing serializer and controller paths cover
non-serialization and strict request handling if a narrow correction is needed.
The separate Recipe nutrition migration remains outside this allowlist and is
controlled by the sequencing gate in section 9. The production allowlist stays
at exactly 15 paths; this amendment authorizes no additional mobile production path.

## 12. Test allowlist and required proof

Only these test paths may change during RANK1 implementation.

Backend existing tests:

- `apps/api/test/recipe-model.test.js`
- `apps/api/test/recipe-validation.test.js`
- `apps/api/test/recipe-service.test.js`
- `apps/api/test/recipe-routes.test.js`
- `apps/api/test/recipe-authoring.test.js`
- `apps/api/test/recipe-image-lifecycle.test.js`

Backend new tests:

- `apps/api/test/recipe-ranking-migration.test.js`
- `apps/api/test/recipe-ranking-mongo.test.js`

Mobile existing tests:

- `apps/mobile/__tests__/discoverFilters.test.js`
- `apps/mobile/__tests__/discoverInteraction.test.js`
- `apps/mobile/__tests__/discoverStaticAudit.test.js`
- `apps/mobile/__tests__/dashboardStaticAudit.test.js`
- `apps/mobile/__tests__/dashboardInteraction.test.js`
- `apps/mobile/__tests__/navigationShellStaticAudit.test.js`
- `apps/mobile/__tests__/searchHistoryInteraction.test.js`

Mobile new tests:

- `apps/mobile/__tests__/recipeService.test.js`
- `apps/mobile/__tests__/dashboardTrendingInteraction.test.js`
- `apps/mobile/__tests__/trendingInteraction.test.js`
- `apps/mobile/__tests__/trendingStaticAudit.test.js`

No fixture, snapshot, helper, configuration, or unrelated test path is
implicitly allowed.

Backend proof must cover strict query rejection; relevance requiring search;
title-over-description precedence; full-precision score descent and exact
`_id` ascending relevance ties regardless of ASCII, accented, or non-Latin
titles; no lowercase-title stage or `titleSortKey`; stable repeated pagination
without duplicate or missing Recipes; preservation of regex
search for every non-relevance sort; complete current-filter composition;
strict exclusion; authoritative raw Review average/count aggregation; unrated
exclusion; Review create/update/delete reflection; exact Top Rated ties;
role-safe visibility and consumer usability before counting/paging; correct
totals and page boundaries; and `_id` tie-breakers for every touched sort.

Migration proof must cover dry-run zero writes, no declared or physical text
index conflict, exact existing-index no-op, conflicting-name/key/text-index
blockers, exact apply shape, catalogue reread, guarded two-field backfill,
concurrent-snapshot rejection, authoritative postconditions for both facts,
idempotent rerun, no drops, and no other document writes. Counterfactuals must
include an index created with zero document updates before a failed
postcondition, a partial document-update failure, an existing correct index, an
index mismatch, sanitized CLI error code/progress without secrets, and an
explicit idempotent second apply. Model/service/route proof must show separate
server derivation on complete create, Draft create, update/clear, publish, and
restore; strict client rejection; non-serialization; and archive preservation.
Repository/service proof must reject an asset id without an eligible image URL,
nutrition without valid required source material or attribution, invalid
present provenance URLs, draft/archived/ineligible Recipes, and stale/missing
required derived facts. Provenance cases must distinguish valid complete
provenance, missing/invalid `acceptedBy`, missing/invalid `acceptedAt`, valid
provenance with an absent optional source URL, and a present invalid source URL.
It must retain valid image references, valid sourced nutrition, canonically
valid absent optional image/nutrition, and published legacy Recipes.
Mixed-dataset totals and every page must exclude invalid rows before the facet
while preserving filters and deterministic ties. URL cases must include
numeric-loopback and percent-encoded localhost as well as valid public HTTPS.
Concurrency proof must cover the A/B URL race, reverse completion order, image
URL versus title, nutrition clear versus ordinary edit, publish/restore/archive
interleavings, equal-timestamp writes, missing legacy `__v`, no stale overwrite,
conflict-state validity, and an explicitly re-read new request. Assertions must
prove the revision predicate and increment on every competing API write path,
and that legacy direct-write migrations cannot run concurrently with those
writers under the release protocol.
Repository-level counterfactual tests must distinguish all three persisted
revision states: a legacy Recipe missing `__v` uses the filter
`{ __v: { $exists: false } }` and an atomic `$inc` sets `__v` to `1`; a Recipe
with `__v: 0` uses `{ __v: 0 }` and an atomic `$inc` sets `__v` to `1`; and a
Recipe with `__v: 5` uses `{ __v: 5 }` and an atomic `$inc` sets `__v` to `6`.
Missing and zero revisions must use distinct predicates. For same-version
competing writes, exactly one succeeds and increments once; the stale write
returns the existing `409 RECIPE_EDIT_CONFLICT` without overwriting newer
Recipe fields or either derived eligibility fact. Equal-millisecond updates
must still conflict by revision. Tests must reject automatic retry or
destructive replay of a stale patch. The opt-in isolated Mongo suite must
verify these counterfactuals under the section 9 URI, database, and credential
restrictions; this contract freeze does not authorize running that suite.
ASCII title lengths 150/151, supplementary-plane counts 75/76, mixed BMP/non-BMP
boundaries, and relevant related string lengths must distinguish UTF-16 units
from Mongo code points. New assertions must fail against the old erroneous
aggregation and migration behavior. The live-Mongo suite is environment-gated
and may use only the isolated URI/database and credential rule from section 9.
The existing test allowlist remains exactly 19 paths; no new fixture, helper,
configuration, or mobile test path is authorized by this amendment.

Mounted mobile proof must cover both new Discover sorts; Relevance search
requirement; complete search/filter/sort/exclusion composition; stale first
page/refresh/load-more rejection; no local reordering; strict ranked response
handling; Dashboard six-item prefix consistency; Trending loading, empty,
error/retry, refresh, and pagination; exact Recipe Detail navigation; and
account/unmount races. Mutation-resistant negative tests must fail if local
sorting, mock values, fabricated totals, stale completion, or client scores are
introduced.

## 13. Blockers, open gates, and verdict

The three first independent current-main integration review findings remain
open in code: consumer cross-field and provenance URL completeness (HIGH),
UTF-16 length parity (MEDIUM), and migration partial-progress reporting
(MEDIUM). Final independent contract verification passed, including the
missing-versus-zero `__v` test-spec correction. This frozen amendment authorizes
scoped implementation, not an implementation pass or production release. RANK1
remains unblocked by DISC6 under the previously frozen ranking semantics.

Implementation, focused automated proof, isolated live-Mongo index/query proof,
production index alignment, physical-device behavior, and accessibility
runtime verification remain open and must not be claimed complete. Production
migration execution remains unauthorized.

The earlier image regex-equivalence closure and the new nutrition URL finding
are resolved only when both amended field-maintenance, backfill, and
pre-pagination query proofs pass. Isolated Mongo verification remains deferred
by project decision and must not be claimed as passed. Production index
alignment/backfill, physical-device behavior, accessibility runtime, and the
MEAL4, SHOP4, and SHOP5 release holds remain separate gates. No database or
migration execution is authorized by this document edit.

**RANK1 AMENDED CONTRACT FROZEN — IMPLEMENTATION AUTHORIZED; PRODUCTION RELEASE HELD**
