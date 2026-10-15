# MOBILE-SHOP5 — Custom Shopping Items and Recipe Provenance

## 1. Status, baseline, and authority

- Status: **CONTRACT FROZEN — IMPLEMENTATION AUTHORIZED; PRODUCTION RELEASE HELD**.
- Contract worktree: `wecooked-mobile-shop5-contract`, branch `audit/mobile-shop5-contract`.
- Dependency baseline: SHOP4 clean-finalization commit `18c79c3e7630f784ed2d3bc2e919f5c1072218ad`.
- Independent verification: **SHOP5 FINAL UNICODE VERIFICATION PASS — CONTRACT READY FOR FREEZE** (approved verdict supplied for this freeze). The six independent-review correction groups in section 8 are closed, including the final Unicode correction; no further contract edit is required.
- The seven decisions in section 2, exact API and Unicode rules, release hold, and implementation and test allowlists in section 7 are approved and frozen. Draft-stage wording elsewhere in this document records the review history; the frozen requirements govern implementation.
- Authority for implementation remains `/AGENTS.md`, the reviewed live repository, frozen SHOP3/SHOP4/SHOP4-MIG1 contracts, then this approved contract. The teammate UI and parity audit establish visible product intent, not identity, persistence, security, or API authority.
- This freeze changes this document only. SHOP5 implementation and tests are authorized in a new isolated worktree under the frozen allowlists; database migration, dependency, production release, and deployment work are not authorized.

The SHOP4 baseline has one per-user `ShoppingList` document, at most 200 embedded rows, document `__v` optimistic concurrency, complete-list mutation responses, and an exact ingredient-only mobile parser. Its existing `/api/v1/shopping-list` responses cannot safely acquire extra row keys. The existing clear-checked endpoint is `/items/checked`, and Clear All is `/items`.

## 2. Seven proposed product decisions

1. **Two server-owned row types.** An embedded row is `ingredient` or `custom`. A missing legacy discriminator means `ingredient`. Custom rows have a server-generated embedded ObjectId, normalized label, and checked state only; repeated equal labels create different rows.
2. **Separate entry and actions.** Add a label-only inline Custom Items entry, apart from the canonical Ingredient picker. Custom rows appear in a `Custom Items` group after all Ingredient groups, including `Category unavailable`. Check/uncheck, swipe reveal plus explicit Delete, Edit-mode Remove, Clear Checked, and confirmed Clear All work across both types. Custom rename, quantity, and unit editing are excluded.
3. **Exact canonical merging.** Ingredient add and Recipe import continue to merge only on `ingredientId + exact unit`, without conversion. Custom rows never merge by name with each other or with Ingredients. The 200-row aggregate limit covers both types.
4. **Truthful bounded provenance.** Only the server's successful Recipe import records distinct Recipe IDs on Ingredient rows: at most 8 per row and 200 distinct IDs per list. Overflow rejects the entire import before save. Legacy rows receive no invented source backfill. Current, consumer-visible Recipe titles are resolved on read, with one bounded batch lookup; no title snapshot, source ID, or quantity attribution is exposed to mobile.
5. **Versioned API isolation.** SHOP4 paths retain their exact successful ingredient response schema. SHOP5 clients explicitly call `/api/v1/shopping-list/v2` paths and require an exact version-2 envelope and row union. A valid legacy Shopping request whose owner-document service snapshot contains a custom row fails with the upgrade error; an earlier in-flight GET may still finish with its earlier ingredient-only snapshot. OCC prevents a stale legacy write from deleting a concurrent custom row. The v2 endpoint is deployed before v2 mobile activation.
6. **Existing authority and concurrency.** Authentication derives the owner from `req.auth.userId`; clients never choose owner/list/source Recipe IDs. All row mutations use the same `ShoppingList` document and `__v` OCC, including version zero. Stale destructive operations return `409 SHOPPING_LIST_STALE` with no automatic replay. Only proven additive version conflicts permit at most one server retry; ambiguous outcomes never do.
7. **Gated release.** SHOP4-MIG1's controlled production backfill and all SHOP4 release gates precede SHOP4 activation. A compatible SHOP5 backend then precedes SHOP5 mobile activation and real Android/iOS acceptance. No startup migration or Render Free background dependency is introduced.

## 3. Stored data and validation candidates

