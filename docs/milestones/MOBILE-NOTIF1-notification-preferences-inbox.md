# MOBILE-NOTIF1 — Server-Authoritative Notification Preferences and In-App Inbox

**Phase:** CODE FINALIZATION

**Status:** IMPLEMENTATION COMPLETE — CLOSURE PASS — PRE-MERGE BLOCKED

**Baseline:** `main @ 605e51b87afadfa6f8fa650b769b5e8edb23b6c5`

**Roadmap authority:** `docs/milestones/MOBILE-PARITY-AUDIT2-final-product-parity-audit.md`

**Verdict:** `MOBILE-NOTIF1 CODE FINALIZED — PR MAY OPEN — MERGE BLOCKED BY DEV DB ALIGNMENT`

The frozen MOBILE-NOTIF1 implementation is complete, all independent-review findings are fixed, and closure is PASS. The implementation preserves the existing `Route → authentication/validation → controller → service → repository → Mongoose → MongoDB` boundaries and remains inside the exact allowlists below.

## 1. Milestone path

`docs/milestones/MOBILE-NOTIF1-notification-preferences-inbox.md`

## 2. Frozen architecture

- Add one dedicated first-class `Notification` collection. MongoDB is authoritative for inbox membership, ordering, content, read/archive state, expiry, and counts.
- Keep notification preferences embedded at `User.preferences.notifications`; do not create a second preferences collection.
- Add one authenticated `NotificationsContext` beneath `AuthProvider`. It owns the current account's preferences, inbox pages, unread count, request ownership, and mutations.
- The context and API service are the only mobile notification data path. `TopBar`, the dropdown, and `NotificationsScreen` consume that context rather than keeping independent notification state.
- Do not persist inbox rows, unread state, archive state, or preferences in `AsyncStorage` or any other device store.
- Do not seed, fabricate, or optimistically create inbox rows. An account with no server rows sees the frozen empty state.
- MOBILE-NOTIF1 creates no public/client notification-create endpoint and no product event producers. Server-side writers added by later milestones must use the frozen repository/service boundary.
- No `expo-notifications`, OS permission request, device-token model, token registration, native configuration, push provider, delivery job, or scheduler is in scope.

## 3. Model/index contract

### Notification document

The dedicated `Notification` model has exactly these application fields:

```js
{
  recipientId: ObjectId<User>,       // required; server-owned
  type: String,                      // required; server-owned, frozen enum
  eventKey: String,                  // required; server-owned idempotency key
  content: {
    title: String,                   // required, trimmed, 1..120
    body: String                     // required, trimmed, 1..500
  },
  action:                            // required safe discriminator
    { kind: 'none' }
    | { kind: 'recipe', recipeId: ObjectId<Recipe> }
    | { kind: 'communityPost', postId: ObjectId<CommunityPost> }
    | { kind: 'mealPlan', entryId: ObjectId<MealPlanEntry> },
  readAt: Date | null,               // default null; server-owned
  archivedAt: Date | null,           // default null; server-owned
  expiresAt: Date                    // required; createdAt + 90 days
}
```

- Use `timestamps: { createdAt: true, updatedAt: false }`. There is no mutable `updatedAt`, actor snapshot, arbitrary URL, route name, raw navigation payload, HTML, image, delivery state, push token, or client-owned field.
- `type` is exactly one of `savedRecipe`, `cookCompleted`, `collectionCreated`, `cookReminder`, `communityLike`, `communityComment`, or `communityFollow`. These values reserve the audited domain contract; MOBILE-NOTIF1 does not produce them.
- `eventKey` is an opaque server-generated value, 1 through 200 characters. It is never accepted from or returned to the mobile client.
- `action` is a strict discriminated union. Each variant accepts only its named key(s); `none` accepts no target. No arbitrary screen, URL, nested payload, or client-selected action is legal.
- A read is represented only by `readAt`; an archive only by `archivedAt`. Boolean mirrors such as `read`, `isRead`, `archived`, or `isArchived` are forbidden.
- Set `expiresAt` when the row is created to exactly 90 days after `createdAt`. Reads and archives do not extend retention.

