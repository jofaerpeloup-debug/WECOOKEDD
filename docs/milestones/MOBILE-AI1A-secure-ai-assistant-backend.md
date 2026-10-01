# MOBILE-AI1A - Secure AI Assistant Backend Contract

## GOAL

Freeze the smallest secure, authenticated, server-side AI boundary needed for a later MOBILE-AI1B mobile integration. MOBILE-AI1A is contract-only: it does not implement the endpoint, change mobile behavior, select a production model, or contact OpenAI.

The live-repository baseline is `main` at `d00ad0ce16cae86466b9b8328ae87f2075d6288a`, aligned with `origin/main`. The teammate AI prototype audited at `teammate/main` commit `081a94bd85aafc8d736f0c10d3c9e2655b1a0368` is not an implementation source: its client-held key, direct Chat Completions request, hardcoded fallback model, local rule engine, mock catalog/profile context, and raw provider-error behavior are rejected.

## ARCHITECTURE

```text
apps/mobile
  -> authenticated WeCooked API
  -> assistant route / validation / controller / service
  -> server-only OpenAI Responses provider
  -> normalized WeCooked response
  -> apps/mobile
```

The route remains inside the existing `Route -> Middleware / Validation -> Controller -> Service -> Provider` architecture. There is no repository, Mongoose model, conversation store, provider SDK, or mobile-side provider access in AI1A.

## REQUEST / RESPONSE CONTRACT

### Endpoint and authentication

`POST /api/v1/assistant/chat`

The route uses the existing `authenticate` middleware. Authentication runs before both dedicated Assistant limiters, validation, and the controller. Anonymous, invalid-session, and suspended-user behavior remains owned by the existing authentication contract.

### Request

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

The JSON body contract is frozen as follows:

- `messages` is required and must contain 1 through 12 entries.
- Each entry is a strict object containing only `role` and `content`.
- The request body is strict and contains only `messages`.
- `role` is exactly `user` or `assistant`; `system`, `developer`, tool, and unknown roles are rejected.
- `content` must be a string, is trimmed before use, and must be non-empty after trimming.
- Trimmed `user` content is at most 2,000 JavaScript string-length units.
- Trimmed `assistant` content is at most 4,000 JavaScript string-length units.
- The sum of all trimmed `content.length` values is at most 12,000.
- The final message must have role `user`.
- No alternation, first-role, or same-role-merging rule is imposed. Consecutive equal roles and an initial assistant message are valid if every other rule holds.
- Validation failures use the existing `400 VALIDATION_ERROR` envelope and field-detail convention.

### Success response

```json
{
  "success": true,
  "data": {
    "reply": "..."
  }
}
```

`reply` is a trimmed, non-empty string extracted from provider `output_text` content items. The API never exposes a provider response object, response ID, model name, usage, token counts, finish/incomplete details, headers, status text, or provider error body.

### Error response mapping

| Condition | HTTP | WeCooked code |
| --- | ---: | --- |
| Missing or blank server API key or model | 503 | `ASSISTANT_NOT_CONFIGURED` |
| Provider HTTP failure, network failure, invalid JSON, malformed response, or empty text | 503 | `ASSISTANT_UNAVAILABLE` |
| The server-owned 20-second deadline aborts the provider request | 504 | `ASSISTANT_TIMEOUT` |
| Request validation failure | 400 | existing `VALIDATION_ERROR` |

All public messages are fixed WeCooked messages. A raw OpenAI error body, API key, provider stack, or transcript must never enter an API response.

## SERVER INSTRUCTIONS

The following string is a fixed server-owned constant. It is never accepted from the client, concatenated from client content, or replaceable by a request field:

```text
You are WeCooked's cooking assistant. Help with cooking questions, recipe ideas, ingredient substitutions, recipe scaling, and meal ideas. You do not have access to the user's pantry, profile, saved recipes, or the WeCooked catalog unless that context is explicitly supplied by the WeCooked server in this request. Never claim that you accessed information that was not supplied. Do not claim that food, ingredients, substitutions, or recipes are allergy-safe, and do not give allergy-safety guarantees. Do not provide medical guarantees. Do not claim exact nutritional values or guarantees unless authoritative nutritional data is explicitly supplied by the WeCooked server. Do not claim that you saved, changed, added, removed, ordered, or otherwise performed any action in WeCooked. Be clear when uncertain, and keep the answer concise and practical.
```

AI1A supplies no pantry, profile, dietary, allergy, saved-recipe, catalog, or other application context. Client messages remain untrusted transcript content even if they attempt to override the fixed instructions.

## PROVIDER CONTRACT

The provider is OpenAI through a raw server-side `fetch` to the fixed official URL `https://api.openai.com/v1/responses`. Node 20 already supplies `fetch` and `AbortController`, so no package or lockfile change is authorized.

The request is exactly bounded by these application-owned fields:

```json
{
  "model": "<OPENAI_MODEL>",
  "instructions": "<fixed server-owned instruction above>",
  "input": "<validated messages mapped only to role/content items>",
  "max_output_tokens": 600,
  "store": false,
  "tools": []
}
```

The actual `input` value is the validated `messages` array, preserving order and containing only `{ role, content }`. The provider request:

- sends `Authorization: Bearer <OPENAI_API_KEY>` and `Content-Type: application/json`;
- obtains the model only from normalized server environment configuration;
- sets a 20,000 ms `AbortController` deadline and always clears its timer;
- uses foreground, non-streaming generation;
- sends no tool definitions and enables no web search, file search, function calls, or other tools;
- omits `previous_response_id`, `conversation`, `background`, provider metadata, and provider-side conversation continuation;
- sets `store: false` on every request;
- extracts text only from message output content items whose type is `output_text`, joins those text values in provider order, and trims the result;
- treats missing/blank output text or an unrecognized response shape as `ASSISTANT_UNAVAILABLE` rather than passing raw data through.

The official OpenAI documentation establishes that Responses accepts separate top-level `instructions` and `input`, and that Responses state storage is disabled with `store: false`: <https://developers.openai.com/api/docs/guides/migrate-to-responses>. It also establishes that `store: false` is distinct from organization-level Zero Data Retention and does not justify a claim of zero provider retention: <https://developers.openai.com/api/docs/guides/your-data>.

## ENVIRONMENT CONTRACT

Only these new server environment names are frozen:

- `OPENAI_API_KEY`: trimmed server secret; never public, returned, or logged.
- `OPENAI_MODEL`: trimmed provider model identifier selected after provider smoke testing; no source-code default.

Both values are optional at process boot and normalize to empty strings when absent. This preserves API availability for non-Assistant routes. The Assistant service requires both non-empty values at request time; absent or partial configuration fails closed as `503 ASSISTANT_NOT_CONFIGURED` before any provider request.

No `EXPO_PUBLIC_OPENAI_*`, client-pasted key, device-stored key, source-code model fallback, or client-selected model/instructions field is permitted.

## RATE-LIMIT CONTRACT

The live API already has a global `300 requests / IP / 15 minutes` limiter and an `authenticatedUserKey` helper backed by `req.auth.userId`. Existing external-request protection also establishes the paired `10/user` and `20/IP` 15-minute convention. AI1A therefore freezes dedicated limiters without weakening or replacing the global limiter:

- primary quota: 10 authenticated Assistant requests per user per 15 minutes;
- looser abuse backstop: 20 authenticated Assistant requests reaching the IP limiter per client IP per 15 minutes;
- middleware order: `authenticate -> assistantUserRateLimiter -> assistantIpRateLimiter -> validate -> controller`;
- both dedicated limiters use the existing standard `429 RATE_LIMIT_EXCEEDED` envelope and in-memory store convention;
- the IP limiter uses the existing proxy-trust configuration and default IP keying;
- the user limiter uses the existing `authenticatedUserKey`; it never keys from request body, token claims alone, or a client header;
- anonymous requests fail authentication before consuming either Assistant quota;
- the existing global limiter remains unchanged and continues to run before body parsing.

