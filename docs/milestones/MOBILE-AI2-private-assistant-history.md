# MOBILE-AI2 — Private Assistant History

Date: 2026-10-15 (Asia/Singapore).

**Verdict: FROZEN — owner-approved 30-day retention from immutable conversation createdAt.**

This is the frozen contract for the existing MOBILE-AI2 roadmap item, not a replacement milestone. The owner approved 30-day conversation retention on 2026-10-15; the technical scope and exact allowlists below include that amendment. Contract freeze authorizes no implementation, production data access, migration, package change, commit, push, merge, or deployment.

## Authority and inspected baseline

- Source checkout: `C:\Users\Clein\OneDrive\Documents\Projects\wecooked`, local `main`, HEAD `4e283bc1b88077e3f467b92f2533652dbeccc643`. No remote freshness claim.
- The five API AI1 files and four mobile AI1 files listed under protections were read. Their contents are identical to the IDE's `wecooked-cooking-backend-slice1` checkout, HEAD `62c1f2641f64dc2de9cbe082f60b817cbb4cac68`.
- Read AI1A/AI1B milestone contracts, ACCOUNT2, roadmap row 21 in `MOBILE-PARITY-AUDIT2-final-product-parity-audit.md`, existing AI2 audit records from 2026-10-14, and both local token-efficient/testing workflow documents in `docs/workflows/`.
- Inspected route mounting, current authentication, response/validation conventions, global/Assistant limiters, notification cursor pagination, collection serialization, meal-plan Mongo transactions, shared mobile client, AuthContext, PrivacyScreen, and Assistant tests/configuration.
- No applicable ancestor or checkout `AGENTS.md` was found. The open tab in the preserved notification worktree does not govern this checkout.
- Existing untracked `docs/milestones/ANALYTICS-VIZ1-admin-analytics-visualization.md` and `docs/workflows/` are protected unrelated work. Do not stage, edit, or relocate them.

Earlier audits correctly identified absent persistence and owner scoping. Their proposed model, quota, spend, provider-data-control, and live-provider decisions are not prerequisites for this storage contract: AI1 already owns those boundaries and activation gates. The current checkout also has mounted React Native test tooling; do not carry forward the older missing-tooling finding.

## Existing behavior that remains authoritative

`POST /api/v1/assistant/chat` remains stateless with the exact request `{ messages: [{ role, content }] }`, exact success data `{ reply }`, and current errors. It neither reads nor writes AI2 history. Existing clients continue to work.

Keep authentication → shared Assistant user limiter → shared Assistant IP limiter → AI1 validation → controller unchanged. Limits remain 10 requests/user/15 minutes, 20/IP/15 minutes, and the existing global 300/IP/15 minutes. Use the same exported limiter instances for AI2 generation; do not create a second allowance.

Reuse `assistant.service.chat(messages)` directly for generation. Keep the provider implementation, URL, configured key/model, fixed instructions, plain-text reply extraction, `max_output_tokens: 600`, `store: false`, empty tools, 20,000 ms provider deadline, safe errors, and sanitized logging unchanged. No SDK, provider continuation IDs, tools, streaming, new prompt, second provider, or extra generation call.

Replay bounds remain at most 12 messages and 12,000 total trimmed JavaScript string-length units; user content at most 2,000 and replayed Assistant content at most 4,000. The new user message is always last and retained. These are generation-context bounds, not a stored-history quota or expiry policy.

## Dependency order and ownership

| Slice | Owner and deliverable | Dependency |
| --- | --- | --- |
| AI2-A | API: private Mongo storage, New/List/Open/Delete, serialization, pagination, ownership, fixed expiry and indexes | Frozen contract; separate implementation authorization |
| AI2-B | API: persistent send/retry, durable deduplication, server replay, shared AI1 generation budget | AI2-A; no edits to AI1 generation |
| AI2-C | Mobile: additive history controls and persistent messaging inside existing Assistant route | Approved AI2-A/B wire contract and API availability |

Implement A before B, then C. Do not run overlapping source edits in parallel. C must never fall back to stateless `/chat` after a history failure: that could generate an answer without saving it. Preserve the existing stateless mobile service export for other callers and its regression tests.

## API wire contract

All new paths below are relative to `/api/v1/assistant/conversations`. Mount a separate router there in `v1.routes.js`; do not attach persistence dependencies to `assistant.routes.js` or its core graph.

Use `authenticate`, `validate`, `req.validated`, `req.auth.userId`, `asyncHandler`, `AppError`, and `sendSuccess`. Success envelopes remain `{ success: true, data }`; errors remain `{ success: false, error: { code, message, details? } }`. All history responses, including failures, use `Cache-Control: no-store`.

| Method/path | Strict input | Success data/status |
| --- | --- | --- |
| `POST /` | `{ requestId }` | `{ conversation }`, 201; same create key returns the same conversation, 200 |
| `GET /` | Query `{ limit?, cursor? }`; no body | `{ conversations, pageInfo }`, 200 |
| `GET /:conversationId` | Query `{ limit?, cursor? }`; no body | `{ conversation, messages, pageInfo }`, 200 |
| `DELETE /:conversationId` | Empty body/query | `{ deleted: true }`, 200 after active Mongo records are deleted |
| `POST /:conversationId/messages` | Exactly one of the send/retry bodies below | `{ conversation, requestId, userMessage, assistantMessage }`, 200 after durable success |

Create key and send keys are UUID strings; create keys are scoped to authenticated owner. Send keys are scoped to owner and conversation. Conversation/message IDs reuse the existing ObjectId validator. `expectedVersion` is a non-negative safe integer and a concurrency precondition, never ownership authority.

```json
{ "requestId": "<new UUID>", "expectedVersion": 0, "content": "What can I cook with lentils?" }
```