The exact physical indexes are:

```js
{ recipientId: 1, archivedAt: 1, createdAt: -1, _id: -1 }
// name: notification_inbox_page

{ recipientId: 1, archivedAt: 1, readAt: 1 }
// name: notification_unread_count

{ recipientId: 1, eventKey: 1 }
// name: uniq_notification_recipient_event; unique: true

{ expiresAt: 1 }
// name: notification_expiry_ttl; expireAfterSeconds: 0
```

- Key order, names, uniqueness, and TTL options are contract, not suggestions.
- The list and count paths must use these indexes; there is no unbounded client-side filtering or per-row follow-up query.
- The migration is the sole creator of the four production indexes. The schema must not create competing auto-named definitions. Startup performs read-only exact verification and refuses to start if a required index is missing or drifted.

### Exact serializer allowlist

Every inbox row returned to mobile is exactly:

```js
{
  id,
  type,
  content: { title, body },
  action,
  createdAt,
  readAt
}
```

- `action` is serialized field-by-field according to its discriminator and its ObjectId is converted to a string.
- Never serialize `recipientId`, `eventKey`, `archivedAt`, `expiresAt`, `updatedAt`, `__v`, raw Mongoose documents, delivery metadata, actor/private User data, or any extra database field.
- Archived rows are absent from list responses rather than exposed with an archive flag.

## 4. Inbox API contract

All endpoints are mounted under `/api/v1/notifications`, require an authenticated active account, derive the sole owner from `req.auth.userId`, and set `Cache-Control: no-store` on successes and errors. Authentication runs before resource/anchor validation.

### `GET /api/v1/notifications?limit=20&cursor=<opaque>`

- Strict query only: optional `limit` and optional `cursor`; body must be empty.
- `limit` is an integer from 1 through 50 and defaults to `20`.
- Return only unarchived rows owned by the authenticated account, newest first by `{ createdAt: -1, _id: -1 }`.
- Success:

```js
{
  success: true,
  data: {
    notifications: [/* exact serializer rows */],
    unreadCount: 3,
    pageInfo: {
      nextCursor: '<opaque>' | null,
      hasMore: true
    }
  }
}
```

- `unreadCount` is an exact fresh count of all unarchived unread rows for the owner, not merely the current page and not a cached/client-derived value.
- `nextCursor` exists only when `hasMore` is true and encodes the last returned row's exact `createdAt/_id` tuple. It is opaque to the client.

### `PATCH /api/v1/notifications/:notificationId/read`

- Strict valid ObjectId path; empty query and empty body only.
- Atomically set `readAt` to the server time only when the authenticated owner has the unarchived row and `readAt` is null.
- Repeated requests are idempotent and preserve the original `readAt`.
- Success:

```js
{
  success: true,
  data: {
    notification: {/* exact serializer row */},
    unreadCount: 2
  }
}
```

- Missing, archived, expired, or other-owner ID: `404 NOTIFICATION_NOT_FOUND`. Malformed ID: `400 VALIDATION_ERROR`.

### `PATCH /api/v1/notifications/read-all`

- Strict empty query and exact body `{ throughNotificationId }`, where the value is a valid ObjectId.
- Resolve the anchor only as an unarchived row owned by `req.auth.userId`. A missing, archived, expired, or other-owner anchor returns `404 NOTIFICATION_NOT_FOUND` without mutation.
- Atomically set the server `readAt` on unread, unarchived owner rows at or older than the anchor tuple. Rows newer than the anchor remain untouched.
- Success:

```js
{
  success: true,
  data: { unreadCount: 0 }
}
```

- Repetition is idempotent. The returned count is an exact post-write count and therefore includes any newer concurrently-created unread rows.

### `POST /api/v1/notifications/archive-all`

- Strict empty query and exact body `{ throughNotificationId }`.
- Anchor ownership/not-found behavior matches read-all.
- Atomically set the server `archivedAt` on unarchived owner rows at or older than the anchor tuple. Rows newer than the anchor remain visible and unchanged.
- Success:

