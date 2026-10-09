# MOBILE-NOTIF2 — Native Push Foundation

**Phase:** CONTRACT FREEZE

**Audit:** COMPLETE

**Contract review:** APPROVED WITH SECURITY CLARIFICATIONS

**Contract:** FROZEN

**Status:** READY FOR IMPLEMENTATION

**Baseline:** `origin/main @ 11e788427166f5c2e7c5b456bef80b205639a61f`

**Roadmap authority:** `docs/milestones/MOBILE-PARITY-AUDIT2-final-product-parity-audit.md`

**Dependency authority:** `docs/milestones/MOBILE-NOTIF1-notification-preferences-inbox.md`

**Verdict:** `MOBILE-NOTIF2 CONTRACT FROZEN — READY FOR IMPLEMENTATION`

This milestone adds native/device push delivery infrastructure around the existing server-authoritative Notification inbox. It does not create Notification rows or product events. The backend remains authoritative for identity, session state, preference eligibility, notification existence/content/action, and navigation authorization.

## 1. Baseline

- Contract review used the clean detached worktree `wecooked-mobile-notif2-audit` after a fresh `git fetch origin main`.
- `HEAD`, `origin/main`, and their merge base were all `11e788427166f5c2e7c5b456bef80b205639a61f` on 2026-10-05.
- The primary `wecooked` checkout was deliberately not used because it contains unrelated tracked and untracked work on another branch.
- No production code, dependency, native configuration, database, index, EAS setting, credential, stash, stage, commit, or push was changed during contract freeze.

## 2. Existing auth/session authority

A stable server-side session identifier already exists. Contract freeze is not blocked.

Exact authority chain:

1. `apps/api/src/modules/sessions/session.model.js` creates a MongoDB `Session` document whose `_id` remains stable while its one-time refresh-token digest rotates.
2. `apps/api/src/shared/security/access-token.js` signs that Session `_id` into the short-lived access token as `sessionId`.
3. `apps/api/src/modules/auth/auth.service.js` signs the same `rotated.session._id` after refresh; refresh rotation does not create a parallel session identity.
4. `apps/api/src/middleware/authenticate.middleware.js` validates the signed claim, loads the active unexpired Session from MongoDB, proves that the Session user matches the token subject, reloads the active User, and exposes `req.auth.sessionId = String(session._id)` and `req.auth.userId = String(user._id)`.

Every PushInstallation write and every delivery-eligibility decision uses these existing values. The client never sends `recipientId`, `sessionId`, a user/owner identity, a role, or a replacement auth claim. No push-only session model or authority is permitted.

An installation is eligible for delivery only while its bound Session is still active, unrevoked, unexpired, and owned by its `recipientId`. Logout, logout-all, password reset/change, suspension, or natural session expiry therefore removes eligibility even if best-effort device cleanup has not completed.

## 3. Installation trust, transfer, logout, and relogin

### Device-held identity

The native client stores one strict versioned SecureStore record containing:

```js
{
  version: 1,
  installationId,       // canonical lowercase UUID, random and opaque
  bindingCredential,    // separate random 256-bit base64url secret
  bindingGeneration     // safe integer >= 1
}
```

- Generate `installationId` and `bindingCredential` independently with a cryptographically secure native random source.
- `installationId` is a locator, not authentication and not proof of device ownership.
- `bindingCredential` is never used as WeCooked account authentication. It proves continuity of this installation only, is sent only to the authenticated PUT/DELETE installation endpoints, is never logged/serialized by the server, and is persisted only in SecureStore.
- The server stores only a SHA-256 digest of `bindingCredential`, with `select: false`. It never returns the credential.
- A malformed/missing SecureStore record is unavailable, not a clean prior state. The client must not guess a generation or silently overwrite it. Recovery requires rotating the provider registration and creating a new installation identity.
- Inbox rows, notification content, preferences, unread count, actions, and Expo tokens are never stored in this record.

### Authorization and ordering

- A first registration is authorized by the current authenticated user/session plus a validated Expo token and the newly supplied high-entropy binding credential.
- Every update, unregister, or rebind of an existing `installationId` additionally requires the exact binding credential digest match.
- `bindingGeneration` orders operations for that already-authorized installation. It grants no authority. A larger number without the credential can never register, unregister, or transfer the installation.
- A provider token is private delivery material but is not account authentication and is not accepted by itself as proof of installation ownership.
- The active-token unique index prevents the same Expo token from being active in two installation documents. A collision is fail-closed and never transfers or clears the other record.