```json
{ "requestId": "<new UUID for this explicit retry>", "expectedVersion": 2, "retryOf": "<existing failed user-message ID>" }
```

Reject mixed send/retry bodies, unknown fields, caller ownership, roles, message arrays, timestamps, provider settings, and provider IDs. Trim nonblank new content and reject over 2,000 units; never silently truncate API input. A retry obtains content and the original bounded replay snapshot from the server record, not from mobile.

Wire serialization is explicit:

- `conversation`: `{ id, createdAt, updatedAt, expiresAt, version }`; server-owned immutable `createdAt` and `expiresAt`.
- Stored user message: `{ id, role: "user", content, sequence, createdAt, status }`; status is `pending`, `complete`, `failed`, or `uncertain`.
- Stored Assistant message: `{ id, role: "assistant", content, sequence, createdAt }`. It exists only for a real successful reply.
- `pageInfo`: `{ nextCursor: string | null, hasMore: boolean }`.
- Dates are ISO strings; never expose owner IDs, internal request records, replay snapshots, raw Mongo documents, provider metadata, or raw errors.

No AI-generated titles or summaries. List rows use a date-based display label on mobile; metadata does not contain transcript previews. This removes a title-generation call and a separate title-editing feature.

Pagination follows the existing cursor/pageInfo convention: default 20, maximum 50, positive integer limit; cursor length maximum 1,000. These are response-size bounds, not account quotas. List order is immutable `(createdAt DESC, _id DESC)`, avoiding activity-sort cursor movement. Open returns the latest message page, displayed in ascending sequence; subsequent cursors retrieve older messages, which mobile prepends. A completed Assistant reply has the next sequence after its user message. Missing replies leave sequence gaps; they never produce placeholder message rows.

Use signed, versioned, canonical opaque cursors following the notification pattern, bound to owner, endpoint, and conversation where applicable. Verify signature, shape, boundary types, and scope; reject malformed/foreign-scope cursors as `400 VALIDATION_ERROR`. Every query independently applies owner/conversation predicates; a cursor never grants access. Keep cursor code within the new history service; do not import or modify notification business logic. Pagination is a live view: mobile deduplicates by ID, refreshes page one after mutations, and does not promise a frozen snapshot across devices.

Malformed IDs/input return `400 VALIDATION_ERROR`. Well-formed expired, missing and foreign conversation/message references return the same `404 ASSISTANT_CONVERSATION_NOT_FOUND`. Expiry is checked before request-result replay or conflict details. No existence, ownership, count, or timing-detail field is exposed. Authentication errors, limiter errors, and AI1 generation errors retain their existing codes/statuses. New safe conflicts are `409 ASSISTANT_CONVERSATION_STALE`, `409 ASSISTANT_REQUEST_CONFLICT`, `409 ASSISTANT_REQUEST_IN_PROGRESS`, and `409 ASSISTANT_SEND_UNCERTAIN`.

## Fixed expiry and enforcement

Owner-approved retention is exactly **30 elapsed days from immutable conversation `createdAt`**, not last activity: `expiresAt = createdAt + 2_592_000_000 ms` (30 × 24 hours). Both timestamps are set by the server when the conversation is first created, stored as UTC instants, and immutable thereafter. `updatedAt`, reads, reopen, sends, replies, retries, session changes and reactivation never reset either timestamp. A conversation is live only while `expiresAt > serverNow`; equality is expired. Client clocks, cursor timestamps, request IDs and Mongo TTL deletion timing are never access authority.

Every child message and generation-request record, including content, replay snapshots and cached outcomes, inherits the parent's exact immutable `expiresAt`; its own creation time never starts a new retention period. New children must not be written under an expired or missing parent. Request-result retention cannot exceed the parent deadline.

| Operation | Required server enforcement |
| --- | --- |
| List and every page | Query with authenticated owner and `expiresAt > serverNow`, then recheck before serialization/response. Exclude rows that expired during the read; compute pagination only from eligible rows, never expose expired content or counts. A valid old cursor is only a boundary and does not revive expired rows. |
| Open, older message pages, and reconciliation | Require a live owned parent before reading children and recheck before returning content. Child reads also require their inherited expiry to be live. If the parent expires during the read, discard the data and return opaque 404. |
| Send, explicit retry, and duplicate-result replay | Require a live owned parent before resolving saved request content/results, claiming a write or assembling replay. Include expiry in parent/child mutation predicates and recheck immediately before provider dispatch. An expired conversation causes opaque 404 with zero new provider calls; do not auto-create a replacement or fall back to `/chat`. |
| Pending provider reply or failure | Recheck the live parent and immutable deadline at final fenced database writes and again before returning content. If expiry wins, discard the provider reply/error payload, do not append a reply, save a result/snapshot, renew a claim, or expose cached success; return opaque 404. A commit confirmed only after expiry must not produce a success response or expose its result. All records remain inaccessible at expiry even if a write/commit crossed the deadline or TTL has not removed them yet. |
| Duplicate create and Delete | A create-key replay may return only an existing live conversation and never update its dates; an existing expired key returns opaque 404. Delete of an expired parent returns opaque 404. Explicit New uses a fresh key and creates a distinct empty conversation; it never restores an expired transcript. |

Use fresh trusted server time at each enforcement boundary, not a request-start timestamp reused after awaits. Database write predicates must evaluate the deadline using current database time at the final conditional write, together with owner/parent/version/request fencing; read/response guards use current server time. Expiry takes precedence over claim recovery and idempotent-result return. No pending completion, transaction retry, reconciliation or upsert can recreate a removed parent or children. Time control must be injectable in tests; clock alignment is a runtime verification gate.

