# WeCooked — MOBILE-MEAL3 Meal Plan Drag/Drop

**Status:** IMPLEMENTATION COMPLETE — READY FOR FINALIZATION

**Baseline commit:** `11e788427166f5c2e7c5b456bef80b205639a61f`

**Audit result:** `MOBILE-MEAL3 INDEPENDENT CLOSURE REVIEW COMPLETE — FINDINGS RESOLVED`

**Teammate presentation reference:** `jofaerpeloup-debug/WECOOKEDD` at pinned commit `4ffd47d176afcfb1f23ffa1be079f01791fae92e`; visible-product reference only. Live WeCooked remains authoritative for authentication, ownership, canonical identity, persistence, validation, concurrency, navigation, and server state.

This document freezes the completed MOBILE-MEAL3 audit as the implementation authority. It adds only in-week drag/drop rescheduling to the completed MOBILE-MEAL2 behavior. If implementation requires a production or test file outside the allowlists below, stop and amend the contract before changing it.

## 1. Product boundary

MOBILE-MEAL3 adds a dedicated drag handle to each available or unavailable Meal Plan entry and permits a deliberate gesture to move that entry to another real calendar day in the currently displayed Monday–Sunday week.

The visible gesture treatment is:

- a floating preview of the dragged entry;
- a dimmed source card that remains in its original day while the request is pending;
- highlighting for only the currently valid hovered day; and
- a clear drop-target treatment for the seven displayed day sections.

Drag is additive. The existing entry-specific **Move** action and `MealPlanMoveSheet` remain the accessible non-gesture path and the only cross-week movement path. Existing add, remove, Clear Week, Recipe Detail navigation, unavailable-entry handling, Shopping CTA, loading/error/empty states, week navigation, focus reload, and server-backed persistence remain unchanged.

Drag does not auto-scroll the list, page to another week, or open the Move sheet. A user who needs another week uses **Move**.

## 2. Frozen drag/move contract

Drag reuses the completed MOBILE-MEAL2 service and backend contract without modification:

```js
moveMealPlanEntry(entry.id, {
  dateKey: targetDateKey,
  expectedUpdatedAt: entry.updatedAt,
})
```

The request is the existing authenticated `PATCH /api/v1/meal-plan/:entryId`. The path identity is the exact Meal Plan `entry.id`, never `recipeId`; the body contains exactly the target `dateKey` and the captured public `expectedUpdatedAt`. The client never supplies owner identity.

A drag may target only one of the seven real `dateKey` values in the currently displayed week. Starting a drag captures an immutable snapshot of the entry ID, source `dateKey`, `updatedAt`, authenticated owner, displayed range, and current request generation.

Releasing over a valid different day submits exactly one move. Releasing outside a displayed day, over the source day, below the deliberate-drag threshold, or after gesture termination or invalidation cancels locally and makes no request.

The source entry is never removed optimistically. Only an authoritative successful response may replace the matching entry by `id`, using the complete returned public entry. Duplicate, stale, `404`, network, malformed-success, and server failures retain the source in its original visible day. Existing MEAL2 error mapping remains authoritative; stale conflict performs the existing guarded authoritative refetch and is never automatically resubmitted.

No backend route, validation, controller, service, repository, model, serializer, schema, index, migration, mobile service, error mapping, or date utility changes are required or permitted by MEAL3.

## 3. Mutation and race ownership

The screen permits one active drag and one conflicting Meal Plan mutation at a time.

- A drag cannot start while an explicit move, remove, Clear Week, or other conflicting Meal Plan mutation is active.
- Once a drag is active, another drag, explicit Move, add/remove control, Clear Week, or week change cannot begin a competing mutation. The valid drop must claim the same mutation ownership used by the existing move path.
- Explicit Move and drag release share one internal conditional-move operation. Drag must not create a second request path that bypasses the existing pending lock, submitted snapshot, attempt ownership, returned-entry reconciliation, error mapping, or stale-refetch behavior.
- The captured entry ID and version are immutable for the operation. A later entry with the same Recipe is not the submitted entry.
- Account change, displayed-week/range change, load-generation change, unmount, gesture termination, newer drag/mutation ownership, entry removal, or authoritative `updatedAt` change immediately invalidates the drag and any late completion.
- Before submission, the screen must still contain the captured entry ID at the captured `updatedAt`. Before applying a response or clearing owned pending state, owner, range, generation, operation/attempt, entry ID, and submitted version must still match.
- Invalidated success, failure, and finalizer work is ignored. It must not move an entry, surface an error into a newer session, close/reset newer UI, clear a newer pending state, or trigger a stale refetch for the wrong account/week.
- Destination duplicate remains `409 MEAL_PLAN_ENTRY_ALREADY_EXISTS`; stale version remains `409 MEAL_PLAN_ENTRY_STALE`; absent and foreign entries remain indistinguishable `404`. Drag never deletes/recreates, merges, fabricates, or retries a move.

