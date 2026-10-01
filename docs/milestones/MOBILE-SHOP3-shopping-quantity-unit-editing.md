# MOBILE-SHOP3 — Shopping Quantity and Unit Editing

## 1. Status and authority

- Audit: **COMPLETE**
- Contract freeze: **COMPLETE**
- Implementation: **COMPLETE**
- Independent review: **COMPLETE**
- Required test hardening: **COMPLETE**
- Closure: **PASS**
- Runtime: **DEFERRED — NOT RUN — NOT CLAIMED AS PASS**
- Baseline: `main` at `674d7811d2eb1459b6c56e7117800a72d0e84949`

This document freezes a mobile-only implementation contract. Authority is, in
order: `/AGENTS.md`, the live repository at the baseline above, the completed
MOBILE-SHOP3 audit, and the existing Shopping PATCH contract. The teammate
repository is presentation reference only, pinned at
`4ffd47d176afcfb1f23ffa1be079f01791fae92e`; none of its mock data, local
persistence, free-text behavior, category guesses, or name-based identity is
authoritative.

## 2. Product goal

An authenticated user can edit the quantity and unit of one existing Shopping
item without deleting and re-adding it:

`Shopping List -> choose an available item -> edit quantity/unit -> Save -> existing PATCH -> replace from the full server response`

Ingredient identity and category remain immutable. This milestone does not
change the backend, schema, service endpoint, navigation, global theme, or
Shopping persistence architecture.

## 3. Current Shopping architecture

The existing data path remains the only Shopping authority:

`ShoppingListScreen -> ShoppingListContext -> shoppingListService -> shared API client -> /api/v1/shopping-list -> MongoDB`

`ShoppingListContext` already provides the authenticated-owner gate, render-time
owner isolation, session and list-generation guards, a synchronous one-mutation
lock, pessimistic mutations, stale-response rejection, and full-list
replacement from mutation responses. SHOP3 adds only a narrow `updateItem`
context action through that existing `runMutation` path. It does not add local
Shopping state, optimistic row rewriting, another provider, a queue, or direct
screen-to-service calls.

All existing behavior remains: canonical add-item picker, category grouping,
check/uncheck, remove, destructive edit mode, clear-all, Recipe import, Meal
Plan import, focus reload, pull-to-refresh, loading/error/empty states,
unavailable-item presentation, and owner/session protections.

## 4. Frozen existing PATCH reuse

No backend or mobile service change is permitted or expected. Reuse:

`PATCH /api/v1/shopping-list/items/:itemId`

The existing `shoppingListService.updateItem(itemId, patch)` already encodes the
Shopping **item id**, sends the patch through the shared authenticated API
client, unwraps the full returned Shopping list, and maps existing 404, 409,
validation, network, authentication, and server failures.

SHOP3 Save may send only these bodies:

```js
// Measurable unit
{ quantity: positiveFiniteNumber, unit: canonicalMeasurableUnit }

// toTaste
{ quantity: null, unit: 'toTaste' }
```

Do not send `ingredientId`, `ingredient`, `category`, `userId`, `isChecked`, or
any arbitrary field. `isChecked` remains exclusive to the existing independent
check/uncheck action.

## 5. Canonical unit and quantity contract

The edit modal must consume the existing mobile canonical unit source already
used by recipe and Shopping add UI (`RECIPE_UNITS` and `unitLabel` from
`apps/mobile/src/api/recipeOptions.js`). Do not introduce a second SHOP3 unit
array or accept free-text units.

For every measurable unit, quantity must be parsed to a JavaScript number and
must be numeric, finite, and greater than zero before Save. Decimals such as
`2.5 kg` and `0.5 cup`, and whole values such as `3 piece`, are valid under the
current API conventions. Blank values, zero, negative values, `NaN`, infinity,
and string fractions such as `1/2` are invalid and must not reach the context or
service.

There is no unit conversion, equivalence calculation, rounding contract, or
cross-unit arithmetic. The exact user-entered valid numeric value and selected
canonical unit are submitted.

## 6. Frozen `toTaste` transitions

- Measurable to `toTaste`: selecting `toTaste` immediately clears the modal's
  quantity draft, hides/disables the quantity input, and Save sends
  `{ quantity: null, unit: 'toTaste' }`. The explicit `null` is required so the
  backend does not retain the stored measurable quantity during its
  prospective-state check.
- `toTaste` to measurable: selecting any measurable unit reveals an empty
  quantity input. Save remains blocked until the user supplies a valid positive
  finite quantity. The old pre-`toTaste` value must not reappear.
- Repeated unit changes must never retain or submit a hidden stale quantity.

## 7. Item identity and immutable fields

The selected row is captured and mutated by `item.id`, which is the embedded
Shopping item id. Modal state and reconciliation must not use row index,
ingredient name, or `ingredientId` alone.

