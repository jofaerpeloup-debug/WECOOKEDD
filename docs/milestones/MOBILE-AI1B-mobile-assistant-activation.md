# MOBILE-AI1B - Mobile Assistant Activation Contract

## GOAL AND BASELINE

Activate the existing authenticated mobile `Assistant` screen against the implemented WeCooked AI1A endpoint without changing the app shell, navigation, authentication, token refresh, persistence architecture, or backend.

This contract is frozen from `main` at `bb47a3faffea01d4b0aaeb22fd73188dbc677c00`, aligned with `origin/main`. The audited teammate source is `teammate/main` at `081a94bd85aafc8d736f0c10d3c9e2655b1a0368`.

AI1B is a mobile integration only. This document preserves the frozen contract and now records the completed implementation and closure evidence.

## AI1A DEPENDENCY

AI1A is present on the baseline and remains authoritative for provider access, server instructions, validation, authentication, rate limiting, timeout handling, privacy, and error normalization. Mobile calls only:

`POST /api/v1/assistant/chat`

The route is mounted under `/api/v1/assistant`, uses the existing `authenticate` middleware, and returns the standard WeCooked envelope. Mobile must not know the provider URL, key, model, request shape, response object, or raw provider errors.

AI1A implementation and automated review evidence are complete. Live-provider verification remains deferred because provider credentials or credits are unavailable; this does not block AI1B implementation or mocked mobile testing.

## TEAMMATE BEHAVIOR REUSED

The teammate implementation is a visual and interaction reference only. AI1B may adapt these behaviors to current WeCooked architecture:

- user and Assistant message bubbles;
- one composer and one send path for typed text and quick prompts;
- cooking-focused quick prompts;
- a visible `Thinking...` state while the request is active;
- automatic scrolling after messages and request-state changes;
- a visible retryable error state;
- a clear/new-conversation control;
- disabled composer, send control, and quick prompts during the active request;
- labelled back, clear, prompt, input, retry, and send controls.

Current WeCooked remains authoritative for the header, back behavior, theme, typography, spacing, safe-area handling, keyboard handling, `PlusMenu` entry, root `Assistant` route, authenticated client, and token refresh.

## TEAMMATE BEHAVIOR REJECTED

Do not port or recreate:

- direct mobile-to-OpenAI `fetch` or any other provider request;
- `AiContext`, `AiSettingsScreen`, BYO-key storage, or device-held provider configuration;
- `EXPO_PUBLIC_OPENAI_API_KEY`, `EXPO_PUBLIC_OPENAI_MODEL`, a model default, or provider branding/configuration in the mobile layer;
- teammate navigation, authentication, profile, storage, or app-shell contexts;
- the local rule-based responder, hardcoded `SWAPS`, fabricated fallback replies, or mock recipe/profile/catalog grounding;
- mock recipe cards, inferred catalog links, or automatic shopping-list actions;
- raw provider errors or provider-specific retry guidance;
- `AsyncStorage` or any other conversation persistence.

## MOBILE API CONTRACT

Create a small `assistantService` that uses the existing authenticated `api.post` client:

```json
{
  "messages": [
    {
      "role": "user",
      "content": "What can I make with lentils?"
    }
  ]
}
```

The service calls `/assistant/chat` with only `{ body: { messages } }`. Authentication and the single transparent refresh/retry remain owned by `client.js`.

On success the client unwraps the standard envelope and the service consumes only:

```json
{
  "reply": "..."
}
```

The service trims `reply` and returns the resulting non-empty string. A missing, non-string, or blank reply is treated as an unavailable/generic Assistant failure; it must not create an empty or fabricated bubble.

The submitted transcript contains only strict `{ role, content }` objects with roles `user` or `assistant`, preserves order, and ends in the accepted user message. Before each send, select the newest contiguous transcript suffix that satisfies the AI1A limits: at most 12 messages, at most 12,000 total trimmed JavaScript string-length units, at most 2,000 per user message, and at most 4,000 per Assistant message. The current user message is always retained. The composer enforces the 2,000-unit user limit and blank input never reaches the service.

## TRANSIENT STATE MODEL

Conversation state exists only while `AssistantScreen` is mounted:

- `messages`: visible successful user/Assistant turns;
- `input`: current composer text;
- `status`: `idle` or `sending`;
- `error`: the current safe user-facing error or `null`;
- `failedRequest`: the exact bounded transcript snapshot for the last failed logical request, or `null`;
- a monotonic conversation/request generation and active-request identity used only for race protection.

There is no fabricated greeting in `messages`; introductory UI text is not sent as transcript. There is no `AsyncStorage`, storage helper, context, provider response ID, provider conversation ID, or other hidden conversation state.

Reset/new conversation clears messages, input, error, failed-request data, and active request identity, and increments the generation. Unmount performs the same invalidation without setting React state.

## SEND CONTRACT