Declare an independent single-field TTL index `{ expiresAt: 1 }` with `expireAfterSeconds: 0` on each of the three new collections. TTL provides eventual physical cleanup only: parent deletion does not cascade, so messages and request snapshots/results need their own TTL indexes. A delayed or disabled TTL monitor must never change access denial. Do not promise physical purge at the exact deadline or infer an additional retention allowance from cleanup lag; verify cleanup and indexes separately before release. No TTL on User/session collections, new cleanup job, startup hook, package, migration script or additional implementation path is authorized. Backup retention is a separate unresolved release gate, not part of this approval.

## Mongo ownership, replay, and races

Use three new collections/models: conversation metadata, individual messages, and bounded per-generation-request records. Do not embed growing transcripts or attempt arrays in a User or conversation document.

- Conversation metadata owns `userId`, create request ID, immutable creation/expiry timestamps, mutable activity timestamp, monotonic version/sequence allocation, and the current generation claim.
- Message records own `userId`, `conversationId`, sequence, role/content, and user-send status. Store the normalized successful AI1 reply as returned; the 4,000-unit Assistant bound applies to replay, matching AI1B normalization. Do not impose a new output truncation policy.
- Request records own `userId`, `conversationId`, request ID, canonical payload fingerprint, user-message reference, bounded replay snapshot, claim/fence identity, state, safe outcome, and committed result references. Never store credentials or raw provider payloads/errors.
- Indexes: conversations unique `{ userId, createRequestId }` and `{ userId, createdAt DESC, _id DESC }`; messages unique `{ userId, conversationId, sequence }`; requests unique `{ userId, conversationId, requestId }`; plus each collection's independent `expiresAt` TTL index defined above. Child indexes also support owner/conversation deletion. Declare and verify indexes; no live index creation is authorized here.

Each create/list/open/delete/send/retry lookup and mutation uses authenticated owner and live-expiry predicates. Child records must also match the live owned parent and inherited deadline. Private data is excluded from Admin, public profile, search, analytics, audit events, notifications, recommendations, and other user context. No client/device transcript storage.

New/List/Open/Delete and transport replays of completed requests make **zero** provider calls. History must remain usable when AI1 is unconfigured or the provider is unavailable. Mounting the router must not require provider credentials at boot.

For a new logical send:

1. Authenticate and apply the existing shared user/IP Assistant limiters, then validate. CRUD uses the global limiter only. Request replays remain subject to those same limiters; no new free-generation allowance is introduced.
2. Confirm the live owned conversation and expiry; only then resolve an existing request ID before rejecting its now-stale version. Same ID/different canonical input is a conflict. Same completed ID returns its committed result without generation only while the parent/result remain live; pending returns in-progress; terminal failed/uncertain ID returns its stored safe outcome without generation only while live. Expired records always return opaque 404 instead.
3. Atomically claim the expected live conversation version, persist one user message and one request record with the parent's unchanged expiry, and advance version/sequence. Concurrent new sends to the same conversation cannot both claim the same version or dispatch while another claim is active.
4. Server builds the newest contiguous suffix from persisted owner/conversation messages plus the accepted user message. Apply the exact normalization and bounds of `buildAssistantTranscript`, including trimming and slicing historical Assistant text for replay. Failed user messages remain real user text; status labels, errors, introductory copy, dates, and UI labels never enter replay. Persist the bounded snapshot for exact retries. Reject no-op/invalid input before provider dispatch.
5. Recheck parent expiry immediately before invoking existing `assistant.service.chat(snapshot)` once, outside any retried Mongo transaction callback. Never accept client-supplied replay, fetch profile/pantry/catalog data, or add instructions. Do not change AI1's provider timeout; expiry during a provider call is handled by discarding its late result.
6. On success, atomically fence against the owned unexpired parent, inherited deadline, active request, and version; append one real Assistant reply, mark the user/request complete, release the claim, and advance version/activity without changing expiry. Return success only after Mongo confirms commit and a fresh expiry check still passes. Unknown commit recovery reads the request record only through live-parent/expiry checks; it never calls generation again.
7. On a known failure while still live, retain the accepted user message, save only the safe outcome with the unchanged deadline, release/fence the claim, and advance version. If expired, discard the outcome and return opaque 404 instead of updating expired records. No failed request becomes an Assistant bubble. An explicit retry creates a new attempt key for the same user message and exact saved snapshot; no duplicate user row. Allow retry only for the latest failed user turn with no later send in a live conversation. Stale or nonretryable attempts require refresh and receive a safe conflict/validation response.

Generation claims require bounded recovery after process loss, using the existing provider deadline as the timing basis and fencing every completion. Claim timeout/recovery within a still-live conversation marks an ambiguous attempt uncertain and releases its claim; it must never redispatch that request key. Conversation expiry instead denies access without extending or updating retained content. Pending cannot lock a live conversation forever. An uncertain attempt is reconciled by live Open/request lookup and must not receive an automatic provider retry. Mobile asks the user to review the reopened history before explicitly sending again. This promises durable deduplication and fenced writes, not exactly-once execution across Mongo and the external provider.

Delete checks the owner and atomically removes parent, messages, and request snapshots/results using Mongo transactions. It fences pending completion: a send committed before Delete is removed; a send finishing afterward cannot recreate the parent or children and returns opaque not-found. On failure, do not claim deletion. Repeated deletion of an absent resource returns the same opaque 404 as foreign/missing. No soft-delete retention window, backup-erasure promise, or provider-erasure call is inferred. Delete confirmation describes removal from WeCooked conversation history only.

Do not call the provider inside a transaction, transaction retry, cleanup, Open, pagination, deletion, or uncertain-outcome reconciliation. Do not retry a provider timeout automatically. Replica-set transaction/index proof is mandatory later; an in-memory mock cannot close it.