### Exact rebind semantics

- Same user and same session: a higher generation may rotate the token or platform state; same-generation/same-payload is idempotent.
- Same user with a new session, or a different current user: rebind requires current WeCooked authentication, the new server-derived `req.auth.sessionId`/`req.auth.userId`, the exact existing binding credential, a validated current Expo token, and a strictly higher generation. The server atomically replaces the binding. Neither `installationId`, token, nor generation alone is sufficient.
- A same-generation request whose server-derived user/session, platform, token, status, or canonical payload differs is contradictory and returns `409 PUSH_INSTALLATION_GENERATION_CONFLICT`.
- A lower generation returns `409 PUSH_INSTALLATION_STALE` and changes nothing.
- Missing/wrong credentials or an attempt to affect a foreign binding fail opaquely and reveal no owner/session/token details.
- If SecureStore continuity is lost, the client must call the native provider unregister operation, obtain a fresh provider token, create a new installation ID/credential pair, and register that pair. It may not reclaim the old record with ID or generation guesses.

### Logout/account switch

1. While the old access token is still available, increment and persist the generation, then issue the owner/session-scoped DELETE with the binding credential.
2. Continue the existing auth logout even if native/server push cleanup fails; push cleanup must not trap the user in an account.
3. Tear down listeners and best-effort unregister the native provider token locally. Never erase the installation ID, credential, or last generation merely because a network request failed.
4. Server delivery selection also checks the bound Session live, so a successfully revoked session is immediately ineligible even if the PushInstallation remains marked active.
5. On relogin, after the current account and session are established, granted permission plus `push=true` obtains the current Expo token, increments generation, and performs the credential-authenticated rebind.

All async completions and finalizers are guarded by mounted state, authenticated owner, auth-session generation, installation generation, and operation identity. An old-account completion cannot register, unregister, clear, navigate, or release a newer account's operation.

## 4. Secure-storage dependency

- `expo-secure-store` is already a direct mobile dependency at `~57.0.3` in `apps/mobile/package.json`, is locked in the root `package-lock.json`, and is configured by the existing `expo-secure-store` plugin.
- The existing auth token store already uses it for native refresh-token persistence at `apps/mobile/src/api/tokenStore.js`.
- MOBILE-NOTIF2 reuses the installed package through a dedicated push-installation store. It does not put push state into `tokenStore`, AsyncStorage, localStorage, files, Expo `extra`, React state persistence, or a new storage dependency.
- `expo-notifications` and direct `expo-constants` usage are new NOTIF2 runtime dependencies and are explicitly allowlisted below. No other package change is permitted.
- Web keeps the installation record in no fallback store and reports native push as unsupported.

## 5. Scope and permission/preference contract

### Included only in MOBILE-NOTIF2

- `expo-notifications` native configuration and an Android general-notifications channel;
- native permission/capability lifecycle;
- secure installation identity and registration/unregistration;
- Expo push-token acquisition, refresh, rotation listener, and revocation handling;
- foreground receive and cold/warm response handling;
- safe notification-tap reconciliation through the existing owner-scoped Notification read mutation;
- an internal Expo Push Service adapter;
- strict ticket/receipt parsing and exact-token `DeviceNotRegistered` cleanup;
- PushInstallation indexes, migration, and read-only startup index verification;
- Android/iOS native runtime verification.

### Preference versus OS permission

- `push=false`: never request OS permission, never obtain/register a token, unregister an existing server binding immediately, tear down token registration, and exclude the user from server delivery selection immediately.
- `push=true`: evaluate actual OS state. Request permission only when the status is undetermined/requestable. Never repeatedly prompt a denied user.
- Granted: configure the Android channel where applicable, obtain the project-bound Expo token, and register/refresh it.
- Denied or non-requestable: show the true denied state and an accessible **Open device settings** action. Do not report registration success.
- Foreground return: re-read permission. Newly granted state registers/refreshes; revoked or no-longer-granted state unregisters.
- OS permission never changes the stored `push` preference. The server preference never fabricates OS permission.
- A preference mutation remains server-authoritative through NOTIF1. Native reconciliation begins only after that mutation returns for the same still-current account; stale preference responses are inert.
- Web: `unsupported`. No permission prompt, token, registration request, SecureStore fallback, or success copy.
- Expo Go is not an acceptance environment for remote push. Use native development builds.

