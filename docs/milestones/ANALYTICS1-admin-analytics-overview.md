# ANALYTICS1 — Admin Analytics & AI Overview

**Phase:** contract freeze after read-only source audit; application code unchanged. **Audit baseline:**
`41a8cfbc54e2794415acb6df60e073092b88df67` (the local `origin/main` ref and
the STAFF-AUDIT1 audit worktree HEAD on 2026-10-12). Remote freshness is
**unverified**: `git ls-remote origin refs/heads/main` could not connect through
the configured proxy. No live MongoDB, deployed API, or production data was read.
No repository or ancestor `AGENTS.md` was present in this checkout/environment;
the requested `/AGENTS.md` could not be applied. No earlier ANALYTICS1 or Admin
Insights milestone exists in this baseline; this is the single milestone authority.

## Audit verdict and scope

**AUDIT PASS for a constrained, server-authoritative descriptive analytics
contract.** The frozen first-slice contract is at the end of this document and
supersedes the audit-stage proposals and open decisions above it. Existing data can support current counts and
qualified trends. It cannot support reliable historical engagement, retention,
staff-action completeness, or forecasts. No dashboard number is supplied by
this document. Implementation requires its own review and runtime gates.

Relevant authority: `apps/admin/src/App.jsx`, `apps/admin/test/dashboard.test.js`,
`docs/architecture/admin-users-integration.md`, `docs/architecture/recipes.md`,
`docs/milestones/M27-moderator-content-operations-audit.md`, the Community
models/repositories/service, `docs/milestones/ACCOUNT2-account-settings-lifecycle.md`,
`docs/milestones/MOBILE-M27-teammate-frontend-adoption.md`, and the sibling
`STAFF-AUDIT1-system-activity-security-audit-logs.md` audit contract. Older architecture
documents describe retired Firestore or demo states; current source wins.

## Existing capability and important definitions

- Admin Overview currently reads `GET /users` three times (`all`, `active`,
  `suspended`, `limit: 1`) and `GET /recipes?status=all&sort=newest&page=1&limit=100`.
  It uses authoritative `pagination.total`, shows four latest recipe rows, and
  distinguishes loading, error, and real zero. `apps/admin/src/App.jsx` lines
  121-162, 293-346, 1814-1902 and `apps/admin/test/dashboard.test.js` cover
  this. There is no aggregate analytics endpoint, reporting-period control, or
  forecast UI. The old fabricated growth/activity charts are absent.
- The existing **Active users** card is exactly `User.status === 'active'`,
  across all roles. It is **not** daily/monthly active usage. `User.deactivatedAt`
  is a separate ACCOUNT2 access state, so this status-only count can include a
  deactivated account. Keep its label explicit until a product decision changes
  it. For ANALYTICS1, propose **eligible active accounts** as `status: 'active'`
  with `deactivatedAt` absent/null, all roles, as an *as-of-now* snapshot. Offer
  role breakdown only if approved; never silently mix all accounts with
  consumer-only accounts. `Session.lastUsedAt` updates on refresh rotation only,
  expires via TTL, and is not a complete login/request-activity record. No DAU,
  MAU, retention, or session-engagement claim follows from it.
- Admin authentication is server-authoritative. `monitoring.read` belongs to
  Admin, not Moderator (`shared/security/capabilities.js`). New analytics must
  use `authenticate`, `noStore`, and `requireCapability(monitoring.read)` on the
  API route. A hidden frontend tab alone is never an authorization boundary.
  STAFF-AUDIT1 identifies a privileged-read race after the initial DB-backed
  role read: demotion can commit before an in-flight query executes. Reuse its
  eventual fresh-authority fence, or amend this allowlist to implement and test
  an equivalent fence before exposing sensitive analytics.

## Metric-availability matrix

