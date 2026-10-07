# MOBILE-COOK2 - Manual Cook Timer Contract

**Contract date:** 2026-10-07
**Audit baseline:** `origin/main` at `b0cbe3c77f08204dc72345855d5fc2e3ac9b4088`
**Source audit:** `docs/milestones/MOBILE-COOK2-cook-mode-audit.md`
**Status:** Frozen; ready for implementation

## 1. Baseline

`origin/main` was re-fetched on 2026-10-07 and still resolves to `b0cbe3c77f08204dc72345855d5fc2e3ac9b4088`. The COOK2 audit worktree is detached at the same commit. Main did not move, and no integration was performed.

The protected `stash@{0}: On feat/cook-mode-timer-ui: WIP cook mode timer UI` was inspected read-only. It was not applied, popped, dropped, branched, restored, or checked out. Its absolute-clock, AppState, cleanup, exit-guard, and accessibility concepts are evidence only. Its instruction-duration parsing, automatic timer, vibration, TopBar changes, and stale implementation details are not part of this contract.

## 2. Frozen milestone path

`docs/milestones/MOBILE-COOK2-cook-mode.md`

The audit document remains unchanged.

## 3. Exact COOK2 net-new slice

COOK2 adds **one manual Cook Timer V1** to the existing guided Cook Mode:

- exactly one timer for the whole mounted Cook Mode screen session;
- explicitly configured and started by the user;
- transient local UI state owned by `CookModeScreen`;
- independent of the displayed recipe step and recipe instruction text;
- visible and controllable while the user moves between recipe steps;
- discarded on reset or confirmed exit; and
- never canonical recipe, cooking-session, account, or Cook History data.

The already-merged prep checklist, serving handoff, ingredient scaling, ordered step navigation, progress, explicit Finish, server Cook History mutation, duplicate-Finish guard, and retry behavior are preserved. COOK2 does not rebuild them.

## 4. Duration-entry contract

The timer starts only after an explicit user action submits a valid manual duration. Recipe instructions, recipe-level prep/cook time, the current step, and historical timer values provide no default.

The duration-entry surface is owned inside `CookModeScreen`; repository evidence does not require a separate component. It presents three explicit, manual numeric fields in `HH : MM : SS` order: **Hours**, **Minutes**, and **Seconds**. No picker or native dependency is required. It must follow current React Native input/dialog conventions: labelled inputs, visible validation text, keyboard-appropriate input hints, reachable Cancel and Start actions, and a screen-reader-contained modal/sheet if a modal presentation is selected.

Validation is strict and occurs before state changes:

- each non-empty field accepts only ASCII decimal digits (`0` through `9`), with no whitespace, decimal point, decimal comma, sign, exponent/scientific notation, alphabetic character, or other pasted content; fractions are not allowed;
- fields may be empty while editing; at Start, empty Hours, Minutes, and Seconds each mean zero;
- Hours is one digit and in `0` through `3`; Minutes and Seconds are each at most two digits and in `0` through `59`;
- if Hours is `3`, both Minutes and Seconds must be `0`; no silent clamping or modulo conversion is permitted;
- all-empty or all-zero input is rejected; the minimum valid duration is `00:00:01`, and the maximum valid duration is `03:00:00`;
- whitespace or platform keyboard behavior must not cause permissive partial parsing (`parseInt`-style acceptance is forbidden);
- conversion produces one exact integer `durationMs` for timer logic; it must be a safe integer in the inclusive range `1000` through `10800000`;
- unit conversion and `currentTimeMs + durationMs` must remain finite, non-negative safe integers and within the JavaScript `Date` representable range;
- failed validation leaves the timer `IDLE` and does not retain a partially configured timer; and
- input length/state is bounded by the field limits above, rather than accepting an unbounded string.

For example, `00:60:00`, `00:00:60`, `03:00:01`, `03:01:00`, and `04:00:00` are invalid; they must not normalize to another duration. `02:59:59` and `03:00:00` are valid.

