# WeCooked — MOBILE-MEAL2 Meal Plan Move & Reschedule

**Status:** CLOSURE REVIEW PASS - READY FOR PR

**Baseline commit:** `87f572d993f5b4da4b1c323b5526c504a0a1be3a`

**Audit result:** `MOBILE-MEAL2 AUDIT COMPLETE — READY FOR CONTRACT FREEZE`

**Teammate presentation reference:** `jofaerpeloup-debug/WECOOKEDD` at pinned commit `4ffd47d176afcfb1f23ffa1be079f01791fae92e`; visual/product reference only. The live WeCooked repository remains authoritative for data, API, authentication, navigation, theme, state, and persistence.

This document records the frozen implementation contract produced from the completed read-only audit and the completed implementation, required-fix, and closure-review gates. If implementation requires a production or test file outside the allowlists below, stop and justify an amended contract before changing it.

## 1. Product goal

MOBILE-MEAL2 adds one explicit, accessible **Move** workflow for changing the real calendar date of an existing Meal Plan entry:

```text
Meal Plan
  -> choose an existing entry
  -> Move
  -> choose a target date
  -> confirm one atomic server update
  -> reconcile from the returned public entry
```

Only `dateKey` changes. The entry's `id`, `recipeId`, and `createdAt` remain unchanged; `updatedAt` advances. The server remains authoritative. A move must never be implemented as DELETE followed by POST, because that would lose identity and permit partial failure.

## 2. Audited architecture and current behavior

The active backend path is:

```text
PATCH /api/v1/meal-plan/:entryId
  -> authenticate
  -> strict validation
  -> controller
  -> meal-plan service
  -> meal-plan repository
  -> Mongoose MealPlanEntry
  -> MongoDB
```

The active mobile path is:

```text
MealPlanScreen
  -> mealPlanService
  -> authenticated API client
  -> server-backed Meal Plan state
```

Current repository evidence relevant to this contract:

- Meal Plan routes are authenticated, and ownership is derived from `req.auth.userId`.
- `MealPlanEntry` already uses Mongoose timestamps and exposes `_id`, `dateKey`, `recipeId`, `createdAt`, and `updatedAt` through the existing public serializer.
- The existing unique index is `{ userId: 1, dateKey: 1, recipeId: 1 }`.
- Range reads retain an entry when its Recipe is no longer usable; the public entry then has `isAvailable: false` and `recipe: null`.
- Mobile Meal Plan state is API-backed, owner/range-bound, focus-refetched, and protected by request-generation guards. There is no approved Meal Plan `AsyncStorage` authority.
- `mealPlanDates.js` creates real local-calendar keys from local year/month/day parts, uses noon-anchored local dates for calendar arithmetic, and deliberately avoids `toISOString()`, UTC conversion, and duration arithmetic.
- Existing add, remove, Clear Week, Recipe Detail, unavailable-entry, Shopping CTA, loading/error/empty, week-navigation, and focus-reload behavior is already live and must remain intact.
- `apps/mobile/__tests__/mealPlanInteraction.test.js` does not exist at freeze time; creating it later is expressly permitted by the test allowlist.

No model/schema change or database migration is required or approved.

## 3. Frozen HTTP contract

### Request

```http
PATCH /api/v1/meal-plan/:entryId
Authorization: Bearer <access token>
Content-Type: application/json
```

```json
{
  "dateKey": "YYYY-MM-DD",
  "expectedUpdatedAt": "<current public entry updatedAt>"
}
```

The route is authenticated and owner-scoped. `entryId` must satisfy the existing Meal Plan ObjectId parameter contract. The body is strict and both fields are required:

- `dateKey`: the existing `dateKeySchema`, including exact `YYYY-MM-DD` shape and real-calendar validation;
- `expectedUpdatedAt`: a valid ISO-8601 timestamp with an offset, following the repository's existing conditional-write convention. Mobile sends the unchanged `updatedAt` value from the currently displayed public entry.