| Class | Metric and exact meaning | Source / availability limit |
| --- | --- | --- |
| A | Total accounts, status counts, role counts, and eligible active accounts **now** | `User` fields `role`, `status`, `deactivatedAt`; existing REST Overview already exposes total/status counts. Include staff explicitly or filter `role: user` with a separately named metric. |
| A | Registrations by UTC period among **currently retained** accounts | `User.createdAt`; no event stream or verified legacy coverage. Do not call this historical active users or retention. |
| A | Current recipe inventory by `draft`/`published` and active/archived | `Recipe.publicationStatus`, `isActive`; missing publication status is legacy-published compatibility (`recipe.visibility.js`). Report the legacy bucket separately and do not equate inventory with consumer-visible recipes: consumer usability also checks completeness and ingredient state. |
| A, qualified | New recipes by creation date; first publication by period only for rows with trustworthy `publishedAt` | `Recipe.createdAt`, `publishedAt`. Direct complete-create and explicit publish stamp it; legacy backfill can use `createdAt` as an approximation, so label backfilled/unknown dates, not true historical publish events. Archive/restore do not create publish events. |
| A | Current Community posts and retained-post creation cohorts | `CommunityPost.createdAt`. Owner deletion physically removes a post and its likes/comments/bookmarks; prior totals and deleted-post cohorts are unrecoverable. |
| A, qualified | Current likes, comments, bookmarks, follows; retained relationship creations by period | Separate Community relationship collections with `createdAt`. Unlike, unbookmark, unfollow, comment deletion, and post cascade deletion remove rows. These are surviving relationships, not all engagement actions or impressions. No popularity ranking is defined. |
| A | Current canonical ingredient inventory by active/archive and category | `Ingredient.isActive`, `category`, `createdAt`; legacy category values and alias semantics require explicit buckets. Recipe ingredient *uses* are a separate recipe-array count, not unique ingredients or shopping demand. |
| A | Pending moderator applications now and terminal application rows by decision date | `ModeratorApplication.status`, `createdAt`, `reviewedAt`; approval/rejection history may include compensation, so validate terminal-state semantics. This is an application queue, not a Community reports queue. |
| A, limited | Counts by existing four administrative audit event types and outcome, during retained audit-log coverage | `AuditLog` contains status changes, moderator approval/rejection/demotion only; recording is best-effort. No complete staff-operation, failure-rate, or moderation workload claim. |
| B | Staff/security action volumes, outcomes, actors, and audit coverage | STAFF-AUDIT1 proposes additive auth/account/session/community/catalog/staff/security events in the existing `AuditLog`; its persistence, throttling, integrity, and retention decisions remain open. Count only emitted, retained, unsampled events after activation and disclose coverage gaps. No backfill of imaginary events. |
| B | Staff moderation throughput or time-to-action | Requires STAFF-AUDIT1 start/decision event pairing **if** that milestone actually supplies it. Otherwise `ModeratorApplication.createdAt`/`reviewedAt` can measure only application decision latency, not Community moderation. |
| C | DAU/MAU, retention/churn, unique views, deleted-content history, conversion funnels, trending/rankings, or engagement forecasts | No complete immutable behavioral/event history or agreed denominator; current rows and rotating sessions cannot reconstruct it. |
| C | Recipe/user growth forecasts or AI-generated operational predictions | No verified longitudinal volume, stability, quality, holdout period, or error bounds. Remain absent or marked unavailable. |

`Review` ratings and `CookHistory` rows exist, but adding them to Admin Analytics
requires a named product metric, visibility/privacy review, and source coverage
audit; they are outside the first slice. No fake charts, placeholder values,
model scores, or customer-level rankings are acceptable.

## Audit-stage reporting proposal (superseded by frozen contract below)

Use MongoDB as the source of truth. Propose UTC calendar day/week/month buckets
and half-open `[from, to)` windows, with `asOf` generated by the server. Validate
ISO timestamps with offsets, `from < to`, bounded lookback/bucket count, fixed
enum filters, and a defined maximum response size. All periods and filters must
be shown in the UI; a default such as last 30 complete UTC days needs owner
approval. Return `0` only after a successful authoritative query; loading,
denied, error, and insufficient-history states remain distinct. Snapshot counts
and period counts have different meanings. A multi-query response needs one
documented `asOf` and consistency expectation; it is not a transactionally
frozen snapshot by default. Define whether later deletion changes past buckets.

Keep all queries server-side. Return aggregate counts and bucket labels only;
exclude user IDs, emails, names, captions, comments, authentication fields,
session/token data, dietary/allergy preferences, notification data, and raw
audit metadata. ACCOUNT2 explicitly excludes preference values from analytics.
Avoid tiny segmented cohorts or suppress them using an approved threshold;
do not add arbitrary drill-down or exports. Apply no-store response headers,
least-privilege capability checks, bounded query work, and safe generic errors.
Do not send account or content data to an AI provider.

## Audit-stage MongoDB feasibility notes (superseded by frozen gate below)