The three-hour cap is deliberately conservative: COOK2 V1 is screen-session-only, non-persistent, has no keep-awake capability, no background notification, and no background-execution guarantee. The product must not imply reliable long-running alarm behavior that this architecture cannot provide.

## 5. Timer state machine

The only states are uppercase contract states `IDLE`, `RUNNING`, `PAUSED`, and `COMPLETED`.

| From | Event | To | Required result |
| --- | --- | --- | --- |
| `IDLE` | valid configure/start | `RUNNING` | Store configured `durationMs`; set `endAtMs = currentTimeMs + durationMs`. |
| `IDLE` | invalid configure/start | `IDLE` | Show validation; do not create an end target. |
| `RUNNING` | display tick/reconcile with time remaining | `RUNNING` | Derive remaining time from `endAtMs`; do not decrement authoritative state. |
| `RUNNING` | pause | `PAUSED` | Capture clamped authoritative `remainingMs`; clear/ignore `endAtMs`. |
| `PAUSED` | resume with time remaining | `RUNNING` | Set a new `endAtMs = currentTimeMs + remainingMs`. |
| `RUNNING` | reconcile at or after expiry | `COMPLETED` | Set displayed/authoritative remaining to zero; clear/ignore `endAtMs`. |
| `RUNNING` | reset | `IDLE` | Clear the timer completely. |
| `PAUSED` | reset | `IDLE` | Clear the timer completely. |
| `COMPLETED` | reset/clear | `IDLE` | Clear the timer completely. |

No second timer can be configured while non-idle. Reconfiguration requires Reset/Clear first. Step Back/Next changes no timer state.

## 6. Reset semantics

Reset is option **B: clear the timer completely to `IDLE`**.

It clears configured duration, remaining duration, end target, completion indication, and per-run announcement ownership. It does not return to a ready/paused copy of the original duration. This avoids inventing a fifth `READY` state and makes reconfiguration an explicit user action.

## 7. Absolute-clock contract

While `RUNNING`, the sole time authority is the absolute target `endAtMs`. Authoritative remaining time is:

```text
remainingMs = max(0, endAtMs - currentTimeMs)
```

An interval may request display refreshes, but it must never subtract a fixed amount from stored remaining state. Delayed callbacks, event-loop stalls, device sleep, and time spent in the background therefore cannot accumulate interval drift. Every render refresh or lifecycle reconciliation uses the current clock and the same target.

Visible seconds are derived from clamped milliseconds by `visibleSeconds = ceil(remainingMs / 1000)` when `remainingMs > 0`, otherwise `0`. A positive remainder must not be displayed as already complete; completion remains based only on `remainingMs <= 0`, not rendered text. Negative display/state is forbidden. There are no fractional visible seconds.

If `visibleSeconds` is under one hour, display `MM:SS`, with both fields zero-padded; otherwise display `H:MM:SS`, with Minutes and Seconds zero-padded. Thus 5 seconds is `00:05`, 5 minutes 7 seconds is `05:07`, 59 minutes 59 seconds is `59:59`, 1 hour is `1:00:00`, 1 hour 2 minutes 3 seconds is `1:02:03`, and 3 hours is `3:00:00`.

`apps/mobile/src/utils/cookTimer.js` is justified as a pure deterministic boundary for strict duration normalization after the product decisions, safe conversion, remaining-time arithmetic, display derivation, and state transitions. It owns no React state, navigation, interval, listener, API, storage, or persistence behavior.

## 8. Pause/resume contract

Pause samples the current clock exactly once, computes `max(0, endAtMs - currentTimeMs)`, and either:

- enters `PAUSED` with that positive `remainingMs` and no active end target; or
- enters `COMPLETED` with zero if expiry has already occurred.

