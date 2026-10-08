# MOBILE-COOK2-HOTFIX1 - Native-stack exit guard audit

**Audit date:** 2026-10-08

**Audit worktree:** `C:\Users\Clein\OneDrive\Documents\Projects\wecooked-mobile-cook2-hotfix1-audit`

**Baseline:** `origin/main` and detached `HEAD` at `8fbe1ecc551cdce46aaaa96eb9db3cddf12dd30c`

**Merge:** PR #105, implementation commit `996c787212ca440af0d1f1bb377252de6e0361ee`

**Audit boundary:** Contract audit only. No production, test, package, lockfile, stash, branch, database, or deployment mutation.

## 1. Baseline

The clean audit worktree was created detached at `8fbe1ecc551cdce46aaaa96eb9db3cddf12dd30c`. That commit is both the local `origin/main` value supplied for this audit and the PR #105 merge commit (`Merge pull request #105 from klaynn/feat/mobile-cook2-single-manual-timer`). Its first parent is `b0cbe3c77f08204dc72345855d5fc2e3ac9b4088`; its COOK2 parent is `996c787212ca440af0d1f1bb377252de6e0361ee`.

All pre-existing worktrees were retained. The dirty primary checkout was not changed. The protected Cook Mode stash was not listed, inspected, applied, popped, dropped, restored, or otherwise touched.

## 2. Reproducing platform

**Not determinable from the supplied defect report or merged repository.** The error is emitted by the installed native-stack implementation and includes an iOS-specific back-menu recommendation, but that wording does not prove which platform reproduced the defect. Final runtime acceptance must record the reproducing OS/device/build before executing the platform-specific gate in section 16.

## 3. Navigator type

- `RootNavigator.js` imports `createNativeStackNavigator` from `@react-navigation/native-stack` and declares `const Stack = createNativeStackNavigator()`.
- CookMode is an authenticated root-stack route: `<Stack.Screen name="CookMode" component={CookModeScreen} options={{ animation: 'slide_from_bottom' }} />`.
- The navigator-wide options are `{ headerShown: false, animation: 'slide_from_right' }`. CookMode overrides only `animation`.
- Therefore CookMode has **no native-stack header**. `headerBackButtonMenuEnabled` is not currently set at navigator or screen level, and there is no native header back button/menu for this screen.
- CookMode renders its own in-content `CookHeader`. Its `Pressable` has accessibility label `Back` and calls `navigation.goBack()`.
- `gestureEnabled` is not configured by the app. In the resolved packages, iOS passes the unset value through to `react-native-screens`, whose native default is enabled; on Android native-stack explicitly disables the native screen gesture prop because Android system back is handled on the JS navigation side. Programmatic and custom-header Back remain enabled.

## 4. Installed navigation versions

The mobile manifest, root lockfile, and the existing lockfile-matching installation agree on:

| Package | Manifest request | Resolved/installed |
| --- | --- | --- |
| `@react-navigation/native` | `^7.3.16` | `7.3.17` |
| `@react-navigation/native-stack` | `^7.18.8` | `7.18.9` |
| `@react-navigation/core` | transitive `^7.21.13` | `7.21.13` |
| `react-native-screens` | `~4.26.0` | `4.26.2` |

No dependency installation or package/lockfile change is required or authorized.

## 5. Exact current `beforeRemove` behavior

`CookModeScreen` currently installs `navigation.addListener('beforeRemove', ...)` in an effect and returns the remover for cleanup.

1. The listener ignores calls after unmount.
2. `allowedRemovalActionRef` is an exact object-identity bypass. If the incoming `event.data.action` is the same object as the allowed action, the listener clears the bypass and permits removal.
3. Otherwise it reads `timerRef`. Only `RUNNING`, or `PAUSED` with positive `remainingMs`, is active. `IDLE` and `COMPLETED` pass without prevention.
4. For an active timer it calls `event.preventDefault()` on every removal attempt before prompt deduplication.
5. `activePromptRef` permits only one live prompt. A new prompt increments `promptGenerationRef`; both actions use `ownsPrompt()` (`mountedRef` plus generation equality).
6. **Stay** clears the active prompt only. It preserves the timer and permits a later removal attempt to own a new prompt.
7. **Discard timer and leave** is one-shot through prompt ownership. It clears the prompt, suppresses a completion announcement, clears invalid input ownership, increments timer generation, commits `IDLE`, clears input/error state, captures the first prevented event's exact action, writes that object to `allowedRemovalActionRef`, and dispatches it.
8. A `finally` clears the bypass if the dispatch did not synchronously re-enter the listener or if dispatch threw. This avoids leaving the same action object permanently allowed.
9. Native platforms use `Alert.alert`; web uses `window.confirm` with the same Stay/Discard outcome.
10. Reset and unmount increment prompt generation and null the live prompt/bypass. Unmount also removes the navigation listener through the effect cleanup.