The source-declared indexes are optimized mainly for existing lists: posts have
`(createdAt, _id)`; recipes have `(isActive, publicationStatus, createdAt)` and
`(publicationStatus, isActive, updatedAt)` but no `publishedAt` index; ingredients
have `(isActive, category)`; moderator applications have `(status, createdAt,
_id)`; audit logs have `(createdAt, _id)`. Users have unique email and token
indexes, not `(status, deactivatedAt)` or `createdAt`. Community likes/bookmarks/
follows are keyed by relationship IDs, not global `createdAt`; comments have
`(postId, createdAt, _id)`. Source indexes do not prove physical DB indexes.

Start with bounded `$match` on eligible dates/status, then `$group` by UTC
bucket, and project only required counts. Avoid unbounded `$lookup`, full
collection transfer to Node, per-row joins, and regex search in aggregates.
Measure each proposed pipeline with `explain('executionStats')`, realistic
cardinality and periods, `totalDocsExamined`, execution time, memory/spill,
and concurrency in an authorized isolated Mongo target. Require a documented
latency/scan budget and add only measured indexes via a separate reviewed
schema/migration amendment. Until this gate passes, high-volume time-series
panels are blocked; no production DB was queried during this audit.

## AI and forecasting decision

Class A descriptive metrics are deterministic Mongo aggregations. Hadoop, an
LLM, provider credits, and a paid analytics API have no demonstrated technical
need. Forecasting needs an agreed target, sufficiently long and complete
history across seasonal cycles, documented missing/deletion bias, a naive
baseline, time-ordered train/validation/test splits, and measured error and
calibration against that baseline. No minimum sample count can be asserted
without seeing the live data and target. A later statistical model can be
evaluated locally before any external service is considered; no prediction is
authorized for the first slice.

## Audit-stage candidate allowlists (superseded by frozen allowlists below)

**Backend production, exact first-slice paths:**

```text
apps/api/src/routes/v1.routes.js
apps/api/src/modules/analytics/analytics.routes.js
apps/api/src/modules/analytics/analytics.validation.js
apps/api/src/modules/analytics/analytics.controller.js
apps/api/src/modules/analytics/analytics.service.js
apps/api/src/modules/analytics/analytics.repository.js
```

Read existing models from the analytics repository; do not widen their schemas,
change audit producers, or add an event pipeline in this slice. The first
slice is limited to Class A current snapshots and qualified retained-row
cohorts that pass the performance gate. Any needed model index or migration
file is a blocker requiring an explicit allowlist amendment, not an implied
permission to edit arbitrary model files.

**Frontend production, exact first-slice paths:**

```text
apps/admin/src/App.jsx
apps/admin/src/analyticsApi.js
apps/admin/src/AnalyticsOverview.jsx
apps/admin/src/styles/dashboard.css
```

Reuse the existing Admin Overview and admin navigation; do not expose metrics
to the Moderator workspace or mobile app. Preserve the existing authoritative
four-card semantics until the active-account naming decision is approved.

**Focused tests, exact first-slice paths:**

```text
apps/api/test/analytics-routes.test.js
apps/api/test/analytics-service.test.js
apps/api/test/analytics-repository.test.js
apps/admin/test/dashboard.test.js
apps/admin/test/analyticsOverview.test.js
```

Test denied/expired/consumer/moderator access, strict filters/windows,
zero-versus-error, role/deactivation semantics, legacy recipe buckets,
deleted-row limitations, no private fields, bounded queries, and UI states.
Synthetic tests prove logic, not Mongo execution plans or physical indexes.

**STAFF-AUDIT1 coordination:** its separate, untracked audit milestone was
available during this review at the same HEAD. It proposes changing the
existing AuditLog model/service/repository/route, auth/session and domain
producers, `authenticate`/`require-capability`, Admin Audit Logs viewer/API,
and their tests; its verdict is **AUDIT BLOCKED — DO NOT IMPLEMENT**. Comparing
its section 7/8 proposed path lists to the ANALYTICS1 first-slice lists above
finds **no exact same-file overlap**: STAFF-AUDIT1 does not list
`apps/api/src/routes/v1.routes.js`, `apps/admin/src/App.jsx`, or
`apps/admin/test/dashboard.test.js`. Those are ANALYTICS1-owned shared shell/
registration files, so still recheck an actual STAFF-AUDIT1 implementation
diff before integration. The semantic shared boundary is `monitoring.read`
and privileged-read freshness; ANALYTICS1 should reuse STAFF-AUDIT1's fence.
For Class B, `apps/api/src/modules/audit/audit-log.model.js`,
`audit-log.repository.js`, `audit.service.js`, and audit validation are **direct
future shared-file conflicts** if ANALYTICS1 expands them: STAFF-AUDIT1 owns
their proposed schema/event changes. Keep Class B out of the first slice and
consume only the finalized, measured event contract. STAFF-AUDIT1 expressly
excludes likes/bookmarks/follows and has no Community content-moderation queue,
so it cannot supply those missing metrics. Reconcile its accepted diff/baseline
before freezing either implementation. Existing `monitoring.read` can gate
analytics without editing the capability map.