Paused time never elapses. Resume is valid only from `PAUSED` with positive remaining time and creates a fresh `endAtMs` from the resume-time clock plus preserved `remainingMs`. The old end target is never reused.

## 9. Completion contract

At expiry the state becomes `COMPLETED`, remaining time is exactly zero, and the in-screen timer surface shows a persistent completed indication until Reset/Clear or exit. Completion is announced once per timer run with React Native `AccessibilityInfo.announceForAccessibility` (for example, "Timer complete"). Re-renders and repeated foreground events must not announce it again.

Completion does not:

- advance or change the recipe step;
- invoke Finish;
- create or alter Cook History;
- navigate;
- start another timer;
- vibrate, schedule a notification, or run background work; or
- mutate recipe, servings, or ingredient state.

## 10. Background/foreground contract

`CookModeScreen` subscribes to React Native `AppState` using the repository's existing subscription shape (`AppState.addEventListener('change', ...)` and `subscription.remove()` cleanup). No new lifecycle utility or production file is required.

While inactive/backgrounded, background execution and timer delivery are not promised. The display refresh interval may stop. On transition to `active`, the screen immediately reconciles from `endAtMs` and the current clock before relying on another interval tick. If the target passed in the background, reconciliation enters `COMPLETED` and performs the one in-screen accessibility announcement. No local, push, or background notification is sent.

## 11. Exit/unmount contract

`RUNNING`, and `PAUSED` with positive remaining time, are active timer states. Any ordinary attempt to remove Cook Mode in either state must be intercepted before timer loss, including the visible header Back control, Android hardware Back, gestures/native stack removal, and navigation caused after a successful explicit Finish.

The confirmation is accessible and states that leaving discards the active timer. It offers a non-destructive **Stay** action and an explicit destructive **Discard timer and leave** action. Stay preserves all state. Confirmed discard clears/inerts the timer and then performs the original navigation action exactly once.

`IDLE` and `COMPLETED` may exit normally without confirmation: a completed timer has no remaining countdown to lose, and its completed indication has already been delivered. Reset/Clear followed by exit also requires no confirmation.

Unmount cleanup clears display intervals, removes the AppState listener, invalidates completion/confirmation callbacks, and prevents late timer state mutation. No timer owner remains after unmount.

An auth expiration/logout changes the authenticated navigator screen set and unmounts Cook Mode. Session authority wins: the timer becomes inert immediately and cannot block the auth transition, survive into the guest stack, or reappear for a later account. The timer performs no server operation and adds no account-keyed persistence.

## 12. Finish/Cook History isolation

Existing explicit Finish behavior remains the only Cook History completion path. Timer code must not invoke, wrap, synthesize, or change `recordCompletion`; change recipe ID/servings ownership; change the synchronous duplicate-tap ref; change disabled state; change request ordering; or change honest failure/retry behavior.

Timer state and Finish mutation state are independent. Expiry never triggers Finish. Finish never completes, resets, pauses, or persists the timer. If successful Finish navigation would leave an active timer, the exit rule in section 11 applies to that navigation action without repeating the Finish request.

## 13. Servings/ingredient preservation

Recipe Detail continues to pass `{ recipeSource: 'api', recipe, ingredients: ingredientLines, servings }` to the root-stack CookMode route. Cook Mode continues to use its existing serving fallback and `cookModeIngredientChecklist` scaling path. Timer work adds no serving selector, alternative calculation, unit conversion, recipe mutation, or ingredient mutation.

## 14. Accessibility contract

- The timer entry/open control has a specific discoverable label, not only an icon.
- Duration fields have explicit labels, validation/error association, appropriate input hints, and understandable unit text once the input shape is approved.
- Start, Pause, Resume, Reset/Clear, Cancel, Stay, and Discard/Leave controls use button semantics and expose disabled state.
- Remaining time has an understandable accessibility label containing timer state and remaining duration; decorative rings/icons are hidden from the accessibility tree.
- Completion uses one accessible announcement per run and retains visible completed text.
- The discard confirmation is screen-reader reachable, correctly ordered, and cannot be dismissed in a way that silently discards an active timer.
- Normal countdown refreshes do not announce every tick.