## ACCOUNT2 and mobile behavior

ACCOUNT2 remains authoritative: reversible deactivation does not itself delete stored account content; inactive/deactivated/suspended accounts and stale session generations fail existing authentication. The AI2 30-day deadline continues during deactivation. Reactivation with a new valid session can reopen only that owner's unexpired conversations; it never restarts retention. Email/password changes, logout-all, and session rotation neither transfer ownership nor delete history or extend expiry. Permanent account deletion/anonymization is outside ACCOUNT2 and this milestone; do not implement a partial cascade or claim one exists.

Keep the existing root `Assistant` route, PlusMenu entry, teammate header/back behavior, theme, safe areas, keyboard handling, quick prompts, composer, bubbles, thinking/errors, scrolling, accessibility, initialPrompt consumption, single-flight guard, and stale-response protections. Add New, History/List, Open, and explicit confirmed Delete controls within that screen and a small inline history panel; no new root route or app-wide context.

- Entry shows the current blank draft, preserving the existing entry behavior. New/Clear resets the visible draft and invalidates pending UI identities; it does not delete an older saved conversation. Use separate Delete wording/confirmation. Opening history does not call generation.
- Persist New through create; first send creates a conversation if the current draft has no server ID. Blank input never creates a conversation or calls generation. Coalesce rapid New/create/send actions and retain the create key across network retry.
- List/Open always load from the authenticated API. Reopening after unmount, app restart, or sign-in restores server messages, not local storage. The active conversation ID need not survive restart; selecting it from List supplies continuity.
- Persisted send/retry uses only the new history service; send strict new content or a server message reference, never the visible transcript. A typed submit, quick prompt, and initialPrompt use the same bounded, synchronously guarded send path. Preserve exactly-once initialPrompt consumption and clearing of route params.
- Keep one optimistic user bubble while pending; reconcile by server message ID on success/Open. A transport replay keeps its request ID and body; an explicit retry of a known failure uses a new attempt key and `retryOf`. Do not duplicate the user bubble or rebuild its saved retry snapshot from changed input.
- A saved send may finish after New, Clear, navigation, or unmount. Ignore its stale UI result; the next List/Open may show the saved result only while the conversation remains unexpired. Local invalidation is not server deletion or provider cancellation.
- Use server-supplied `expiresAt` to invalidate visible conversation content and retry eligibility at the known deadline and revalidate on foreground/resume. A local timer is only presentation hygiene; server enforcement remains authoritative. On opaque not-found from an expired/deleted conversation, clear its active content and refresh List; never automatically create/resend, restore a local transcript or fall back to `/chat`.
- Bind all create/list/open/delete/send completions to AuthContext's existing session identity as well as owner, selected conversation, generation, and request identity. Clear private state immediately on logout, direct account change, or same-owner session replacement; reject stale successes and failures. Preserve shared client's session-bound transparent refresh/retry. No edits to auth/client/token files.
- Provide list/open loading, empty, failure, pagination, and retry states. Delete failure retains the visible conversation; successful Delete clears the active one and its retry eligibility. No mocked fallback conversations, replies, recipe cards, or storage-success claims.

## Exact frozen allowlists

Only this document may be written during contract preparation. The frozen future implementation allowlists below include expiry fields, conditional access/write checks, TTL declarations and expiry tests within the existing named paths. Implementation still requires separate authorization. New files are marked `new`; all other paths exist on the inspected baseline. No glob or directory permission is implied.

### AI2-A — API history foundation

**AI2-1 finding amendment — owner-authorized 2026-10-15:** include `apps/api/src/app.js` solely to install narrowly scoped history `Cache-Control: no-store` middleware before CORS, global rate limiting and body parsing can reject a history request. Preserve those middleware behaviors and ordering, authentication, and AI1 `/assistant/chat`. Extend only the existing history-route tests to cover early rejection and unrelated-route isolation. No other shared-file edit is authorized by this amendment.

```text
apps/api/src/app.js (AI2-1 history-header middleware only)
apps/api/src/routes/v1.routes.js
apps/api/src/modules/assistant/assistant-history.routes.js (new)
apps/api/src/modules/assistant/assistant-history.validation.js (new)
apps/api/src/modules/assistant/assistant-history.controller.js (new)
apps/api/src/modules/assistant/assistant-history.service.js (new)
apps/api/src/modules/assistant/assistant-history.repository.js (new)
apps/api/src/modules/assistant/assistant-history.serializer.js (new)
apps/api/src/modules/assistant/assistant-conversation.model.js (new)
apps/api/src/modules/assistant/assistant-message.model.js (new)
apps/api/src/modules/assistant/assistant-request.model.js (new)
apps/api/test/assistant-history-validation.test.js (new)
apps/api/test/assistant-history-routes.test.js (new)
apps/api/test/assistant-history-service.test.js (new)
apps/api/test/assistant-history-repository.test.js (new)
apps/api/test/assistant-history-models.test.js (new)
apps/api/test/assistant-history-mongo.test.js (new; isolated opt-in)
```

### AI2-B — persistent generation

Reuse the exact new history route/validation/controller/service/repository/serializer/models from A. No new production paths. Additional test path:

```text
apps/api/test/assistant-history-send.test.js (new)
```

### AI2-C — additive mobile integration

```text
apps/mobile/src/screens/AssistantScreen.js
apps/mobile/src/screens/assistantHistoryState.js (new)
apps/mobile/src/api/assistantHistoryService.js (new)
apps/mobile/src/components/AssistantHistoryPanel.js (new)
apps/mobile/__tests__/assistantHistoryService.test.js (new)
apps/mobile/__tests__/assistantHistoryState.test.js (new)
apps/mobile/__tests__/assistantHistoryInteraction.test.js (new)
apps/mobile/__tests__/assistantScreenStaticAudit.test.js
```

