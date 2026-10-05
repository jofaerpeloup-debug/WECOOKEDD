# WeCooked — MOBILE-ING2 Ingredient Studio Action Parity

**Phase:** FINALIZATION  
**Status:** CLOSURE PASS — READY FOR PR (NOT MERGED)  
**Baseline:** `origin/main @ 6be6f796bf61e02932701f6532047b4f7386ddbf`  
**Verdict:** `MOBILE-ING2 FINALIZED — READY FOR PR`

This document records the frozen MOBILE-ING2 contract and its current-main closure result. The implementation is ready for PR but is not claimed merged; Shopping and Assistant architecture remains unchanged, and the exact allowlists remain binding.

## 1. Frozen architecture

MOBILE-ING2 is one mobile-only vertical slice with two bounded actions:

```text
canonical substitution result
  -> Swap Detail
  -> locked IngredientPickerModal
  -> ShoppingListContext.addItem
  -> existing shoppingListService
  -> existing authenticated Shopping API

current strict nonblank Ingredient search succeeds with []
  -> explicit Ask Assistant action
  -> existing Assistant route with a one-use initial prompt
  -> existing assistantService
  -> POST /api/v1/assistant/chat
```

The current backend, schema, indexes, providers, persistence, shared API client, authentication, navigation registration, and packages remain unchanged. No second Shopping, Ingredient, substitution, or Assistant authority may be introduced.

## 2. Shopping action contract

- The Shopping action is for the canonical `substituteIngredient.id` returned by the validated substitution response. It must never use the source Ingredient ID, relation ID, substitute name, route label, or any name-derived identity.
- Swap Detail opens the existing `IngredientPickerModal` in a locked-Ingredient mode. The substitute is visible and cannot be searched, changed, or replaced in that mode.
- The modal must still require the user to choose an explicit canonical unit and, for every measurable unit, enter an explicit positive finite quantity.
- `toTaste` is permitted only through the existing canonical unit contract and is sent without a quantity, exactly as the current add-item path requires.
- The substitution ratio is advisory catalog data without unit semantics. It must not prefill, derive, suggest, scale, or default Shopping quantity or unit.
- No default quantity and no default unit are permitted.
- Submission must call only `ShoppingListContext.addItem({ ingredientId, unit, quantity })`. Swap Detail and the modal must not call the Shopping service or API directly.
- The server-returned complete Shopping list remains authoritative. No optimistic row, local merge, fabricated success, or local rollback state is permitted.
- Success closes the same still-current modal session only after the authoritative context result succeeds. Recoverable failure keeps that session open with an honest error. `busy` does not retry automatically. A superseded account/session result must not present success.
- The existing recipe-application action remains unavailable. MOBILE-ING2 adds a substitute to Shopping; it does not apply or persist a recipe/formula substitution.

## 3. Assistant fallback contract

- The Ask Assistant action may appear only for the latest, current, trimmed nonblank Ingredient Studio search after `searchIngredientsStrict` succeeds with an exact empty `ingredients` array.
- Loading, debounce, initial blank catalog load, search error, malformed successful payload, stale response, or a nonempty canonical result must not expose the unmatched-search Assistant action.
- A selected canonical Ingredient whose current substitution lookup succeeds with zero substitutions keeps the existing `No substitutions available` state. That state is not an unmatched Ingredient search and must not become the Assistant fallback.
- The action navigates to the already-registered `Assistant` route with a bounded cooking/ingredient-guidance prompt derived from the current trimmed unmatched search text. It must not add or change navigation registration.
- Assistant consumes that initial prompt at most once for that route/screen session and sends it through the existing normal single-flight send path. Re-render, focus, route-param persistence, reset, retry, or stale navigation state must not submit it again.
- The existing Assistant transcript bounds, input limits, retry rules, request identity, reset generation, unmount guard, authenticated client, and safe error mapping remain authoritative.
- All AI output is advisory text only. It must not create or select an Ingredient, create or alter a substitution, add or edit Shopping rows, apply a recipe substitution, navigate from inferred entities, or become catalog authority.
- No Assistant history, persistence, fabricated reply, deterministic local fallback, direct provider request, client key, provider configuration, or automatic tool/action execution is permitted.