Dynamic type, focus behavior, touch targets, screen-reader output, and platform dialog behavior remain real-device gates, not claims made by this document. This milestone does not broaden into UI-FINAL1.

## 15. Native/package implications

| Item | COOK2 contract |
| --- | --- |
| New native package | None |
| `package.json` change | None |
| Lockfile change | None |
| Keep-awake | Deferred |
| Background task | None |
| Local/push notification | Deferred; NOTIF2/NOTIF3 remain separate |
| Vibration/haptic/audio | None required or authorized |

React Native `AppState`, `AccessibilityInfo`, ordinary timer callbacks for display refresh, and React Navigation removal prevention are sufficient existing capabilities.

## 16. Exact production allowlist

Only these production files are sufficient and allowed:

1. `apps/mobile/src/screens/CookModeScreen.js`
2. `apps/mobile/src/utils/cookTimer.js` (new)

`CookModeScreen` owns the timer UI, transient state, interval, AppState subscription, accessibility announcement ownership, navigation-removal confirmation, and cleanup. `cookTimer.js` owns deterministic pure math/validation/transitions only.

If implementation requires any other production path, stop with **CONTRACT AMENDMENT REQUIRED**. Do not create an extra component merely for convenience.

## 17. Exact test allowlist

Only these test files are allowed:

1. `apps/mobile/__tests__/cookModeStaticAudit.test.js`
2. `apps/mobile/__tests__/cookModeData.test.js`
3. `apps/mobile/__tests__/cookTimer.test.js` (new deterministic pure tests)
4. `apps/mobile/__tests__/cookModeInteraction.test.js` (new mounted screen tests)

Use controlled/fake time, never real wall-clock sleeps. Pure tests cover strict duration normalization/conversion after the product decision, overflow rejection, end-target creation, remaining arithmetic, zero clamp, ceiling display, delayed reconciliation, pause, resume with a new target, reset-to-IDLE, and completion.

Mounted tests cover configure/start, malformed/zero rejection, single-timer behavior, pause/resume/reset, delayed callback drift, expiry, background/foreground reconciliation, step independence, no Finish/Cook History call on timer completion, active-exit confirmation for visible and navigation removal paths, completed exit without confirmation, confirmation cancellation/acceptance, and interval/listener/unmount cleanup.

The proof must fail against these relevant mutations:

- authoritative repeated decrement instead of `endAtMs`;
- delayed callback drift;
- paused time consumption;
- resume reusing the old target;
- negative remaining time;
- background freeze from missing absolute-clock reconciliation;
- missing foreground reconciliation;
- completion advancing a recipe step;
- completion invoking Finish/Cook History;
- post-unmount timer mutation;
- active exit without confirmation; and
- malformed/zero input starting a timer.

Existing static/data assertions continue to protect no instruction parsing, no recipe-derived duration, real route data, bounded step navigation, server Finish ownership, duplicate-Finish protection, and existing serving/ingredient behavior.

## 18. Backend/schema implications

| Layer | Change |
| --- | --- |
| Backend | None |
| Endpoint | None |
| Recipe or Cook History schema | None |
| Migration/backfill | None |
| Database index | None |
| Persistence/storage/AsyncStorage | None |
| Server timer/session state | None |

## 19. Exclusions/dependencies

Outside COOK2: structured recipe timer metadata; parsing/NLP/AI/regex duration extraction; defaults derived from step text or recipe-level time; automatic/per-step timers; multiple simultaneous timers; timer scaling with servings; persisted Cook Mode sessions; app-restart or cross-device resume; background execution; local/push notifications; keep-awake; timer-specific navigation/deep links; recipe schema/authoring changes; spice heuristics; broad redesign; UI-FINAL1; NOTIF2/NOTIF3; AI2; RECIPE4; and SEC2.

