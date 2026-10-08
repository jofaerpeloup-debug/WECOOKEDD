# MOBILE-COOK2-HOTFIX1 - Native-stack exit guard

**Contract freeze date:** 2026-10-08

**Contract worktree:** `C:\Users\Clein\OneDrive\Documents\Projects\wecooked-mobile-cook2-hotfix1-audit`

**Baseline:** freshly fetched `origin/main`, `FETCH_HEAD`, and detached `HEAD` at `8fbe1ecc551cdce46aaaa96eb9db3cddf12dd30c`

**History:** PR #105 is merged. COOK2 source integration is complete. A post-merge native-stack runtime defect was found, so COOK2 runtime acceptance is reopened and HOTFIX1 is required.

**Contract boundary:** Documentation-only freeze. No production code, tests, package or lockfile, Git index/history, protected stash, backend, database, deployment, or migration mutation was performed.

## 1. Baseline

`origin/main` was re-fetched on 2026-10-08. The remote-tracking ref, `FETCH_HEAD`, and this detached worktree's `HEAD` all resolve to `8fbe1ecc551cdce46aaaa96eb9db3cddf12dd30c`, the PR #105 merge commit. Main has not moved from the required audit baseline, so no merge, rebase, or cherry-pick is required or authorized.

## 2. Root cause

CookMode is hosted by `createNativeStackNavigator`, but its active-timer exit guard currently uses a raw `navigation.addListener('beforeRemove', ...)` listener. That listener can prevent the JavaScript route removal after native-stack has already dismissed the native screen, causing the native and JavaScript navigation states to diverge.

The defect is the unsupported raw-listener integration with native-stack. It is not a timer-state, Cook History, action-identity, dependency-version, native-header, or navigation-architecture defect.

## 3. Supported navigation primitive

Replace the raw `beforeRemove` listener with the installed hook from `@react-navigation/native`:

```js
usePreventRemove(hasActiveTimer, ({ data }) => {
  // Preserve prompt ownership and, after confirmed discard,
  // continue the first blocked action exactly once.
  navigation.dispatch(data.action);
});
```

The installed versions already support this contract:

- `@react-navigation/native@7.3.17`
- `@react-navigation/native-stack@7.18.9`
- `@react-navigation/core@7.21.13`
- `react-native-screens@4.26.2`

No dependency change is required. CookMode keeps `animation: 'slide_from_bottom'` and inherits `headerShown: false`. It has no native header, so no explicit `headerBackButtonMenuEnabled` change is required. `RootNavigator.js` must not change.

## 4. Active-timer removal contract

An active timer is exactly:

- `RUNNING`; or
- `PAUSED` with `remainingMs > 0`.

While active, `usePreventRemove` prevents an action that would remove CookMode and presents at most one owned discard confirmation. The first blocked action remains owned while that confirmation is active.

`IDLE` and `COMPLETED` are not active. Their removal proceeds normally without a timer-discard prompt.

The hook's enabled value must be derived from current rendered timer state so native-stack receives the current prevention state. Existing synchronous timer ownership remains authoritative inside callbacks and timer handlers.

## 5. Prompt ownership contract

Retain only the ownership machinery still required after migration:

- active prompt ownership;
- a prompt generation token;
- first blocked action ownership;
- a one-shot Discard callback;
- stale callback invalidation;
- Reset invalidation;
- unmount invalidation; and
- mounted ownership checks.

Repeated removal attempts while an Alert is open remain prevented but must not create duplicate prompts or replace the first prompt's blocked action. An action may run only when its captured callback still owns the current prompt generation and the screen remains mounted.

## 6. Stay contract

Stay must:

- verify mounted/current prompt ownership;
- clear only that prompt's ownership;
- perform no navigation;
- preserve all timer state; and
- permit a later independent removal attempt to create one new prompt.

After Stay, the old prompt's Discard callback is stale and inert, including after a newer prompt has been created.

## 7. Discard contract

Discard must, in order:

1. verify mounted/current prompt ownership;
2. invalidate active prompt ownership before navigation continuation;
3. invalidate stale prompt callbacks;
4. clear and inert the local timer state; and
5. dispatch the first blocked `data.action` exactly once.

Repeated invocation of the same captured Discard callback is inert. Discard performs no API call, Cook History call, recipe mutation, persistence, or server operation.

## 8. Old bypass disposition

Remove `allowedRemovalActionRef` completely and remove all related exact-action comparison, bypass assignment, bypass cleanup, and `try`/`finally` reset logic.

That bypass existed to replay an action through the unsupported raw listener. `usePreventRemove` supplies the supported continuation contract through `data.action`; HOTFIX1 must use `navigation.dispatch(data.action)` after confirmed Discard and must not add a second app-owned bypass. Tests that require the obsolete bypass implementation must be migrated to behavioral one-shot continuation proof.

## 9. Reset and unmount contract

Reset must return the timer to `IDLE`, invalidate current prompt ownership, and make captured Stay/Discard callbacks inert.