These exact values are grounded in the repository's current paired per-user/IP convention, not copied from the teammate prototype. Multi-instance deployment remains subject to the existing documented requirement for a shared rate-limit store.

## PRIVACY / LOGGING BOUNDARY

AI1A is application-stateless. WeCooked does not persist prompts, replies, transcripts, provider response objects, response IDs, or chat history. It adds no MongoDB model, repository, collection, cache, queue, analytics payload, or audit-log event for Assistant content. It sends no profile, dietary, allergy, pantry, saved-recipe, or catalog context.

The repository has console/Morgan conventions but no shared structured application logger. AI1A must not invent a logger or add a logging dependency. It may emit one fixed, sanitized console outcome event per service attempt with only:

- event name `assistant.chat`;
- outcome `success` or `failure`;
- non-negative integer `latencyMs`;
- normalized failure category `not_configured`, `timeout`, or `provider_unavailable` when applicable.

It must not log an authenticated user ID because the current general logging policy does not establish that as an application-log convention. It must never log message content, the full request body, provider request/response bodies, API keys, Authorization headers, raw provider errors, or provider stack traces. Existing development request logging and centralized error handling remain unchanged; Assistant `AppError` messages are fixed and content-free.

`store: false` means no provider response-state storage is requested. It must not be represented as a guarantee of zero provider retention. External-AI data disclosure, retention review, and production policy approval are release gates; Privacy Policy and Help Center content are not modified in AI1A.

## EXACT IMPLEMENTATION ALLOWLIST

Only the following backend paths may change in a future AI1A implementation:

1. `apps/api/.env.example`
2. `apps/api/src/config/env.js`
3. `apps/api/src/middleware/rate-limiter.js`
4. `apps/api/src/routes/v1.routes.js`
5. `apps/api/src/modules/assistant/assistant.routes.js`
6. `apps/api/src/modules/assistant/assistant.validation.js`
7. `apps/api/src/modules/assistant/assistant.controller.js`
8. `apps/api/src/modules/assistant/assistant.service.js`
9. `apps/api/src/modules/assistant/openai.provider.js`

Every listed file is necessary: environment documentation and normalization, dedicated quota construction, v1 mounting, and the repository-standard route/validation/controller/service boundary plus isolated provider transport. `app.js`, shared error/response middleware, packages, locks, database files, mobile files, navigation, and legal/help content are not authorized.

## EXACT TEST ALLOWLIST

Only the following focused test paths may change or be created for AI1A implementation:

1. `apps/api/test/env.test.js`
2. `apps/api/test/rate-limiter.test.js`
3. `apps/api/test/assistant-validation.test.js`
4. `apps/api/test/assistant-provider.test.js`
5. `apps/api/test/assistant-service.test.js`
6. `apps/api/test/assistant-routes.test.js`

The focused tests must prove:

- both provider environment values are optional at boot, trimmed, mapped server-side, and partial/missing configuration fails at the Assistant boundary;
- authenticated-user and IP limits are independent, exact, ordered after authentication, and preserve the existing 429 envelope and global limiter;
- every request bound, role restriction, strict unknown-key rejection, total trimmed transcript bound, final-user rule, and intentional lack of alternation constraint;
- authentication precedes quotas/provider work and success is exactly `{ success: true, data: { reply } }`;
- the fixed URL, server Authorization header, server-only instruction constant, environment model, mapped input, `max_output_tokens: 600`, `store: false`, empty tools, and omission of persistence/continuation fields;
- timeout abort and timer cleanup, with timeout distinct from other provider/network failures;
- raw provider errors and malformed bodies are normalized without secret, transcript, provider body, response ID, or stack leakage;
- only normalized output text reaches the controller response;
- repeated calls are independent and no model, repository, collection, conversation ID, previous response ID, or other persistence mechanism is used;
- sanitized logging contains only the frozen fields and never messages, credentials, Authorization, or raw provider data.