The existing `ShoppingList` owner, timestamps, unique-owner index, embedded IDs, and `__v` remain. The document still has at most **200 total rows**. The proposed embedded union is:

```text
Ingredient row:
  _id: server-generated ObjectId
  type?: "ingredient"                 // absent on legacy rows; read as ingredient
  ingredientId: ObjectId
  quantity?: positive finite Number    // absent for toTaste
  unit: existing UNITS enum
  isChecked: Boolean
  originKind?: "manual" | "recipe"     // absent means legacy, never inferred from name
  sourceRecipeIds?: distinct ObjectId[] // at most 8, server-written only
  quantityEdited?: Boolean             // required when sourceRecipeIds is present; absent otherwise

Custom row:
  _id: server-generated ObjectId
  type: "custom"
  label: normalized String
  isChecked: Boolean
```

Reject cross-type persisted fields on new writes. A custom row has no `ingredientId`, `ingredient`, `category`, `isAvailable`, `quantity`, `unit`, Recipe source, or client-supplied `_id`. On legacy hydration, only a missing `type` maps to `ingredient`; an unknown or malformed type is an error, never silently coerced. Existing rows are read without a data migration. Preserve the historical Ingredient availability behavior and raw historical `ingredientId` when its Ingredient is gone.

For a new manual Ingredient row, store `originKind: "manual"` and no sources. A manual merge or edit of a legacy row leaves its missing origin as `legacy`; its unknown earlier history is not rewritten. For a newly imported row, store `originKind: "recipe"`, one source ID, and `quantityEdited: false`. Recipe import into an existing row adds its Recipe ID once. If the existing row was legacy or manual, set `quantityEdited: true` because its resulting amount has mixed or unknown history. A manual add into a sourced row, or any manual quantity/unit edit of one, sets `quantityEdited: true` and keeps the source IDs as historical row associations. Check/uncheck and delete do not edit provenance. Reimporting the same Recipe does not duplicate its source ID. An import never rewrites an earlier quantity because the Recipe has since changed; it adds only the Recipe's current eligible usages under the existing merge rule.

The server rejects a Recipe import with `400 SHOPPING_LIST_SOURCE_LIMIT_EXCEEDED` if applying it would exceed **8 distinct sources on any resulting row** or **200 distinct source IDs across the list**. It rejects the whole operation, with no partial merge and no dropped source. Count the limits after candidate merge and before save, including an additive OCC retry. Existing malformed or over-limit persisted provenance must fail closed for mutation and be reported for repair; it is never truncated or silently rewritten by SHOP5.

### Custom label algorithm

Apply these ordered steps identically in API and mobile, with API validation authoritative. Iterate Unicode scalar values rather than UTF-16 code units for character checks; the stated Unicode categories are behavioral requirements, not a requirement to use Unicode-property regular expressions or `Intl` features that may differ across JavaScript runtimes. The two allowlisted label utilities may use explicit scalar predicates where needed, with no new package or runtime feature assumption.

1. Accept only a JSON string; reject any unpaired UTF-16 surrogate. Normalize the string with Unicode **NFC**.
2. Before whitespace folding, reject any Unicode control (`Cc`), line/paragraph separator (`Zl`, `Zp`), or format (`Cf`) scalar except U+200C ZERO WIDTH NON-JOINER and U+200D ZERO WIDTH JOINER, which remain subject to step 4. This rejects U+200B ZERO WIDTH SPACE, U+2060 WORD JOINER, U+FEFF, soft hyphen, and bidi formatting/override controls including U+061C, U+200E–U+200F, U+202A–U+202E, and U+2066–U+2069, even beside visible text. Also reject **U+2800 BRAILLE PATTERN BLANK, U+3164 HANGUL FILLER, and U+FFA0 HALFWIDTH HANGUL FILLER anywhere**, alone or mixed with other characters; none is whitespace for this algorithm.
3. Replace each run of Unicode `White_Space` scalars with one ASCII space, then trim ASCII spaces at both ends. Do not apply NFKC, case folding, or another later normalization.
4. In this normalized label, each U+200C or U+200D must have an immediately adjacent scalar on **both** sides whose Unicode general category is Letter (`L`), Mark (`M`), Number (`N`), or Symbol (`S`); adjacent joiners, an edge joiner, or a joiner beside whitespace/punctuation fail. This retains internal script-shaping joiners and emoji ZWJ sequences while rejecting free-standing format characters.
5. Require at least one **visible-content anchor** after steps 1–4: a scalar in Letter (`L`), Number (`N`), Punctuation (`P`), or Symbol (`S`) **other than U+115F HANGUL CHOSEONG FILLER or U+1160 HANGUL JUNGSEONG FILLER**. The three prohibited blank scalars cannot qualify because step 2 rejects them. U+115F and U+1160 may occur with a qualifying anchor for legitimate Korean text, but neither qualifies alone or in any blank-only combination. Marks (`M`), whitespace, and permitted joiners do not qualify alone. Category `L/N/P/S` without these scalar exclusions is not a visibility test.
6. Count Unicode scalar values with `Array.from(normalized).length`; require **1–80** inclusive. Store and return exactly the normalized label. Empty or invalid input is `400 VALIDATION_ERROR`, field `label`.

