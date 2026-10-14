# UI-FINAL1 consolidated integration freeze

**Frozen 2026-10-14 (Asia/Singapore), before production edits.**

Baseline: `887784a72a9966f841ae239cc985933a5597fef7`. Source UI: `ec5faa37a181785dcd35dc1fdf2cbb87fbb36522` plus its current Recipe Detail correction. Teammate presentation pin: `WECOOKEDD@4ffd47d176afcfb1f23ffa1be079f01791fae92e`.

Purpose: carry the already approved UI-FINAL1 implementation onto the integrated SHOP4/SHOP5/RANK1 source while keeping real API, auth, session, ownership, shopping v2, ranking, pagination and error behavior. No new frontend feature, mock authority, asset, backend, migration or deployment is authorized.

The exact edit allowlist is the 74 paths below plus `docs/milestones/UI-FINAL1-mobile-ui-adoption.md` and this integration freeze. The source worktree personal untracked runbook is excluded. No other path may change without a named amendment.

**Integration test amendment (2026-10-14, before the additional test edits):** add exactly `apps/mobile/__tests__/dashboardTrendingInteraction.test.js`, `apps/mobile/__tests__/recipeUnitContract.test.js`, and `apps/mobile/jest.config.js`. The pinned SVG visual requires an isolated mock in the existing RANK1 Dashboard test; instruction removal makes one Recipe Detail source boundary stale; the guest legal interaction test requires React Navigation ESM transformation. The historical COMM6 static audit is already allowlisted and must pin its original committed diff endpoint so this later integration cannot change the meaning of its scope check. No production path or new feature is added by this amendment.

## Exact 74 source-path allowlist

- `apps/mobile/__tests__/accountDetailsStaticAudit.test.js`
- `apps/mobile/__tests__/assistantScreenStaticAudit.test.js`
- `apps/mobile/__tests__/authScreensStaticAudit.test.js`
- `apps/mobile/__tests__/collectionDetailInteraction.test.js`
- `apps/mobile/__tests__/collectionDetailStaticAudit.test.js`
- `apps/mobile/__tests__/communityInteraction.test.js`
- `apps/mobile/__tests__/communityStaticAudit.test.js`
- `apps/mobile/__tests__/cookModeInteraction.test.js`
- `apps/mobile/__tests__/cookingHistoryStaticAudit.test.js`
- `apps/mobile/__tests__/dashboardInteraction.test.js`
- `apps/mobile/__tests__/dashboardStaticAudit.test.js`
- `apps/mobile/__tests__/deepLinkScreensStaticAudit.test.js`
- `apps/mobile/__tests__/discoverInteraction.test.js`
- `apps/mobile/__tests__/discoverStaticAudit.test.js`
- `apps/mobile/__tests__/ingredientService.test.js`
- `apps/mobile/__tests__/ingredientStudioInteraction.test.js`
- `apps/mobile/__tests__/ingredientStudioStaticAudit.test.js`
- `apps/mobile/__tests__/mealPlanInteraction.test.js`
- `apps/mobile/__tests__/mealPlanStaticAudit.test.js`
- `apps/mobile/__tests__/navigationShellStaticAudit.test.js`
- `apps/mobile/__tests__/notificationsInteraction.test.js`
- `apps/mobile/__tests__/notificationsStaticAudit.test.js`
- `apps/mobile/__tests__/pendingFeatureHonestyStaticAudit.test.js`
- `apps/mobile/__tests__/profileScreenInteraction.test.js`
- `apps/mobile/__tests__/profileStaticAudit.test.js`
- `apps/mobile/__tests__/recipeDetailInteraction.test.js`
- `apps/mobile/__tests__/recipeDetailStaticAudit.test.js`
- `apps/mobile/__tests__/registerLegalInteraction.test.js`
- `apps/mobile/__tests__/savedStaticAudit.test.js`
- `apps/mobile/__tests__/searchHistoryInteraction.test.js`
- `apps/mobile/__tests__/settingsStaticAudit.test.js`
- `apps/mobile/__tests__/shoppingListInteraction.test.js`
- `apps/mobile/__tests__/shoppingListStaticAudit.test.js`
- `apps/mobile/__tests__/themePreferenceInteraction.test.js`
- `apps/mobile/__tests__/topBarStaticAudit.test.js`
- `apps/mobile/__tests__/uiFinalSlice4c.test.js`
- `apps/mobile/app.json`
- `apps/mobile/package.json`
- `apps/mobile/src/api/ingredientService.js`
- `apps/mobile/src/components/DiscoverFiltersSheet.js`
- `apps/mobile/src/components/MealPlanSheet.js`
- `apps/mobile/src/components/NotificationsDropdown.js`
- `apps/mobile/src/components/SwipeToDelete.js`
- `apps/mobile/src/components/TabBar.js`
- `apps/mobile/src/components/TopBar.js`
- `apps/mobile/src/data/licenses.js`
- `apps/mobile/src/navigation/MainTabs.js`
- `apps/mobile/src/navigation/RootNavigator.js`
- `apps/mobile/src/navigation/tabBarLayout.js`
- `apps/mobile/src/screens/AboutScreen.js`
- `apps/mobile/src/screens/AccountDetailScreen.js`
- `apps/mobile/src/screens/AssistantScreen.js`
- `apps/mobile/src/screens/CollectionDetailScreen.js`
- `apps/mobile/src/screens/CommunityScreen.js`
- `apps/mobile/src/screens/CookModeScreen.js`
- `apps/mobile/src/screens/CookingHistoryScreen.js`
- `apps/mobile/src/screens/DashboardScreen.js`
- `apps/mobile/src/screens/DiscoverScreen.js`
- `apps/mobile/src/screens/HelpCenterScreen.js`
- `apps/mobile/src/screens/IngredientStudioScreen.js`
- `apps/mobile/src/screens/LandingScreen.js`
- `apps/mobile/src/screens/LicensesScreen.js`
- `apps/mobile/src/screens/MealPlanScreen.js`
- `apps/mobile/src/screens/PrivacyScreen.js`
- `apps/mobile/src/screens/ProfileScreen.js`
- `apps/mobile/src/screens/RecipeDetailScreen.js`
- `apps/mobile/src/screens/RegisterScreen.js`
- `apps/mobile/src/screens/SecurityScreen.js`
- `apps/mobile/src/screens/SettingsScreen.js`
- `apps/mobile/src/screens/ShoppingListScreen.js`
- `apps/mobile/src/screens/TermsScreen.js`
- `apps/mobile/src/screens/VerifyEmailChangeScreen.js`
- `apps/mobile/src/theme/ThemeContext.js`
- `package-lock.json`