An authoritative automatic-timer feature depends on a separately frozen recipe-step schema, authoring, validation, serializer, compatibility/backfill, and consumer contract. A resumable timer depends on separately frozen session ownership, account isolation, persistence, and recovery semantics.

## 20. Runtime/device gates

Automated proof does not replace these future physical checks on Android and iOS where applicable:

- configure/start and visible countdown;
- pause/resume and long-delay drift;
- foreground/background reconciliation and expiry while backgrounded;
- device sleep, screen sleep, app interruption, and truthful no-keep-awake behavior;
- visible Back, Android hardware Back, native gesture/removal, Stay, and confirmed discard;
- completed exit without confirmation;
- Finish success/failure/retry while a timer exists, including active-timer exit confirmation after success;
- timer completion never changing the step or creating Cook History;
- account/session expiration or replacement;
- VoiceOver/TalkBack labels, completion announcement, modal focus/order, dynamic type, and touch targets;
- orientation if Cook Mode currently supports it; and
- existing offline Finish retry behavior.

Keep-awake, background execution, and notification delivery are not implemented and must not be claimed.

## 21. Product decisions still required

None. The duration input shape, fractional policy, minimum, maximum, field bounds, input lengths, malformed-input policy, canonical integer-millisecond representation, display format, and deterministic ceiling rounding policy are frozen in sections 4 and 7.

## 22. Blockers

None for the approved COOK2 implementation allowlists. The existing exclusions and physical runtime/device gates remain exclusions or deferred verification, not contract blockers.

## 23. Verdict

**MOBILE-COOK2 CONTRACT FROZEN — READY FOR IMPLEMENTATION**

---

## 24. Closure record

**Closure date:** 2026-10-08
**Closure baseline:** `origin/main` and `HEAD` are both `b0cbe3c77f08204dc72345855d5fc2e3ac9b4088`.
**Closure status:** implementation and final independent re-review complete.

### 1. Final feature delivered

COOK2 delivers one manual, screen-session-only Cook Timer V1 alongside the existing guided Cook Mode. It accepts explicit strict `HH : MM : SS` input, enforces `00:00:01` through `03:00:00`, and has only `IDLE`, `RUNNING`, `PAUSED`, and `COMPLETED` states.

### 2. Exact final scope

Production scope:

1. `apps/mobile/src/screens/CookModeScreen.js`
2. `apps/mobile/src/utils/cookTimer.js`

Test scope:

1. `apps/mobile/__tests__/cookModeStaticAudit.test.js`
2. `apps/mobile/__tests__/cookModeData.test.js`
3. `apps/mobile/__tests__/cookTimer.test.js`
4. `apps/mobile/__tests__/cookModeInteraction.test.js`

Authority documents:

1. `docs/milestones/MOBILE-COOK2-cook-mode-audit.md`
2. `docs/milestones/MOBILE-COOK2-cook-mode.md`

These are the exact eight attributable COOK2 paths. No package, lockfile, backend, schema, API, migration, index, storage, notification, or native path was changed.

### 3. Implementation and timer authority

`CookModeScreen` owns transient UI, interval/lifecycle cleanup, AppState reconciliation, one completion announcement per run, and navigation-removal handling. `cookTimer.js` is the pure validation and clock boundary. While running, `remainingMs = max(0, endAtMs - nowMs)`; positive visible countdown uses `ceil(remainingMs / 1000)`. Pause retains the authoritative millisecond remainder and Resume creates a fresh end target. Reset clears the complete timer back to `IDLE`.

The timer remains independent of recipe step progression, Finish, Cook History, and navigation. Completion neither changes steps nor records completion, and it does not navigate, start another timer, or write server state.

### 4. Navigation/discard ownership