Repeated Back attempts are prevented but retain the first action as prompt owner. Confirmed replay relies on the custom exact-action bypass to avoid a second prevention loop.

## 6. Root cause

The observed warning text is present verbatim in the resolved `@react-navigation/native-stack@7.18.9` source. Its diagnosis is exact: the route was dismissed natively while the raw JS `beforeRemove` listener prevented the corresponding JS navigation-state removal. Native and JS stacks then disagreed about whether CookMode still existed.

Raw `navigation.addListener('beforeRemove', ...)` can therefore produce the observed divergence in this navigator. The listener handles only the JS event; it does not register the route in React Navigation's native-stack prevention context before native dismissal. This is a runtime integration defect, not a timer-state, action-identity, Cook History, or dependency-version defect.

## 7. `usePreventRemove` availability

**Available now.** `@react-navigation/native@7.3.17` re-exports `@react-navigation/core`; core `7.21.13` exports `usePreventRemove`. The resolved hook registers route prevention through `PreventRemoveContext` during insertion effects and also installs the supported `beforeRemove` callback path.

The resolved native-stack consumes that context by setting `preventNativeDismiss={isRemovePrevented}` on iOS and handling native-dismiss cancellation. This is the integration missing from the current raw listener. The supported callback receives `{ data: { action } }`, and the documented continuation is `navigation.dispatch(data.action)` after confirmation. See the official [`usePreventRemove` reference](https://reactnavigation.org/docs/use-prevent-remove/) and [preventing-going-back guidance](https://reactnavigation.org/docs/preventing-going-back/).

**Dependency implication:** none. Preferred no-package-change hotfix is supported by the exact installed packages.

## 8. `headerBackButtonMenuEnabled` requirement

**No explicit configuration is required for this CookMode route.**

- The option is iOS-only and controls the long-press menu on a native header back button; CookMode inherits `headerShown: false`, so that header and menu do not exist. See the official [native-stack option reference](https://reactnavigation.org/docs/native-stack-navigator/#headerbackbuttonmenuenabled).
- The installed native-stack also derives the value while a route is registered by `usePreventRemove`: an actively prevented route is passed to header configuration with the back-button menu disabled.
- The visible CookMode back control is a React Native `Pressable`, not a native-stack header button.

Disposition: **C - unnecessary for the current platform/configuration.** Do not touch `RootNavigator.js`; adding an unused screen option would not fix the raw-listener defect and would broaden production scope without effect.

## 9. Correct supported removal contract

Replace the raw listener effect with `usePreventRemove` imported from `@react-navigation/native` and enable it only for `RUNNING`, or `PAUSED` with positive remaining time. Its callback must retain the minimum prompt ownership needed for repeated removal attempts and stale native alert callbacks:

```js
usePreventRemove(hasActiveTimer, ({ data }) => {
  // Ignore after unmount; own at most one prompt generation.
  // Stay: release this prompt and preserve the timer.
  // Discard: if this generation still owns the prompt, clear/inert the timer,
  // then continue exactly the prevented action once.
  navigation.dispatch(data.action);
});
```

Freeze these invariants:

- `hasActiveTimer` is derived from rendered timer state so native-stack receives current prevention state; `timerRef` remains the synchronous authority inside the callback and timer handlers.
- `activePromptRef`, `promptGenerationRef`, `ownsPrompt`, first-action ownership, one-shot confirmation, Reset invalidation, and unmount invalidation remain.
- The first prevented action owns the visible prompt. Later attempts while that prompt is live are ignored by prompt creation but remain prevented by the hook.
- Confirmed discard clears/inerts the timer before continuing `data.action`; double-press and stale callbacks cannot dispatch twice.
- Web/native prompt copy and choices remain unchanged.
- The raw `navigation.addListener('beforeRemove', ...)` effect and its manual listener cleanup disappear. Hook lifecycle cleanup becomes library-owned; existing component unmount cleanup remains for timer and prompt refs.

## 10. Old bypass disposition

Remove `allowedRemovalActionRef` completely, including initialization, exact-object comparison, assignment, `finally` cleanup, Reset cleanup, and unmount cleanup.

The bypass compensates for replay through an unsupported raw listener. `usePreventRemove` explicitly supports continuing the captured action with `navigation.dispatch(data.action)`; carrying a second app-owned bypass would duplicate library behavior and could permit a later removal outside the hook's prevention state. Existing tests that require exact-action bypass cleanup encode the obsolete implementation and must be replaced by behavioral continuation/one-shot assertions.

## 11. Exit-case contract

| Exit case | Frozen result |
| --- | --- |
| Visible CookMode header Back | Custom `navigation.goBack()`; active timer prompts once, Stay remains, Discard continues captured action once. |
| Android hardware Back | JS navigation removal; active timer is guarded by `usePreventRemove`; applicable physical gate required. |
| iOS swipe-back | Native dismissal is prevented/cancelled through native-stack context; active timer prompts, Stay keeps CookMode, Discard continues once. |
| iOS native header back-button menu | Not present because `headerShown: false`; no explicit option needed. If a future native header is enabled, re-audit and keep the menu disabled while prevention is active. |
| Programmatic `goBack`/pop/reset that removes CookMode | Same active-timer guard; continue the exact captured action after confirmation. |
| Finish success `goBack` | Active timer prompts after the successful POST; confirmed continuation must not invoke Finish again. |
| Confirmed discard replay | Clear/inert timer, dispatch `data.action` once, no second prompt, no app-owned bypass. |
| Logout/session root replacement | Session authority wins; conditional authenticated-tree removal unmounts CookMode and is not trapped by the hook. |
| Completed timer exit | Normal removal, no prompt. |
| Idle/reset timer exit | Normal removal, no prompt. |

The hook only prevents a navigation-state action that removes the route. Its documented limitation is that it does not prevent conditional parent unmount; that limitation is required here for auth/session authority.

## 12. Finish coexistence implications

Explicit Finish remains the sole Cook History mutation.

- `RUNNING` or positive `PAUSED` plus Finish: `recordCompletion` is called once. After success, the notification callback's `navigation.goBack()` is prevented and prompts. Stay keeps CookMode without repeating the POST. Discard continues that already-requested Back once; stale/double Discard cannot dispatch twice.
- `COMPLETED` or `IDLE` plus Finish: the successful Back proceeds normally without discard confirmation.
- The synchronous `isFinishingRef` duplicate-request guard, disabled UI state, request/error/retry behavior, recipe identity, and servings payload remain untouched.
- Timer completion/reset/exit never calls `recordCompletion`; navigation continuation never calls `finishCooking`.

## 13. Auth/session implications

`RootNavigator` conditionally swaps the authenticated screen set when `isLoggedIn` becomes false. That parent-driven route-set/unmount transition is not an ordinary removal action that `usePreventRemove` can or should trap. Logout, expiration, revocation, password-driven session end, and account replacement therefore remain authoritative.

On unmount, CookMode must continue to mark itself unmounted, invalidate timer and prompt generations, null the active prompt, clear interval ownership, and make captured Stay/Discard callbacks inert. No timer is persisted or restored across sessions. No auth/navigation file change is required.

## 14. Proposed production allowlist

Exactly one production file:

1. `apps/mobile/src/screens/CookModeScreen.js`

`apps/mobile/src/navigation/RootNavigator.js`, package manifests, lockfiles, timer math, API/context files, auth files, and native configuration are excluded. Any evidence during implementation that requires another production path is a contract amendment and must stop for review.

## 15. Proposed test allowlist

Exactly two test files:

1. `apps/mobile/__tests__/cookModeInteraction.test.js`
2. `apps/mobile/__tests__/cookModeStaticAudit.test.js`

No navigation static test is required because `RootNavigator.js` does not change.

Test migration and exact required behavior:

- Replace the static assertion for `navigation.addListener('beforeRemove', ...)` with the installed supported import/use contract; assert the raw listener and `allowedRemovalActionRef` are absent.
- Replace the interaction harness's direct `listeners.beforeRemove(...)` calls with a controlled `usePreventRemove` seam or a mounted navigator path. The seam may expose the current enabled boolean and callback, but assertions must remain user-visible/navigation behavior rather than raw-listener registration details.
- Prove `RUNNING` and positive `PAUSED` enable prevention; `IDLE` and `COMPLETED` do not.
- Prove one prompt across repeated/distinct Back attempts and first-action ownership.
- Prove Stay preserves timer state and a later removal gets one fresh prompt.
- Prove Discard clears the timer and continues captured `data.action` exactly once without a second prompt; double Discard is inert.
- Prove old Stay/Discard callbacks are inert after a newer prompt, Reset, and unmount/session replacement.
- Prove visible/programmatic Back uses the same removal contract.
- Preserve Finish tests: one POST, running/paused success navigation prompts, Stay/Discard never repeat the POST, completed/idle success navigation does not prompt.
- Prove parent/session replacement unmount cleanup is not blocked and late prompt/timer callbacks are inert.
- Remove the two exact-action bypass-cleanup tests (non-reentrant dispatch and throwing dispatch) as implementation-specific. Replace them with supported continuation success/one-shot behavior; do not weaken repeated-removal, stale-callback, Finish, or cleanup coverage.

## 16. Physical runtime verification gates

Automated proof is insufficient. Before hotfix runtime acceptance, record the reproducing platform/device/OS/build and execute at least the applicable platform set below with a development log open:

1. Running timer -> visible/native Back -> Stay: CookMode and countdown remain correct.
2. Running timer -> visible/native Back -> Discard: exactly one prompt, one removal, no native/JS mismatch.
3. Repeated Back attempts while the first prompt is open: no duplicate prompt or navigation.
4. Paused timer exit: Stay and Discard both behave correctly.
5. Completed timer exit: no prompt.
6. Idle/reset timer exit: no prompt.
7. Finish with running timer: one Cook History POST, then prompt; Stay/Discard never repeat the POST.
8. Finish with paused timer: one Cook History POST, then prompt; Stay/Discard never repeat the POST.
9. Logout/session expiration/root replacement with an active timer: auth transition wins, no trap, no stale callback effect.
10. No warning/error matching native/JS state divergence; no duplicate prompt; no duplicate Cook History POST.

If iOS reproduced the defect, include the custom visible Back control, native edge swipe/cancel/confirm behavior, and repeated swipe/Back attempts. There is no CookMode native header back-menu flow to test in the current configuration. If Android reproduced it, include hardware Back and repeated hardware Back. Until the reproducing platform is identified and its set passes, runtime acceptance remains reopened.

## 17. Documentation strategy

Choose **B**: keep this separate `MOBILE-COOK2-HOTFIX1-native-stack-exit-guard-audit.md` record. The original milestone's closure history remains historical evidence and must not be rewritten as if the runtime defect never occurred.

After implementation, independent review, merge, and reproducing physical verification, append a closure section to this HOTFIX1 document. The original COOK2 milestone may receive only a short cross-reference/status correction if explicitly authorized; do not erase or silently replace its prior closure record.

## 18. Blockers

- **Audit/contract freeze:** none.
- **Implementation dependency:** none; `usePreventRemove` is already installed and exported.
- **Runtime acceptance:** blocked until the reproducing platform is identified and the applicable physical regression set passes on the hotfix build.
- **Deployment:** blocked; not authorized and must not occur from this audit.

## 19. Status

| Item | Status |
| --- | --- |
| PR #105 | **MERGED** |
| COOK2 source integration | **COMPLETE** |
| COOK2 runtime acceptance | **REOPENED - HOTFIX REQUIRED** |
| HOTFIX1 implementation | **NOT PERFORMED** |
| HOTFIX1 automated verification | **NOT RUN - AUDIT ONLY** |
| Reproducing physical verification | **NOT RUN - REQUIRED GATE** |
| Production deployment | **NOT PERFORMED** |

MOBILE-COOK2 must not be described as fully runtime-complete until the hotfix is merged and the reproducing physical flow passes.

## 20. Verdict

**MOBILE-COOK2-HOTFIX1 AUDIT COMPLETE - READY FOR CONTRACT FREEZE**