No local scheduling, background content fetch, badge-count authority, or exact-alarm permission is added. The iOS config-plugin option `enableBackgroundRemoteNotifications` remains false.

## 6. PushInstallation model and indexes

Create `PushInstallation` with `strict: 'throw'`, `autoIndex: false`, and normal `createdAt`/`updatedAt` timestamps.

Exact fields:

| Field | Contract |
| --- | --- |
| `installationId` | required canonical lowercase UUID string; immutable locator; never treated as authority |
| `bindingCredentialHash` | required 64-character lowercase SHA-256 hex digest; `select: false`; never serialized/logged |
| `recipientId` | required User ObjectId; always assigned from `req.auth.userId` |
| `sessionId` | required Session ObjectId; always assigned from `req.auth.sessionId` |
| `provider` | required immutable enum with the sole value `expo`; server assigned |
| `platform` | required enum `ios | android` |
| `expoPushToken` | required only while active; bounded validated Expo token; `select: false`; null after unregister; never serialized/logged |
| `bindingGeneration` | required non-negative safe integer; monotonic stale-operation order only |
| `status` | required enum `active | unregistered` |
| `unregisteredAt` | null while active; exact server time when unregistered |
| `createdAt`, `updatedAt` | server timestamps |

No recipient/session/provider/owner/role is accepted from the client. No device name, advertising ID, native APNs/FCM token, arbitrary metadata, route, URL, action, payload, notification content, last-seen IP, or user-agent is persisted.

Exact migration-owned indexes:

1. `uniq_push_installation_id`: `{ installationId: 1 }`, unique, non-sparse, no partial filter, no TTL.
2. `uniq_active_expo_push_token`: `{ provider: 1, expoPushToken: 1 }`, unique, non-sparse, partial filter exactly `{ status: 'active', expoPushToken: { $type: 'string' } }`, no TTL.
3. `push_installation_recipient_delivery`: `{ recipientId: 1, status: 1, sessionId: 1 }`, non-unique, non-sparse, no partial filter, no TTL.

Tombstones retain the credential digest, last generation, binding identity, and timestamps but clear `expoPushToken`. They have no TTL in NOTIF2 because deleting ordering state would permit an arbitrarily delayed lower-generation operation to recreate stale state. They are never delivery eligible or publicly listed.

## 7. Endpoint contract

Register these authenticated, `no-store`, rate-limited endpoints under the existing notifications router:

### `PUT /api/v1/notifications/push-installations/:installationId`

Strict path/body:

```js
{
  platform: 'ios' | 'android',
  expoPushToken: '<validated ExpoPushToken[...] or ExponentPushToken[...]>',
  bindingCredential: '<256-bit base64url secret>',
  bindingGeneration: <safe integer >= 1>
}
```

- Authentication runs before validation.
- Provider is fixed server-side to `expo`; it is not a request field.
- Owner and session come only from `req.auth.userId` and `req.auth.sessionId`.
- First creation hashes the credential and creates the active binding.
- Existing binding requires constant-time credential-digest verification before any generation or ownership mutation.
- Lower generation is stale; same-generation contradiction is a conflict; exact same-generation/same-payload/current-binding retry is idempotent; a valid higher generation atomically updates/rebinds.
- Token uniqueness conflicts fail closed as `409 PUSH_INSTALLATION_TOKEN_CONFLICT` without identifying the conflicting installation or account.
- Success returns only `{ installation: { installationId, provider, platform, bindingGeneration, status, createdAt, updatedAt } }`. It never returns token, credential/hash, recipient, session, or database metadata.

### `DELETE /api/v1/notifications/push-installations/:installationId`

Strict body:

```js
{
  bindingCredential: '<256-bit base64url secret>',
  bindingGeneration: <safe integer >= 1>
}
```