Unknown fields are rejected with `400 VALIDATION_ERROR`. In particular, the endpoint must not accept `userId`, `ownerId`, `recipeId`, `mealType`, `createdAt`, `updatedAt`, arbitrary timestamps, Mongo operators, or arbitrary update objects.

### Success

Return `200` with the existing response envelope and public serializer:

```json
{
  "data": {
    "mealPlanEntry": {
      "id": "...",
      "dateKey": "YYYY-MM-DD",
      "recipeId": "...",
      "isAvailable": true,
      "recipe": {},
      "createdAt": "...",
      "updatedAt": "..."
    }
  }
}
```

For an unavailable Recipe, success still returns the moved entry with `isAvailable: false` and `recipe: null`. The response must not expose `userId` or private Recipe fields. `id`, `recipeId`, and `createdAt` are preserved; `dateKey` is the requested target; `updatedAt` changes.

## 4. Atomic conditional-write and stale strategy

The repository performs one atomic owner/version-scoped update whose match contains all three authoritative predicates:

```js
{
  _id: entryId,
  userId: authenticatedUserId,
  updatedAt: new Date(expectedUpdatedAt)
}
```

The update is only `{ $set: { dateKey } }`, returns the post-update document, and runs model validation. Mongoose timestamps advance `updatedAt`; no client timestamp is written. This operation preserves identity, Recipe association, ownership, and `createdAt`.

If the atomic update returns no entry, the service performs an owner-scoped existence check by `entryId + authenticatedUserId` only to classify the failed precondition:

- owner entry still exists: `409 MEAL_PLAN_ENTRY_STALE` with truthful refresh/retry guidance;
- owner entry is absent: `404 MEAL_PLAN_ENTRY_NOT_FOUND`;
- foreign entry: the same `404 MEAL_PLAN_ENTRY_NOT_FOUND`, without revealing its existence;
- entry was concurrently deleted before commit or before classification: `404 MEAL_PLAN_ENTRY_NOT_FOUND`.

The existence check may classify a failed atomic match; it must not mutate, retry the update, or recreate an entry. Last-write-wins behavior is forbidden.

## 5. Target duplicate behavior

The existing unique contract remains authoritative:

```text
userId + dateKey + recipeId
```

If the atomic move encounters Mongo duplicate-key error `11000`, translate it to the existing public conflict:

```text
409 MEAL_PLAN_ENTRY_ALREADY_EXISTS
```

Use the existing message convention: the Recipe is already planned for that date. Because the change is one atomic document update, the source entry remains unchanged on duplicate conflict. Do not pre-delete, recreate, merge, or silently remove either entry.

## 6. Date and timezone contract

- `dateKey` is a calendar identity, not a timestamp.
- Backend validation reuses the existing strict real-calendar `YYYY-MM-DD` contract used by Meal Plan create/read flows, including leap-year validation.
- Mobile target dates come from the existing Meal Plan date utilities and their local calendar-part construction.
- Week movement uses calendar-day helpers, not millisecond/timestamp arithmetic.
- Do not use `toISOString()`, `Date.UTC`, UTC-derived conversion, `getTime()` duration math, or `86400000` to produce or move a `dateKey`.
- The selected date must remain the same local calendar date submitted to and returned by the server; no timezone conversion is permitted.

## 7. Frozen mobile Move workflow

The final product label is **Move** and must be used consistently.

Each Meal Plan entry, including an unavailable Recipe entry, exposes an accessible Move button with an entry-specific accessible name. Activating it opens the new dedicated `MealPlanMoveSheet` for that entry. The sheet:

- identifies the entry being moved without inventing unavailable Recipe content;
- shows a clear Monday-Sunday real-date hierarchy;
- indicates the current date and the selected target date distinctly;
- opens with the entry's current real date selected and its week displayed;
- supports previous- and next-week navigation, so cross-week movement is possible;
- uses existing `mealPlanDates.js` helpers to derive every displayed/selected `dateKey`;
- supplies an accessible close path, Android back handling, appropriate button roles/labels/states, and modal/sheet focus behavior;
- uses one strong primary action labeled **Move meal**.