The following are **literal JSON string tokens containing Unicode escapes**: decode each token once before validating; do not validate the backslash characters as label text or substitute visually similar glyphs. Accepted input → stored label: `"Milk"` → `Milk`; `"\uAE40\uCE58"` → `김치` (Korean); `"\u5BFF\u53F8"` → `寿司` (multilingual); `"Cafe\u0301"` → `Café` (attached combining mark composed by NFC); `"\u0020Milk\u00A0"` → `Milk` (whitespace folding); `"\u0645\u06CC\u200C\u0631\u0648\u0645"` → `می‌روم` (contextual U+200C); `"\uD83C\uDF4E"` → `🍎` (emoji); `"\uD83D\uDC69\u200D\uD83C\uDF73"` → `👩‍🍳` (contextual U+200D).

Rejected input: `"\u2800"`, `"\u3164"`, `"\uFFA0"`, `"\u115F"`, `"\u1160"`, `"\u115F\u1160"`, `"\u2800\u3164\uFFA0"` (blank-only); `"\u0020\u2800\u00A0"` (whitespace plus blank); `"Milk\u2800"`, `"Milk\u3164"`, `"Milk\uFFA0"` (prohibited scalar beside visible text); `"\u200B"`, `"Milk\u200B"`, `"\u0301"` (combining mark alone), `"\u200D"`, `"A\u200D"`, `"A\u200D\u200DB"`, and `"\u00ADMilk"` (soft hyphen). API and mobile must classify these decoded inputs identically and return the same normalized value for accepted inputs.

No case folding, locale collation, punctuation folding, name-based deduplication, rename, custom quantity/unit editing, or client-generated identity is proposed. Mobile validates with the same code-point and character rules before submit, preserves the draft on validation, stale, or ambiguous failure, and disables synchronous duplicate submit. The server reruns validation and never trusts the mobile result.

## 4. Recipe provenance response and lookup

Every v2 Ingredient row has one exact `source` variant. These are exact field sets; `boolean` means either JSON `true` or JSON `false`, never a literal string or an optional field:

```text
{kind:"legacy"}
{kind:"manual"}
{kind:"single",title:string,quantityEdited:boolean}
{kind:"multiple",quantityEdited:boolean}
{kind:"unavailable",quantityEdited:boolean}
```

`legacy` means no source fields existed on the historical row; `manual` means a new/edited row with no Recipe source. Resolve consumer visibility for **every** stored source before choosing a public variant. If any stored source is deleted, private, draft, unpublished, inactive, incomplete, or otherwise not consumer-visible, use `unavailable` regardless of how many sources remain visible; never disclose the hidden-source count, title, ID, or internal metadata. Otherwise `single` requires exactly one stored source and uses its current consumer-visible public title; `multiple` requires at least two distinct stored sources, **all** consumer-visible. Neither `multiple` nor `unavailable` has a title or source ID. `quantityEdited` is a required stored true/false history flag in every sourced variant. Two distinct Recipe imports without manual changes can yield `multiple` with `false`; a solely imported Recipe later becoming unavailable can yield `unavailable` with `false`. A manual change sets the flag to `true` and later imports or source visibility changes do not reset it. The flag never allocates the current quantity among Recipes.