Unmount must invalidate timer ownership and prompt ownership, make stale callbacks inert, and preserve the existing interval and AppState cleanup. After unmount there is no navigation, accessibility announcement, timer resurrection, or late timer state mutation.

## 10. Exit-case contract

| Exit case | Frozen behavior |
| --- | --- |
| Custom in-screen Back | Active timer prompts; `IDLE`/`COMPLETED` use normal `goBack()`. |
| Android hardware Back | Active timer is protected by `usePreventRemove`; `IDLE`/`COMPLETED` remove normally. Physical verification is required if Android is the reproducing platform. |
| iOS swipe-back/native gesture | Active removal is prevented through supported native-stack integration; `IDLE`/`COMPLETED` remove normally. Physical edge-swipe verification is required if iOS is the reproducing platform. |
| Programmatic `goBack` or another removing action | Active timer prompts and Discard continues the first captured action once; inactive timer exits normally. |
| Finish success with `RUNNING` or positive `PAUSED` | The Finish POST occurs once; success removal may prompt; Stay leaves the screen mounted; Discard continues the captured removal; neither choice repeats the POST. |
| Finish success with `COMPLETED` or `IDLE` | Success navigation proceeds normally with no unnecessary timer prompt. |
| Auth/session navigator replacement | Session authority wins; conditional parent replacement is not trapped, and unmount makes local timer/prompt ownership inert. |

## 11. Finish and Cook History isolation

Explicit Finish remains the only Cook History mutation. HOTFIX1 must not change the Finish payload, endpoint, server-owned account identity, duplicate-Finish guard, disabled state, request ordering, retry/error behavior, recipe identity, servings ownership, or Cook History semantics.

Timer expiry, Reset, Stay, Discard, and navigation continuation never invoke Finish or `recordCompletion`. Timer discard is navigation-only and local-state-only behavior.

## 12. Auth and session contract

The conditional authenticated navigator remains authoritative. Logout, token/session invalidation, expiration, revocation, password-driven session end, and account replacement must not be trapped by the local timer guard.

Parent-driven replacement unmounts CookMode. Unmount clears local timer/prompt ownership; no timer is persisted, restored, transferred to the guest stack, or resurrected for a later account. No auth or navigation file change is required.

## 13. Exact production allowlist

Exactly one production path is authorized:

1. `apps/mobile/src/screens/CookModeScreen.js`

No other production path is authorized. In particular, `apps/mobile/src/navigation/RootNavigator.js`, package files, lockfiles, backend/API/schema files, storage, timer utilities, auth files, and native configuration must not change. If implementation finds another production path truly required, stop and report **CONTRACT AMENDMENT REQUIRED**.

## 14. Exact test allowlist

Exactly two test paths are authorized:

1. `apps/mobile/__tests__/cookModeInteraction.test.js`
2. `apps/mobile/__tests__/cookModeStaticAudit.test.js`

No other test path is authorized unless a contract amendment is approved.

Interaction proof must be behavioral rather than tied to obsolete raw-listener or bypass internals. It must cover:

1. active-state `usePreventRemove` protection;
2. one active prompt only;
3. first blocked action ownership;
4. Stay preserving timer state and allowing a later fresh prompt;
5. old Discard becoming inert after Stay and a new prompt;
6. Discard dispatching the owned action once and repeated callback invocation being inert;
7. Reset invalidating stale callbacks;
8. unmount invalidating stale callbacks;
9. `RUNNING` Finish performing one POST and prompting on success removal without a duplicate POST;
10. `PAUSED` Finish preserving the same invariant;
11. `COMPLETED` Finish navigating without an unnecessary discard prompt;
12. `IDLE` removal exiting normally;
13. `COMPLETED` removal exiting normally;
14. auth/session replacement not being trapped; and
15. timer expiry not invoking Finish.

Tests must not require `navigation.addListener('beforeRemove')`, `allowedRemovalActionRef`, or an exact-action bypass implementation.

## 15. Static-test contract

`cookModeStaticAudit.test.js` should prove only stable architectural facts:

- `usePreventRemove` is imported from `@react-navigation/native` and used;
- CookModeScreen has no raw `beforeRemove` listener;
- `allowedRemovalActionRef` is absent; and
- HOTFIX1 adds no timer persistence, notification, backend, package, or native integration.

Avoid assertions tied to line formatting or internal variable names unless an internal symbol's absence is itself an explicit regression boundary.

## 16. Physical runtime acceptance contract

Automated tests may establish HOTFIX1 source closure but are insufficient for runtime acceptance. Before runtime acceptance, record the actual reproducing platform, device, OS, and build, keep development logs open, and verify on that platform:

1. `RUNNING` -> Back/removal -> Stay: the timer remains active and CookMode remains mounted with no native/JavaScript mismatch.
2. `RUNNING` -> Back/removal -> Discard: CookMode exits once with no duplicate prompt or navigation warning/error.
3. Repeated Back/removal attempts while the prompt is open: exactly one prompt, no stacked prompt, and no native/JavaScript mismatch.
4. `PAUSED` -> Back/removal: Stay and Discard both behave correctly.
5. `COMPLETED` -> exit: normal removal and no unnecessary prompt.
6. `IDLE` -> exit: normal removal.
7. Finish with `RUNNING`: exactly one Cook History POST; success removal prompts; Stay does not repeat the POST; Discard exits without repeating it.
8. Finish with positive `PAUSED`: the same one-POST invariant.
9. Session/auth replacement: the transition is not trapped and timer/prompt ownership disappears on unmount.

If iOS reproduced the defect, additionally verify edge swipe/native gesture behavior. If Android reproduced it, additionally verify hardware Back. The physical record must explicitly confirm absence of this warning/error:

> The screen 'CookMode' was removed natively but didn't get removed from JS state

Until the reproducing platform is identified and this applicable set passes, HOTFIX1 runtime acceptance remains blocked.

## 17. Reproducing-platform status

**UNKNOWN.** The warning text does not identify the platform that reproduced the defect, and the contract must not infer one from platform-specific guidance embedded in the warning.

Source implementation is not blocked by this unknown. Physical runtime acceptance is blocked until the platform is identified and verified.

## 18. Exclusions

HOTFIX1 must not change:

- timer duration, input, display, state-machine, or clock-arithmetic contracts;
- timer UI design, completion behavior, interval behavior, or AppState behavior;
- ingredients, servings, recipe steps, or recipe data;
- Finish/Cook History payload, endpoint, identity, retry, or mutation semantics;
- notification, keep-awake, background-execution, or persistence behavior;
- backend, API, schema, database, migration, or storage behavior;
- navigation architecture, RootNavigator configuration, native configuration, dependencies, or lockfiles; or
- the protected Cook Mode stash.

This is a narrow integration hotfix, not a Cook Mode or timer redesign.

## 19. Documentation strategy

Keep HOTFIX1 history separate in this milestone. Do not rewrite the original COOK2 closure as though the post-merge runtime defect never occurred.

Frozen status:

| Item | Status |
| --- | --- |
| PR #105 | **MERGED** |
| COOK2 source integration | **COMPLETE** |
| Post-merge runtime defect | **FOUND** |
| COOK2 runtime acceptance | **REOPENED - HOTFIX REQUIRED** |
| HOTFIX1 | **REQUIRED - NOT IMPLEMENTED IN THIS PHASE** |
| Production deployment | **NOT PERFORMED** |

After authorized implementation, independent review, merge, and reproducing-platform physical verification, record HOTFIX1 closure in this separate history. Any correction or cross-reference in the original COOK2 milestone requires separate authorization.

## 20. Remaining blockers

- **Contract freeze:** none.
- **Source implementation:** no dependency blocker; `usePreventRemove` is already installed and exported.
- **Source closure:** pending authorized implementation, focused automated verification, and independent review.
- **Runtime acceptance:** blocked until the reproducing platform is identified and the applicable physical verification passes without the native/JavaScript divergence warning.
- **Deployment:** not authorized and not performed.

## 21. Verdict

**MOBILE-COOK2-HOTFIX1 CONTRACT FROZEN - READY FOR IMPLEMENTATION**

## 22. Closure evidence

This section appends the HOTFIX1 closure record; sections 1--21 remain the
historical audit and contract record.

### Delivered hotfix history

- PR #105 had already merged the original COOK2 implementation.
- A post-merge native-stack defect was then found, reopening runtime
  acceptance for the focused hotfix.
- HOTFIX1 replaced the raw `beforeRemove` approach with the supported
  `usePreventRemove` contract.
- The initial independent review identified F1/F2 test-proof issues.
- The follow-up fixes added real React Navigation continuation coverage and
  semantic AST checks.

### Final evidence

| Evidence | Result |
| --- | --- |
| Final independent source re-review | **PASS** |
| Focused HOTFIX1 automated verification | **2 suites, 46/46 PASS** |
| Full COOK2 automated verification | **4 suites, 93/93 PASS** |
| Tested real-device/runtime flow | **PASS** |

Physical verification passed for: RUNNING Back -> Stay; RUNNING Back ->
Discard; repeated Back; PAUSED exit; COMPLETED exit; IDLE exit; RUNNING Finish;
PAUSED Finish; session replacement; and applicable native Back/gesture behavior.
The original native/JavaScript mismatch warning was **not reproduced**.

The React Native DevTools `fb-dotslash/dotslash.exe ENOENT` message was
observed as a **NON-BLOCKING LOCAL TOOLING WARNING**. Metro continued, the app
ran, and HOTFIX1 runtime behavior remained testable; it is not a product
failure.

### Closure scope and disposition

This closure update changes only this milestone document. Production and test
paths were not modified during closure; nothing was staged, committed, pushed,
or deployed, and the protected stash was not touched.

There are no remaining HOTFIX1 source, automated-evidence, or tested-runtime
blockers for finalization. Production deployment remains outside this closure
and was not performed.

## 23. Closure verdict

**MOBILE-COOK2-HOTFIX1 CLOSURE PASS — READY FOR FINALIZATION**