The frozen same-date behavior is: **disable `Move meal` when the selected target equals the entry's current `dateKey`; do not issue a network request.** Changing to another date enables confirmation.

While submission is pending, the original entry remains visible, the primary action exposes a busy state, duplicate confirmation is blocked, the target controls cannot initiate a competing request, and the competing Move action for that entry is disabled. Existing destructive mutations must not race the same entry through an untracked second action.

No destructive optimistic state change is allowed.

## 8. Mobile service and reconciliation

Add one service method that URL-encodes `entryId` and calls:

```js
api.patch(`/meal-plan/${encodeURIComponent(entryId)}`, {
  body: { dateKey, expectedUpdatedAt },
})
```

It sends exactly the two frozen body fields and normalizes `data.mealPlanEntry` through the existing Meal Plan public-entry normalizer. It must not fabricate success or persist a local Meal Plan.

The submitted operation is bound to the entry id, its submitted `expectedUpdatedAt`, authenticated owner, displayed range, and request generation. A late success or failure from an older sheet/session, account, entry version, or displayed week must not alter or clear newer state.

### Success

Only after a successful PATCH:

- target inside the currently displayed week: replace the matching entry by `id` with the complete server-returned entry; grouping then displays it under the returned `dateKey`;
- target outside the currently displayed week: remove the matching `id` from the current displayed range;
- close/reset the submitted Move sheet only if the response still belongs to the active owner/range/entry operation.

Never synthesize a target entry or retain client-authored fields over the server response.

### Failure

For duplicate conflict, stale conflict, `404`, network failure, or server failure, preserve the original displayed entry in its original date group. Present the established truthful Meal Plan error UI; do not report success and do not optimistically remove the source.

- Duplicate: explain that the Recipe is already planned for the target day; allow a different target.
- Stale: explain that the entry changed, then reload/refetch the authoritative displayed Meal Plan range if the same owner/range operation is still active. Until a successful refetch replaces it, retain the existing visible entry. Do not automatically resubmit.
- `404`: explain that the planned entry no longer exists and offer/rely on authoritative reload; do not recreate it.
- Network/server: retain the sheet selection and original entry so the user can retry deliberately.

## 9. Teammate Adopt / Adapt / Reject / Defer decisions

The pinned teammate implementation is not data or architecture authority. Its weekday-template context, mock Recipe catalog, local persistence, drag responder, and notification behavior are incompatible with the live product contract.

### Adopt

- Sage & Stone Meal Plan surfaces and compact card treatment.
- Clear week/date hierarchy, Monday-Sunday orientation, previous/next week controls, and selected/current-date emphasis.
- Bottom-sheet presentation with grabber, backdrop, safe-area spacing, and a strong primary action.
- Entry-level presentation cues that make movement discoverable.

### Adapt

- Adapt the teammate's move intent into an explicit accessible **Move** action and dedicated real-date sheet.
- Adapt week navigation to the live `mealPlanDates.js` local-calendar helpers and API-backed `dateKey` values.
- Adapt styling through the live theme, typography, spacing, radius, navigation, Recipe image, and error conventions.
- Adapt state updates to pessimistic PATCH confirmation and returned server data, guarded by active owner/range/generation.

### Reject

- Drag-and-drop/PanResponder movement.
- Weekday-name templates detached from real dates.
- `MealPlanContext` as a second authority, AsyncStorage Meal Plan persistence, mock Recipes, and client-only mutations.
- Delete-plus-create movement or source removal on target collision.
- Teammate reminder/time, notification, meal-slot, completion, nutrition, AI, shopping-automation, and global redesign behavior.

### Defer

- Any broader teammate Meal Plan redesign not required for the Move sheet.
- Drag-and-drop, notifications/reminders, meal types, cooked/completion state, nutrition, predictive planning, and automated shopping changes to later separately audited milestones.

## 10. Existing behavior that must remain