```js
{
  success: true,
  data: { unreadCount: 0 }
}
```

- Repetition is idempotent. The exact post-write unread count includes any newer concurrent rows.
- “Clear” in the UI means archive through the observed anchor; it never deletes rows immediately and never sends a client-computed ID list.

There is no `POST /notifications`, single-row archive, restore, delete, cross-user read, admin inbox, delivery-status, or actor endpoint in MOBILE-NOTIF1.

## 5. Preferences contract

The canonical stored preference leaves remain under `User.preferences.notifications`:

```js
{
  enabled: Boolean,      // legacy compatibility mirror of push
  push: Boolean,         // default true
  email: Boolean,        // default true
  suggestions: Boolean,  // default true
  digest: Boolean,       // default false
  reminders: Boolean     // default true
}
```

- The exact teammate defaults are `push: true`, `email: true`, `suggestions: true`, `digest: false`, and `reminders: true`.
- `enabled` remains a compatibility alias for `push`, not a sixth visible setting or a global delivery policy. New code reads canonical `push`; every write keeps `enabled === push`.
- `GET /users/me`, authentication responses, and successful self-profile mutations serialize notification preferences exactly as:

```js
{
  enabled,
  push,
  email,
  suggestions,
  digest,
  reminders
}
```

- `PATCH /users/me` remains the mutation endpoint. `preferences.notifications` is strict and partial: it accepts one or more canonical Boolean leaves and rejects an empty object, unknown keys, non-Booleans, IDs, roles, timestamps, token fields, and operator keys.
- Legacy `{ enabled: boolean }` remains accepted. It writes both `enabled` and `push` to that Boolean. A payload containing both `enabled` and `push` is accepted only when they are equal; contradiction is `400 VALIDATION_ERROR`.
- A canonical `push` write also writes the legacy `enabled` mirror. Other supplied leaves change only themselves. Omitted leaves remain unchanged.
- Preference responses are full authoritative public-user payloads. The mobile preference writer must reconcile only a response belonging to the same current account and the latest owned preference operation.
- These values are server preferences only in NOTIF1. `push` does not request native permission, register a token, or claim delivery capability; `email`, `suggestions`, `digest`, and `reminders` do not create producers, schedules, or email jobs.

## 6. Pagination/concurrency contract

- Pagination is keyset-only. Offset/page pagination, `skip`, client sorting, and timestamp-only cursors are forbidden.
- A cursor is an opaque, versioned, base64url value authenticated/validated by the server and carrying the exact `createdAt/_id` tuple. Malformed, extra, wrong-version, or noncanonical cursors return `400 VALIDATION_ERROR`.
- The continuation predicate for descending order is strictly older than the tuple: `createdAt < cursor.createdAt` or equal `createdAt` with `_id < cursor._id`.
- Fetch `limit + 1` to derive `hasMore`; never duplicate the sentinel in results.
- Every list response carries a fresh exact owner-wide unread count. Every mutation returns a fresh exact post-mutation unread count.
- Read-all and archive-all anchor to the newest row the current UI actually observed. The server resolves the anchor tuple; it never trusts a client timestamp.
- Same-timestamp tie handling uses `_id`, so rows through the observed anchor are affected exactly once while newer rows remain unaffected.
- New rows created after the observed anchor remain unread/unarchived and visible on refresh. Their existence may make a mutation response's `unreadCount` nonzero.
- The mobile context owns reads by authenticated account ID, mounted generation, list generation, and exact operation token. A response may update state only while all owners still match.
- Page one replaces state; a continuation may append only to the exact page chain that produced its cursor. Duplicate IDs are rejected as malformed/unavailable rather than silently merged.
- A confirmed single-read, read-all, archive-all, or preference mutation increments the relevant mutation version. Any older list response cannot restore stale rows, read state, archived membership, cursor state, or unread count.
- If an otherwise-owned page-one read was invalidated by a confirmed mutation, the context must start a fresh owned page-one read rather than leave loading or pagination stranded.
- Mutations are pessimistic and single-flight for their scope. Read-one operations are tokenized per notification ID; read-all and archive-all are mutually exclusive inbox-wide operations; preference writes are serialized/tokenized per account.
- A later preference intent wins. An older success or failure cannot overwrite the current switch values, clear a newer token, or display a stale error.
- Account change or logout invalidates every old-owner list cursor, continuation, retry, mutation, timer, and alert; clears inbox state synchronously; and fetches only for the new authenticated owner. An old-owner response is inert even if IDs match rows in the new account.
- Unmounted continuations perform no state update, navigation, alert, refetch, or cleanup belonging to a newer operation.