## Controlled batches

1. Carry the existing source UI contract and the 61 paths absent from the baseline delta, retaining the source Recipe Detail instruction-removal change and its two focused tests.
2. Reconcile the 13 overlapping paths below manually against the integrated baseline; retain SHOP4/SHOP5/RANK1 code and tests. Never replace the entire Dashboard, Discover, Shopping List, RootNavigator or SwipeToDelete file.
3. Run focused UI, shopping, ranking and navigation tests; inspect the full changed-path manifest and source diff. Do not begin new UI features before this gate passes.

## Exact baseline-overlap paths

- `apps/mobile/__tests__/dashboardInteraction.test.js`
- `apps/mobile/__tests__/dashboardStaticAudit.test.js`
- `apps/mobile/__tests__/discoverInteraction.test.js`
- `apps/mobile/__tests__/discoverStaticAudit.test.js`
- `apps/mobile/__tests__/navigationShellStaticAudit.test.js`
- `apps/mobile/__tests__/searchHistoryInteraction.test.js`
- `apps/mobile/__tests__/shoppingListInteraction.test.js`
- `apps/mobile/__tests__/shoppingListStaticAudit.test.js`
- `apps/mobile/src/components/SwipeToDelete.js`
- `apps/mobile/src/navigation/RootNavigator.js`
- `apps/mobile/src/screens/DashboardScreen.js`
- `apps/mobile/src/screens/DiscoverScreen.js`
- `apps/mobile/src/screens/ShoppingListScreen.js`

The four-card Home taxonomy is approved, but image provenance is unresolved and is outside this consolidation. Register password/consent redesign, authored heat, selected-serving shopping import, and authored step timers are also separate follow-on slices. Recipe Detail instructions are hidden only in Detail; API recipe fields and Cook Mode remain unchanged.

Source and Jest evidence are separate from physical device, Mongo, provider and deployment evidence. No release gate is inferred from a local source integration.

## Reconciliation and verification result

- The 61 nonoverlapping source UI paths were carried into this worktree, including the source Recipe Detail instruction-removal change and its interaction/static tests. Two of those test paths received the named integration fixes below. The source UI worktree, its four dirty paths and its personal untracked runbook remain untouched.
- Dashboard combines the source Home header, accessible hero, SVG scrim and tab clearance with RANK1's Top Rated rail and request/owner guards. Discover combines the pinned Search card/header/filter presentation with RANK1's sort, pagination and owner behavior. RootNavigator carries guest and authenticated Terms/Privacy keys while retaining Trending. Shopping List retains SHOP5 custom items, clear-checked, provenance, and synchronous context mutation lock; it adopts Grocery List/Clear all labels and the pinned 76-pixel trash-icon reveal on the existing tested swipe component. The source screen's extra per-row removal lock is unnecessary because `ShoppingListContext.runMutation` already takes a synchronous one-at-a-time lock before making a request.
- The eight overlapping source test paths were reconciled against baseline tests. The source Shopping swipe tests were not copied because the integrated SHOP5 tests already exercise horizontal activation, explicit deletion, failure recovery and stale-session behavior through the real component. The source static assertion forbidding custom items and clear-checked conflicts with SHOP5 and was not adopted. Matching presentation assertions were added to the integrated tests.
- Test amendment: `dashboardTrendingInteraction.test.js` gained suite-local SVG and safe-area mocks; `recipeUnitContract.test.js` now bounds its source inspection by the Nutrition card after Detail instructions were removed; `registerLegalInteraction.test.js` mocks the unrelated RANK1 Trending route; `jest.config.js` transforms the React Navigation ESM modules used by the real legal-route test. The already allowlisted `communityStaticAudit.test.js` now checks the immutable COMM6 baseline-to-tip range instead of diffing all later integration work.
- Focused integration gate: 10 suites, 305 tests passed. After the final Shopping visual reconciliation, its 2 focused suites and 86 tests passed. The final full mobile Jest run passed **98/98 suites and 1704/1704 tests**, with `--runInBand --silent --testTimeout=30000`; the Community static audit needed read-only Git subprocess access outside the restricted process sandbox. `git diff --check` and JSON parsing of `package-lock.json`, `apps/mobile/package.json`, and `apps/mobile/app.json` passed. The final 78 changed paths are inside the frozen 74-path source list, three named test amendments, and two milestone documents.

This worktree is the active UI-FINAL1 development location. Its source integration gate is passed. No new frontend feature was started as part of this consolidation. Native/device, live API, Mongo, provider and deployment checks were not run.