- current week and previous/next week navigation;
- add Recipe flows from Meal Plan and Recipe Detail;
- remove Recipe and Clear Week;
- Recipe Detail navigation;
- unavailable Recipe entry rendering and removal;
- server-backed persistence only;
- Shopping CTA/integration and its partial-failure semantics;
- loading, error, retry, empty, and pending states;
- focus reload behavior;
- owner/range/generation protections against stale asynchronous state;
- live authentication, API client, navigation, theme, date helpers, alerts, and Recipe presentation.

## 11. Exact production allowlist

Only these production files may change during implementation.

### Backend

```text
apps/api/src/modules/meal-plan/meal-plan.routes.js
apps/api/src/modules/meal-plan/meal-plan.validation.js
apps/api/src/modules/meal-plan/meal-plan.controller.js
apps/api/src/modules/meal-plan/meal-plan.service.js
apps/api/src/modules/meal-plan/meal-plan.repository.js
```

### Mobile

```text
apps/mobile/src/screens/MealPlanScreen.js
apps/mobile/src/components/MealPlanMoveSheet.js
apps/mobile/src/api/mealPlanService.js
apps/mobile/src/api/mealPlanErrors.js
```

No model/schema, serializer, shared client, navigation, theme, date-utility, context, storage, package, lockfile, configuration, migration, or other production change is approved. If another production file proves necessary, stop and justify the scope expansion before editing it.

## 12. Exact test allowlist

Only these test files may change or be created during implementation.

### Backend

```text
apps/api/test/meal-plan-validation.test.js
apps/api/test/meal-plan-repository.test.js
apps/api/test/meal-plan-service.test.js
apps/api/test/meal-plan-routes.test.js
```

### Mobile

```text
apps/mobile/__tests__/mealPlanService.test.js
apps/mobile/__tests__/mealPlanStaticAudit.test.js
apps/mobile/__tests__/mealPlanInteraction.test.js
```

## 13. Required verification contract

Backend tests must prove:

- authenticated valid move through the PATCH route;
- exact strict body acceptance and rejection of unknown/mass-assignment fields;
- invalid, malformed, and impossible dates are rejected;
- repository filter contains entry id, authenticated owner id, and exact expected `updatedAt` in one atomic update;
- the update sets only `dateKey`, returns the post-update entry, and runs validation;
- id, Recipe id, and `createdAt` are preserved, while `updatedAt` changes;
- owner scoping and BOLA resistance: foreign entries are indistinguishable from absent entries at `404`;
- stale `expectedUpdatedAt` returns `409 MEAL_PLAN_ENTRY_STALE` and does not move the entry;
- target duplicate-key conflict returns `409 MEAL_PLAN_ENTRY_ALREADY_EXISTS` and leaves the source unchanged;
- an unavailable Recipe entry can move and serializes as unavailable without re-running create eligibility;
- a delete-before-move outcome returns `404` and never recreates the entry;
- the success response uses the established safe `mealPlanEntry` representation.

Mobile service tests must prove the encoded URL, PATCH method, exact `{ dateKey, expectedUpdatedAt }` body, public response normalization, and rejection propagation.

Mounted interaction tests must prove:

- an entry-specific accessible Move action opens the dedicated sheet;
- real date selection and current/selected-date semantics;
- previous/next week navigation and cross-week selection;
- same-date confirmation is disabled and makes no request;
- one submit while pending, busy/disabled controls, and the source entry remains visible;
- in-week success replaces by id with the returned server entry;
- out-of-week success removes only that id from the displayed range;
- duplicate, stale, `404`, network, and server failures retain the original entry;
- stale conflict performs the frozen authoritative refetch behavior without automatic resubmit;
- late success/failure cannot corrupt a newer sheet, entry version, displayed range, or authenticated account state;
- existing add/remove/Clear Week/week navigation/Recipe Detail/Shopping/focus-reload behavior remains wired.

Static audit tests remain useful for bounded source/allowlist invariants, exact service wiring, forbidden persistence/UTC patterns, and preservation of existing integration points. They must not substitute broad string presence for interaction behavior; the new workflow and asynchronous recovery require mounted behavioral coverage.

## 14. Explicitly out of scope