All typed sends, keyboard submits, and quick prompts call the same send operation.

1. Trim the candidate text. Return without mutation if it is blank or another request has already claimed the active-request guard.
2. Claim the guard synchronously before awaiting or scheduling state updates.
3. Append exactly one user message, clear the input, clear any prior error/failed request, and build the bounded transcript snapshot ending in that user message.
4. Set `sending`, scroll to the latest content, and call `assistantService` once with that snapshot.
5. If the result still owns the current mounted generation/request identity, append exactly one normalized Assistant reply and return to `idle`.
6. If the request is no longer current, ignore both its success and its failure.

The composer, keyboard submission, send control, and quick prompts are disabled while sending. The synchronous guard, not disabled rendering alone, provides single-flight behavior.

## ERROR AND RETRY CONTRACT

Failures are rendered as an error state, never as an Assistant message. The already-appended user message remains visible.

- `503 ASSISTANT_NOT_CONFIGURED`: state truthfully that Chef Assistant is not available yet and allow retry.
- `503 ASSISTANT_UNAVAILABLE`, `504 ASSISTANT_TIMEOUT`, network failures, and other server failures: show a safe temporary-failure message and allow retry.
- `429 RATE_LIMIT_EXCEEDED`: state that too many requests were made and ask the user to try later.
- authentication/session failures remain governed by the shared authenticated client and existing session behavior; no token logic is added to Assistant files.
- validation or malformed-success failures receive a safe generic message; raw backend/provider details are not rendered.

Retry claims the same single-flight guard and resends the stored failed transcript snapshot. It does not append another user message, rebuild from changed input, or create a fallback reply. A successful retry appends one Assistant reply and clears the error/failed request. Reset clears retry eligibility.

## STALE-RESPONSE STRATEGY

Use a small screen-owned generation/request identity mechanism rather than a new state-management dependency:

- each accepted send or retry receives an identity tied to the current conversation generation;
- completion may mutate state only when the screen is still mounted and that identity is still the active request;
- reset increments the generation and clears the active identity before clearing visible state;
- unmount marks the screen inactive and invalidates the active identity;
- a new request after reset has a different identity, so an older completion cannot overwrite it.

The underlying network request may finish after invalidation, but its result is ignored. This is sufficient for AI1B stale-response safety and preserves the shared client's current authentication/refresh contract.

## EXACT PRODUCTION ALLOWLIST

Only these production paths may change or be created during AI1B implementation:

1. `apps/mobile/src/screens/AssistantScreen.js`
2. `apps/mobile/src/screens/assistantState.js`
3. `apps/mobile/src/api/assistantService.js`
4. `apps/mobile/src/api/assistantErrors.js`

`assistantState.js` owns pure transcript bounding and state-transition helpers so race, retry, reset, and duplicate-message behavior can be tested without provider access. `AssistantScreen.js` owns mounted/request identity refs and renders the existing WeCooked composition. The API files own only the authenticated endpoint call, reply normalization, and safe WeCooked error mapping.

Navigation, `PlusMenu`, auth/context files, backend AI1A files, Expo configuration, legal/Help Center content, and persistence files are excluded. The only package and lockfile exception is the authorized mounted-test infrastructure recorded below.

## EXACT TEST ALLOWLIST

Only these mobile test paths may change or be created during AI1B implementation:

1. `apps/mobile/__tests__/assistantService.test.js`
2. `apps/mobile/__tests__/assistantErrors.test.js`
3. `apps/mobile/__tests__/assistantState.test.js`
4. `apps/mobile/__tests__/assistantScreenStaticAudit.test.js`
5. `apps/mobile/__tests__/pendingFeatureHonestyStaticAudit.test.js`

The last file requires a narrow update because its current Assistant assertion freezes the honest unavailable placeholder and requires that no message be sent. Its Community, Substitute Finder, Swap Detail, provider-mount, and Help Center assertions remain unchanged.

These tests must mock the WeCooked `api` boundary, never OpenAI, and prove:

- the service sends the exact bounded transcript to `/assistant/chat` through `api.post` and returns only a trimmed non-empty reply;
- successful send appends one user message and one Assistant reply;
- blank input is a no-op and accepted input is trimmed and cleared;
- the synchronous single-flight guard prevents duplicate calls/messages;
- quick prompts invoke the same send path;
- the `ASSISTANT_NOT_CONFIGURED` state is truthful, and generic/network/timeout/rate-limit mappings are safe;
- retry resends the saved transcript without duplicating the user message;
- reset invalidates an outstanding completion and clears all transient/retry state;
- unmount cleanup prevents an outstanding completion from committing;
- a late older completion cannot overwrite a newer conversation;
- transcript order and AI1A per-message/count/total bounds are preserved;
- no Assistant production file imports persistence, calls `fetch`, refers to OpenAI/provider configuration, uses `EXPO_PUBLIC_OPENAI_*`, or fabricates replies;
- current header/back, safe-area, theme, composer, scrolling, disabled/loading, and accessibility wiring remain present.