- Match the installation plus current `recipientId` and current `sessionId`; DELETE never performs cross-account or cross-session transfer.
- Verify the credential before mutation.
- A valid higher generation atomically sets `status='unregistered'`, clears the exact stored token, and sets `unregisteredAt`.
- Same-generation/already-unregistered is idempotent. Same-generation/active is contradictory. Lower generation is stale.
- Missing, foreign-user, foreign-session, or wrong-credential requests use one opaque not-found response. No administrative override exists.
- Success returns only `{ unregistered: true, bindingGeneration }`.

Strict validation rejects extra fields, arbitrary provider, owner/user/session IDs, role, token arrays, notification data, and unsafe generation values. Duplicate-key/database details never cross the API boundary.

## 8. Internal Expo adapter and payload

The adapter is an internal server module. There is no public send, test-send, arbitrary-payload, broadcast, token-list, receipt, or cleanup endpoint.

The adapter accepts only:

- one existing authoritative Notification document; and
- an already-selected bounded list of eligible PushInstallation targets for that Notification's recipient.

Before provider I/O, target selection rechecks the recipient's current canonical `preferences.notifications.push === true`, active User state, active matching Session ownership, installation `status='active'`, provider, and platform. It deduplicates exact destination tokens.

Provider message fields are exactly `to`, Notification-derived `title`, Notification-derived `body`, and this exact `data` object:

```js
{
  version: 1,
  kind: 'notification',
  notificationId
}
```

No URL, route, action, action target, user/owner/session/installation ID, arbitrary client/server payload, image, badge, category, or mutable metadata is sent. Notification title/body and ID come from the existing authoritative Notification; the PushInstallation never supplies content.

The adapter uses HTTPS directly from the server, batches at most 100 messages per send request, bounds input size, and sends the server-only Expo access token as `Authorization: Bearer ...`. It never exposes or logs that access token or destination tokens.

Ticket and receipt rules:

- Validate HTTP status, content type, exact top-level shape, item count/order, ticket/receipt status, IDs, and bounded provider error codes before treating anything as accepted.
- A request error, top-level provider error, malformed/partial response, missing item, unexpected item, or count mismatch fails closed. No target is silently called successful.
- Map each ticket to its input token by request order only after the entire response shape passes.
- Return receipt probes only as private in-process values pairing the provider receipt ID with the exact token. Do not persist or serialize them.
- Receipt lookup is an internal bounded method invoked explicitly by controlled verification or a later NOTIF3 worker. NOTIF2 adds no poller, timer, queue, scheduler, retry loop, or attempt collection.
- `DeviceNotRegistered` from either a valid ticket or a valid receipt may unregister only a row whose currently stored active token exactly equals the implicated token. A rotated replacement token cannot be cleared by an old ticket/receipt.
- Other provider failures produce bounded internal classifications. NOTIF2 does not retry them.

Expo project `@cleiinns-team/wecooked` / `2fd3ccda-ee13-4acb-9766-7f892c50fc09` was queried read-only during freeze: app-level and account-level Push Security were both disabled. The frozen project decision is to **require Push Security**. Before the first controlled push, an owner must enable it in EAS and provision `EXPO_PUSH_ACCESS_TOKEN` only in the API server environment. With the toggle required, absence of that secret makes the adapter unavailable; it must never fall back to unauthenticated sending. The dashboard change and secret provisioning are release/runtime work, not contract-freeze mutations.

Provider behavior follows the official Expo send/security and ticket/receipt contract: <https://docs.expo.dev/push-notifications/sending-notifications/>.

## 9. Tap, navigation, and foreground contract

Native response data is accepted only when it is an exact object with `version === 1`, `kind === 'notification'`, and one canonical Notification ObjectId. Extra/missing/mistyped fields are malformed.

Cold and warm handling uses one shared response consumer:

1. Capture response identity and deduplicate concurrent listener/last-response delivery with a single-flight consumed-response key.
2. Wait until auth restoration has completed, a current authenticated account exists, and the navigation container reports ready.
3. Call the existing `PATCH /api/v1/notifications/:notificationId/read` through `markNotificationRead`. That endpoint is owner-scoped and excludes archived/expired rows; its strict response returns the authoritative Notification including its safe action.
4. Recheck current account/auth generation and response operation identity after the request.
5. Navigate only through the existing `actionDestination` mapping from that returned Notification:
   - `recipe` → `RecipeDetail`, `{ recipeSource: 'api', recipeId }`;
   - `communityPost` → `MainTabs`, `{ screen: 'Community', params: { postId } }`;
   - `mealPlan` → `MealPlan`, `{ entryId }`;
   - `none` or unsupported/malformed action → no navigation.