- Breakfast/Lunch/Dinner/Snack slots or any `mealType` schema;
- drag-and-drop movement;
- notifications, reminders, Expo Notifications, push tokens, or backend notification jobs;
- completion/cooked state;
- nutrition, calories, or macros;
- AI or predictive planning;
- Shopping automation changes;
- Community, Discover, Moderator/Admin, or Cook Mode timer work;
- AsyncStorage Meal Plan persistence or another client data authority;
- batch move/edit;
- database migration or model/schema/index change;
- global navigation, global theme, or shared-card redesign;
- copying the teammate source tree or its mock/local/provider architecture.

## 15. Status and runtime boundary

| Gate | Status |
| --- | --- |
| Audit | COMPLETE |
| Contract freeze | COMPLETE |
| Implementation | COMPLETE |
| Independent review | PASS WITH REQUIRED FIXES |
| Required fixes | COMPLETE |
| Closure review | PASS |
| Runtime | DEFERRED BY PROJECT DECISION - NOT RUN - NOT CLAIMED AS PASS |

Runtime verification is deferred by project decision and was not run. It is not claimed as passing, and this document claims no browser/rendering, Android/device, touch, accessibility-runtime, live API, or database runtime result.

## 16. Implementation evidence

Implemented on `feat/mobile-meal2-move-reschedule` from the frozen baseline `87f572d993f5b4da4b1c323b5526c504a0a1be3a`.

- Backend production: the five allowlisted Meal Plan route, validation, controller, service, and repository files.
- Mobile production: `MealPlanScreen.js`, `MealPlanMoveSheet.js`, `mealPlanService.js`, and `mealPlanErrors.js`.
- Tests: the four allowlisted backend Meal Plan test files plus the three allowlisted mobile Meal Plan test files.
- `PATCH /api/v1/meal-plan/:entryId` validates the exact `dateKey + expectedUpdatedAt` body, matches `_id + authenticated userId + updatedAt` atomically, and updates only `dateKey`.
- A failed conditional match is classified by an owner-scoped existence read: owner version mismatch is `409 MEAL_PLAN_ENTRY_STALE`; missing, foreign, and concurrently deleted entries are `404 MEAL_PLAN_ENTRY_NOT_FOUND`.
- Mongo duplicate-key error `11000` maps to `409 MEAL_PLAN_ENTRY_ALREADY_EXISTS`; there is no delete/recreate path, so the source entry remains intact.
- Movement does not re-run create eligibility. The returned entry uses the existing public serializer and can contain `isAvailable: false` with `recipe: null`.
- Mobile exposes an entry-specific Move action for available and unavailable entries, a real local-calendar previous/current/next-week sheet, a disabled same-date confirmation, and a pessimistic pending state.
- Success replaces by id from the returned server entry when the target is inside the displayed range, or removes only that id when it is outside. Failures retain the source entry; stale failures trigger one authoritative range refetch without retrying the move.
- Response reconciliation is guarded by mounted state, owner, displayed range, load generation, move attempt, entry id, and submitted `updatedAt`.
- Focused backend command: `node --test --test-isolation=none test/meal-plan-validation.test.js test/meal-plan-repository.test.js test/meal-plan-service.test.js test/meal-plan-routes.test.js` — 41 passed, 0 failed.
- Required mobile command: `npm test -- --runInBand __tests__/mealPlanService.test.js __tests__/mealPlanStaticAudit.test.js __tests__/mealPlanInteraction.test.js` — 40 passed, 0 failed.
- Related mobile Meal Plan date/shopping regressions: 5 passed, 0 failed.
- Closure review: PASS.
- `git diff --check`: PASS; only line-ending conversion warnings were emitted.
- No deviations from the production or test allowlists. No schema, migration, package, lockfile, theme, navigation, storage, Shopping, Community, Discover, Moderator/Admin, or Cook Mode change was required.
- No browser/rendering, Android/device, touch, accessibility-runtime, live API, or live database claim is made.

## 17. Freeze verdict