## 4. Gesture and accessibility contract

Implementation uses only React Native `PanResponder` and `Animated`, already available in the application. No dependency, package, lockfile, native configuration, or gesture-library change is allowed.

Only the dedicated drag handle may initiate dragging; the meal card itself must not become a broad responder. The handle has a usable touch target, button semantics, an entry-specific accessibility label/hint, disabled state while movement is unavailable, and a visible non-color-only affordance. Available and unavailable entries both expose it without fabricating unavailable Recipe content.

Gesture capture begins only after a deliberate movement threshold from the handle. Until then, normal vertical `ScrollView` scrolling remains available. While a drag is active, its floating preview must not become a competing accessibility or touch target. Release/termination always restores scrolling and clears preview, source dimming, and hover state unless an owned server request is pending.

Recipe Detail navigation, the dedicated **Move** button, remove control, add controls, week navigation, back navigation, and ordinary vertical scrolling remain independently usable and must not be swallowed by the responder. **Move** remains the keyboard/screen-reader/non-gesture fallback and retains cross-week support.

Automated tests may establish responder wiring, ownership, request shape, reconciliation, cancellation, and preserved controls. They do not prove physical drag threshold, scroll arbitration, coordinate hit-testing after scrolling, animation quality, screen-size behavior, or device accessibility. Those remain a later physical-device runtime gate and must be reported as not run until performed.

## 5. Exact production allowlist

```text
apps/mobile/src/screens/MealPlanScreen.js
```

No other production file may change. In particular, no backend, Meal Plan service/error/date helper, `MealPlanMoveSheet`, `MealPlanSheet`, navigation, context, Shopping, Recipe Detail, storage, package, lockfile, or configuration change is approved.

## 6. Exact test allowlist

```text
apps/mobile/__tests__/mealPlanInteraction.test.js
apps/mobile/__tests__/mealPlanStaticAudit.test.js
```

Mounted interaction coverage must prove valid in-week drop, exact ID/version request, one-submit ownership, pessimistic source visibility, returned-entry-by-ID reconciliation, same-day/outside/termination cancellation, duplicate/stale/`404`/network/server failure preservation, unavailable-entry drag, and account/week/generation/version/unmount invalidation. It must also preserve explicit Move and existing add/remove/Clear Week/Shopping/navigation/focus-reload behavior.

The static audit's MOBILE-MEAL2-era prohibition on `PanResponder` and drag terminology must be replaced with the frozen MEAL3 invariants. Removing that prohibition alone is insufficient proof.

## 7. Explicit exclusions

- any change to completed MOBILE-MEAL2 behavior or its HTTP/data contract;
- cross-week dragging, auto-scroll, or automatic week paging;
- optimistic source removal, delete-plus-create movement, or client-authored success;
- reminders, reminder state/times, notification scheduling, permissions, jobs, or exact alarms (MOBILE-MEAL4);
- meal slots/types, completion/cooked state, servings persistence, nutrition, calories, or macros;
- Shopping redesign, automation, clear-checked/swipe behavior, custom-item provenance, or changes owned by SHOP4/SHOP5;
- recurring weekday templates, batch movement, predictive/AI planning, or global Meal Plan redesign;
- AsyncStorage, mock data, generated domain IDs, or any other client-side Meal Plan authority;
- backend, schema, index, migration, dependency, package, or native-configuration work.

## 8. Verification and runtime boundary

Implementation is complete. Independent closure review is complete and its documentation finding is resolved. Focused tests pass: **58/58**. Exact scope is verified: the one production file and two test files in the frozen allowlists, plus this milestone evidence document. The milestone is ready for finalization.

Physical device/runtime: **NOT RUN — NOT CLAIMED AS PASS.** Physical-device verification remains mandatory for deliberate drag threshold, vertical-scroll arbitration, hit testing before and after scrolling, gesture cancellation, small and large screens, available and unavailable cards, normal navigation/remove controls, animation quality, and accessible explicit-Move fallback. No automated result may be reported as satisfying this runtime gate.

Database migration is not required. There are no contract-freeze blockers.

## 9. Frozen verdict

**MOBILE-MEAL3 IMPLEMENTATION COMPLETE — READY FOR FINALIZATION**
