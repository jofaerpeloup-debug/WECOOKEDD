# UI-FINAL1 — Recipe Ingredients route

Baseline: clean `101f8338fc8878931358c7b289f5e9de6c132024`.
Authority: `UI-FINAL1-mobile-ui-adoption.md`, completed `MOBILE-PARITY-AUDIT2-final-product-parity-audit.md` Recipe Ingredients finding, and teammate `WECOOKEDD@4ffd47d176afcfb1f23ffa1be079f01791fae92e` presentation.

## Frozen exact edit allowlist (before production edits)

- `docs/milestones/UI-FINAL1-recipe-ingredients-route.md`
- `apps/mobile/src/navigation/RootNavigator.js`
- `apps/mobile/src/screens/CommunityScreen.js`
- `apps/mobile/src/screens/RecipeIngredientsScreen.js` (new)
- `apps/mobile/__tests__/communityInteraction.test.js`
- `apps/mobile/__tests__/recipeIngredientsInteraction.test.js` (new)

**Pre-edit test amendment:** `apps/mobile/__tests__/navigationShellStaticAudit.test.js` is also allowed. Its exact authenticated route list must include the new route, and its focused route assertion must verify the new screen registration. No other navigation expectation changes.

## Contract

Register `RecipeIngredients` in the authenticated root stack. Community retains its `View Recipe` action and adds `View Ingredients` only for the existing available attachment with a nonblank real Recipe ID. Pass exactly `{ recipeId }`, not the attachment or a recipe. The destination validates the ID, performs a fresh authenticated `getRecipe(recipeId)`, and renders only the fetched title and ingredient list using teammate styling and current theme tokens. It must distinguish loading, retryable errors, and a missing/unavailable recipe; no stale recipe may remain visible after a 404 or account/session change. Invalidate pending responses on route ID change, session change, retry, and unmount. Preserve all other Community, RootNavigator, SHOP5, and RANK1 behavior. No backend, service, package, configuration, or mock-data change.

The owner will run focused Jest locally. Source inspection, parse and whitespace checks do not claim Jest, device, live API, or deployment proof.