## 4. Substitution service boundary

`getSubstitutesFor(sourceIngredientId)` remains a directed active-catalog lookup and must fail closed:

- Reject a noncanonical requested source ID before any request.
- A 2xx response is valid only when its envelope contains a real `substitutions` array. Missing, `null`, object, string, or otherwise malformed collections are errors, never empty success.
- Validate every returned row before exposing any result. One malformed row rejects the whole payload; invalid rows must not be silently filtered into a smaller or empty success.
- Each row must have a usable relation ID and an active state, and its populated source and substitute summaries must each contain canonical public IDs and nonblank names.
- Every returned source ID must exactly equal the requested source ID.
- Source and substitute IDs must be different.
- Reject inactive relations, missing/unusable Ingredient summaries, malformed identities, duplicate relation IDs, and duplicate substitute Ingredient IDs.
- Preserve directed semantics. Never infer the reverse relation.
- Continue dropping ratio from the mobile normalized result. Contexts and notes remain display-only guidance.

The screen must render a malformed-boundary rejection as the existing substitution error/retry state, never as `No substitutions available`.

## 5. Mobile lifecycle and race contract

- Ingredient Studio search uses a monotonic generation. Only the latest generation for the current trimmed query may commit results, selected Ingredient state, unmatched state, error, loading completion, or Assistant CTA visibility.
- Starting a new search immediately invalidates and clears the prior search-owned selection and unmatched state. A stale search success or failure must not restore an old selected Ingredient, results, error, empty state, or Assistant CTA.
- Selection is owned by the current search result set. The latest successful nonempty search selects only from that generation; a previous selection must not survive merely because it was already non-null.
- Substitution lookup remains tagged with both generation and source Ingredient identity. A stale success or failure must not render, navigate, or expose a Shopping action under a newer selected Ingredient.
- Swap Detail and locked-modal input must preserve the exact validated source/relation/substitute pairing. Missing or invalid route data disables the action without synthesizing identity.
- `IngredientPickerModal` must use a synchronous ref-based submit lock in addition to rendered disabled/loading state, so two taps in the same render frame issue exactly one `addItem` call.
- Every modal open receives a new session identity. Submit continuations may update errors, release UI state, or close only when still mounted and owned by the same visible modal session.
- Close/reopen, account or authentication identity change, and unmount invalidate pending modal continuations. An old completion must not close, unlock, show an error in, or otherwise mutate a newer modal session.
- The existing `ShoppingListContext` session identity, mutation lock, stale-GET invalidation, owner gate, and pessimistic full-list reconciliation remain mandatory and unchanged.
- Assistant initial-prompt consumption and Assistant requests retain their own mounted, generation, and active-request identities. An old request cannot mutate a reset or later conversation.

## 6. Security rules

- Use only the existing authenticated shared API client. Do not call `fetch` directly and do not bypass access-token refresh/session handling.
- The backend authenticated identity remains the only Shopping owner. Never send or derive `userId`, Shopping-list owner, role, or privilege data from the client.
- Route params and display names are not authority. Shopping identity must originate from a strictly validated canonical substitute ID and be rechecked before enabling the locked action.
- Do not expose tokens, provider keys, provider/model configuration, raw provider errors, private auth metadata, or secrets in UI, logs, route params, storage, or requests.
- Do not weaken server validation, authorization, rate limits, Assistant bounds, Shopping serialization, or session isolation.
- Do not persist Assistant prompts/replies or server-owned domain state in AsyncStorage or another mobile store.
- Do not fabricate Ingredient IDs, substitution relations, Shopping rows, Assistant replies, successes, quantities, units, or availability.
- Errors must remain user-safe and must not leak internal response bodies or cross-account state.