## 7. Mobile contract

- Add `notificationService` with strict response parsing for all four inbox endpoints. Malformed 2xx data is unavailable, never empty inbox, zero unread, or mutation success.
- Add one authenticated `NotificationsContext` and `useNotifications`. It exposes authoritative preferences, rows, unread count, initial/refresh/continuation states, `markRead`, `markAllRead`, `archiveAll`, `setPreference`, and retry actions.
- Mount `NotificationsProvider` once inside `AuthProvider` and outside authenticated consumers. Do not add a second provider per screen or navigator.
- Replace `TopBar`'s unavailable placeholder with the real dropdown. The bell dot is shown exactly when authoritative `unreadCount > 0`; its accessible label reports the exact unread count.
- The dropdown header is `Notifications`, with `Clear`, `Settings`, and accessible close actions. `Settings` closes the dropdown and navigates to `Notifications`.
- Empty state is exactly: `You're all caught up. Real activity — saves, cooked dishes, cook reminders — will show up here.` This copy describes later producers; it does not seed them.
- Each row shows allowlisted title, body, relative server timestamp, and unread dot. Rendering never interprets HTML or arbitrary links.
- Opening the dropdown may mark observed rows read only after a page has loaded and only through that page's newest observed row. The delayed action/timer is generation- and account-owned and is cancelled on close, account change, or unmount.
- `Clear` archives only through the newest currently observed row, then reconciles from the authoritative response and guarded page-one reload. No observed row means the action is absent/disabled.
- A supported action closes the dropdown and navigates through a fixed local discriminator switch. A missing/unavailable target fails safely; arbitrary route names/URLs are never executed.
- `NotificationsScreen` renders exactly the five teammate settings, in order and with these labels/subtitles/defaults:

  1. `Push Notifications` — `Alerts on this device` — `true`
  2. `Email Alerts` — `Summaries and receipts` — `true`
  3. `Recipe Suggestions` — `New picks based on what you cook` — `true`
  4. `Weekly Digest` — `Top recipes every Sunday` — `false`
  5. `Cooking Reminders` — `Nudges to try something new` — `true`

- The screen subtitle is exactly `Choose what WeCooked can notify you about.` Switches are pessimistic, disabled only for the owned leaf/in-flight serialization boundary, and driven by authoritative context state.
- Preserve theme, keyboard/screen-reader behavior, minimum touch targets, close/back behavior, focus order, and accessible selected/busy/error states. Loading, unavailable/retry, empty, populated, and pagination states must be distinguishable.
- Remove the obsolete single `Allow notifications` presentation. Do not import `notificationSettings` or notification feed rows from mock data.

## 8. Security/privacy contract