Implementation verification must start with these focused tests, then run the existing API test suite and `git diff --check`. Automated tests do not replace a live provider smoke test.

## RUNTIME GATES

Before production activation or MOBILE-AI1B:

1. Select a supported, cost-appropriate model through provider smoke testing and set `OPENAI_MODEL` in the server environment; do not commit the value as an application default.
2. Provision a dedicated least-privilege server-side OpenAI project key, set `OPENAI_API_KEY`, verify billing/quota/model access, and confirm neither value reaches mobile bundles or logs.
3. Exercise the deployed endpoint with a real authenticated WeCooked session and prove success, normalized provider failure, missing configuration, provider timeout, rate limiting, and recovery after failure.
4. Confirm the actual raw Responses payload shape used by the selected model is accepted by the provider parser and that no provider-specific fields escape.
5. Review provider data controls and approve an accurate external-AI disclosure. `store: false` alone must not be described as zero retention.
6. Confirm production observability contains only the frozen sanitized outcome fields and no transcript, key, Authorization header, raw body, or provider error.
7. Reassess the in-memory limiter store before running more than one API instance.

No live provider, deployed environment, browser, Android/device, or production logging proof is claimed by this contract-only milestone.

## OUT OF SCOPE

- Any mobile, Admin, navigation, Help Center, Privacy Policy, or legal-content change.
- Client-held or public OpenAI credentials, AI settings, client-selected models, or direct mobile-to-OpenAI traffic.
- Package or lockfile changes and the OpenAI SDK.
- Chat persistence, conversation lists, server sessions, provider conversations, analytics, audit records, repositories, models, or database migrations.
- Profile, dietary, allergy, pantry, saved-recipe, catalog, recipe-card, or curated-substitution context.
- Tools, web search, file search, function calls, actions, streaming, background mode, attachments, images, voice, structured outputs, moderation workflow, or provider failover.
- Fake/rule-based answers, mock catalog grounding, exact nutrition claims, medical/allergy guarantees, or claims that WeCooked actions occurred.
- Production model selection and live provider verification.

## AI1B BOUNDARY

MOBILE-AI1B may activate the existing Assistant shell only after AI1A is implemented, reviewed, tested, and passes the runtime gates. AI1B may call only the authenticated WeCooked endpoint and may keep the current session transcript transient in component memory. It must send the bounded transcript contract, render only normalized `data.reply`, handle the frozen WeCooked error codes honestly, prevent duplicate concurrent sends, and preserve retry/clear behavior without device persistence unless separately authorized.

AI1B may not introduce OpenAI keys, direct provider calls, provider model controls, system instructions, fake fallback answers, catalog/profile/pantry claims, provider IDs/errors, or persistence. Recipe cards, catalog grounding, user context, tools/actions, streaming, and stored conversations require separate contracts.

## BLOCKERS AND VERDICT

AI1A implementation and review evidence is complete:

- focused tests: **61/61 PASS**;
- full API evidence: **1738/1738 PASS**;
- independent review completed;
- required findings fixed;
- closure review: **PASS**.

The live-provider smoke test is **DEFERRED** because no provider credentials or credits are currently available. This is an external limitation, not an implementation failure. `OPENAI_API_KEY` and `OPENAI_MODEL` remain optional at process boot, and an unconfigured Assistant correctly fails closed with `503 ASSISTANT_NOT_CONFIGURED` before any provider request.

Real-provider verification remains a production activation and release gate. OpenAI connectivity has not been verified, and this milestone makes no such claim. Production activation also remains gated on deployed runtime verification and external-AI disclosure approval.

**AI1A FINALIZED — READY TO MERGE**