The visible label is `Includes <current Recipe title>` for `single` (for example, `Includes Recipe A`), `Includes multiple recipes` for `multiple`, and `Recipe source unavailable` for `unavailable`. If `quantityEdited` is true, additionally show `Amount manually adjusted or mixed`; for a legacy/unknown earlier amount, “mixed” signals uncertain history, not a proven allocation. A row containing 9 kg manually added and 1 kg imported from Recipe A therefore says `Includes Recipe A`, never that all 10 kg came from Recipe A. Manual/legacy rows show no source label. There is no source navigation in SHOP5. Archived/deleted/private/unpublished Recipe titles and identifiers never appear in the response, logs intended for clients, or accessible labels. Recipe title changes reflect on the next read; Recipe ingredient changes never retroactively alter Shopping quantities.

For each full-list v2 response, collect distinct stored source IDs, enforce the 200-ID list bound, and ask `RecipeService` for consumer-visible `{id,title}` summaries in **one batch of at most 200 IDs**. The service reuses current publication, activity, completeness, and Ingredient-usability rules; the Shopping module does not query the Recipe model/repository directly. The Recipe service's repository method uses one bounded `_id: {$in: ids}` Recipe query with only server-validated ObjectIds and the fields needed for those visibility rules; its Ingredient population is also batched, never per Recipe. Missing/unusable results are omitted. Never run one Recipe query per row or trust source IDs from a client request.

## 5. Exact API response schemas and negotiation

The existing unversioned SHOP4 paths and their successful `data: {shoppingList}` shape remain unchanged for lists containing only Ingredient rows. Their Ingredient item has **exactly**:

```text
{ id, ingredient: {id,name}|null, ingredientId, isAvailable,
  category: category|null, quantity: number|null, unit, isChecked }
```

The list remains exactly `{id,items,createdAt,updatedAt}`. No `type`, `source`, `__v`, owner, or custom row is added to a successful SHOP4 response. For an authenticated, valid v1 request whose owner-scoped service snapshot already contains any custom row, **every** unversioned Shopping route returns the existing error envelope with `HTTP 426`, code `SHOPPING_LIST_UPGRADE_REQUIRED`, and generic message `Update WeCooked to use this shopping list.` No mixed list is serialized as a partial Ingredient projection. The compatibility decision for a v1 GET is linearized at its owner-document read. A GET that reads the ingredient-only list before a v2 custom insertion may finish its earlier 200 response after that insertion; every v1 GET whose read occurs after the custom insertion must return 426. An already-open old client may retain its cached list, and an earlier in-flight GET may update that cache; the next read is the upgrade wall.

For each v1 mutation, check the custom-row guard on the **same owner-document snapshot** that the mutation will save. The version predicate and mutation must commit atomically against that snapshot; a separate check-then-write is insufficient. If a v2 custom insertion wins after the v1 snapshot, the v1 versioned save returns `409 SHOPPING_LIST_STALE` rather than deleting, overwriting, or hiding the new row. This includes zero-checked Clear Checked and an otherwise no-op Clear All. A proven additive `VersionError` retry re-reads the owner document and checks the guard again; if the winning state has a custom row, the retry returns 426 without applying its payload. No destructive operation retries. Version zero remains a valid OCC predicate.

V1 route-level error precedence is: authentication failure → existing 401; malformed body or identifier rejected by existing route validation → existing 400; authenticated, structurally valid request with a custom row in its service snapshot → 426 before Ingredient, Recipe, or item existence lookup; an ingredient-only snapshot → existing business errors or success; a concurrent version change during mutation save → 409 unless the permitted one-time additive retry reaches a fresh compatible state. Existing global middleware runs before these routes: malformed JSON can receive its existing parse error before authentication, and CORS/rate-limit errors retain their existing precedence. SHOP5 does not change that shared middleware. On an ingredient-only snapshot, a foreign or missing row ID remains the same opaque `404 SHOPPING_LIST_ITEM_NOT_FOUND`. The 426 rule does not override authentication or malformed-request validation and does not change v1's successful wire shape.

| Existing v1 route | Ingredient-only service snapshot | Snapshot already has custom row | Custom insertion wins after snapshot |
| --- | --- | --- | --- |
| `GET /` | Exact v1 200 from that snapshot | 426 | Earlier exact v1 200 may finish later; next GET is 426 |
| `POST /items` | Existing Ingredient add/merge and exact v1 response | 426 | OCC conflict; one proven additive retry rechecks guard and returns 426 |
| `PATCH /items/:itemId` | Existing checked/quantity/unit behavior and exact v1 response | 426 | 409; no retry |
| `DELETE /items/:itemId` | Existing opaque delete behavior and exact v1 response | 426 | 409; no retry |
| `DELETE /items/checked` | Existing Clear Checked behavior, including zero-checked OCC write | 426 | 409; no retry |
| `DELETE /items` | Existing Clear All behavior, including empty-list OCC write | 426 | 409; no retry |
| `POST /recipes/:recipeId` | Existing Recipe import/merge and exact v1 response | 426 | OCC conflict; one proven additive retry rechecks guard and returns 426 |