- `req.auth.userId` is the only recipient/owner authority. Ignore nothing silently: strict schemas reject client recipient, actor, event key, type, content, action, timestamps, read/archive state, expiry, role, and delivery fields.
- Other-owner, missing, archived, and expired notification IDs/anchors share `404 NOTIFICATION_NOT_FOUND`; do not reveal row existence or ownership.
- Admin and moderator roles receive no cross-user inbox, preference override, or inspection endpoint.
- Notification rows and preference values are private account data. They never appear in public-author, Community, admin-user-summary, analytics, logs, error details, or cacheable responses.
- Do not log titles, bodies, action targets, recipient IDs, cursor payloads, or full request/response bodies. Operational logs may use bounded error codes and aggregate counts only.
- No arbitrary URLs, route names, JSX, HTML, markdown execution, or server-provided navigation objects cross the action boundary.
- Cursor validation must not disclose decoded internals. Database/index/duplicate-key details never cross the API boundary.
- All endpoints use the existing authentication/session protections and rate-limiting conventions. No auth shortcut, client-selected owner, or local-login fallback is permitted.
- `Cache-Control: no-store` is mandatory for every notifications response, including 304-ineligible and error paths. Do not add ETags or shared caching.
- TTL deletion is retention cleanup, not immediate business behavior. APIs must already exclude logically expired rows (`expiresAt <= now`) so MongoDB TTL monitor delay cannot expose stale private data.

## 9. Migration contract

- Add `migrate-notifications-v1`; it defaults to dry-run and applies only with the exact explicit apply flag and approved environment/database binding.
- The migration handles only `User.preferences.notifications` normalization and creation/verification of the four Notification indexes. It does not create Notification rows.
- Preflight scans the complete target User population and the complete Notification index catalogue before the first write.
- Canonical target preference state:
  - `push` is the existing Boolean `enabled` when present; otherwise `true`.
  - `enabled` is set to the same Boolean as `push`.
  - missing `email`, `suggestions`, and `reminders` become `true`.
  - missing `digest` becomes `false`.
  - already-canonical Boolean leaves are preserved.
- Preflight treats a non-object notification preference, any present non-Boolean canonical/legacy leaf, contradiction between present `enabled` and `push`, or any other malformed audited state as a blocker. Apply stops before every write and before index creation.
- Each User update uses `_id` plus exact observed notification-leaf existence/value predicates. A stale predicate is accepted only after an immediate reread proves the exact canonical target state; otherwise apply fails and reports partial state.
- Create indexes only after every preference write and final preference postcondition pass. Use the exact names, keys, order, uniqueness, and TTL option frozen above.
- Existing same-name or same-key indexes with drifted options are blockers; the migration never silently drops or rebuilds an index.
- Reread and verify the complete physical index catalogue after creation. Success requires exact preference postconditions and all four exact indexes.
- Reports distinguish dry-run/apply, scanned, canonical, candidates, malformed/blockers, matched, changed, conflicts, pending, and exact index state without emitting private preference documents.
- A second apply after success performs zero User writes, creates zero indexes, reports zero pending work, and succeeds.
- Do not execute the migration against production during MOBILE-NOTIF1. Production dry-run/apply remains an explicit release/`PROD-DB-ALIGN` concern.
- An isolated non-production database run is allowed and required for implementation closure. It must prove real observed-state behavior, exact physical indexes, TTL configuration, idempotent rerun, and concurrent inbox mutations.

## 10. Production allowlist

- `apps/api/src/modules/notifications/notification.model.js` — new
- `apps/api/src/modules/notifications/notification.validation.js` — new
- `apps/api/src/modules/notifications/notification.repository.js` — new
- `apps/api/src/modules/notifications/notification.serializer.js` — new
- `apps/api/src/modules/notifications/notification.service.js` — new
- `apps/api/src/modules/notifications/notification.controller.js` — new
- `apps/api/src/modules/notifications/notification.routes.js` — new
- `apps/api/src/modules/users/user.model.js`
- `apps/api/src/modules/users/user.validation.js`
- `apps/api/src/modules/users/user.repository.js`
- `apps/api/src/modules/users/user.service.js`
- `apps/api/src/modules/users/user.serializer.js`
- `apps/api/src/routes/v1.routes.js`
- `apps/api/src/config/required-indexes.js`
- `apps/api/scripts/migrate-notifications-v1.js` — new
- `apps/api/package.json`
- `apps/mobile/App.js`
- `apps/mobile/src/api/notificationService.js` — new
- `apps/mobile/src/context/NotificationsContext.js` — new
- `apps/mobile/src/components/NotificationsDropdown.js` — new
- `apps/mobile/src/components/TopBar.js`
- `apps/mobile/src/screens/ProfileScreen.js`
- `apps/mobile/src/screens/NotificationsScreen.js`