The current API/data model, public serializer, unique index, mobile server-backed state, and local-calendar utilities support this bounded implementation without schema change. The frozen conditional update preserves entry identity and prevents stale or partial moves; conflicts preserve the source entry; unavailable entries remain movable; and the UI remains pessimistic and server-authoritative.

**MOBILE-MEAL2 CONTRACT FROZEN — READY FOR IMPLEMENTATION**

**MOBILE-MEAL2 IMPLEMENTATION COMPLETE — READY FOR INDEPENDENT REVIEW**

## 18. Independent review required findings fix

The independent review result was **PASS WITH REQUIRED FIXES**. Production architecture passed. This bounded phase addressed only the review findings and did not broaden the frozen milestone.

Findings and exact fixes:

- `expectedUpdatedAt` previously accepted fractional seconds beyond JavaScript/MongoDB millisecond precision. Validation now rejects fractional precision longer than three digits while retaining offset-aware ISO-8601 values with zero through three fractional digits. No timestamp is silently truncated.
- A same-date PATCH previously advanced `updatedAt`. The one atomic owner/version update now also requires a different `dateKey`; a failed conditional update continues through the existing owner-scoped classification read. An exact owner/version same-date request returns the current entry without a write, while absent/foreign entries remain `404` and version mismatches remain `409 MEAL_PLAN_ENTRY_STALE`.
- The Move sheet now presents an explicit **Moving from** source date and a separate **Current plan** or **Selected target** summary. Today's calendar marker remains independent from the entry's source date.
- Stale UI copy now says that the app is reloading while the refetch is pending. A successful refetch is acknowledged only after success; a failed refetch tells the user to reload and leaves the existing tap-to-retry path visible. The move is never auto-resubmitted.
- Mounted reconciliation coverage now uses two entries with the same `recipeId` and different entry ids, and proves that only the submitted entry id is replaced while its sibling remains unchanged.
- Controlled-promise mounted coverage now proves that a late stale refetch for week A cannot overwrite a resolved week B, cannot corrupt week B loading/error state, and cannot retry the move.
- Mounted Move-sheet coverage proves local-calendar selection over month and year boundaries. Existing local-date utility tests and static prohibitions continue to cover local calendar construction and forbid `toISOString`, `Date.UTC`, and duration arithmetic. Jest does not safely change the process timezone after startup, so no brittle global timezone mutation was added.
- Duplicate coverage now proves one `findOneAndUpdate` attempt, direct duplicate rejection, no delete, no create/POST fallback, no classification read, no second mutation, and public `409 MEAL_PLAN_ENTRY_ALREADY_EXISTS` mapping. Source-document rollback on a unique-index rejection remains delegated to MongoDB's atomic single-document update semantics; no embedded database harness was introduced.

Files changed in this findings-fix phase:

- Production: `meal-plan.validation.js`, `meal-plan.repository.js`, `meal-plan.service.js`, `MealPlanMoveSheet.js`, and `MealPlanScreen.js`.
- Tests: `meal-plan-validation.test.js`, `meal-plan-repository.test.js`, `meal-plan-service.test.js`, `meal-plan-routes.test.js`, `mealPlanInteraction.test.js`, and `mealPlanStaticAudit.test.js`.
- Documentation: this milestone.

Focused verification on 2026-10-02:

- Backend Meal Plan validation/repository/service/routes: 41 passed, 0 failed.
- Mobile Meal Plan interaction/static/service: 40 passed, 0 failed. Jest emitted only the existing `react-test-renderer` deprecation warning.
- Related mobile Meal Plan date/shopping regressions: 5 passed, 0 failed.
- `git diff --check`: passed; only line-ending conversion warnings were emitted.

Closure review result: **PASS**.

Runtime is **DEFERRED BY PROJECT DECISION**, **NOT RUN**, and **NOT CLAIMED AS PASS**. This update makes no browser/rendering, Android/device, touch, accessibility-runtime, live API, live MongoDB, commit, push, merge, or release claim.

**MOBILE-MEAL2 FINALIZATION STATUS — READY FOR PR (RUNTIME DEFERRED)**