An active running timer, or paused timer with positive remainder, intercepts removal. Prompt generation and active-prompt ownership allow only one live prompt; its exact original action gets a one-shot bypass after confirmed discard. Stay, Reset, unmount, and stale callbacks invalidate obsolete prompt callbacks. `IDLE` and `COMPLETED` exit normally.

### 5. Regression preservation

The existing guided steps, progress, ingredient checklist, servings handoff/scaling, explicit Finish, server-owned Cook History mutation, duplicate-Finish guard, and retry/error behavior remain intact. Server identity remains authoritative.

### 6. Independent-review history and fixes

The initial independent review was **FINDINGS — FIX REQUIRED**. Its material finding was **MEDIUM**: duplicate discard prompts / independently live navigation callbacks; LOW proof gaps were also recorded. The narrow fix added active-prompt ownership, prompt generation ownership, one-shot Discard, exact action-object bypass, Reset/unmount invalidation, stale timer callback ownership, and Finish coexistence proof.

The first independent re-review judged production behavior correct and left LOW test-proof gaps only. The final proof-only pass changed only `apps/mobile/__tests__/cookModeInteraction.test.js`, adding proof for Back A/B/C first-action ownership, stale old Discard after Stay/new prompt, direct Reset invalidation of old Discard, and ignored/non-reentrant or throwing dispatch bypass cleanup. No production defect was exposed.

### 7. Final re-review and automated evidence

**Final independent re-review:** **MOBILE-COOK2 FINAL INDEPENDENT RE-REVIEW PASS — READY FOR CLOSURE**.

Latest recorded focused interaction evidence is **1 suite, 28/28 PASS**. Latest recorded complete frozen COOK2 evidence is **4 suites, 93/93 PASS**. Dependencies were reused from a verified lockfile-identical checkout; no dependency installation occurred during final review.

On this closure checkout, a fresh focused-suite attempt could not execute because `jest` is unavailable on the reused dependency path (`'jest' is not recognized`). This is an environment limitation and non-evidence; it does not replace or upgrade the recorded 93/93 result.

### 8. Runtime/device gates

- Android countdown: **NOT RUN — NOT CLAIMED AS PASS**
- iOS countdown: **NOT RUN — NOT CLAIMED AS PASS**
- Background/foreground physical runtime: **NOT RUN — NOT CLAIMED AS PASS**
- Device sleep/drift: **NOT RUN — NOT CLAIMED AS PASS**
- Hardware Back/discard: **NOT RUN — NOT CLAIMED AS PASS**
- Finish coexistence physical runtime: **NOT RUN — NOT CLAIMED AS PASS**
- Session/account replacement physical runtime: **NOT RUN — NOT CLAIMED AS PASS**
- Physical accessibility: **NOT RUN — NOT CLAIMED AS PASS**
- Rotation: **NOT RUN — NOT CLAIMED AS PASS**
- Keep-awake: **NOT IMPLEMENTED — NOT CLAIMED**
- Background notification: **NOT IMPLEMENTED — NOT CLAIMED**

### 9. Explicit exclusions and future work

COOK2 excludes authoritative per-step duration metadata, automatic step timers, multiple timers, timer persistence, restart/resume, cross-device cooking sessions, keep-awake, background/local notification integration, NOTIF2/NOTIF3 integration, AI duration extraction, and broader Cook Mode redesign. These require future product and architecture decisions.

### 10. Protected stash

`stash@{0}: On feat/cook-mode-timer-ui: WIP cook mode timer UI` remains present at `3460ec2bd7f6602a36c4a58b000e876e3c431fe5` and was left untouched: not applied, popped, dropped, restored, or further inspected during closure.

### 11. Closure verdict

No unresolved source finding remains. The frozen feature is implemented, its eight-path scope is preserved, final independent re-review passed, recorded automated evidence is passing, and physical gates remain explicitly deferred rather than fabricated as passing.

**MOBILE-COOK2 CLOSURE PASS — READY FOR FINALIZATION**
