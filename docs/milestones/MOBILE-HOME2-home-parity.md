# WeCooked — MOBILE-HOME2 Home Parity Contract

**Status:** CONTRACT FROZEN — READY FOR IMPLEMENTATION

## 1. Baseline

- Existing HOME2 audit worktree, detached at `5d61bde3c9602a3fc044bcb19e957212d0fc52a5`.
- `origin/main` was fetched again on 2026-10-07 and remains exactly `5d61bde3c9602a3fc044bcb19e957212d0fc52a5`.
- The verified baseline has not moved; no integration is required or permitted by this contract review.
- Audit authority: `docs/milestones/MOBILE-HOME2-home-parity-audit.md`. This contract does not rewrite that audit.

## 2. Frozen milestone path

`docs/milestones/MOBILE-HOME2-home-parity.md`

## 3. Exact HOME2 slice

HOME2 adds only an accessible Shopping shortcut to the authenticated Home header, an authoritative badge for the current number of unchecked Shopping List entries, and navigation to the existing Shopping List route.

The shortcut is Home-only. Existing Home recipe loading, search, recent-search convenience history, Saved behavior, notification behavior, recipe generation ownership, and all other Home content remain unchanged. The teammate Home is presentation reference only and supplies no data, persistence, API, security, or accessibility authority.

## 4. Shopping provider authority

`ShoppingListProvider` is the sole Shopping authority. `DashboardScreen` consumes only the provider's existing authenticated, server-backed state exposed by `useShoppingList()`:

- `items`, already ownership-gated to the current authenticated account;
- `status`, whose effective values are `idle`, `loading`, `ready`, or `error` and which becomes `loading` rather than exposing stale status during an account transition;
- no direct import or call to `shoppingListService`;
- no Home-specific request, reload, persistence, cached count, optimistic count, local merge, or AsyncStorage domain state.

The provider's existing initial load, refresh, mutation responses, session invalidation, request generations, and current-account exposure gate remain authoritative and unchanged.

## 5. Badge counting semantics

When and only when provider `status === 'ready'`, the badge count is the number of current exposed entries for which `item.isChecked` is falsy. Each entry contributes exactly one. Quantity, textual amount, unit, ingredient availability, or any ingredient quantity never changes its contribution.

- An unchecked entry contributes one.
- A checked entry contributes zero.
- Zero unchecked entries hide the badge.
- A server-confirmed check or uncheck changes the badge through the provider's replacement `items` state.
- Server-confirmed add, delete, and clear mutations change the badge through that same provider state; Home performs no independent reconciliation.
- A provider refresh replaces the count from its resulting authoritative `items` state.
- During an account switch, the provider's ownership gate exposes no prior-account items and effective status is `loading`; therefore the old badge disappears immediately and no new badge appears until the new account reaches `ready`.
- A failed background refresh that preserves the provider's already-ready list may continue to display the count from that still-authoritative exposed list. The accompanying provider error does not turn known data into unknown data.

## 6. Approved badge cap semantics

The authoritative unchecked-entry count remains an uncapped nonnegative integer derived from the current ready provider items. Only its visual presentation is capped:

- zero unchecked entries: render no badge;
- one through 99 unchecked entries: render the exact numeric count;
- 100 or more unchecked entries: render `99+`.

The cap is a `TopBar` presentation rule only. It must not alter, truncate, replace, persist, or become the source of the authoritative count. Focused tests must cover zero, one, 99, 100, and a value above 100.

## 7. Zero, loading, and error behavior

- `ready` with an empty list: Shopping shortcut remains enabled; badge is absent.
- `ready` with all entries checked: Shopping shortcut remains enabled; badge is absent.
- `ready` with unchecked entries: Shopping shortcut remains enabled; badge shows the approved visual representation: the exact count through 99 and `99+` at 100 or more.
- `idle` or `loading`, including the account-ownership transition: Shopping shortcut remains enabled; badge is absent. Absence means unknown, not a fabricated zero.
- Initial `error` with no ready list: Shopping shortcut remains enabled; badge is absent. Home does not render a zero or duplicate the Shopping screen's error UI.
- Ready data retained after a failed background refresh: Shopping shortcut remains enabled and the badge continues to reflect the retained provider items.

Navigation is independent of badge readiness because the existing `List` screen owns its own loading, error, empty, refresh, and mutation UI.

## 8. TopBar blast-radius result

`apps/mobile/src/components/TopBar.js` is shared by Dashboard, Community, Discover, Cooking History, Ingredient Studio, account/settings/legal screens, reviews, notifications, and other screens. Shopping UI therefore must be explicit and prop-driven:

- `TopBar` remains backward-compatible by default and renders no Shopping control unless an explicit Shopping callback is supplied.
- `DashboardScreen` is the only caller that opts in and supplies the authoritative ready-state count plus the Shopping navigation callback.
- Existing `brand`, `title`, and `back` modes, Saved opt-in behavior, notification dropdown, right action, layout, and all non-Dashboard consumers render and behave as before.
- No component rename, redesign, provider ownership transfer, or implicit Home detection is permitted.

