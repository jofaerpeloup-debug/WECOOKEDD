# MOBILE-SHOP4 — Shopping Completed and Delete

## 1. Status and authority

- Audit: **COMPLETE**
- Contract review: **APPROVED**
- Contract: **FROZEN**
- ING2 dependency: **SATISFIED**
- Current-main implementation: **COMPLETE** at `c66cf82f357d953668e03ee419198103f6beab85`
- Independent integration re-review: **PASS**
- All five original targeted findings: **CLOSED**
- Status: **ENGINEERING COMPLETE, RELEASE HELD**
- Release: **PRODUCTION RELEASE HOLD; deployment not authorized**
- Baseline at implementation start: `origin/main` at `11e788427166f5c2e7c5b456bef80b205639a61f`

### Finalization evidence

- API SHOP4 focused verification: **103 PASS, 0 FAIL, 1 SKIPPED** across model,
  service, routes, and guarded Mongo tests. The skipped test is isolated live-Mongo.
- Mobile SHOP4 focused verification: **91 PASS, 0 FAIL** across interaction,
  service, and static audit tests.
- Relevant SHOP3/auth API regressions: **210 PASS, 0 FAIL, 1 SKIPPED** across
  Shopping repository/validation/MIG1 and auth/session tests. The skipped test
  is MIG1 isolated live-Mongo.
- Relevant SHOP3/auth mobile regressions: **151 PASS, 0 FAIL** across Shopping
  grouping and auth/session tests.
- Independent integration re-review: **PASS**; the five original findings are
  closed, covering same-user session-generation fencing, version-zero OCC,
  null-category response compatibility, safe opt-in Mongo guards/cleanup, and
  screen focus/mount alert fencing.
- Exact 17-path frozen scope: **PASS**; merged SHOP4-MIG1 files unchanged.
- `git diff --check`: **PASS**.
- The full regression suite is not claimed as passed. Its unrelated historical
  baseline failures remain baseline dispositions; SHOP4 neither changes nor
  resolves them.
- SHOP4 live Mongo concurrency: **NOT RUN — NOT CLAIMED AS PASS**.
- SHOP4-MIG1 production backfill: **NOT RUN — NOT CLAIMED AS PASS**.
- Physical swipe/accessibility: **NOT RUN — NOT CLAIMED AS PASS**.
- Render auto-deploy: **UNVERIFIED**.
- SHOP4 merge and production deployment: **HOLD; NOT AUTHORIZED**.

This document is the implementation authority for MOBILE-SHOP4. Authority is,
in order: `/AGENTS.md`, the live repository at the baseline above, this frozen
contract, and the completed MOBILE-SHOP4 audit. MOBILE-ING2 is present through
PR #97 and merge commit `11e788427166f5c2e7c5b456bef80b205639a61f`.

This freeze does not implement production behavior, change tests, authorize a
production database mutation, or claim automated, live-Mongo, device, or
accessibility-runtime verification.

## 2. Milestone purpose

MOBILE-SHOP4 completes the existing server-authoritative Shopping experience
with:

- a count-aware Clear Checked control;
- server-authoritative checked-row deletion;
- swipe-reveal individual delete;
- preservation of explicit Edit-mode delete;
- strict validation of successful mobile Shopping responses;
- document-level Mongoose optimistic concurrency; and
- safe reconciliation after stale or ambiguous destructive outcomes.

SHOP5 custom Shopping rows are explicitly outside this milestone.

## 3. Frozen user-visible behavior

Checked rows remain persisted and visible in their canonical category and
existing list order. They remain muted and struck through. Checking a row does
not move it to a completed section or otherwise reorder it.

When Edit mode is off and `checkedCount > 0`, show exactly:

- `Clear 1 checked item` for one checked row; or
- `Clear N checked items` for the exact plural count.

The count is derived from authoritative Shopping List items and is never
persisted separately. When `checkedCount === 0`, the Clear Checked control is
hidden. SHOP4 adds no total count, remaining count, or Shopping status summary.

If every row is checked, all rows remain visible until Clear Checked succeeds.
If that success removes every row, show the existing empty Shopping List state.
Clear Checked has no confirmation.

Existing Clear All remains separate and unchanged: it removes every row,
retains its destructive confirmation, and reconciles from the complete
authoritative Shopping List response. `DELETE /api/v1/shopping-list/items`
must not be repurposed, merged with Clear Checked, or renamed.

## 4. Clear Checked API contract

Add:

`DELETE /api/v1/shopping-list/items/checked`

The endpoint is authenticated. Ownership is derived exclusively from
`req.auth.userId`; the client supplies no owner id, arbitrary user id, or list
id. There is no request-body contract. The static `/items/checked` route must
be declared before `/items/:itemId`.

The operation reads the authenticated user's Shopping List, removes only rows
whose stored `isChecked === true`, saves through the optimistic-concurrency
path, and returns the complete authoritative Shopping List. Zero checked rows
is a successful `200` no-op returning that complete list. It does not return a
separate count.