## Audit-stage open decisions and release blockers (resolved or narrowed below)

1. Owner must decide all-roles versus consumer-only scope for user cards,
   whether to add eligible-active alongside the existing status-active label,
   period defaults, category/role filters, and suppression of small cohorts.
2. STAFF-AUDIT1 must resolve its blocked audit policy and privileged-read
   fence; no Class B panel may be inferred from a proposed schema or a
   best-effort event writer. If analytics ships first, the auth fence needs an
   explicit ANALYTICS1 allowlist amendment and regression tests.
3. Verify source data quality, migration/backfill state, physical indexes,
   query plans, and latency in an authorized isolated target; deployment and
   actual admin access need separate gates. Production DB access was excluded.
4. Forecasting remains blocked until complete historical data and evaluation
   evidence exist. Provider spend requires a specific measured need.

**Audit verification:** source/docs inspection only. No application code,
tests, build, database, provider, staging, commit, or push operation was run.

## ANALYTICS1 frozen first-slice contract — 2026-10-12

**Verdict: ANALYTICS1 CONTRACT FROZEN — READY FOR IMPLEMENTATION.** This is a
source-level contract, not approval to deploy. This section is authoritative
where the earlier audit proposed broader metrics, UTC reporting days, or a
STAFF-AUDIT1 fence dependency. Worktree HEAD and the previously fetched local
`origin/main` ref both remain `41a8cfbc54e2794415acb6df60e073092b88df67`;
the worktree uses `wecooked/.git` as its common Git directory. Remote freshness
remains unverified. The only file changed for this freeze is this untracked
milestone; STAFF-AUDIT1 files are untouched. Recheck HEAD, ref, and actual
STAFF-AUDIT1 diffs before implementation/integration; material drift reopens
the contract.

### Scope, exact metrics, and source

One Admin-only `GET /api/v1/admin/analytics/overview` response contains only
the fixed aggregates below. MongoDB `User` and `CommunityPost` domain records
are authoritative. No caller-selected filters, dates, role, or grouping are
accepted; reject any query key with 400. No client-side counting, joins, raw
documents, pagination, drill-down, exports, or other endpoints.

| Response field | Exact definition |
| --- | --- |
| `accounts.total` | Count of all currently retained `User` documents, all roles and statuses, including deactivated accounts. |
| `accounts.byRole.user`, `.moderator`, `.admin` | Count of retained `User` documents whose current `role` is the named value. These three counts sum to `accounts.total` only after the data-quality gate confirms every row has a valid role. A missing/unknown role fails the query closed rather than being silently omitted. |
| `accounts.byStatus.active`, `.suspended` | Count of retained `User` documents whose current `status` is the named value, across all roles. These two counts sum to `accounts.total` only after the same validation; an unknown status fails closed. UI label is **active-status accounts**, never active users or usage-active users. |
| `accounts.eligibleActive` | Count of retained `User` documents with `status === 'active'` and `deactivatedAt` missing or null, across all roles. This is an access-state snapshot, not observed usage. It is at most `accounts.byStatus.active`. |
| `communityPosts.retainedTotal` | Count of currently retained `CommunityPost` documents. Physical owner deletion removes posts; this is neither lifetime posts ever created nor views/engagement. |
| `periods.days7.accountsRegistered`, `days30.accountsRegistered`, `days90.accountsRegistered` | For each window, count currently retained `User` documents with a valid BSON Date `createdAt` in `[fromUtc, toUtc)`, regardless of current role/status/deactivation. These are retained registrations, not active users or a complete historical signup event log. |
| `periods.days7.postsCreated`, `days30.postsCreated`, `days90.postsCreated` | For each window, count currently retained `CommunityPost` documents with a valid BSON Date `createdAt` in `[fromUtc, toUtc)`. Deleted posts disappear from prior period counts. No deleted-post history is implied. |