SHOP5 negotiation is an explicit versioned path, requiring no change to the shared mobile API client or its auth-refresh behavior:

| Method and path under `/api/v1/shopping-list` | v2 request body | Result |
| --- | --- | --- |
| `GET /v2` | none | complete v2 list |
| `POST /v2/items` | `{type:"ingredient",ingredientId,unit,quantity?}` **or** `{type:"custom",label}` | complete v2 list |
| `PATCH /v2/items/:itemId` | `{type:"ingredient",isChecked?,quantity?,unit?}` **or** `{type:"custom",isChecked}` | complete v2 list |
| `DELETE /v2/items/:itemId` | none | complete v2 list |
| `DELETE /v2/items/checked` | none | complete v2 list |
| `DELETE /v2/items` | none | complete v2 list |
| `POST /v2/recipes/:recipeId` | none | complete v2 list |

All bodies and params are strict. Ingredient create retains SHOP3 quantity/toTaste rules. Ingredient PATCH requires at least one mutable field and cannot change identity or source. Custom PATCH accepts exactly a boolean `isChecked`; it cannot rename or gain quantity/unit. The PATCH `type` must match the persisted row type; mismatches are `400 VALIDATION_ERROR` with no write. No route accepts `ownerId`, list ID, `_id`, `sourceRecipeIds`, `source`, category, Recipe title, or arbitrary Mongo query object. Keep static `/items/checked` before `/items/:itemId`. Bodyless endpoints reject unexpected bodies/query selectors under the v2 contract.

Every successful v2 response uses the existing success envelope and exactly:

```text
data: {
  shoppingListFormat: 2,
  shoppingList: {
    id: ObjectId string,
    items: Array<IngredientV2 | CustomV2>,
    createdAt: ISO timestamp,
    updatedAt: ISO timestamp
  }
}

IngredientV2: {
  id: ObjectId string, type: "ingredient",
  ingredient: {id: ObjectId string, name: string} | null,
  ingredientId: ObjectId string,
  isAvailable: boolean, category: existing category | null,
  quantity: positive finite number | null, unit: existing UNITS value,
  isChecked: boolean, source: exact variant from section 4
}

CustomV2: {
  id: ObjectId string, type: "custom", label: normalized string,
  isChecked: boolean
}
```

The client validates exact keys, discriminators, IDs, units, categories, timestamps, normalized labels, unique row IDs, and the exact `source` variant fields and boolean types before replacing provider state. A malformed 2xx is `INVALID_RESPONSE` and preserves current state. The SHOP5 client never falls back to v1. Only an `HTTP 404` with code `ROUTE_NOT_FOUND` from **GET `/api/v1/shopping-list/v2`** is mapped to fixed `SHOPPING_LIST_SERVER_UPGRADE_REQUIRED`; this is the existing old-backend missing-route envelope. A 404 from a row or Recipe operation, a different 404 code, a network failure, 5xx, 401, or malformed response keeps its actual classification. SHOP5 mutations require a successful, fully validated v2 GET for the active auth session; any failed v2 GET revokes that capability, even when a cached list or earlier successful capability check exists, until another successful v2 GET. Same-user relogin also clears the earlier capability. Only `SHOPPING_LIST_ITEM_NOT_FOUND` supports existing delete reconciliation. Unknown future API versions are unsupported and do not downgrade. An old client encountering 426 receives a failed operation with no mutation; its UI may show its existing generic API error, but never a filtered 200 list.

## 6. Security, OCC, and mobile state invariants