This Home-only contract fits within the two-file production allowlist; no amendment is required.

## 9. Navigation contract

- The complete Shopping icon/button is one tap target in the Home `TopBar` action cluster.
- One activation invokes exactly one `navigation.navigate('List')` call.
- No nested competing press target, propagation path, debounce callback, reset, replace, or second navigation call is introduced.
- The route target is the existing authenticated root-stack screen named `List`, backed by `ShoppingListScreen`.
- The action stays enabled during loading, initial error, empty, all-checked, and nonempty states; the destination owns those states.

## 10. Accessibility contract

- The Shopping shortcut is a `Pressable` with `accessibilityRole="button"`.
- Its stable discoverability text identifies the destination as `Shopping list`.
- When an authoritative nonzero count is rendered, the accessible label includes the exact uncapped semantic count of unchecked entries, not merely the capped visual text; singular/plural wording must be correct. For example, an authoritative count of 127 renders `99+` visually and announces `Shopping list, 127 unchecked items`. While unknown or zero, the label must not announce a fabricated pending count.
- The decorative badge is part of the button's accessible meaning and must not create a second independently focusable element or duplicate announcement.
- Reuse the current TopBar action convention: an explicit button style plus `hitSlop={10}`. Preserve the existing action-cluster order and minimum practical touch area; do not broaden HOME2 into a shared accessibility redesign.
- The cart icon remains discoverable without relying on icon recognition, color, or badge text alone.

## 11. Async and ownership contract

`ShoppingListProvider` continues to own every Shopping async lifecycle concern: authenticated account identity, initial GET, refresh exclusion, mutation serialization, pessimistic server-confirmed replacement, stale GET invalidation, session invalidation, unmount guards, and previous-account suppression.

Dashboard performs a synchronous derivation from the currently exposed `items` only when provider state is ready, and passes presentation values to `TopBar`. It introduces no effect, request generation, request cancellation, retry, reload, mutation, separate state copy, or cached count. Provider rerenders alone update the badge. Dashboard's existing latest-recipe and search request generations remain untouched.

## 12. Exact production allowlist

```text
apps/mobile/src/screens/DashboardScreen.js
apps/mobile/src/components/TopBar.js
```

These two paths are sufficient. No other production path is authorized.

## 13. Exact test allowlist

```text
apps/mobile/__tests__/dashboardInteraction.test.js
apps/mobile/__tests__/dashboardStaticAudit.test.js
apps/mobile/__tests__/searchHistoryInteraction.test.js
```

These paths are sufficient. The new mounted interaction suite can render Dashboard against replaceable Shopping provider values and render shared `TopBar` configurations directly. It must prove:

- zero hides the badge;
- only unchecked entries are counted;
- provider value replacement updates the display without a Home request;
- check/uncheck and add/delete/clear-shaped provider replacements update the display;
- initial loading, account-transition loading, and initial error hide unknown counts while leaving navigation usable;
- ready retained items remain represented when a background-refresh error is also present;
- exact visual values through 99, `99+` at 100 and above, and the unchanged uncapped authoritative accessibility count;
- one Shopping activation navigates exactly once to `List`;
- button role, destination label, authoritative count announcement, and nonduplicated badge semantics;
- default/shared `TopBar` configurations without Shopping props render no Shopping control and preserve existing controls.

The static audit may supplement this by proving no direct Shopping service, storage, request, mutation, or independent count state is introduced and by pinning the Dashboard-only opt-in. Static assertions do not replace mounted interaction proof. Existing relevant suites must also pass unchanged, but no other test file may be modified under HOME2.

## 13A. Narrow contract amendment — search-history harness

- **Reason:** HOME2 correctly makes the real `DashboardScreen` consume `useShoppingList()`. The existing `searchHistoryInteraction.test.js` real-Dashboard harness neither mocks nor provides that required Shopping context, so it cannot render the Dashboard without loading the real provider and its API dependencies.
- **Added test path:** `apps/mobile/__tests__/searchHistoryInteraction.test.js` is added to the exact HOME2 test allowlist solely for this harness compatibility repair.
- **Production scope:** unchanged; the exact two-file production allowlist in section 12 remains sufficient and no production code may be changed for this repair.
- **Frozen repair direction:** preserve the test's search-history purpose and mock the existing `useShoppingList()` hook with a stable neutral authoritative value (`items: []`, `status: 'ready'`). The harness must not mount a Shopping provider, issue Shopping API requests, add Shopping behavior assertions, or change Dashboard behavior.
- **Excluded baseline findings:** `apps/mobile/__tests__/topBarStaticAudit.test.js` and `apps/mobile/__tests__/navigationShellStaticAudit.test.js` have unrelated baseline failures. They remain outside HOME2 and are not added to this allowlist or repaired here.

## 14. Backend and schema implications