Focused Assistant tests run first, followed by the full mobile Jest suite and repository whitespace/status checks. Static source assertions do not replace mounted interaction or device verification.

## AUTHORIZED MOUNTED-TEST INFRASTRUCTURE

AI1B includes the following exact test-only dependencies in `apps/mobile/package.json`:

- `@testing-library/react-native@13.3.3`;
- `react-test-renderer@19.2.3`.

Both remain `devDependencies`. The corresponding `package-lock.json` changes belong only to this authorized mounted Assistant test-infrastructure expansion and its resolved transitive dependency metadata. They do not change production mobile behavior or backend AI1A.

## SHARED CLIENT DECISION

`apps/mobile/src/api/client.js` must not change for AI1B. It does not currently forward `AbortSignal`, but physical transport cancellation is not required to meet the frozen contract: generation/request identity prevents every stale completion from committing while the existing client preserves authenticated refresh/retry behavior.

Adding signal propagation would require defining abort behavior across the transparent 401 refresh/retry path and broadening shared-client tests. That is unnecessary for this milestone. A future transport-cancellation milestone may freeze that separately.

## RUNTIME GATES

Before AI1B release, verify in a mounted Expo runtime and on an Android device or emulator:

1. the existing `PlusMenu` entry opens the root `Assistant` route and back navigation remains correct;
2. keyboard avoidance, safe-area spacing, focus, submit behavior, disabled controls, touch targets, accessibility labels, and automatic scrolling work with short and long conversations;
3. reset during an outstanding mocked request and unmount/navigation during an outstanding mocked request produce no late UI update or warning;
4. success, missing configuration, timeout/unavailable, rate limit, network failure, retry, and auth refresh/retry render the frozen behavior through the WeCooked API boundary;
5. no transcript survives screen unmount/remount or app restart;
6. the built mobile bundle contains no provider secret, `EXPO_PUBLIC_OPENAI_*`, direct OpenAI URL, provider model setting, or Assistant persistence path.

A deployed authenticated endpoint smoke test may prove the expected `503 ASSISTANT_NOT_CONFIGURED` state without provider credentials. A live successful provider call is not required for AI1B implementation and remains a production-activation gate under AI1A.

Before enabling a configured provider in production, complete the AI1A live-provider, deployed timeout/failure/rate-limit, logging/privacy, data-disclosure, model-access, billing/quota, and multi-instance limiter gates. Do not claim those gates from mocked mobile tests.

## CLOSURE EVIDENCE

- Mounted Assistant interaction tests: **25/25 PASS**.
- Focused AI1B tests: **123/123 PASS**.
- Babel transforms: **3/3 PASS**.
- Independent review completed; all required findings were fixed.
- Closure review: **PASS**.
- Full-suite failures were independently verified as unrelated baseline failures, not AI1B regressions.
- API startup against `wecooked-dev`: **PASS**.
- Android runtime verification: **DEFERRED** because no physical Android device was connected and the available Android emulator could not boot without the required hypervisor driver. This is an environment limitation, not a discovered AI1B production defect.
- No mobile-originated runtime network proof was obtained.
- No OpenAI live-provider verification or OpenAI request was performed.
- Android/device verification remains a release gate.
- OpenAI end-to-end success remains an AI1A/provider activation gate.

The automated and review evidence above does not claim Android runtime, real-device, emulator, mobile-originated network, or OpenAI connectivity success.

## OUT OF SCOPE

- Any navigation, tab, auth, token, backend, package, lockfile, Expo config, legal, Help Center, or persistence change other than the exact authorized mounted-test dependencies and their lockfile resolution recorded above.
- Streaming, tools/actions, web/file search, attachments, images, voice, provider failover, model selection, or provider settings.
- Stored chat history, cross-screen conversation context, analytics, audit records, or server/provider conversation IDs.
- Profile, pantry, allergy, dietary, saved-recipe, catalog, recipe-card, nutrition, or shopping-list grounding/actions.
- Fake/rule-based replies, local fallbacks, mock recipes, direct provider calls, or provider error details.
- Redesign of the Assistant route or unrelated mobile screens.

## BLOCKERS AND VERDICT

No repository blocker prevents AI1B implementation. The endpoint, authenticated client, root route, `PlusMenu` entry, current Assistant shell, and mobile Jest infrastructure are present on the frozen baseline.

Provider credentials/credits and live-provider proof remain unavailable. That limitation is a production-activation/runtime gate, not an AI1B implementation blocker, because mobile tests must mock the WeCooked API boundary and the unconfigured endpoint has a truthful frozen state.

Repository implementation, focused verification, independent review, required fixes, and closure review are complete. The deferred Android/device and AI1A provider-activation gates remain explicit and are not represented as passed.

**AI1B CLOSURE PASS - READY FOR PR**