- All routes authenticate. Owner is only `req.auth.userId`; Admin/Moderator get no cross-user Shopping access. An embedded row ID absent from the current owner's list yields the same opaque `404 SHOPPING_LIST_ITEM_NOT_FOUND` whether foreign or missing. Validate ObjectId syntax before lookup.
- Preserve document `optimisticConcurrency: true` and MIG1-established numeric `__v`, including zero. Every check/uncheck, quantity/unit edit, single delete, Clear Checked, and Clear All saves against the document version. A zero-checked Clear Checked still creates an OCC linearization write. `VersionError` maps to `409 SHOPPING_LIST_STALE`.
- Only Ingredient add, Custom add, and Recipe import may retry **once** after a proven Mongoose `VersionError`. Re-read, recheck v1 compatibility if applicable, reapply the original validated payload, enforce both row and source bounds, then save once. A custom retry creates exactly one row in the winning save; ambiguous network/5xx/malformed-success outcomes are not retried automatically. The mobile client never performs an automatic destructive replay.
- Preserve `ShoppingListContext` as the one mutation owner: synchronous lock, complete response replacement, account and same-user relogin generation fencing, stale response protection, unmount/focus fencing, and guarded reload on stale or ambiguous destructive outcome. A custom draft survives a failed/stale submit. New row rendering and grouping cannot modify authoritative state locally.
- The Ingredient picker and SHOP3 quantity/unit editor remain Ingredient-only. Custom row actions use ID and checked state. Existing checkbox, swipe-reveal Delete, Edit-mode Remove, Clear Checked count, Clear All confirmation, and accessibility semantics continue across both types.

## 7. Proposed exact implementation allowlists

Only these production paths are proposed for a later authorized SHOP5 implementation:

**Backend**

- `apps/api/src/modules/shopping-lists/shopping-list.model.js` — embedded union and bounds.
- `apps/api/src/modules/shopping-lists/shopping-list.validation.js` — strict v2 bodies/params.
- `apps/api/src/modules/shopping-lists/shopping-list.repository.js` — only if bounded owner-document lookup or save support proves necessary; no new write bypass.
- `apps/api/src/modules/shopping-lists/shopping-list.service.js` — type-aware mutations, compatibility guard, provenance and OCC.
- `apps/api/src/modules/shopping-lists/shopping-list.serializer.js` — exact v1/v2 serializers.
- `apps/api/src/modules/shopping-lists/shopping-list.controller.js` — v2 envelope and error routing.
- `apps/api/src/modules/shopping-lists/shopping-list.routes.js` — versioned route declarations and ordering.
- `apps/api/src/modules/shopping-lists/shopping-list.custom-label.js` (new) — API normalization and validation.
- `apps/api/src/modules/recipes/recipe.service.js` — bounded consumer-visible title batch boundary.
- `apps/api/src/modules/recipes/recipe.repository.js` — one bounded Recipe batch query.

**Mobile**

- `apps/mobile/src/api/shoppingListService.js` — v2 paths and exact parser.
- `apps/mobile/src/api/shoppingListErrors.js` — upgrade/source-limit/error copy.
- `apps/mobile/src/context/ShoppingListContext.js` — custom add and existing fencing.
- `apps/mobile/src/screens/ShoppingListScreen.js` — inline entry, row/source labels, type-aware controls.
- `apps/mobile/src/utils/shoppingListGrouping.js` — Custom Items last.
- `apps/mobile/src/utils/shoppingCustomLabel.js` (new) — matching immediate label validation.
- `apps/mobile/src/components/SwipeToDelete.js` — only if inspection finds a concrete custom-row accessibility or swipe defect; do not rebuild SHOP4 behavior.

**Behavioral tests**

- `apps/api/test/shopping-list-model.test.js`
- `apps/api/test/shopping-list-validation.test.js`
- `apps/api/test/shopping-list-repository.test.js` — only if repository behavior changes.
- `apps/api/test/shopping-list-service.test.js`
- `apps/api/test/shopping-list-routes.test.js`
- `apps/api/test/shopping-list-mongo.test.js` — existing, opt-in isolated Mongo.
- `apps/api/test/recipe-service.test.js` — bounded Recipe visibility batch boundary.
- `apps/mobile/__tests__/shoppingListService.test.js`
- `apps/mobile/__tests__/shoppingListInteraction.test.js`
- `apps/mobile/__tests__/shoppingListGrouping.test.js`
- `apps/mobile/__tests__/shoppingListStaticAudit.test.js` — replace its historical SHOP3 tracked-scope assertion with SHOP5-approved scope evidence, without weakening behavioral checks.
- `apps/mobile/__tests__/mealPlanShopping.test.js` — only if Recipe import interaction needs adjustment.

