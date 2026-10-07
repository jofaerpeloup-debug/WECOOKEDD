# MOBILE-COOK2 — Cook Mode Audit

**Audit date:** 2026-10-07
**Baseline:** \`origin/main\` at \`b0cbe3c77f08204dc72345855d5fc2e3ac9b4088\` (verified after \`git fetch origin\`)
**Teammate UX reference:** pinned commit \`4ffd47d176afcfb1f23ffa1be079f01791fae92e\`
**Protected stash:** \`stash@{0}: On feat/cook-mode-timer-ui: WIP cook mode timer UI\` (identity matched; read-only inspection only)

## Authority and audit boundary

This is a read-only product/architecture audit. WeCooked owns authentication, recipe visibility, canonical recipe content, validation, persistence, and cooking-history events. The teammate repository is UX reference only; its fixture state, AsyncStorage progress, local cooked state, notification calls, and timer fields are not authority. No production code, tests, package manifest, database, stash, commit, or remote branch was changed.

## Current recipe-step authority

The canonical persisted representation is \`Recipe.instructions: string[]\` in \`apps/api/src/modules/recipes/recipe.model.js\`. Array position is the only identity/order mechanism. \`steps\` is not persisted: \`recipe.serializer.js\` derives \`[{ order: index + 1, text }]\` from instructions. Service/validation accept either strings or structured input, but normalize structured input back to instructions; when both are supplied, their ordered text must match exactly.

| Question | Current authoritative answer |
| --- | --- |
| Structured objects or strings? | Persisted plain strings; derived API objects only. |
| Stable IDs? | No. Identity is positional only. |
| Order/index? | Yes: array order and derived contiguous 1-based \`order\`. |
| Titles/body? | No title; text is the body. |
| Duration/timer/temperature? | No per-step fields. Recipe-level prep/cook minutes are not a per-step timer contract. |
| Per-step media? | No. Recipe-level \`imageUrl\` only. |
| Omit/malformed steps? | Drafts may omit them. Publish requires at least one valid step. New writes require 1–50 trimmed 3–1,000-character strings with a Unicode letter; structured input requires unique contiguous orders. Legacy malformed published records fail the consumer eligibility gate. |

Path: model → Zod validation → service normalization and visibility/publish gate → public serializer (\`instructions\` plus derived \`steps\`) → mobile \`recipeService\` → \`RecipeDetailScreen\` → \`cookModeSteps\` → \`CookModeScreen\`. Moderator authoring writes this same contract and has no per-step title, duration, timer, temperature, or media control.

## Current merged cooking experience

Main already contains a server-backed guided Cook Mode.

- Recipe Detail gets authoritative detail, maintains selected servings, and pushes root-stack \`CookMode\` with real recipe, display ingredient lines, servings, and \`recipeSource: 'api'\`.
- Cook Mode has a screen-session prep checklist with existing structured ingredient scaling, then one ordered step at a time, numbered progress, Back/Next, and Finish. First-step Back returns to prep; header Back exits normally.
- The adapter uses valid derived steps, then valid legacy instruction strings; it invents no IDs, titles, or durations. Empty steps disable Start.
- It shows only the recipe image, has no fullscreen/keep-awake/timer/resume session, and honestly labels the timer unavailable.
- Explicit Finish posts one Cook History event only for a real API recipe. A synchronous ref prevents rapid duplicate POSTs; failure stays in place for retry; opening, step changes, timer UI, or exit never writes history.
- \`CookMode\` is a root-stack screen, not a tab or deep link. \`goBack()\` returns to Recipe Detail, whose focus refresh reads server-confirmed cooked state.

## Pinned teammate Cook Mode inventory

The reference has prep/check-all, spice selection, servings-scaled ingredients, numbered dots, one step with fixture title/instruction, photo, immersive timer ring, Pause/Resume, Back/Next/Finish, keep-awake, haptic/chime feedback, and close. It uses fixture \`seconds\` fields, locally scales times, decrements an interval, persists prep/progress/spice in local storage, locally marks cooked, and creates a client notification.

Those behavior shapes may inform UI but not architecture. Its resumed progress resets timer time from step duration rather than preserving an absolute deadline, so it does not demonstrate restart-safe timer correctness. Evident labels/selected state do not prove complete progress announcements, timer semantics, dynamic type, or destructive-exit accessibility.

## Protected stash findings

The stash touches \`CookModeScreen.js\`, \`cookModeStaticAudit.test.js\`, and unrelated \`TopBar.js\` / \`topBarStaticAudit.test.js\`. It was never applied or restored.

| Finding | Classification | Disposition |
| --- | --- | --- |
| Absolute-end-time state concepts, AppState refresh, pause/resume/reset, mounted and Finish guards, exit confirmation, accessibility completion announcement | Reusable concept only | Adapt after a frozen manual-timer contract. |
| Regex \`parseInstructionDuration(step.text)\` automatic timer | Unsafe | Discard; no deterministic extraction contract exists. |
| Auto timer from parsed instructions | Unsafe | Discard. |
| Single transient visible-step timer | Still-compatible concept only | Adapt without treating positional step as canonical metadata. |
| Current path/navigation/history assumptions | Partly stale | Reimplement against current main only. |
| TopBar changes | Outside COOK2 | Discard. |

The stash assumes a single nonpersistent timer and vibration-only completion; it adds no backend/session authority. Do not restore it wholesale.

## Step-by-step feasibility

Step-by-step cooking is already safely supported with current data:

| Capability | Source/result |
| --- | --- |
| Current step | Derived \`steps[n]\`, legacy instruction fallback |
| Previous/next | Bounded local positional index |
| Step number/progress | Derived contiguous order/current index |
| Ingredient reference | \`ingredients[]\` plus Recipe Detail serving handoff |
| Finish | Existing server \`POST /cook-history\` only after explicit Finish |
| Exit | Normal \`goBack()\`, no event |

This is positional identity only, not canonical step IDs. Cook Mode operates from already-loaded detail; it requires no per-step request.

## Timer authority, manual timer, and lifecycle

**Timer classification: C — only natural-language instructions may mention times.** There is no authoritative structured per-step duration/timer metadata. Global prep/cook minutes cannot be mapped to a step without a separate frozen decision. COOK2 must not regex-parse, AI-extract, default, or otherwise infer auto timers.

A **manual user timer** is coherent only as an explicitly labelled screen-session utility: the user supplies a duration; it is not recipe metadata, does not modify instructions, and does not establish canonical state. A one-timer implementation needs no schema/API/package change if duration entry, one-timer policy, reset, and exit behavior are frozen.

Correct timing uses an absolute target/end timestamp while running, not decrementing state. Display may refresh on an interval, but remaining time must derive from \`Date.now()\` on foreground/resume. Pause captures remaining duration; resume creates a new target; reset clears local state. This handles delayed renders, sleep, backgrounding, and temporary unmount correctly.

There is no approved background delivery/native notification infrastructure. Background completion alerts, multiple timers, restart persistence, keep-awake, and push/local notification are future work. NOTIF2 remains excluded and independently blocked on Android FCM configuration.

## Persistence, history, servings, navigation, and races

### Persistence/resume

No canonical cooking-session model exists. Current checklist, step index, and serving handoff exist only in the mounted screen; Cook Mode deliberately has no AsyncStorage. Local resume needs an ownership/retention/account-switch decision; server resume needs API/schema. Neither may be introduced implicitly.

### Cooking history

Current Finish is the single correct history path. The API accepts only recipe ID and optional integer servings; authenticated user and completion time are server-derived, and usability is rechecked. Repeat intentional Finishes are separate permitted events. Do not create events for exit, step/timer/prep completion. Mobile duplicate protection is a ref guard; server idempotency keys are not currently defined because repeat cooking is valid.

### Servings and ingredients

Cook Mode must receive Recipe Detail’s selected serving count and use existing quantity scaling. It must not create a second servings calculation or independent serving state. The passed count is the completion event’s servings value. Freeze it for the screen session unless a future contract defines in-flow changes.

### Navigation and races

Source is authenticated Recipe Detail; destination is root-stack CookMode; exit/finish is \`goBack()\`; there is no deep link. Recipe Detail owns freshness; Cook Mode must not refetch per step. Pure navigation stays synchronous. Future Finish work retains ref guard, disabled state, mounted ownership, and honest retry. A future timer cleans intervals/AppState listeners, remains route/account-owned, and is inert after unmount/account switch. Persisted sessions need explicit recipe/session identity and generation ownership before rehydration.

## Accessibility and native/package implications

Current behavior has scrollable readable steps, checkbox semantics, and labelled back/timer controls. It does not announce progress changes; Back is labelled only “Back”; timer is unavailable. A manual timer must add accessible duration entry and Start/Pause/Resume/Reset, non-noisy status updates, completion announcement, logical focus order, dynamic-type/touch-target validation, and active-timer exit confirmation. Keep this functional, not UI-FINAL1 redesign.

\`apps/mobile/package.json\` has no \`expo-keep-awake\`. Do not add it under this audit. It is a separate package/native product decision and requires Android/iOS runtime verification.

## Dependencies and exclusions

- Recipe authoring/step schema: required for authoritative auto timers, titles, temperatures, or media; each needs a separate schema/authoring/serializer/backfill milestone.
- RECIPE4 nutrition, MEAL, AI2 extraction, UI-FINAL1 redesign, and SEC2 auth changes remain out of scope.
- NOTIF2/NOTIF3: no push/background timer notification behavior.
- PROFILE/Cook History: preserve existing server completion; no local cooked authority or duplicate events.

## Recommended COOK2 contract

The data-supported guided step-by-step slice is already merged at this baseline. If a net-new COOK2 implementation milestone is required, the smallest coherent slice is **one manual, screen-session-only timer** beside it:

1. User explicitly supplies duration; no recipe text or recipe-level cook time provides it.
2. Exactly one local timer using absolute end time; pause, resume, reset, foreground reconciliation, and discard-on-exit confirmation.
3. No restart persistence, server cooking session, auto-start on step advance, background notification, keep-awake package, or history event until existing explicit Finish.
4. Preserve positional steps, existing ingredient/yield authority, current route, and server-owned completion.

Duration-entry design, one-timer policy, and exit copy require approval. Without that product decision, there is no safe net-new COOK2 code; existing guided Cook Mode remains correct.

### Deferred/future features

Authoritative step titles/durations/temperature/media; auto timers; multiple timers; timer history; local/server cooking-session resume; keep-awake; background/local/push completion alerts; notification integration; and fixture-derived spice/serving-time heuristics.

## Proposed allowlists

Proposed only for the approved manual-timer contract; no implementation is authorized by this audit.

**Production paths**

- \`apps/mobile/src/screens/CookModeScreen.js\`
- \`apps/mobile/src/utils/cookTimer.js\` (new pure absolute-clock helper)

**Test paths**

- \`apps/mobile/__tests__/cookModeStaticAudit.test.js\`
- \`apps/mobile/__tests__/cookModeData.test.js\`
- \`apps/mobile/__tests__/cookTimer.test.js\` (new deterministic unit tests)
- \`apps/mobile/__tests__/cookModeInteraction.test.js\` (new mounted interaction proof if supported)

No API/model/validation/serializer/Admin/navigation/package/lockfile/app-config/storage/notification/migration path is in scope. Auto timers, resume, or keep-awake require a new contract.

## Focused proof and runtime gates

For approved manual timer: prove explicit duration validation, initial state, absolute-clock reconciliation after delays/background, pause/resume, reset, single-timer policy, step changes while active, exit discard, unmount cleanup, no parser/AI inference, no recipe mutation, no history before Finish, and existing zero/one/many/previous/next/Finish boundaries. Use mounted interaction/request observation for Finish duplicate/error handling.

Not run and not claimed passing: Android/iOS foreground/background/sleep and drift; interruptions/hardware Back; dynamic type/screen reader/focus/touch targets; orientation; slow/offline Finish retry; account switch during timer/Finish; and any future keep-awake/notification behavior.

## Blockers

1. Auto step timers: no authoritative per-step duration/timer data; free-text parsing is prohibited.
2. Resume: no approved cooking-session ownership/persistence contract.
3. Keep-awake/background alerts: no approved native dependency and independent NOTIF2/FCM state.
4. Manual timer: technically supported, awaiting frozen duration-entry, one-timer, and exit-copy decisions.

**Verdict:** **MOBILE-COOK2 AUDIT PARTIALLY READY — BLOCKED FEATURES EXCLUDED**