6. Re-read the current last native response and clear it only if it is still the same processed response; never erase a newer response that arrived during reconciliation.

Foreign/old-account, missing, archived, expired, malformed, unsupported, network-failed, or stale responses do nothing. They never fall back to payload navigation or local inbox state. A response for an account that becomes current later is not retained for replay.

Foreground receive validates only enough to recognize the frozen payload, then triggers the existing guarded page-one `NotificationsContext.reload()`. It does not insert a row, append an off-page row into the cursor chain, increment unread count locally, mark read, or trust native title/body/action. The existing account/list/mutation guards decide whether the reload may commit.

Foreground presentation is allowed only for the current authenticated account while `push=true`; use banner/list presentation without local badge authority. Listener subscriptions and the notification handler are removed/neutralized on logout/unmount/account change.

## 10. Migration and index contract

Add `migrate-notifications-v2` for PushInstallation indexes only.

- Default mode is dry-run/read-only.
- Apply requires explicit `--apply` plus an approved non-production environment/database binding. Production apply is forbidden in NOTIF2.
- Preflight reads the complete PushInstallation index catalogue before any write.
- The migration creates only the three exact indexes in section 6. It performs no Notification, User, Session, PushInstallation, preference, token, or credential backfill and does not alter any NOTIF1 index.
- Same-name or same-key drift is a blocker; never drop/rebuild silently.
- Apply creates only missing exact indexes, rereads the physical catalogue, and requires exact key order, name, uniqueness, partial filter, absence of sparse/TTL options, and absence of conflicting same-key definitions.
- A second apply after success creates zero indexes and succeeds.
- Extend the existing startup verifier to read and verify the PushInstallation collection and all three exact indexes. Startup verification remains fail-closed and strictly read-only; it never invokes the migration or creates/repairs/drops indexes.
- Isolated non-production apply plus idempotent rerun is an implementation-closure gate. Production execution remains release-stage work.

## 11. Production allowlist

Backend existing files:

- `apps/api/.env.example`
- `apps/api/package.json`
- `apps/api/src/config/env.js`
- `apps/api/src/config/required-indexes.js`
- `apps/api/src/modules/notifications/notification.routes.js`
- `apps/api/src/modules/sessions/session.repository.js`
- `apps/api/src/modules/sessions/session.service.js`
- `apps/api/src/routes/v1.routes.js`

Backend new files:

- `apps/api/scripts/migrate-notifications-v2.js`
- `apps/api/src/modules/push-installations/push-installation.model.js`
- `apps/api/src/modules/push-installations/push-installation.validation.js`
- `apps/api/src/modules/push-installations/push-installation.repository.js`
- `apps/api/src/modules/push-installations/push-installation.serializer.js`
- `apps/api/src/modules/push-installations/push-installation.service.js`
- `apps/api/src/modules/push-installations/push-installation.controller.js`
- `apps/api/src/modules/push-installations/push-installation.routes.js`
- `apps/api/src/shared/push/expo-push.adapter.js`

Mobile existing files:

- `package-lock.json`
- `apps/mobile/package.json`
- `apps/mobile/app.json`
- `apps/mobile/app.config.js`
- `apps/mobile/App.js`
- `apps/mobile/src/context/AuthContext.js`
- `apps/mobile/src/components/NotificationsDropdown.js`
- `apps/mobile/src/navigation/RootNavigator.js`
- `apps/mobile/src/screens/NotificationsScreen.js`

Mobile new files/assets:

- `apps/mobile/google-services.json` — public Firebase client configuration only; never an FCM service-account private key
- `apps/mobile/assets/notification-icon.png` — Android 96x96 all-white transparent icon
- `apps/mobile/src/api/pushInstallationService.js`
- `apps/mobile/src/context/NativePushContext.js`
- `apps/mobile/src/navigation/navigationRef.js`
- `apps/mobile/src/navigation/notificationAction.js`
- `apps/mobile/src/notifications/nativePushLifecycle.js`
- `apps/mobile/src/notifications/pushInstallationStore.js`