The previously audited Shopping model/service/controller/routes and mobile service/context/screen remain core. The actual baseline additionally requires **Shopping validation and serializer** for a strict row union and exact v1/v2 wire shapes, **grouping** for the Custom Items section, and the **Recipe service/repository boundary** for a non-N+1 consumer-visible title lookup. The existing repository and Swipe component are conditional paths, not automatic rewrites. No Recipe model/schema, Ingredient module, auth, shared API client, navigation, package file, lockfile, migration command, index, MEAL4, RANK1, or protected stash belongs to SHOP5. A necessary path outside this proposed list requires contract amendment before implementation.

## 8. Required verification and acceptance gates

Focused API behavior must cover legacy missing-type and missing-origin reads; exact v1 and v2 shapes; custom persistence and server IDs; repeated equal labels; Unicode normalization/code-point boundaries, controls, bidi and surrogate rejection; cross-field/type payload rejection; the 200-row, 8-per-row, and 200-per-list limits; same-Recipe and distinct-Recipe imports; mixed manual quantities; no retroactive Recipe quantity rewrite; rename, unpublish, private/inactive, incomplete, and delete title visibility; one bounded batch query; v1 426 on every valid read/write route whose service snapshot contains custom rows; v2-on-old-backend behavior; owner/BOLA opacity; and stale `__v=0` destructive conflicts. Verify both Clear Checked and Clear All across row types and no lost rows under concurrent add/import/clear.

Focused mobile behavior must cover exact parser rejection and complete-list replacement; v2-only activation; no fallback after unsupported GET; inline custom entry and draft retention; same-frame duplicate submit; group order; count across types; persisted check/uncheck/delete; Ingredient editor exclusion for custom rows; source labels without quantity attribution or unavailable title leaks; session/account transitions, same-user relogin, late responses, and focus/unmount alerts; swipe reveal plus explicit Delete and Edit-mode alternative; and readable accessibility names/states.

The first independent-review corrections add these **counterfactual test requirements** within the same allowlists:

1. API serializer and mobile exact parser accept `quantityEdited: false` **and** `true` for each applicable `single`, `multiple`, and `unavailable` variant; reject a missing, non-boolean, or extra source field. Import two distinct Recipes without manual editing to produce `multiple:false`; hide a solely imported Recipe to produce `unavailable:false`; verify manual add/edit sets true and later import or unpublish does not reset it.
2. Interleave v1 GET before and after a v2 custom insertion. The pre-insert snapshot may finish as exact ingredient-only 200 after the insert; a post-insert read returns 426, and a mixed snapshot is never serialized as a filtered 200. For each existing v1 mutation route—Ingredient add, Recipe import, PATCH, single delete, Clear Checked (including zero checked), and Clear All (including empty)—interleave custom insertion after the guard and before save. Destructive operations return 409 with the custom row intact; each additive route retries at most once after a proven version conflict, rechecks compatibility, and returns 426 without adding. Repeat with `__v=0`, and verify unrelated version changes retain the existing stale/retry rules.
3. For every v1 route, test parsed unauthenticated 401, its applicable authenticated malformed-body/identifier 400, valid mixed-snapshot 426, and a racing 409 where applicable. Assert that existing global JSON parse, CORS, and rate-limit precedence is unchanged. With no custom row, foreign and missing item IDs remain indistinguishable opaque 404s; a valid mixed-snapshot request does not leak Ingredient, Recipe, or row existence ahead of the 426 guard.
4. Resolve all stored source IDs before labeling: one visible source uses its current title, two visible sources use `multiple`, one hidden source uses `unavailable`, and mixed visible/hidden or multiple hidden sources use the **same** `unavailable` shape and generic label without title, ID, or hidden count. Confirm bounded lookup and retention of historical stored IDs. Verify `Includes Recipe A`, `Includes multiple recipes`, the generic unavailable label, and `Amount manually adjusted or mixed` for a 9 kg manual plus 1 kg Recipe A row without claiming all 10 kg came from Recipe A.
5. Run **every literal escaped JSON input** in section 3 through both API and mobile label validators after one JSON decode. Reject U+2800, U+3164, and U+FFA0 alone and mixed with visible text; U+115F and U+1160 alone and together; blank-only combinations; whitespace plus blank scalars; U+200B alone or inside a label; U+2060, U+FEFF, soft hyphen, combining-only input, lone/edge/adjacent joiners, controls, bidi controls, and 0/81-code-point boundaries. Accept ordinary Ingredient-like names, Korean and other multilingual names, composed combining sequences, emoji, and valid contextual U+200C/U+200D sequences. Assert the exact NFC/whitespace-normalized accepted values, identical API/mobile classifications without depending on Unicode-property regex support, and `400 VALIDATION_ERROR` field `label` for each API rejection.
6. On mobile, map only `404 ROUTE_NOT_FOUND` from the exact v2 GET to `SHOPPING_LIST_SERVER_UPGRADE_REQUIRED`; test unrelated row/Recipe 404s, a different v2 GET 404 code, network failure, 5xx, malformed 2xx, stale cached capability, and same-user relogin. Each failed v2 GET blocks SHOP5 mutations until a fresh validated v2 GET for that auth session, without falling back to v1.