**Contract amendment (2026-10-04):** `ProfileScreen.js` was present in the authoritative read-only audit and was accidentally omitted during contract freeze. Restoring it is a correction of freeze drift, not scope expansion, and is required only for the frozen Profile notification bell, authoritative unread indicator, and dropdown behavior.

No other production file is permitted. In particular, do not change auth/session architecture, navigation routes, product-event modules, `mockData.js`, storage helpers, native/app configuration, dependencies, package lockfiles, Cook Mode, Meal Plan, Community, Saved/Collections, recipe/favorite producers, email providers, schedulers, or deployment files. Any required expansion must stop for a new audit decision.

## 11. Test allowlist

- `apps/api/test/notification-model.test.js` — new
- `apps/api/test/notification-repository.test.js` — new
- `apps/api/test/notification-routes.test.js` — new
- `apps/api/test/notification-migration.test.js` — new
- `apps/api/test/notification-mongo.test.js` — new isolated live-Mongo gate
- `apps/api/test/user-model.test.js`
- `apps/api/test/user-validation.test.js`
- `apps/api/test/user-service.test.js`
- `apps/api/test/user-routes.test.js`
- `apps/api/test/required-indexes.test.js`
- `apps/api/test/app.test.js`
- `apps/mobile/__tests__/notificationService.test.js` — new
- `apps/mobile/__tests__/notificationsContext.test.js` — new
- `apps/mobile/__tests__/notificationsInteraction.test.js` — new
- `apps/mobile/__tests__/notificationsStaticAudit.test.js` — new
- `apps/mobile/__tests__/pendingFeatureHonestyStaticAudit.test.js`

No fixture, snapshot, helper, configuration, or unrelated test file is implicitly allowed. If an implementation cannot be proven within this list, stop and request a contract amendment.

## 12. Verification gates

Backend/model/API:

- Exact fields, strict subdocuments, enum, limits, `createdAt`-only timestamps, 90-day `expiresAt`, and absence of forbidden fields.
- Exact four schema-independent migration-owned physical indexes, including order, names, uniqueness, and `expireAfterSeconds: 0`; startup verifier is read-only and fail-closed.
- Authentication before validation; exact owner derivation; strict path/query/body rejection; no client-create route; `Cache-Control: no-store` on every path.
- Exact serializer allowlist for every action variant and proof that recipient, event key, archive/expiry state, private User data, and unknown database fields cannot leak.
- Keyset boundary tests with equal timestamps, opaque malformed cursors, `limit + 1`, no gaps/duplicates, expiry exclusion, owner isolation, and exact fresh unread counts.
- Idempotent read, read-all, and archive-all; missing/archived/expired/other-owner opacity; newer concurrent rows unaffected; post-write count includes new unread rows.
- Query-count/request-observation proof that list serialization is bounded and does not issue per-row lookups.

Preferences/migration:

- Exact teammate defaults and full serializer shape; strict partial canonical PATCH; legacy-only alias; equal dual-key acceptance; contradictory dual-key rejection; omitted-leaf preservation.
- Concurrent preference requests proving stale responses cannot overwrite the newest intent or current account.
- Dry-run zero writes/index changes; full malformed preflight before writes; exact observed predicates; stale-conflict failure; already-canonical conflict acceptance only after reread; partial-failure reporting and safe resume.
- Final postconditions, exact index catalogue verification, and successful zero-change second apply.
- Explicit command/integration guard proving MOBILE-NOTIF1 does not run a production apply.

Mobile:

- Strict request paths/methods/bodies and rejection of missing, extra, mistyped, contradictory, duplicate-ID, malformed-action, malformed-pagination, and malformed-unread-count 2xx responses.
- Mounted loading, unavailable/retry, empty, populated, refresh, continuation, settings navigation, safe action dispatch, exact five settings, labels, subtitles, order, and accessibility.
- Exact authoritative unread dot/label and exact empty copy; no mock/seed/local persistence path.
- Pessimistic read/preferences/archive behavior, duplicate-tap suppression, independent per-row reads, inbox-wide operation exclusion, and failure preservation.
- Mutation-resistant races: removing any account, mounted-generation, list-generation, cursor-chain, mutation-version, operation-token, per-row token, or preference-intent guard must make the corresponding test visibly fail.
- Race payloads must be able to corrupt current rows, read flags, unread count, cursor, switch values, errors, or new-account state when a guard is removed; merely asserting that a callback ran is insufficient.
- Old-account same-ID responses, late page one, late continuation, stale mark-all, stale clear, delayed open timer, retry after account switch, and post-unmount success/failure are inert.

Runtime/physical gates:

- Focused API and mobile suites pass, followed by the relevant regression suites and `git diff --check`.
- Isolated non-production live Mongo proves physical indexes, TTL option, owner/event uniqueness, keyset equal-timestamp ordering, concurrent single-read/read-all/archive-all behavior, exact counts, migration apply, and idempotent rerun.
- Authenticated device/emulator runtime proves dropdown geometry, scrolling, relative times, settings switches, errors/retry, refresh/pagination, account switch, safe navigation, screen-reader labels/order, touch targets, light/dark theme, and no local persistence.
- No production database operation is a closure gate for this milestone. Production alignment remains deferred to release/`PROD-DB-ALIGN`.

Automated tests alone do not establish device accessibility or physical Mongo behavior. Do not report those gates passed unless they actually run in the named environment.

## 13. Deferred scope

- MOBILE-NOTIF2: `expo-notifications`, native configuration, permission lifecycle, denied/settings states, device tokens, token rotation/revocation, push provider, tap delivery, and invalid-token cleanup.
- MOBILE-MEAL4: reminder time specification, scheduling, reconciliation, local OS notifications, and meal-reminder producer behavior.
- MOBILE-NOTIF3: saved recipe, cooking completion, collection, Community like/comment/follow, security/account, or other event producers; enqueue/delivery jobs; retries; and observability.
- Any email delivery job, digest scheduler, suggestion engine, push semantics, or preference-driven producer behavior.
- New notification types/actions, arbitrary deep links, images/actor snapshots, admin tooling, inbox search/filtering, row deletion/restore, retention changes, or web notification UI.
- Seeded/demo/fake inbox rows, client-created rows, local timestamps/IDs, local unread counts, and AsyncStorage inbox/prefs.

## 14. Blockers

- Baseline: `main @ 605e51b87afadfa6f8fa650b769b5e8edb23b6c5`.
- Implementation is complete, independent-review findings are fixed, and closure is PASS.
- Focused mobile: **57/57 PASS**.
- Focused API: **247/247 PASS**.
- Migration: **10/10 PASS**.
- Isolated live Mongo: **1/1 PASS**, including physical index verification and exact anchored race evidence.
- TTL monitor expiry timing: **NOT RUN — NOT CLAIMED AS PASS**.
- Device/accessibility runtime: **NOT RUN — NOT CLAIMED AS PASS**.
- Pre-merge operational blocker: shared development database `wecooked-dev` currently lacks the required NOTIF1 indexes, and the frozen migration correctly refuses shared-development apply. The startup verifier must remain fail-closed; do not bypass migration safety, create Atlas indexes manually, mutate `wecooked-dev`, or mutate production in this phase.
- Pre-existing unrelated DISC5/ING2 work and untracked files remain outside this milestone and must remain untouched.
- The protected Cook Mode stash remains present and must not be inspected, applied, dropped, or modified.
- The milestone is not merged and must not be described as merged or fully complete until the development-database alignment blocker is resolved.

## 15. Verdict

**MOBILE-NOTIF1 CODE FINALIZED — PR MAY OPEN — MERGE BLOCKED BY DEV DB ALIGNMENT**