All Shopping mutations remain authenticated. Embedded row ids are validated.
Missing and foreign row ids remain equivalently opaque. Moderator and Admin
roles receive no cross-user Shopping capability, and bulk Clear Checked can
operate only on the authenticated user's Shopping List.

## 5. Individual delete and idempotency contract

The existing authoritative endpoint remains:

`DELETE /api/v1/shopping-list/items/:itemId`

`:itemId` is the embedded Shopping row id. A left swipe reveals, but does not
activate, a destructive action labeled `Delete <item name>`. Deletion occurs
only when the user activates that revealed action, with no confirmation.

The existing explicit Edit-mode action labeled `Remove <item name>` remains
available. Swipe is supplementary and must never become the only deletion
path.

Missing and foreign Shopping rows continue to return the opaque contract:

```text
HTTP 404
code: SHOPPING_LIST_ITEM_NOT_FOUND
```

Mobile may classify a deletion as already completed only when the exact error
code is `SHOPPING_LIST_ITEM_NOT_FOUND`. It must not classify every HTTP 404 as
an idempotent delete.

## 6. Strict mobile response boundary

Every successful Shopping List API response must be strictly validated before
it can become mobile domain state. A malformed 2xx response is an error. It
must not be silently repaired, sorted, filtered, normalized, or converted to a
valid-looking fallback such as `[]`.

A malformed success must never:

- erase visible rows;
- fabricate successful single deletion, Clear Checked, or Clear All;
- fabricate checked counts; or
- fabricate authoritative reconciliation.

Only a response that satisfies the frozen Shopping List response contract may
replace the current list.

## 7. Optimistic concurrency and stale-conflict contract

`ShoppingList` is one persisted aggregate document. Enable Mongoose document
optimistic concurrency with:

```js
optimisticConcurrency: true
```

Use the existing Mongoose version key. All relevant read-modify-save mutations
must participate in document version checks; do not add update paths that
silently bypass optimistic concurrency. Do not serialize `__v` to mobile.

Map Mongoose `VersionError` through existing WeCooked API error-envelope
conventions to:

```text
HTTP 409
code: SHOPPING_LIST_STALE
```

The following operations are non-commutative:

- check and uncheck;
- quantity and unit edit;
- single delete;
- Clear Checked; and
- Clear All.

On `SHOPPING_LIST_STALE`, mobile must not replay the mutation automatically. It
must reload and reconcile the authoritative Shopping List, then require a new
explicit user action if the user still wants the mutation. There is no silent
overwrite or automatic destructive replay.

Existing additive `addItem` and recipe-import operations may retry at most once
after a proven Mongoose `VersionError`. The allowed sequence is: read the
latest document, reapply the original already-validated payload, and save once
more. No automatic retry is permitted after a timeout, connection reset,
request cancellation, unknown network outcome, arbitrary 5xx response, or
malformed response. An unknown outcome may already have succeeded.

Clear Checked operates on one server snapshot: read the Shopping List, identify
the rows whose stored `isChecked === true`, remove them, and save with document
optimistic concurrency. A concurrent check, uncheck, add, recipe import,
quantity/unit edit, single delete, Clear All, or Clear Checked after that read
must cause the save to fail as `SHOPPING_LIST_STALE`. SHOP4 adds no
client-generated version or mutation anchor.

## 8. Mobile mutation ownership and reconciliation

Preserve `ShoppingListContext` as the single global owner of Shopping
mutations. One mounted account/provider continues to serialize mutations.
SHOP4 must preserve protection against:

- same-frame duplicate attempts;
- check/delete overlap;
- mutation/refresh overlap;
- authenticated account transition from A to B;
- stale completion;
- unmount/remount; and
- list-generation replacement.

Do not add per-row queues. After a stale conflict, reconcile the authoritative
list before enabling another conflicting destructive operation. After an
ambiguous destructive network outcome, do not replay the mutation; first
perform guarded authoritative reconciliation.

## 9. Swipe and accessibility contract

Implement swipe with React Native core or a gesture primitive already installed
in the repository. Do not add a gesture dependency. If safe behavior requires
another package, stop and request a contract amendment before changing
`package.json` or a lockfile.

The horizontal gesture must coexist with normal vertical Shopping List
scrolling and must not consume checkbox taps. Preserve existing checkbox
semantics:

- checkbox role;
- checked state;
- disabled/busy state;
- `Check <name>`; and
- `Uncheck <name>`.

The revealed destructive action has the accessible label
`Delete <item name>`. Edit mode retains `Remove <item name>`. Clear Checked has
button semantics, the count-aware accessible name, and disabled/busy semantics
during mutation where applicable.

Automated and source tests cannot establish TalkBack, VoiceOver, focus,
discoverability, or physical gesture behavior.

## 10. SHOP5 compatibility boundary

SHOP4 remains compatible with future SHOP5 rows without implementing them. It
may depend only on:

- `item.id`;
- `item.isChecked`; and
- the resolved primary display label.