The existing mounted screen suite is amended only where its expected transport changes to persisted messaging, with all old behavioral guarantees retained. Extend its provider/no-device-storage scan to the new mobile files. Do not weaken tests to accept both transports or remove race/initialPrompt coverage. Existing `assistantService`, `assistantErrors`, and `assistantState` tests remain unchanged regression checks.

Documentation path for every slice:

```text
docs/milestones/MOBILE-AI2-private-assistant-history.md
```

Any additional production, test, legal-copy, script, configuration, package, or migration path requires a specific contract amendment before editing. Only the explicitly defined expiry fields and three schema-declared TTL indexes are included; no cleanup job or live index/migration action is authorized.

## Dependency protections

Read-only for AI2 implementation:

```text
apps/api/src/modules/assistant/assistant.routes.js
apps/api/src/modules/assistant/assistant.validation.js
apps/api/src/modules/assistant/assistant.controller.js
apps/api/src/modules/assistant/assistant.service.js
apps/api/src/modules/assistant/openai.provider.js
apps/api/test/assistant-routes.test.js
apps/api/test/assistant-validation.test.js
apps/api/test/assistant-service.test.js
apps/api/test/assistant-provider.test.js
apps/api/src/middleware/authenticate.middleware.js
apps/api/src/middleware/rate-limiter.js
apps/mobile/src/api/client.js
apps/mobile/src/api/assistantService.js
apps/mobile/src/api/assistantErrors.js
apps/mobile/src/screens/assistantState.js
apps/mobile/src/context/AuthContext.js
apps/mobile/src/navigation/RootNavigator.js
```

Also protect every other non-allowlisted path, especially auth/session/User repositories and models, notification/SHOP5/COOKING work, Admin, API configuration/env, privacy/legal/Help content, mobile token/storage helpers, package manifests/lockfiles, deployment files, and unrelated dirty/untracked work. Shared integration edits are limited to API route mounting and the narrowly scoped AI2-1 history-header middleware in `apps/api/src/app.js`; keep existing route registrations/order and all other app behavior intact. Importing the existing generation/auth/limiter helpers is allowed; changing them is not.

## Acceptance and efficient handoff

Follow the existing local token-efficient workflow: focused terminal checks by the developer, one separate independent source review per completed slice, then findings-only fixes/re-review. Do not re-audit all of AI1 or run unrelated full suites after each fix. Do not turn historic suite totals into current evidence.

Required behavioral counterexamples:

- Unauthenticated, suspended/deactivated, revoked and stale-generation sessions; two real owners; forged ownership; foreign parent/message/cursor; no private data or existence disclosure.
- New/List/Open/Delete with `assistant.service.chat` set to fail if called; provider unavailable/unconfigured; zero generation calls and no extra provider traffic.
- Cursor tamper/scope/limit, same-timestamp order, message paging/prepend/deduplication, and no unbounded response/model array.
- Exact retention boundary at one millisecond before, equality and after `createdAt + 30 days`; UTC/elapsed-day arithmetic; immutable creation/expiry across reads, reopen, sends, retries, replies, activity updates, deactivation/reactivation and create-key replay.
- Expired rows deliberately left in Mongo with TTL delayed/disabled: no List/Open/page/send/retry/cached-result access; opaque 404; zero provider dispatch after expiry. Child snapshots/results share the original deadline; no parent TTL cascade assumption.
- Expiry during read, before dispatch, during provider execution, final conditional write, transaction/unknown-commit reconciliation and before response; no late reply publication, renewal, resurrection or automatic resend. Verify all three TTL declarations independently and eventual cleanup in isolated Mongo.
- Server replay at every count/length boundary, failed prior user text, injected roles/transcript/provider fields, exact retry snapshot, and one call through existing AI1 service.
- Shared limiter counters across `/chat` and persistent sends, including 10/11 user, 20/21 IP, unchanged global protection, and no CRUD consumption of generation counters.
- Duplicate create/send keys, conflicting payloads, simultaneous devices/version races, replay after lost response, known failure, timeout, process loss, uncertain Mongo commit, expired claim and late fenced completion, and retry without duplicate user/reply.
- Real isolated Mongo unique-index and transaction tests: competing claims, rollback, delete/send races, no orphan/recreated children, and partial/unknown commit recovery. Missing replica set means NOT RUN, not PASS.
- Mounted mobile New/List/Open/Delete, remount restoration, quick prompts/initialPrompt, rapid duplicate submit, exact retry identity, failed/uncertain sends, Clear/delete/navigation during pending work, out-of-order list/open responses, direct owner switch and same-owner session replacement; expiry while visible/backgrounded and an expired pending reply clear state without fallback/resend.
- Existing UI layout/accessibility and legacy AI1 `/chat`/service tests remain meaningful. Keep the API core-stateless dependency-graph test unchanged and passing.

Future focused runners, after the new files exist: API `node --test` with the explicit slice test paths; mobile installed Jest with `--runTestsByPath` and the exact four AI2-C test paths. Include existing AI1 API tests plus `rate-limiter.test.js` and `authenticate-middleware.test.js` at B's regression gate; include the three unchanged mobile Assistant helper suites at C's gate. Check missing files before running. Do not use `--passWithNoTests`, install new dependencies, or silently skip required cases. Record command, exit code, pass/fail/skip totals and environment; run broader regression once at integration. Do not contact a real provider from unit tests.

Before approval/implementation verify branch/base and hash the protected files; compare before/after, inspect exact changed/untracked paths, and check new files as well as tracked diffs. Preserve dirty work; no reset/clean/stash, broad staging, publication, or DB action.