Ingredient name and canonical category may be displayed, but only as read-only
server-projected information. There is no Ingredient picker, Ingredient
replacement, category input, category override, or client category inference in
the edit modal.

Rows sharing one `ingredientId` remain independent when their item ids or units
differ. Saving one row must not edit, replace, merge, remove, or close over the
other row.

## 8. Duplicate-collision contract

Changing a unit can collide with another row having the same exact
`ingredientId + unit`. The backend already rejects that transition with
`409 SHOPPING_LIST_ITEM_ALREADY_EXISTS`.

On that response the client must:

- preserve the full original Shopping list and both rows;
- perform no client-side merge, sum, delete, retry, or fallback request;
- keep the modal open with its current draft intact;
- show truthful guidance that the Ingredient already exists in that unit; and
- let the user choose another unit or Cancel.

The existing safe error mapping may provide the conflict copy. The raw backend
body is not displayed.

## 9. Unavailable-item behavior

Editing is **disabled** for an item whose public projection is
`isAvailable: false` or whose `ingredient` is `null`.

The live serializer retains the historical `ingredientId`, quantity, unit,
checked state, and Shopping item id, but deliberately projects `ingredient:
null` and `category: null`; there is no historical Ingredient name or category
to show. SHOP3 must not invent or re-resolve that metadata. Such a row keeps the
existing generic unavailable presentation, check/uncheck behavior, and removal
path, but receives no edit affordance and cannot open
`ShoppingItemEditModal`. Removal remains available in destructive edit mode.

## 10. Edit-modal workflow

Create `apps/mobile/src/components/ShoppingItemEditModal.js` during
implementation. In normal, non-destructive mode, each **available** row gets a
separate, accessible edit affordance. The checkbox remains a distinct Pressable
whose only action is check/uncheck; tapping it must never open the edit modal.
The existing header `Edit` action continues to mean destructive remove mode and
must not open the quantity/unit editor.

On open, local modal draft state is initialized from that exact row:

- Ingredient name: `item.ingredient.name`, read-only and prominent;
- category: current server-projected `item.category`, read-only and rendered
  through existing canonical category labeling;
- unit: current `item.unit`;
- quantity: current `item.quantity` for measurable units;
- quantity: blank/absent for `toTaste`.

The modal uses Sage & Stone theme tokens, compact hierarchy, canonical unit
controls, clear inline validation, and a strong Save action. It must be
keyboard-safe and support accessible labeled Close and Cancel actions. Closing,
Cancel, or backdrop dismissal performs no Shopping mutation and discards only
the local draft.

## 11. Save, pending, success, and failure

After local validation, Save calls exactly:

```js
updateItem(item.id, { quantity, unit })
```

where `quantity` is a positive finite number for measurable units and `null`
for `toTaste`. The context wrapper uses
`runMutation({ type: 'updateItem', itemId }, ...)` and the existing service
function. It inherits the authenticated-owner guard, synchronous mutation lock,
stale GET invalidation, session/unmount rejection, and full-list replacement.

While pending, Save exposes a busy state and is disabled. A rapid duplicate Save
cannot issue a second request, and the authoritative row remains unchanged.
Other Shopping mutations remain disabled by the existing global mutation lock.

On success, the context replaces its list with the complete server-returned
Shopping list. The screen does not fabricate, splice, map, merge, or optimistically
rewrite a row. The modal closes only after the successful authoritative
reconciliation result.

On local validation error, 409 conflict, network error, backend/server error, or
another recoverable failure:

- the original Shopping list and row remain unchanged;
- the modal remains open;
- the user's draft remains intact where applicable;
- a safe, truthful error is shown; and
- no automatic retry or alternate mutation occurs.

A superseded owner/session or unmounted continuation must not update the newer
list, surface stale UI state, or close a modal in a newer screen/session.

## 12. Teammate presentation decisions

Adopt or adapt only the pinned teammate build's compact grouped-row rhythm,
Sage & Stone surfaces and typography, restrained hierarchy, and checked-state
treatment. Extend that product language into a compact edit sheet/modal with a
prominent Ingredient name and clear Save action.

Do not copy its AsyncStorage authority, generated local ids, free-text add bar,
keyword-derived Produce/Meat/Pantry categories, name-only de-duplication, mock
Recipe or Shopping data, clear-checked behavior, swipe behavior, or local
Shopping mutations. The live app's API, context, server categories, theme,
navigation, data shapes, destructive edit mode, and persistence remain
authoritative.

## 13. Production allowlist

Only these production files may change during implementation:

- `apps/mobile/src/context/ShoppingListContext.js`
- `apps/mobile/src/screens/ShoppingListScreen.js`
- `apps/mobile/src/components/ShoppingItemEditModal.js` (new)