`shopping-list-mongo.test.js` remains an **opt-in, isolated, environment-gated non-production** proof. Use tagged rows/owners, verify exact database binding before any connection, and clean only test-owned data. Prove current and migrated legacy `__v=0` OCC, concurrent custom/Ingredient/import/clear races, winner-state preservation, one additive retry after proven `VersionError`, and zero retry after ambiguous outcomes. This contract authorizes **no Mongo read or write now**. Synthetic tests alone do not pass this gate.

Real Android and iOS acceptance must each prove inline TextInput and keyboard behavior, VoiceOver/TalkBack label and focus order, checkbox and swipe/vertical-scroll coexistence, explicit Delete and Edit-mode fallback, both Clear actions across types, account transitions, old/new app coexistence against the compatible backend, cross-device persistence and conflict reconciliation, and an old client's 426 on its next read after custom-row creation. A previously cached or pre-insert in-flight ingredient-only snapshot may remain visible; no mixed-list snapshot may be returned as a filtered 200. Record OS/build/backend version and observed results. These are **NOT RUN — NOT CLAIMED AS PASS** in contract preparation.

## 9. Release dependencies and exclusions

Required order:

```text
SHOP4-MIG1 controlled production dry-run and backfill under write quiescence
  -> exact postcheck (missing=0, invalid=0), second apply (matched=0, modified=0)
  -> SHOP4 backend/runtime/physical/accessibility prerequisites
  -> SHOP4 activation
  -> SHOP5 compatible backend with v1 guard and v2 routes
  -> v2 backend smoke and old-client compatibility proof
  -> SHOP5 mobile activation
  -> real Android/iOS and cross-version acceptance
```

MIG1 must retain its exact `shoppinglists` raw `__v:0` backfill, snapshot, writer drain, no stale hydrated writer, and isolated OCC proof. SHOP4's existing release hold is not lifted by this draft. Check Render Free auto-deploy behavior and schedule writer quiescence explicitly; do not assume a background worker, always-on process, or atomic simultaneous backend/mobile rollout. Deploy backend first and keep the old-client 426 guard for the entire period old clients can still connect. If SHOP5 backend must roll back after custom rows exist, stop mobile activation and maintain a compatible API or perform a separately contracted recovery; an older backend cannot safely serve those rows.

Exclude Recipe navigation, provenance backfill, title snapshots, source quantity allocation, custom rename/quantity/unit/category, name deduplication, new Ingredient identities, SHOP3/SHOP4 rebuild, auto startup migration, package upgrades, new indexes, local-only Shopping data, and unrelated feature/schema expansion.

## 10. Independent-review questions before freeze

1. Confirm the proposed **8 per row / 200 distinct per list** source bounds and whole-import rejection when the bound is reached.
2. Confirm the v1 **426 upgrade wall** for each authenticated, valid Shopping request whose service snapshot contains custom rows, including old-client inability to read even its Ingredient rows until upgrade; an earlier in-flight ingredient-only GET may finish later.
3. Confirm the v2 URL prefix and strict tagged PATCH body; these keep the shared API client and SHOP4 wire shape untouched.
4. Confirm source copy (`Includes <current Recipe title>`, `Includes multiple recipes`, `Recipe source unavailable`, `Amount manually adjusted or mixed`) and the absence of source navigation or hidden-source counts.
5. Confirm that `quantityEdited` remains true after manual amount/unit changes or a merge with pre-existing manual/legacy quantity, while Recipe source IDs remain historical row associations.

**Verdict: CONTRACT FROZEN — IMPLEMENTATION AUTHORIZED; PRODUCTION RELEASE HELD.**