## Approved retention and separate release gates

**D1 — APPROVED by the owner on 2026-10-15:** retain conversations for 30 days from immutable conversation `createdAt`. Reading, reopening and sending never extend expiry. The fixed-expiry section applies this same deadline to messages, replay snapshots/results and pending replies. No new storage quota, credit system, provider policy or approval is inferred.

No additional owner decisions are needed for pagination, labels, concurrency, failed-send handling, replay, model choice, or a new quota: the technical choices above and the existing AI1 boundary supply them. Explicit Delete removes active WeCooked history; permanent account erasure and provider/backup erasure policies remain outside this scope.

Existing provider model/key/billing/spend/data-control and live-provider smoke gates remain separate AI1 activation/release gates. They do not block separately authorized isolated implementation of this frozen contract. This contract makes no new external provider-retention claim. PrivacyScreen currently identifies its terms as placeholders; approved disclosure covering Mongo history and the existing external-AI flow is a separate release gate. Backup retention and backup-erasure behavior require their own release decision and verification; the approved 30-day application deadline is not approval or proof of a backup policy. Do not draft policy text or silently expand the implementation allowlist to legal content.

Actual isolated Mongo/index verification, API/mobile runtime across restart/sign-in, Android/iOS accessibility, authenticated deployed behavior, provider smoke proof, privacy/logging verification, and deployment approval remain separate gates. Each is **NOT RUN — NOT CLAIMED AS PASS** in this contract-only task.

Contract consistency check: one immutable parent deadline governs every child, replay and pending outcome; equality denies access independently of TTL; activity and ACCOUNT2 cannot renew it; expiry implementation/tests fit the existing exact allowlists; AI1 protections remain unchanged. No unresolved contract decision remains. Automated tests, Mongo cleanup/index proof, provider activation, privacy disclosure, backup policy and runtime acceptance are not claimed by this document review.

**Final contract verdict: FROZEN.** Implementation and every separate release gate still require their own authorization/evidence; freeze does not authorize production edits or publication.

## AI2-2 API generation implementation handoff

Date: 2026-10-15 (Asia/Singapore). **READY FOR SOURCE REVIEW.** This is implementation evidence under the separately authorized AI2-2 task; it does not change the frozen wire contract or close release gates.

- Isolated worktree: `C:\Users\Clein\OneDrive\Documents\Projects\wecooked-mobile-ai2-api-generation-slice2`.
- Branch: `mobile-ai2-api-generation-slice2`; committed base and unchanged HEAD: `a9711f48fafab3c69eef678911972a836e1ca645` (AI2-1).
- Work remains unstaged and uncommitted. No push, merge, deployment, Mobile edit, package change, real provider call, production Mongo access, or live index action occurred.