- Backend change: **NONE**
- Schema change: **NONE**
- Migration: **NONE**
- Index: **NONE**
- Package/lockfile: **NONE**
- Storage: **NONE**
- New endpoint: **NONE**

HOME2 reuses the provider's existing authenticated Shopping List read and server-confirmed mutation results.

## 15. Dependencies and exclusions

Explicitly outside HOME2:

- RANK1 Trending, Top Rated, relevance, eligibility, or any client ranking;
- SAVED2 smart collections and Healthy Meals;
- cravings or inferred taxonomy;
- recent views, view-event persistence, or activity relabeling;
- personalization or recommendation algorithms;
- COMM7 or other Community ranking/feed work;
- notification behavior, delivery, producers, or badge changes;
- meal reminders;
- SHOP4/SHOP5 mutation or Shopping workflow redesign;
- backend, API, schema, migration, index, storage, or package work;
- UI-FINAL1 and final visual polish.

The Shopping badge cap is resolved within HOME2. The unrelated dependencies above remain excluded and do not expand this slice.

## 16. Runtime and device gates

Deferred to implementation/runtime verification and not claimed passed by this contract review:

- authenticated Android and iOS;
- Home to Shopping List navigation;
- provider initial loading, ready-empty, ready-all-checked, nonempty, and initial-error states;
- live server-confirmed check/uncheck count updates;
- live add/delete/clear updates;
- account switch and stale old-account suppression;
- provider refresh, offline, and slow-network behavior;
- screen-reader focus, role, label/count announcement, order, and practical touch target;
- light/dark theme rendering where currently supported.

## 17. Blockers

None. The previously unresolved badge cap is approved as exact numeric display for one through 99 and `99+` for 100 or more, while accessibility continues to announce the exact authoritative count. No production-scope, navigation, provider-authority, backend/schema, or test-allowlist blocker remains.

## 18. Verdict

**MOBILE-HOME2 CONTRACT FROZEN — READY FOR IMPLEMENTATION**

## 19. Closure status

**Implementation summary.** Dashboard now consumes only the existing `ShoppingListProvider` state and derives one count per unchecked entry when that state is authoritative and ready. `TopBar` has an explicit, Dashboard-only Shopping opt-in that renders the existing `List` navigation action, hides a zero or unknown badge, displays exact counts through 99 and `99+` thereafter, and retains the uncapped count in its accessible label. There is no Shopping request, mutation, persistence, async ownership, backend, schema, migration, index, endpoint, package, lockfile, or navigation-configuration change.

**Contract amendment history.** The initial frozen test allowlist contained `dashboardInteraction.test.js` and `dashboardStaticAudit.test.js`. `apps/mobile/__tests__/searchHistoryInteraction.test.js` was added only because the real Dashboard now consumes `useShoppingList()` and its pre-existing search-history harness had neither Shopping context nor a hook mock. The repair is a stable neutral `useShoppingList` mock with `{ items: [], status: 'ready' }`; it makes no production change and adds no Shopping behavior to that test.

**Independent review.** MOBILE-HOME2 INDEPENDENT REVIEW PASS — READY FOR CLOSURE. Provider/session ownership, unchecked semantics, retained ready data, provider updates, the shared TopBar blast radius, one-action `List` navigation, accessibility, the 99/100 boundary, Dashboard regressions, the harness amendment, and mutation resistance were reviewed. No BLOCKER, HIGH, MEDIUM, LOW, or NOTE findings remain.

**Focused evidence.** `dashboardInteraction.test.js`, `dashboardStaticAudit.test.js`, and `searchHistoryInteraction.test.js` passed: 3/3 suites, 35/35 tests. The notifications regression, `notificationsInteraction.test.js`, passed: 1/1 suite, 8/8 tests. Combined confirmation: 4/4 suites, 43/43 tests. The lockfile is identical to the sibling checkout used for the already-installed test dependencies. The local Jest run emitted existing React test-renderer/`act` warnings but no test failures.

**Final attributable scope.**

```text
apps/mobile/src/screens/DashboardScreen.js
apps/mobile/src/components/TopBar.js
apps/mobile/__tests__/dashboardInteraction.test.js
apps/mobile/__tests__/dashboardStaticAudit.test.js
apps/mobile/__tests__/searchHistoryInteraction.test.js
docs/milestones/MOBILE-HOME2-home-parity-audit.md
docs/milestones/MOBILE-HOME2-home-parity.md
```

**Unrelated baseline failures.** `apps/mobile/__tests__/topBarStaticAudit.test.js` and `apps/mobile/__tests__/navigationShellStaticAudit.test.js` remain outside HOME2. They were not changed or absorbed.

**Deferred runtime and device gates.** Android, iOS, live Shopping mutations, account switching, offline/slow-network behavior, physical accessibility/device validation, and theme rendering are NOT RUN and NOT CLAIMED AS PASS.

**Final closure verdict:** **MOBILE-HOME2 CLOSURE PASS — READY FOR FINALIZATION**
