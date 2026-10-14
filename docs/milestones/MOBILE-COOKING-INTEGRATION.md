# MOBILE COOKING INTEGRATION - Mobile contract and scope

Baseline: clean Mobile `ac44d19fe75cb2ff50a1d5d0ebc796af6cdfa48b`.
Backend authority: committed `62c1f2641f64dc2de9cbe082f60b817cbb4cac68` Recipe detail and Shopping List v2 contracts. Moderator checkpoint: `cb897f40ca9b84d4157514c2191f9ef77d4dfca2` (read-only evidence).

## Frozen exact Mobile edit allowlist (before code edits)

Production:

- `apps/mobile/src/screens/RecipeDetailScreen.js`
- `apps/mobile/src/screens/CookModeScreen.js`
- `apps/mobile/src/context/ShoppingListContext.js`
- `apps/mobile/src/api/shoppingListService.js`
- `apps/mobile/src/api/shoppingListErrors.js`
- `apps/mobile/src/utils/cookingSelection.js` (new pure helper)
- `apps/mobile/src/utils/recipe.js`

Focused tests:

- `apps/mobile/__tests__/recipeDetailInteraction.test.js`
- `apps/mobile/__tests__/cookModeInteraction.test.js`
- `apps/mobile/__tests__/shoppingListService.test.js`
- `apps/mobile/__tests__/cookingSelection.test.js` (new)

Documentation: this file only. No backend, Moderator, other worktree, package, navigation, or persistence edits. The owner runs focused Mobile Jest locally.

**Focused test amendment before test edits:** add exactly `apps/mobile/__tests__/recipeDetailStaticAudit.test.js` and `apps/mobile/__tests__/cookModeStaticAudit.test.js`. Their historical source assertions require the old route key, default ingredient handoff, and inline manual timer start. Update those assertions to the new session-scoped route key, complete authored handoff, and shared manual/preset timer start while retaining the existing safety checks. No additional production path is added.

## Field and behavior map

- Authenticated `GET /recipes/:id` supplies `servings`, `updatedAt`, complete default `ingredients`, `steps`, and `cooking: null | {schemaVersion:1,defaultSpiceLevel,spiceAlternatives,stepTimers}`. Each alternative supplies a complete authored ingredient list. Recipe Detail displays the selected complete list, scaled by selected servings, and passes the same selection to Cook Mode. Old recipes use default ingredients and manual timer.
- Offer only the non-null authored default and returned alternatives. An unavailable alternative is already omitted from the consumer detail response. Nutrition remains the authored default per-serving figure and is not recalculated for spice variants.
- A preset applies only to the exact current 1-based step order, selected serving count, and selected spice level (or null for timer-only). The user explicitly starts it. The existing manual `HH:MM:SS` timer stays available when no preset matches and after reset.
- Selected Shopping List v2 import sends exactly `{servings,expectedRecipeUpdatedAt}` and adds `spiceLevel` only for an authored spice profile. It requires a fresh fetched detail, valid authored servings, and `updatedAt`; no default-only fallback may silently replace the user's selection. A 409 `RECIPE_STALE` blocks retry until detail refresh. A 404 `RECIPE_NOT_FOUND` removes stale detail. Other import errors retain the selection and explain the failure.
- Shopping List provider keeps its existing capability, session, mutation lock, and authoritative response guards. Recipe Detail must not commit stale GET/import outcomes across route, session, or unmount changes. Cook Mode remains within the authenticated navigation stack and its manual timer/Finish behavior is preserved.

## Resume completion and verification - 2026-10-14

Preserved the original 14-path delta and completed the remaining static assertions and lifecycle wiring. Recipe Detail initializes the authored default even when the initial list snapshot and fetched detail share a timestamp. A removed selected alternative cannot silently use the default list. An unavailable Recipe remains hidden during a subsequent pending refresh. Route/account/session changes invalidate prior detail and import outcomes; Cook Mode resets local timer/checklist state and suppresses delayed Finish feedback and navigation. No selected-spice nutrition is inferred.

**Final focused Jest: PASS - 9 suites, 275 tests, 0 failed, 0 skipped.** This was agent-run against this worktree's config and source using existing sibling dependencies read-only. Jest, React, renderer, Testing Library, Babel and Expo preset versions matched the target lockfile. No dependency installation was performed. Initial runs exposed two unfinished static assertions and a missing Platform mock in the new real-provider test; those were corrected before the final passing run.

**Source gates:** HEAD remains `ac44d19fe75cb2ff50a1d5d0ebc796af6cdfa48b`; exact allowlist PASS (14 changed paths); Babel parse PASS (13 JavaScript paths); tracked and new-file whitespace checks PASS. The three additional suites below are existing regression tests run without edits.

From the worktree's `apps/mobile` directory, with local dependencies available:

```powershell
$cookingTests = @(
  '__tests__/cookingSelection.test.js',
  '__tests__/recipeDetailInteraction.test.js',
  '__tests__/cookModeInteraction.test.js',
  '__tests__/shoppingListService.test.js',
  '__tests__/recipeDetailStaticAudit.test.js',
  '__tests__/cookModeStaticAudit.test.js',
  '__tests__/cookModeData.test.js',
  '__tests__/cookTimer.test.js',
  '__tests__/shoppingListInteraction.test.js'
)
npm test -- --config jest.config.js --roots __tests__ --runInBand --testTimeout=30000 --runTestsByPath @cookingTests
```

The actual agent run used the same test arguments with this existing dependency runner:

```powershell
$env:NODE_PATH = 'C:\Users\Clein\OneDrive\Documents\Projects\wecooked\apps\mobile\node_modules;C:\Users\Clein\OneDrive\Documents\Projects\wecooked\node_modules'
node '..\..\..\wecooked\apps\mobile\node_modules\jest\bin\jest.js' --config jest.config.js --roots __tests__ --runInBand --testTimeout=30000 --runTestsByPath @cookingTests
```

For concise captured results, the final run also used `--silent --json --outputFile` and temporary log/result files. These affect reporting only.

**Device/native UI, live Recipe/import API, Mongo/provider concurrency and deployment: NOT RUN - NOT CLAIMED AS PASS.** No commit, staging, push, merge, migration, new worktree or deployment was performed.

**Handoff: READY FOR LOCAL TESTING.**