## 7. Exact production allowlist

Only these production files may change:

```text
apps/mobile/src/screens/IngredientStudioScreen.js
apps/mobile/src/screens/SwapDetailScreen.js
apps/mobile/src/screens/AssistantScreen.js
apps/mobile/src/components/IngredientPickerModal.js
apps/mobile/src/api/substitutionService.js
```

No context, Shopping service, Assistant service/state/error module, Ingredient service/error module, navigation, backend, Admin, package, lockfile, schema, index, provider, persistence, config, or native file change is authorized. If any other production file is required, stop and request an explicit contract amendment before editing it.

## 8. Exact test allowlist

Only these test files may change:

```text
apps/mobile/__tests__/ingredientStudioStaticAudit.test.js
apps/mobile/__tests__/ingredientStudioInteraction.test.js
apps/mobile/__tests__/substitutionService.test.js
apps/mobile/__tests__/shoppingListInteraction.test.js
apps/mobile/__tests__/assistantScreenStaticAudit.test.js
apps/mobile/__tests__/pendingFeatureHonestyStaticAudit.test.js
```

`ingredientStudioInteraction.test.js` is the approved new mounted behavior suite. Running another unchanged test does not add it to the test-change allowlist.

## 9. Verification gates

### Focused automated gate

Run from the repository root:

```powershell
npm test --workspace=apps/mobile -- --runInBand --silent __tests__/ingredientStudioStaticAudit.test.js __tests__/ingredientStudioInteraction.test.js __tests__/substitutionService.test.js __tests__/shoppingListInteraction.test.js __tests__/assistantScreenStaticAudit.test.js __tests__/pendingFeatureHonestyStaticAudit.test.js
```

The focused suites must prove, with mounted request observation where behavior is interactive:

- substitute Shopping uses only the validated substitute ID and requires explicit unit/quantity;
- `toTaste` follows the existing no-quantity contract and ratio/default mutations fail;
- rapid double submit produces exactly one context call;
- authoritative success, recoverable failure, busy, superseded, close/reopen, account/session change, and unmount outcomes cannot cross modal sessions;
- only the latest strict nonblank search may own selection and the unmatched CTA;
- canonical result/no-substitution remains the substitution empty state;
- the initial Assistant prompt is sent exactly once through the normal service path;
- stale search and substitution success/failure cannot corrupt the latest state;
- malformed collections/rows, wrong source, invalid substitute, inactive relation, and duplicates reject, while a valid `[]` is the only empty substitution success;
- no direct provider, fake reply, local persistence, AI automation, optimistic Shopping row, recipe application, or unsupported feature claim appears.

Race tests must be mutation-resistant: resolve old requests after a newer search/selection/modal session exists, and make the old continuation capable of visibly corrupting current UI if the production guard is removed. Source-string assertions alone are insufficient for lifecycle behavior.

### Regression and quality gate

Run from the repository root:

```powershell
npm test --workspace=apps/mobile -- --runInBand
git diff --check
git diff --name-status
git status --short --branch
```

Then perform an independent read-only review of the actual diff, including the new untracked interaction test, for exact allowlist compliance, strict-boundary behavior, race/session ownership, server authority, security, accessibility, unsupported claims, and mutation-resistant tests.

### Runtime gate

On a rebuilt current mobile app against a reachable non-production current API, verify:

- canonical search, selection changes, zero results, search failure/retry, substitution loading/error/empty/result, and Swap Detail navigation;
- locked substitute identity, explicit measurable quantity/unit, `toTaste`, duplicate-tap blocking, mutation error, and authoritative Shopping reconciliation;
- unmatched-search Assistant navigation and exactly one initial send through the existing endpoint;
- back/close/reopen, account/session change, slow/out-of-order requests, keyboard behavior, accessibility labels/states, supported viewport, and light/dark appearance;
- no redbox, unexpected console error, prior-account data exposure, optimistic row, recipe mutation, or automatic AI action.