External configuration actions are limited to enabling Expo Push Security for the named EAS project, adding the server-only Expo access token to the API environment, and provisioning matching Android FCM V1 and iOS APNs credentials through approved EAS/Firebase/Apple workflows. Private service-account/APNs/Expo secrets must not be committed.

No other production path is permitted. In particular, do not add or change Notification/User backfills, Notification indexes, public send endpoints, product producers, queues, workers, schedulers, delivery-attempt persistence, analytics, arbitrary deep links, local scheduling, reminder fields, Meal Plan/Cook Mode behavior, inbox local persistence, admin tooling, unrelated native modules, deployment files, or protected documentation. Any required expansion must stop for a contract amendment.

## 12. Test allowlist

Backend existing tests:

- `apps/api/test/app.test.js`
- `apps/api/test/env.test.js`
- `apps/api/test/required-indexes.test.js`
- `apps/api/test/session-repository.test.js`
- `apps/api/test/session-service.test.js`

Backend new tests:

- `apps/api/test/push-installation-model.test.js`
- `apps/api/test/push-installation-repository.test.js`
- `apps/api/test/push-installation-service.test.js`
- `apps/api/test/push-installation-routes.test.js`
- `apps/api/test/push-installation-migration.test.js`
- `apps/api/test/push-installation-mongo.test.js` — isolated live-Mongo gate
- `apps/api/test/expo-push-adapter.test.js`

Mobile existing tests/configuration:

- `apps/mobile/jest.config.js`
- `apps/mobile/test/mocks/expo-secure-store.js`
- `apps/mobile/__tests__/appConfig.test.js`
- `apps/mobile/__tests__/configPlugin.test.js`
- `apps/mobile/__tests__/navigationShellStaticAudit.test.js`
- `apps/mobile/__tests__/notificationService.test.js`
- `apps/mobile/__tests__/notificationsContext.test.js`
- `apps/mobile/__tests__/notificationsInteraction.test.js`
- `apps/mobile/__tests__/notificationsStaticAudit.test.js`

Mobile new tests/mocks:

- `apps/mobile/test/mocks/expo-constants.js`
- `apps/mobile/test/mocks/expo-notifications.js`
- `apps/mobile/__tests__/pushInstallationService.test.js`
- `apps/mobile/__tests__/pushInstallationStore.test.js`
- `apps/mobile/__tests__/nativePushLifecycle.test.js`
- `apps/mobile/__tests__/nativePushInteraction.test.js`
- `apps/mobile/__tests__/nativePushStaticAudit.test.js`

No fixture, snapshot, helper, test configuration, or unrelated test is implicitly allowed. Tests must never call the live Expo Push Service, request real device permission, mutate EAS configuration, expose credentials/tokens, or access a production database.

## 13. Verification and runtime requirements

Automated backend proof must cover:

- exact strict model fields/privacy and three exact migration-owned indexes;
- existing DB-verified auth/session derivation and active-session delivery gating;
- strict endpoint path/body, auth-before-validation, no client owner/session/provider, no public send route, and `no-store` responses;
- first bind, credential continuity, same-session update, same-user/new-session rebind, cross-user rebind, wrong/missing credential, lower generation, same-generation contradiction/idempotence, token collision, and opaque foreign DELETE;
- races with visibly corrupting lower/higher PUT/DELETE/rebind payloads; removing credential, owner, session, generation, or atomic predicates must fail a test;
- preference-off and revoked/expired/foreign Session exclusion at final target selection;
- request chunking/deduplication, authenticated provider header, exact data payload, strict tickets/receipts, malformed/count-mismatch fail-closed behavior, and exact-token-only invalidation after rotation;
- migration dry-run zero writes, drift blocker, exact apply, physical catalogue verification, idempotent rerun, and startup verifier read-only behavior.

Automated mobile proof must cover:

- strict SecureStore record validation, independent random ID/credential, monotonic persistence, no insecure fallback, malformed-record recovery, and write-failure honesty;
- exact permission state machine for false/true/undetermined/granted/denied/non-requestable/web, foreground recheck, settings action, and no preference/permission conflation;
- token acquisition with the exact EAS project ID, runtime token rotation, logout ordering, account switch/rebind, session expiry, and failed cleanup recovery;
- cold/warm response single-consumption, navigation-ready/auth-ready waits, exact payload validation, authoritative read-before-navigation, old-account and newer-response races, and guarded clear;
- foreground guarded page-one reload only, with no local insert/unread increment/cursor append;
- mutation-resistant mounted/account/auth-generation/installation-generation/operation-token/finalizer guards;
- native configuration/plugin, direct dependencies, Android channel/icon/google-services path, and no background scheduling/exact-alarm additions.

Required runtime gates, all **NOT RUN — NOT CLAIMED AS PASS** during contract freeze:

1. Android native development build with matching FCM V1 credentials.
2. iOS native development build with matching APNs credentials.
3. Permission grant, deny, non-requestable/settings-open, settings return, and foreground recheck on both platforms.
4. Initial token registration, runtime token rotation, revocation, server unregister, logout, logout-all, session expiry, relogin, and cross-account device switch.
5. Cold tap, warm/background tap, duplicate response, malformed/old-account/missing/archived/expired response, authoritative navigation, and foreground receipt.
6. Controlled non-production push using enabled Expo Push Security and a server-only access token.
7. Valid/malformed ticket and receipt handling plus a controlled `DeviceNotRegistered` exact-old-token cleanup after token rotation.
8. Isolated non-production Mongo index migration/apply/idempotent rerun and concurrent binding races.

Expo Go is not the remote-push acceptance environment. Jest, config evaluation, and static source checks cannot satisfy these gates. Official native setup authority: <https://docs.expo.dev/push-notifications/push-notifications-setup/> and <https://docs.expo.dev/push-notifications/fcm-credentials/>.

## 14. Deferred scope and blockers

Deferred to MOBILE-NOTIF3:

- product-event producers and Notification creation;
- enqueue/outbox, retry worker, delayed jobs, receipt polling scheduler;
- delivery-attempt persistence, provider analytics, operational dashboard, campaign/broadcast tooling;
- retry/backoff policy and persisted ticket-to-token correlation.

Deferred to MOBILE-MEAL4:

- reminder time fields/preferences beyond existing NOTIF1 booleans;
- local notification scheduling/cancellation/reconciliation;
- exact alarms, background scheduling, and scheduled meal/Cook reminders.

Current blockers: none for source implementation. Runtime/release prerequisites remain deliberately open:

- Expo Push Security is currently disabled and must be enabled before controlled sending.
- `EXPO_PUSH_ACCESS_TOKEN` is not currently configured in the inspected process and must be supplied server-side.
- Android Firebase client config/FCM V1 credentials and iOS APNs credentials were not inspected or provisioned during freeze.
- Native builds, devices, provider delivery, receipts, and live non-production Mongo verification were not run.

These are implementation/runtime/release gates, not unresolved auth or storage contract decisions. They must not be reported as passed until executed.

## 15. Engineering closure update

Closure status as of 2026-10-09:

- Android Firebase client configuration and matching FCM V1 credentials are configured; Expo Push Security is enabled, and server Authorization bearer-token validation passed. Private service-account, APNs, and Expo access secrets remain untracked.
- Android EAS development build / physical push runtime: **DEFERRED BY PROJECT DECISION — NOT PASSED — NOT CLAIMED AS PASS**. Remaining physical-device/runtime acceptance is consolidated into QA-RUNTIME1 after product milestones are complete.
- iOS/APNs provisioning/runtime: **DEFERRED BY PROJECT DECISION — NOT PASSED — NOT CLAIMED AS PASS**. Apple Developer credentials are unavailable.
- EAS CLI reported `expo-dev-client` unavailable during development-build setup. This is not declared a dependency defect: prior workspace resolution found `expo-dev-client@57.0.18`. Final declaration/build diagnosis is deferred to QA-RUNTIME1.

## 16. Milestone path

`docs/milestones/MOBILE-NOTIF2-native-push-foundation.md`

This file is the complete frozen contract. Implementation must remain within sections 11 and 12. If a new production path, dependency, schema field, index, endpoint, payload field, provider, credential flow, background process, or navigation mapping becomes necessary, stop and amend this contract before coding it.

## 16. Verdict

**MOBILE-NOTIF2 CONTRACT FROZEN — READY FOR IMPLEMENTATION**