Exact changed paths (all within AI2-B's frozen allowlist and its reused AI2-A test path):

```text
apps/api/src/modules/assistant/assistant-history.routes.js
apps/api/src/modules/assistant/assistant-history.validation.js
apps/api/src/modules/assistant/assistant-history.controller.js
apps/api/src/modules/assistant/assistant-history.service.js
apps/api/src/modules/assistant/assistant-history.repository.js
apps/api/test/assistant-history-send.test.js (new)
apps/api/test/assistant-history-mongo.test.js
docs/milestones/MOBILE-AI2-private-assistant-history.md
```

Persistent Send uses the authenticated owner, strict new-content or retry-reference input, shared AI1 limiter instances, and one call through unchanged `assistant.service.chat`. The server builds and persists the newest bounded replay suffix; explicit retries use that saved snapshot and the same user row. Successful replies retain AI1's full normalized output; only historical replay applies the 4,000-unit Assistant bound. Versions advance for claim and terminal completion; reserved sequence slots preserve missing-reply gaps.

Claim, completion, failure, and abandoned-claim recovery use transactions and finish with an owned parent write carrying immutable expiry and Mongo `$$NOW`, plus version/request/fence predicates. Delete writes the same parent, so a losing completion rolls back its children and cannot recreate deleted records. Provider invocation sits outside transaction callbacks. The existing 20,000 ms provider deadline bounds claim recovery; live Open or Send recovers an abandoned claim to uncertain without redispatching its key. Expiry always takes precedence over recovery, cached results, conflicts and responses, including results whose commit acknowledgement crosses the deadline.

Same-key canonical conflicts, stale devices, active pending requests, known safe provider failures, unique-index losers and unknown commit acknowledgements are handled without automatic generation retries. Unknown claim acknowledgement never authorizes dispatch; unknown completion acknowledgement resolves only live durable state. Explicit retries can cause another external provider charge. Durable deduplication and fenced storage do not promise exactly-once provider execution or billing.

Validation ran on Windows PowerShell, Node `v24.12.0`, with existing installed dependencies supplied through `NODE_PATH` (no installation):

```powershell
$env:NODE_PATH='C:\Users\Clein\OneDrive\Documents\Projects\wecooked\node_modules;C:\Users\Clein\OneDrive\Documents\Projects\wecooked\apps\api\node_modules'
Remove-Item Env:AI2_HISTORY_MONGO_QA -ErrorAction SilentlyContinue
Remove-Item Env:AI2_HISTORY_TTL_QA -ErrorAction SilentlyContinue
node --test apps/api/test/assistant-history-send.test.js apps/api/test/assistant-history-validation.test.js apps/api/test/assistant-history-routes.test.js apps/api/test/assistant-history-service.test.js apps/api/test/assistant-history-repository.test.js apps/api/test/assistant-history-models.test.js apps/api/test/assistant-history-mongo.test.js apps/api/test/assistant-routes.test.js apps/api/test/assistant-validation.test.js apps/api/test/assistant-service.test.js apps/api/test/assistant-provider.test.js apps/api/test/rate-limiter.test.js apps/api/test/authenticate-middleware.test.js
```

- Final combined gate: exit **0**, **133 tests: 131 pass, 0 fail, 2 skipped**. Both skips explicitly identify isolated replica-set evidence as NOT RUN. The new Send suite independently passed **42/42**, exit 0.
- Coverage includes strict send/retry validation; server replay count/length and failed-user context; durable replay/conflict; competing sends; known failure and exact-snapshot retry; Delete during generation; transaction callback replay/rollback; unknown claim/completion acknowledgement; abandoned claim and late fenced completion; immutable expiry before dispatch, during provider execution, at final database writes, after commit and before response; authenticated mounted routes/no-store; shared 10/11 user and 20/21 IP counters.
- Unchanged AI1 stateless dependency-graph, provider/service/validation/routes, authentication, and limiter regression suites passed. Existing history CRUD, cursor, serialization and three independent TTL declaration tests also passed.
- Initial sandboxed Node test workers failed with `spawn EPERM`; identical authorized execution outside the sandbox recovered the environment. No test result from that failed worker launch is counted as a behavioral failure or pass.
- SHA-256 comparison: **268 protected files** matched the clean AI2-1 worktree, including all tracked Mobile files, AI1 core/tests, auth/limiter middleware, `app.js` and `v1.routes.js`. Tracked and new-file whitespace checks passed. Exact changed/untracked paths were checked against the frozen allowlist; index remains empty.

The opt-in Mongo generation suite was extended for real unique indexes, claims, retry, rollback, lost completion acknowledgement, Delete fencing and expiry rollback, using only the existing guarded disposable loopback replica-set target and mocked provider. It was **NOT RUN**. The mocked transaction double does not prove Mongo isolation, transaction conflict behavior, indexes, physical TTL cleanup or clock alignment. Independent source review, isolated Mongo/index/TTL/clock proof, runtime/mobile/device/provider/privacy/backup and deployment gates remain **NOT RUN / NOT CLAIMED AS PASS**. No unresolved provider retry, budget or API contract decision blocked this isolated implementation.

## AI2-3 mobile implementation handoff

Date: 2026-10-15 (Asia/Singapore). **READY FOR SOURCE REVIEW.** Independent source review remains pending; this is implementation and focused Jest evidence.

- Isolated worktree: `C:\Users\Clein\OneDrive\Documents\Projects\wecooked-mobile-ai2-mobile-slice3`.
- Branch: `mobile-ai2-mobile-slice3`; unchanged committed base/HEAD: `afc89b80f1c54b8cc144e85ef3cf89dfb30795aa`, from `feat/mobile-ui-final1-consolidated-2026-10-14`. The committed consolidated Assistant baseline passed its four existing suites, 52 tests, exit 0 before editing. The consolidated worktree's five unrelated dirty paths were preserved and excluded from this isolated checkout.
- Read the frozen contract and actual AI2-2 commit `b4ab3a854170b6e86f3c605a557d8fdfe03c52ba`, including routes, controller, service and generation tests. The earlier AI2-2 handoff above describes its pre-commit state; the referenced commit is now present. No API source was integrated or changed in this mobile worktree.
- Changes remain unstaged and uncommitted. No package/config/auth/client/navigation edit, real provider call, database action, push, merge or deployment occurred.

Exact changed paths, within the frozen AI2-C allowlist and shared documentation path:

```text
apps/mobile/src/screens/AssistantScreen.js
apps/mobile/src/screens/assistantHistoryState.js
apps/mobile/src/api/assistantHistoryService.js
apps/mobile/src/components/AssistantHistoryPanel.js
apps/mobile/__tests__/assistantHistoryService.test.js
apps/mobile/__tests__/assistantHistoryState.test.js
apps/mobile/__tests__/assistantHistoryInteraction.test.js
apps/mobile/__tests__/assistantScreenStaticAudit.test.js
docs/milestones/MOBILE-AI2-private-assistant-history.md
```

History, date-labelled Open, persisted New Chat and confirmed Delete are additive to the existing Ask the Chef route, message bubbles, quick prompts, composer and Clear control. Entry remains blank. Clear only resets the draft; New persists an empty conversation and leaves older saved work intact. List/Open restore server history after remount. Older messages prepend and deduplicate by ID; list order follows immutable creation order. Mutations refresh list page one. Loading, empty, safe error, retry and pagination states use real API outcomes.

Send uses only `/assistant/conversations/:id/messages`, with content or a failed server message reference, expected version and an attempt UUID from the already installed `expo-crypto`. The shared authenticated client continues to own token refresh/retry. The existing stateless service export and three helper regression suites are unchanged. There is no `/chat` fallback, provider access or device transcript storage. A synchronous guard coalesces double submit and New/create actions, retains create identity on retry, and keeps one optimistic user bubble until server reconciliation.

User-requested transport replay retains the exact attempt key/body. Known API failures and ambiguous/conflicting outcomes require explicit Open to inspect saved state and obtain its version. Only a final failed user turn offers an explicit retry with a fresh key and `retryOf`; restored pending turns remain blocked pending another explicit Open, while uncertain turns never receive automatic generation retries. Clear, New, navigation blur, unmount, changed selection, logout, direct owner change and same-owner session replacement invalidate old UI work. All five operation families guard stale completions and failures; list requests also have independent response ordering guards.

The immutable server expiry drives visible-content and retry invalidation, including pending replies and background/resume. Open revalidates on foreground. Opaque not-found clears the active transcript and refreshes List, without creating, resending or restoring local content. These client presentation guards do not establish trusted clock alignment or replace server enforcement.

Validation ran in Windows PowerShell, Node `v24.12.0`, with existing sibling dependencies through `NODE_PATH`: Jest `29.7.0`, React/test renderer `19.2.3`, React Native `0.86.3`, Babel preset Expo `57.0.10`, Expo Crypto `57.0.2`. No dependency installation or manifest/lockfile mutation. From the isolated worktree's `apps/mobile` directory:

```powershell
$env:NODE_PATH='C:\Users\Clein\OneDrive\Documents\Projects\wecooked\apps\mobile\node_modules;C:\Users\Clein\OneDrive\Documents\Projects\wecooked\node_modules'
$tests=@('assistantHistoryService.test.js','assistantHistoryState.test.js','assistantHistoryInteraction.test.js','assistantScreenStaticAudit.test.js','assistantService.test.js','assistantErrors.test.js','assistantState.test.js')
$paths=@($tests | ForEach-Object { Join-Path '__tests__' $_ })
foreach ($testPath in $paths) {
  if (-not (Test-Path -LiteralPath $testPath)) { throw "Missing test: $testPath" }
}
node C:/Users/Clein/OneDrive/Documents/Projects/wecooked/apps/mobile/node_modules/jest/bin/jest.js --config ./jest.config.js --runTestsByPath @paths --runInBand --watchman=false --silent --testTimeout=30000
```

- Final gate: exit **0**, **7 suites passed; 119 tests passed, 0 failed, 0 skipped**. Jest transformed the changed production/test JavaScript and JSX. No missing required test file.
- Coverage includes CRUD restoration, loading/empty/safe errors, cursor pagination/prepend/deduplication, out-of-order List/Open, duplicate submit/New, blank and bounded initial prompts, exact transport replay including explicit-retry replay, known failure by `retryOf`, timeout/conflict/uncertain/pending reconciliation, Delete failure/confirmation and pending reply fencing, Clear/New during unresolved creates/sends, navigation/unmount, direct account switch, every operation family across same-owner session replacement and logout, exact expiry boundary, background clock advance, opaque 404 and late pending outcomes.
- Expanded source scan covers all seven Assistant production files and rejects direct provider access, credentials, mocked fallback and device persistence. Legacy stateless service/helper regression checks remain passing.
- All **786 protected tracked files** matched their committed base Git blob hashes (Git checkout line-ending normalization applied), including every API file, AI1 helper/auth/client/navigation code, package/configuration paths and unrelated UI. The two changed existing files are excluded from that protected count. Exactly nine modified/new paths match the allowlist. Index empty; tracked diff and all new/changed file whitespace checks passed.

No full mobile integration rerun was performed for this isolated slice. Independent source review, integrated API/mobile runtime across restart/sign-in, Mongo/index/TTL/clock proof, Android/iOS presentation and accessibility, deployed authentication, provider, privacy/backup and deployment acceptance are **NOT RUN / NOT CLAIMED AS PASS**. The worktree intentionally contains the consolidated backend base; integrated runtime must use the approved AI2-1/AI2-2 API implementation. No source implementation blocker remains within the authorized AI2-3 scope.

### AI2-3 P1-only Delete/reopen repair

Date: 2026-10-15 (Asia/Singapore). **READY FOR RE-REVIEW.** This repairs only the source-review Delete/reopen finding in the existing isolated worktree, branch and nine-path allowlist. HEAD remains `afc89b80f1c54b8cc144e85ef3cf89dfb30795aa`; no commit, push, merge or deployment.

Only these three paths were edited for this repair:

```text
apps/mobile/src/screens/assistantHistoryState.js
apps/mobile/__tests__/assistantHistoryInteraction.test.js
docs/milestones/MOBILE-AI2-private-assistant-history.md
```

The former Delete completion used the selection epoch, so reopening A invalidated the earlier Delete A result and left deleted content active. Delete now has its own session-bound operation identity, retained across selection resets and still rejected after session replacement or unmount. Selection tracks the target of an unresolved Open as well as the loaded conversation. Confirmed deletion invalidates a matching loaded or loading selection, clears its transcript/input/retry state, and disables Send until explicit Clear or New. Unrelated active B remains intact. Delete failure preserves reopened content and retry eligibility.

Confirmed deleted IDs remain guarded in memory for the current mounted session. They are excluded from History responses and cannot be reopened through stale controls or accepted from late Open/Send responses. Successful Delete refreshes History page one. This changes no API, provider behavior, auth/client code, device storage or backend enforcement.

Actual validation on Windows PowerShell, Node `v24.12.0`, using the same installed sibling dependencies and seven-suite command recorded above:

- Before the production fix, the new mounted `Open A -> Delete A -> reopen A -> Delete succeeds` regression failed because the reopened failed user turn remained visible: exit 1, one selected failure, 42 tests excluded by the focused name filter.
- After the fix, the full mounted interaction suite passed: exit **0**, **49 tests passed**, none failed or skipped. Seven added cases cover the reported race, late Open success/failure, late Send success/failure, selecting unrelated B, and Delete failure after reopening.
- Final combined AI2/AI1 gate: exit **0**, **7 suites / 126 tests passed, 0 failed, 0 skipped**. This includes the existing mounted/static Assistant suite and unchanged legacy `assistantService`, `assistantErrors`, and `assistantState` regression suites.
- SHA-256 comparison confirms the other six slice files are unchanged from the start of this repair. All **786 protected tracked files** still match the committed base Git blob hashes. The overall slice remains exactly nine allowed modified/new paths; index empty. Tracked and new-file whitespace checks pass.

Independent findings-only re-review is pending. Integrated API/device/runtime and release gates remain **NOT RUN / NOT CLAIMED AS PASS**. No backend edit, provider call, dependency change or publication occurred.