The fixed response is `{ periodEndUtc, generatedAtUtc, timeZone,
accounts: { total, byRole: { user, moderator, admin }, byStatus: { active,
suspended }, eligibleActive }, communityPosts: { retainedTotal }, periods:
{ days7, days30, days90 } }`. Each period value is `{ fromUtc, toUtc,
accountsRegistered, postsCreated }`; `timeZone` is always `Asia/Manila`.
Dates are ISO UTC instants, counts are nonnegative safe integers, and no other
fields are serialized. A response is all-or-error: no partial success or stale
fallback. The existing recipe total/latest-recipe UI continues to use its
current authoritative API but is outside this new response. Rename the existing
Overview **Users** and **Active users** labels to **Accounts** and
**Active-status accounts**, preserving their current underlying counts until
the new response replaces the three user-count requests. The new eligible
active metric has its own explicit label. Do not relabel it as usage.

### Periods and empty-data semantics

Capture `periodEndUtc` once at request start. For N = 7, 30, or 90, let
`fromUtc` be the UTC instant of 00:00:00 at the start of the Manila calendar
date `N - 1` dates before the Manila date containing `periodEndUtc`; let
`toUtc = periodEndUtc`. Thus each window includes the current partial Manila
day and the preceding `N - 1` complete Manila days. Use IANA `Asia/Manila`
calendar conversion and UTC storage/comparisons, not server-local dates or
24-hour subtraction. `days7` is nested in `days30`, which is nested in
`days90`. All-time/current counts have no lower date bound. Do not make
periods configurable in v1.

Only a successful authoritative empty query returns zero, with all fixed keys
present. A missing/invalid `createdAt` is excluded from period counts, never
inferred from `_id` or `updatedAt`; the isolated data-quality gate records the
excluded count. If timestamp validity/coverage cannot be established, withhold
the affected period panel as unsupported and block deployment of this fixed
response until an explicit contract amendment; never substitute zero. Loading,
denied, server error, and unsupported data are separate UI states, and a
denied/error transition clears prior analytics numbers. `generatedAtUtc` is
captured after queries. Multi-collection reads are not a transactionally
frozen snapshot: concurrent writes can make current totals and period counts
temporarily differ. The UI calls the figures **current retained records** and
shows the reporting window; it does not claim exact cross-collection atomicity.

### Authorization, privacy, and independence

Route order: `noStore` → `authenticate` →
`requireCapability(CAPABILITIES.MONITORING_READ)` → reject any query keys →
controller. After all aggregate reads and immediately before `sendSuccess`, the
analytics controller/service re-reads the active Session by `req.auth.sessionId`
and current User by the Session's `userId` using the existing session/user
service APIs. Require Session ownership of `req.auth.userId`, unrevoked and
unexpired Session, equal effective security/session generation (legacy absent
means zero), current User `status === 'active'`, no `deactivatedAt`, and current
`monitoring.read` (Admin). Invalid/lost Session or User returns 401; an
otherwise valid demoted principal returns 403. Query/read failure propagates
as a generic server error and releases no analytics payload. A change committed
before the final check denies the response; a later concurrent transition
remains an in-flight race. Never trust JWT role, frontend role, or the earlier
`req.auth.role` at release. This fence lives entirely in ANALYTICS1's own
allowlisted files; no shared auth/capability file or unfinished STAFF-AUDIT1
file is required. If implementation cannot meet this fence within those files,
**STOP** and amend the contract before exposing data.

The response contains fixed aggregate counts and timestamps only: no User or
Session IDs, names, email, credentials, preferences, captions, post IDs, raw
audit data, or free-text fields. No role-by-period or other small-cohort
cross-tabulation. Admin-only fixed role totals are retained; there is no
anonymous or moderator view. No DAU/MAU, retention, unsupported history,
rankings, predictions, paid AI providers, or audit-event analytics.
STAFF-AUDIT1 acceptance is not a prerequisite for this slice; its event
analytics are deferred until independently accepted. Reconcile its eventual
auth/API integration diff before merging, without editing its unfinished files.

### Exact first-slice file allowlists

Production API (new files except the registration file):

```text
apps/api/src/routes/v1.routes.js
apps/api/src/modules/analytics/analytics.routes.js
apps/api/src/modules/analytics/analytics.controller.js
apps/api/src/modules/analytics/analytics.service.js
apps/api/src/modules/analytics/analytics.repository.js
```

Production Admin (new analytics files except `App.jsx` and existing CSS):

```text
apps/admin/src/App.jsx
apps/admin/src/analyticsApi.js
apps/admin/src/AnalyticsOverview.jsx
apps/admin/src/styles/dashboard.css
```

Focused test files:

```text
apps/api/test/analytics-routes.test.js
apps/api/test/analytics-service.test.js
apps/api/test/analytics-repository.test.js
apps/admin/test/dashboard.test.js
apps/admin/test/analyticsOverview.test.js
```