Clear Checked operates generically on `isChecked`, with no row-type branching.
SHOP4 must not introduce a Shopping item discriminator, custom row type,
free-text Shopping item, provenance, fake Ingredient identity, guessed category,
custom-item validation, SHOP5 persistence, or SHOP5 API behavior.

## 11. Production allowlist

Only these production paths may change during implementation:

- `apps/api/src/modules/shopping-lists/shopping-list.model.js`
- `apps/api/src/modules/shopping-lists/shopping-list.service.js`
- `apps/api/src/modules/shopping-lists/shopping-list.controller.js`
- `apps/api/src/modules/shopping-lists/shopping-list.routes.js`
- `apps/mobile/src/api/shoppingListService.js`
- `apps/mobile/src/api/shoppingListErrors.js`
- `apps/mobile/src/context/ShoppingListContext.js`
- `apps/mobile/src/screens/ShoppingListScreen.js`
- `apps/mobile/src/components/SwipeToDelete.js` (new if required)

There is no current authorization for repository, serializer, validation,
grouping, navigation, authentication, Ingredient, Recipe, `package.json`,
lockfile, or SHOP5 model changes. If implementation proves another production
path necessary, stop and amend this contract before editing it.

## 12. Test allowlist and required automated proof

Only these test paths may change during implementation:

- `apps/api/test/shopping-list-model.test.js`
- `apps/api/test/shopping-list-service.test.js`
- `apps/api/test/shopping-list-routes.test.js`
- `apps/api/test/shopping-list-mongo.test.js` (new if required)
- `apps/mobile/__tests__/shoppingListService.test.js`
- `apps/mobile/__tests__/shoppingListInteraction.test.js`
- `apps/mobile/__tests__/shoppingListStaticAudit.test.js`

`shopping-list-mongo.test.js` must be isolated and environment-gated.

Backend behavioral proof must cover partial, all-checked, and zero-checked Clear
Checked; authenticated ownership and foreign-owner opacity; static route
ordering; `VersionError` mapping; exclusion of `__v` from serialization; exact
error-code delete idempotency; additive retry at most once after `VersionError`;
and no retry after an unknown request outcome.

Mobile behavioral proof must cover singular/plural labels and zero-count
hiding; absence of a Clear Checked confirmation; complete authoritative list
replacement; malformed-2xx rejection; stale reconciliation without automatic
replay; swipe-left reveal followed by explicit Delete activation; vertical
scroll coexistence; a usable checkbox; the Edit-mode fallback; account-switch
safety; stale refresh/mutation protection; and guarded reconciliation after an
ambiguous destructive outcome.

Tests must prove behavior rather than mere string presence.

## 13. Required isolated live-Mongo proof

Before implementation closure, use isolated non-production Mongo to prove:

- two concurrent saves against the same Shopping List;
- exactly one save succeeds and exactly one receives stale `VersionError`
  behavior;
- the winner's state remains intact with no lost rows;
- the application maps the stale conflict correctly;
- additive retry applies the payload exactly once;
- current `__v` behavior; and
- missing-`__v` legacy behavior where safely constructible.

Do not access or mutate production Mongo. Shared development Mongo is not
required unless separately approved.

## 14. Legacy `__v` decision gate

No migration is frozen. A claim of `NO MIGRATION REQUIRED` is blocked until
isolated live-Mongo verification covers both a normal current Shopping List
document and, where safely constructible, a representative legacy document
missing `__v`, including its first optimistic-concurrency-protected mutation.

If the missing-`__v` document cannot participate safely, stop. Do not patch
around the condition silently. Design and freeze a separate migration contract.
No production database mutation belongs to SHOP4 implementation.

## 15. Required physical device and accessibility verification

Before any release claim, physical verification must cover:

- swipe reveal and horizontal gesture behavior;
- coexistence with vertical scrolling;
- checkbox taps near a swipeable row;
- the explicit Edit-mode fallback;
- partial and all-complete Clear Checked states;
- TalkBack and VoiceOver naming;
- focus order; and
- destructive-action discoverability.

Automated evidence must not be reported as a physical runtime pass.

## 16. Explicit exclusions

SHOP4 excludes custom/free-text rows, provenance, item discriminators,
custom-row migration, a completed section, checked-row reordering, drag/drop,
undo, trash, batch selection, pricing, budget, barcode behavior, persisted
counts, a totals endpoint, total/remaining status lines, terminology redesign,
new gesture dependencies, and per-row mutation queues.

## 17. Dependency status, blockers, and verdict

The prior MOBILE-ING2 procedural dependency is satisfied by PR #97 and merge
commit `11e788427166f5c2e7c5b456bef80b205639a61f`. Implementation must begin from
the latest `origin/main` after this contract freeze.

The current-main implementation and targeted independent integration re-review
are complete. The frozen release sequence still requires SHOP4-MIG1 production
backfill under write quiescence, postcheck and idempotency proof, isolated live
Mongo OCC proof, and physical swipe/accessibility verification before any
production release claim. Deployment is not authorized in this phase.

**MOBILE-SHOP4 ENGINEERING COMPLETE — RELEASE HELD**