No `shoppingListService.js` or backend change is expected. If another production
file is genuinely required, stop and justify the expansion before changing it.

## 14. Test allowlist and required behavior

Only these tests may change during implementation:

- `apps/mobile/__tests__/shoppingListStaticAudit.test.js`
- `apps/mobile/__tests__/shoppingListInteraction.test.js` (new if required)

Mounted behavior must prove:

- the correct Shopping item id opens the modal;
- measurable quantity and unit prefill from the selected row;
- `toTaste` prefills without a quantity;
- measurable-to-measurable editing;
- measurable-to-`toTaste` clears and sends `quantity: null`;
- `toTaste`-to-measurable blocks Save until a valid quantity exists;
- the exact `updateItem(itemId, { quantity, unit })` payload;
- rapid duplicate Save produces only one request while pending;
- success reconciles from the full server-returned list before close;
- 409 preserves both rows, the open modal, and its draft;
- network/server failure preserves the row, open modal, and draft;
- Cancel/Close performs no mutation;
- two rows sharing an Ingredient but having different item ids/units remain
  independent;
- Ingredient and category are rendered read-only;
- unavailable rows cannot open the modal and remain removable;
- check/uncheck remains independently tappable and does not open the modal;
- remove and clear-all still work;
- grouping still uses canonical server categories;
- stale owner/session and unmounted responses cannot mutate newer state or
  close newer UI.

The static audit must inspect bounded handler/render/context regions and reject
free-text Shopping items, category guessing, Ingredient replacement,
client-side unit conversion, cross-unit merging, AsyncStorage Shopping
authority, mock Recipe data, backend changes, clear-completed behavior,
drag/reorder, and store/pricing behavior. String presence alone is not
sufficient evidence for mounted interactions.

## 15. Explicit out of scope

- Clear completed or clear checked
- Bulk delete or bulk update
- Free-text or custom Shopping items
- Category overrides or client category inference
- Ingredient replacement
- Unit conversion or cross-unit consolidation
- Recipe serving scaling
- Recipe import, Meal Plan import, or import-preview redesign
- Reordering or drag-and-drop
- Store, aisle, pricing, or budget behavior
- Barcode scanning
- Sharing or collaboration
- Notifications or reminders
- AI
- Nutrition
- Grocery-delivery APIs
- Backend, schema, or migration changes
- Global Shopping redesign
- Global theme or navigation rewrite
- Discover, Community, Moderator, Admin, or Cook Mode changes

## 16. Verification and runtime policy

Implementation, required test hardening, and independent review are complete on
`feat/mobile-shop3-quantity-unit-editing`. Closure passed. Focused mounted/static
tests and the smallest related Shopping regressions pass. Android/device runtime
is deferred, was not run for this phase, and is not claimed as passing. No
browser/rendering, touch, keyboard, accessibility-runtime, live API, or live
database verification is claimed.

## 17. Freeze verdict

The live PATCH, service wrapper, server serializer, mobile context mutation
architecture, canonical unit source, category projection, and current screen
behavior support this bounded mobile implementation without a backend change.

## 18. Implementation evidence

Implemented production files:

- `apps/mobile/src/context/ShoppingListContext.js`
- `apps/mobile/src/screens/ShoppingListScreen.js`
- `apps/mobile/src/components/ShoppingItemEditModal.js`

Implemented test files:

- `apps/mobile/__tests__/shoppingListStaticAudit.test.js`
- `apps/mobile/__tests__/shoppingListInteraction.test.js`

The context now exposes `updateItem(item.id, { quantity, unit })` through the
existing `runMutation` path. Available rows open a separate item-id-selected
editor; unavailable rows do not. The modal consumes `RECIPE_UNITS`, validates
positive finite measurable quantities, sends explicit `quantity: null` for
`toTaste`, keeps Ingredient/category read-only, synchronously blocks duplicate
Save, preserves drafts on recoverable failures, and closes only after a
successful authoritative context result.

Focused verification:

```text
npm test -- --runInBand --silent __tests__/shoppingListStaticAudit.test.js __tests__/shoppingListInteraction.test.js
2 suites passed; 39 tests passed.
```

Smallest related Shopping regressions:

```text
npm test -- --runInBand --silent __tests__/shoppingListGrouping.test.js __tests__/recipeUnitContract.test.js
2 suites passed; 22 tests passed.
```

No backend, Shopping service, database, package, theme, navigation, or
out-of-scope production file was changed. Independent review and required test
hardening are complete, and closure passed. Android/device runtime verification
is deferred, was not run, and is not claimed as passing.

**MOBILE-SHOP3 FINALIZED — READY TO MERGE (RUNTIME DEFERRED)**