No model, migration, shared middleware, capability, STAFF-AUDIT1, mobile, or
other file is implied by this allowlist. Reject unknown query keys within the
allowlisted route, without a separate validation file. Preserve the existing
recipe card and admin navigation. Tests must cover role/status/deactivation
math, valid/invalid/missing timestamps, Manila midnight and month/year edges,
all three nested periods, deleted-post semantics, zero/error/denied UI,
response field allowlist, query-key rejection, no-store, Admin-only access,
and a demotion/revocation between initial auth and final fence. A final-fence
Mongo error must emit no data. Existing unrelated tests may run unchanged.

### Aggregation and isolated Mongo acceptance

Use server-side bounded aggregation/count operations on the two collections.
Period queries start with `createdAt` BSON Date bounds for at most the 90-day
window, then calculate the nested counts; current role/status counts may scan
the User collection once. Do not fetch rows into Node, use `$lookup`, regex,
`$where`, disk-spilling sorts, or `estimatedDocumentCount` (approximate).
Bound each Mongo operation with `maxTimeMS <= 2000` and `allowDiskUse: false`.
Declared source indexes: `CommunityPost` has `(createdAt, _id)`; `User` lacks
a `createdAt` or role/status index. These declarations do not prove physical
indexes or viable plans.

Before deployment, on an independently authorized, isolated **wecooked-dev**
Mongo target, verify connected cluster/database identity, a dedicated
restricted credential, a reset plan, and no production/shared-dev fixtures.
Use synthetic records at realistic scale (at least 100,000 Users and 1,000,000
CommunityPosts unless a documented measured upper bound is higher), including
all roles/statuses, deactivation, missing timestamps, post deletion, and
Manila boundary cases. Verify physical indexes and run every proposed pipeline
with `explain('executionStats')` for all-time and 7/30/90-day windows. Record
winning plan, `totalKeysExamined`, `totalDocsExamined`, returned count,
execution time, memory/spill, and endpoint p95/p99 under 10 concurrent Admin
reads. Acceptance: exact counts versus independently seeded expected results;
no spill or timeout; all-time scans examine no more than collection cardinality
plus 1%, period scans examine no more than 3 times matching 90-day rows plus
1000 and use an index for collections above 10,000 rows; endpoint p95 <= 750 ms
and p99 <= 2000 ms. A missing index or failed budget blocks deployment. Any
new index/schema/migration requires an explicit allowlist amendment and
separate review; no silent performance downgrade or approximate count.

No known source-level implementation blocker remains at the audited SHA; an
inability to implement the final authorization fence inside this allowlist is
an immediate implementation stop requiring a contract amendment. Timestamp
provenance and coverage must be checked before treating retained cohorts as
reliable. Mongo verification, live role/revocation races, deployed Admin access, and
deployment are **NOT RUN — NOT CLAIMED AS PASS** in this contract-freeze phase.
Implementation may begin on this frozen allowlist. Deployment remains blocked
until the isolated Mongo/data-quality/performance gates pass and the actual
STAFF-AUDIT1 integration diff has been checked. Production Mongo access is
excluded.

## Release-held engineering finalization amendment — 2026-10-12

The owner approves deferring the isolated, real MongoDB acceptance work above
for **engineering finalization and merge only**. This changes the sequencing of
the release gate, not the fixed metrics, authorization, privacy, query bounds,
file allowlists, or acceptance thresholds above. Source review, synthetic tests,
and an Admin build may establish **ENGINEERING COMPLETE — RELEASE-HELD**; they
do not authorize deployment or live Admin use of the analytics response.

The following are **DEFERRED — NOT RUN — NOT CLAIMED AS PASS** until a separately
authorized pre-release acceptance session: connected isolated MongoDB target and
credential verification; data quality and timestamp coverage; physical index
verification; `explain('executionStats')` for all-time and 7/30/90-day query
plans at the specified scale; scan, spill, and timeout budgets; endpoint p95/p99
latency under concurrent Admin reads; and deployed API/Admin demo smoke testing.
Any missing index, data-quality failure, or exceeded budget blocks release and
requires the contract's separate amendment and review before remediation.

Merging to `main` is allowed only after confirming that neither the Render API
nor Admin frontend will auto-deploy from that merge and after the required PR
checks pass. If either deployment setting cannot be verified, hold the merge.
No production database access, migration, or Render deployment is authorized by
this amendment. The runtime and demo gates remain mandatory before release.