Record platform, device/emulator, OS, build identifier, non-secret API target classification, viewport/orientation, and console result. Automated tests do not establish device rendering or runtime accessibility. A live provider reply may remain deferred when provider credentials/credits are unavailable; do not report provider connectivity unless actually exercised.

## 10. Deferred and excluded scope

- MOBILE-SHOP4 clear-checked, swipe-delete, and count parity.
- MOBILE-SHOP5 custom/free-text Shopping items and provenance.
- Assistant conversation history or persistence.
- AI-created or AI-mutated Ingredient, substitution, recipe, or Shopping data.
- Automatic recipe/formula application or ratio/unit conversion.
- Backend, schema, index, migration, database, provider, or persistence changes.
- Package, lockfile, native/config, shared-contract, Admin, or navigation-registration changes.
- New routes, screens, contexts, services, providers, or storage authorities.
- Teammate mock data, client-held provider keys, fabricated fallbacks, and local domain authority.

## 11. Stop conditions and blockers

Stop implementation and return for an explicit contract amendment if:

- any production or test file outside the exact allowlists must change;
- strict current Ingredient search cannot be reused without changing `ingredientService.js`;
- the existing Assistant route or `/assistant/chat` contract cannot accept the bounded one-use handoff without navigation/backend changes;
- the existing picker/context contract cannot add the validated substitute with explicit unit/quantity;
- a backend, schema, index, package, provider, persistence, navigation-registration, or database change appears necessary;
- malformed or stale data would have to be treated as clean/empty/current;
- an implementation would infer identity, quantity, unit, catalog data, or success; or
- required tests cannot distinguish removal of the race, session, authority, or strict-boundary guards.

At freeze time there are **no implementation blockers**. All required paths exist on the stated baseline within the exact allowlists. Runtime/device and live-provider evidence are verification gates or explicitly deferred evidence, not reasons to redesign this contract.

## 12. Finalization record

- Audit / contract: **complete**.
- Implementation: **complete**.
- Independent review: **completed with required fixes**.
- Required fixes: **complete**.
- Closure: **PASS**.
- Focused ING2 gate: **112/112 PASS** across all six frozen suites on current `origin/main`.
- Standalone Shopping interaction gate: **29/29 PASS**.
- Direct Assistant/Shopping support regressions: **60/60 PASS** across `assistantState`, `assistantService`, `assistantErrors`, `shoppingListGrouping`, and `mealPlanShopping`.
- The unchanged `shoppingListStaticAudit` still fails only its known historical SHOP3 repository-scope drift assertion. This unrelated SHOP3 gate was not changed or treated as ING2 failure evidence.

Closure evidence includes:

- authenticated account A -> B invalidation for Ingredient Studio search and substitution success/failure;
- authenticated account A -> B ownership for Assistant transcript, request, loading, and error state;
- one-use `initialPrompt` consumption via `navigation.setParams` before send, including genuine unmount/remount proof;
- synchronous picker Save -> Close locking so same-frame close cannot dismiss an active submission;
- stale rejected `onAdd` isolation across close/reopen and account-switch sessions;
- atomic rejection of mixed valid/malformed substitution responses;
- validated substitute-ID-only Shopping handoff through the locked picker with explicit quantity/unit or `toTaste`, using only `ShoppingListContext.addItem`; and
- mutation-sensitive stale-session tests whose old continuations would visibly corrupt newer UI if ownership guards were removed.

Deferred evidence:

- Device/emulator: **NOT RUN — NOT CLAIMED AS PASS**.
- Provider connectivity: **NOT RUN — NOT CLAIMED AS PASS**.
- PR merge: **NOT PERFORMED — MILESTONE NOT CLAIMED MERGED/COMPLETE**.

## 13. Finalization verdict

**MOBILE-ING2 FINALIZED — READY FOR PR**
