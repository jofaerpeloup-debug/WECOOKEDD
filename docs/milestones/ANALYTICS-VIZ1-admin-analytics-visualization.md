# ANALYTICS-VIZ1 — Admin Analytics visualization audit and proposed contract

**Phase:** read-only application audit and contract preparation, 2026-10-12. **Verdict:** ANALYTICS VISUALIZATION AUDIT COMPLETE — READY FOR CONTRACT FREEZE. This document proposes a narrow amendment to ANALYTICS1; it does not authorize implementation or release.

## 1. Authority and observed capabilities

The GitHub `main` branch and clean local `main` worktree both resolved to `4e283bc1b88077e3f467b92f2533652dbeccc643`, the merge of ANALYTICS1 PR #115. Terminal `git fetch` could not reach GitHub through the configured proxy, so branch/PR freshness was checked through the connected GitHub read API. No production MongoDB, deployed API, or Admin browser was accessed. No application files, dependencies, Git index, or STAFF-AUDIT1 files were changed.

The authoritative base is the **frozen first-slice contract** and release-held amendment in `docs/milestones/ANALYTICS1-admin-analytics-overview.md` (sections beginning at lines 223 and 405). Earlier audit-stage UTC/filter proposals in that document are superseded. `apps/admin/src/AnalyticsOverview.jsx` renders five account/post KPI cards, current role text, and three fixed 7/30/90-day period summaries. `apps/admin/src/App.jsx` mounts it on the Admin Overview alongside the separate recipe total, latest recipes, and navigation. There is no chart or interactive reporting selector in that Overview. `apps/admin/package.json` and the root lockfile already declare Recharts 2.15.x (locked 2.15.4); no install or package edit is proposed.

The existing API is one Admin-only `GET /api/v1/admin/analytics/overview` with no query keys. It returns current `User` role/status/deactivation totals, current retained `CommunityPost` total, and retained registration/post-creation totals for nested 7/30/90 Manila-calendar-day windows. It does **not** return daily buckets. `analytics.repository.js` performs bounded snapshot and 90-day range aggregates, with a scalar BSON Date check; `analytics.service.js` computes Manila window starts and rechecks current Session/User Admin authority after reads. `analytics.routes.js` applies `noStore → authenticate → monitoring.read → reject query keys`. None of these metrics are usage activity, lifetime events, or a frozen multi-collection snapshot.

Relevant project context: `docs/milestones/MOBILE-M27-teammate-frontend-adoption.md` rejects fabricated Admin Insights charts, and `docs/architecture/admin-recipes-integration.md` defers cuisine visualization pending classification. The old Admin architecture notes describe retired Firestore/demo states; current source and the frozen ANALYTICS1 section win. No tracked roadmap or earlier authoritative Admin visualization milestone was found. The separate, unfinished `STAFF-AUDIT1-system-activity-security-audit-logs.md` and its S0 worktree were inspected read-only for ownership conflicts.

## 2. Chart-to-data-source matrix

| Requested surface | Authoritative source and exact label | Existing response sufficient? | Proposed change |
| --- | --- | --- | --- |
| Daily registration line | Retained `User` rows with scalar BSON Date `createdAt`, across current roles/statuses/deactivation; label **Retained accounts registered per Manila calendar day**. Deletion removes a past row. | **No.** `periods.daysN.accountsRegistered` are three overlapping totals, not daily points. | Add one fixed 90-day daily bucket series from Mongo. |
| Community activity bars | Retained `CommunityPost` rows with scalar BSON Date `createdAt`; label **Retained posts created per Manila calendar day**. Owner deletion removes a past row. | **No.** `periods.daysN.postsCreated` are overlapping totals. | Add daily post-creation buckets aligned with registration buckets. “Community activity” is a section heading only; it must not imply likes, comments, views, or unique people. |
| User role pie | `accounts.byRole.user/moderator/admin`, current retained accounts, all statuses and deactivation states. | **Yes.** | Render exact counts; percentages may be computed from `accounts.total` only when nonzero. Never present pie slices as historical roles. |
| Account status bars | `accounts.byStatus.active/suspended`, current retained accounts, all roles; **Active-status accounts** means stored status, not observed use or eligibility. | **Yes.** | Render exact counts. Keep `accounts.eligibleActive` as its separate KPI; it is a subset, not a third disjoint status bar. |
| KPI cards and reporting controls | Existing five analytics cards, recipe card, `periods.days7/days30/days90`, and separate recipe API. | **Yes** for totals, **no** for daily charts. | Preserve their definitions and Admin placement. Add a local 7/30/90-day chart selector; use existing fixed period totals for the selected summary. No API query parameter. |

Overlapping 7/30/90 totals must never be plotted as three independent time buckets. There is no authority for DAU/MAU, retention, audit-event analytics, prediction, or an unqualified “engagement” graph.

## 3. Minimal backend response and aggregation amendment

Keep the same route, fixed response, `Asia/Manila` timezone, `periodEndUtc` captured once at request start, and `generatedAtUtc` assigned after the final authorization fence. Propose one additive top-level field:

```text
daily: {
  buckets: [
    { localDate: "YYYY-MM-DD", fromUtc: ISO-UTC, toUtc: ISO-UTC,
      accountsRegistered: nonnegative-safe-integer,
      postsCreated: nonnegative-safe-integer }
  ]
}
```

Return **exactly 90 ordered daily buckets**, from the Manila date 89 days before the date containing `periodEndUtc` through the current partial Manila day. Each `fromUtc` is local midnight converted to UTC; each `toUtc` is the next local midnight, capped at `periodEndUtc` for the last bucket. Buckets are contiguous half-open `[fromUtc, toUtc)` intervals. `localDate` is the Manila civil date, unique and ascending. Empty days receive zero **only after successful authoritative queries**; absent/malformed payloads and unsupported timestamp coverage never become zero. The server, not the browser, constructs boundaries using the existing Temporal/Manila calendar rules.

For each collection, start with the existing bounded `createdAt` range match covering at most the 90-day window, then require scalar BSON Date, then group by Manila calendar date. A Mongo timezone-aware date grouping expression (or equivalent bounded server-side grouping) must use `Asia/Manila`, never host-local time. Do not transfer source rows to Node, add joins, or count by `_id`/`updatedAt`. Merge the two grouped results into the fixed date spine on the server. Derive the existing `periods.days7/days30/days90` counts from **those same bucket results** so each period total equals the sum of its final N buckets, preserving the current definitions while avoiding a second aggregate read that can disagree during concurrent writes. Snapshot totals remain separate, so cross-collection/current-versus-period atomicity is still not claimed.

Keep response field allowlisting and all-or-error behavior. Validate count safety, exact 90-day date coverage, ordered/contiguous UTC bounds, final `toUtc === periodEndUtc`, correct Manila dates, and period-sum equality before release; malformed or inconsistent data fails closed. No raw documents, IDs, names, emails, captions, account preferences, or audit metadata are added. No caller-selected dates, role filters, granularity, exports, or other endpoints. Keep `maxTimeMS <= 2000`, `allowDiskUse: false`, `noStore`, Admin-only `monitoring.read`, and the final active Session/current User/generation/capability fence immediately before response release. Any 401/403/error clears chart and KPI data.

The `CommunityPost` schema declares `(createdAt, _id)`; the `User` schema declares no `createdAt` index. These are source declarations, not physical-index proof. The daily grouping must pass the existing ANALYTICS1 isolated Mongo plan, scan, spill, timeout, p95/p99, and 10-concurrent-Admin gates at its stated scale. An index or migration found necessary is a **separate allowlist amendment and review**, not a silent addition here.

## 4. Frontend design contract

- Keep the Admin Overview structure and the existing account/post KPI meanings, recipe card, latest recipes, and navigation. Place a compact 7/30/90-day control above two daily charts; default to 30 days. Selection only slices the fixed 90-bucket response and chooses the corresponding already-returned period total. The selector does not refetch or create a client-authored filter. Label the precise `fromUtc`/`toUtc` interval in Manila time and disclose that the current day is partial.
- Render the registration line and post-creation vertical bars with the existing Recharts dependency. Use only server counts, stable chronological dates, a zero-based count axis, integer tooltips, restrained tick density, and no interpolated/invented points. A hover tooltip is an enhancement, not the only way to read values. If 90 dates cannot be legibly labeled, reduce visible ticks while retaining all points and an accessible data table.
- Render a role pie with fixed User/Moderator/Admin order and a visible count legend; render status as two labeled bars. Do not show a meaningless zero-total pie or percentages with a zero denominator. Do not combine `eligibleActive` with disjoint status segments. Every chart title, tooltip, legend, and table names **current retained** or **retained created** records as appropriate; avoid “active users,” “engagement,” “growth rate,” and cumulative/lifetime language.
- Provide an HTML data table or equivalently readable structured list for every chart, including all 90 daily values when selected, reachable without hover or pointer input. Native buttons for the period control need visible selection (`aria-pressed` or equivalent), focus rings, keyboard operation, and no hidden data behind pointer-only tooltips. Use the existing semantic light/dark tokens in `styles/tokens.css`; verify chart series, axes, grid, tooltip, focus, and labels in both themes and high zoom. Support narrow screens without clipping data or controls, and honor the existing reduced-motion preference and media query.
- Preserve loading, denied, unsupported, error, and authoritative-zero states. A stale successful response after a tab/account/session change must not repaint charts; preserve the existing request cancellation boundary in `App.jsx`. Do not cache analytics across identities. There is no mock/fabricated production fallback.

## 5. Exact proposed implementation allowlists

This audit changes **only this milestone document**. If this contract is frozen later, the smallest proposed production/test edits are:

| Group | Exact paths | Purpose |
| --- | --- | --- |
| API production | `apps/api/src/modules/analytics/analytics.repository.js`; `apps/api/src/modules/analytics/analytics.service.js` | Date grouping, fixed bucket spine, period sums, response validation; preserve route/controller/auth. |
| Admin production | `apps/admin/src/AnalyticsOverview.jsx`; `apps/admin/src/styles/dashboard.css` | Local selector, four chart surfaces, accessible tables/states, responsive/theme styling. |
| API tests | `apps/api/test/analytics-repository.test.js`; `apps/api/test/analytics-service.test.js` | Bucket query/boundary/type and period-sum/fence behavior. |
| Admin tests | `apps/admin/test/analyticsOverview.test.js` | Response validation, labels, selected-window rendering, accessible data and states. |
| Contract documentation | `docs/milestones/ANALYTICS-VIZ1-admin-analytics-visualization.md` | Freeze/evidence updates only. |

Run unchanged `apps/api/test/analytics-routes.test.js`, `apps/admin/test/dashboard.test.js`, auth/session/capability regressions, and Admin build as verification. They are **not** edit allowlist entries. `App.jsx`, `analyticsApi.js`, route/controller/registration files, models, schemas, middleware, capability map, package manifests/lockfile, migrations, mobile, and every STAFF-AUDIT1 path are outside this proposed edit list. Any required expansion stops for an explicit contract amendment. Recharts availability in the lockfile is not a claim that a local install or browser build passed.

## 6. Focused tests and runtime acceptance

Synthetic tests must cover Manila midnight/month/year boundaries, leap/calendar behavior, first/last inclusive-exclusive timestamps, current partial day, missing/null/string/array `createdAt`, deleted-row effects, empty dates, all 90 ordered buckets, 7/30/90 nested sums, unknown role/status fail-closed behavior, nonnegative safe counts, payload field allowlist, no query keys, no-store, consumer/Moderator/expired/denied access, and demotion/revocation/final-fence read failure. UI tests must cover selector switching, exact chart/table labels and values, zero versus loading/error/unsupported, clearing stale data, keyboard-visible controls, narrow layout, and dark/reduced-motion presentation. No test may treat a tooltip alone as accessible proof.

Before any release, carry forward ANALYTICS1's separately authorized isolated Mongo data-quality and physical-index checks; explain every new daily pipeline for all 7/30/90 views at realistic scale and compare every bucket with independently seeded expected counts. Confirm the existing scan, no-spill, `maxTimeMS`, endpoint p95/p99, and concurrent Admin-read thresholds. Then verify real Admin/Moderator/consumer/revocation behavior and a deployed Admin browser smoke in both themes and narrow/high-zoom layouts. Source/synthetic/build evidence does not prove live Mongo plans, timestamp coverage, deployment, or browser accessibility. These runtime gates are **NOT RUN — NOT CLAIMED AS PASS** here. Production MongoDB remains excluded.

## 7. STAFF-AUDIT1 and blockers

The unfinished STAFF-AUDIT1 S0 worktree has modified audit, auth/capability, user-service, and related test files plus an untracked milestone. Its observed changed-path set has **no exact overlap** with the proposed ANALYTICS-VIZ1 edit list. There is a semantic integration boundary because analytics uses Session/User reads and `monitoring.read`; recheck the accepted STAFF-AUDIT1 diff and rerun privileged-read race tests before integration. Do not change those unfinished files or consume their events. STAFF-AUDIT1 completion is not a dependency for these `User`/`CommunityPost` charts.

No source-level blocker prevents contract preparation. Release remains blocked by ANALYTICS1's deferred isolated Mongo timestamp-coverage/index/plan/scale/latency gates and deployed authorization/browser smoke. The unindexed `User.createdAt` range is a concrete performance risk; if its measured plan fails, this allowlist cannot absorb the fix. Any inability to retain the existing final authorization fence or exact bucket/period reconciliation also blocks implementation until the contract is amended. The word “activity” must remain qualified as retained post creation; a broader activity metric requires its own data contract.

## 8. Audit verdict

**ANALYTICS VISUALIZATION AUDIT COMPLETE — READY FOR CONTRACT FREEZE.** The proposed four charts have defined current-data sources, additive daily-bucket requirements, a fixed reporting interpretation, and bounded file ownership. This verdict covers source audit and document preparation only; it does not state implementation, Mongo, browser, or deployment acceptance.

## ANALYTICS-VIZ1 frozen implementation contract — 2026-10-12

**Verdict: ANALYTICS-VIZ1 CONTRACT FROZEN — READY FOR IMPLEMENTATION.** This section is authoritative for VIZ1 wherever the audit-stage proposals above are less precise. The audited and frozen code baseline is `4e283bc1b88077e3f467b92f2533652dbeccc643`, including merged ANALYTICS1 PR #115. The source-level equivalence proof below resolves the bucket-derived-total question; implementation must prove it with focused tests. This freeze changes only this milestone document and authorizes no database, deployment, package, or STAFF-AUDIT1 work.

### Fixed response and compatibility

Keep `GET /api/v1/admin/analytics/overview` as the **only** analytics endpoint. The request accepts no query string, including an empty `?`; `analytics.routes.js` currently rejects any `?` in `originalUrl`. Retain all existing top-level fields and their exact ANALYTICS1 meanings and types. Add exactly one top-level `daily` object with exactly one `buckets` array. Each of its **exactly 90** elements has exactly these keys and types, in this order for deterministic serialization:

```text
daily: { buckets: [{
  localDate: "YYYY-MM-DD",             // Asia/Manila calendar date
  fromUtc: "YYYY-MM-DDTHH:mm:ss.sssZ", // inclusive
  toUtc: "YYYY-MM-DDTHH:mm:ss.sssZ",   // exclusive
  accountsRegistered: integer,         // nonnegative safe integer
  postsCreated: integer                 // nonnegative safe integer
}] }
```

`periodEndUtc` is captured once by the existing controller at request start. `generatedAtUtc` is captured after all reads and the final authority check. `timeZone` stays exactly `Asia/Manila`. No client-supplied period, role, grouping, or timezone; no extra response keys, user-level rows, exports, or drill-down. The original `accounts`, `communityPosts`, and `periods` shapes stay byte-for-byte equivalent in field names and definitions; count values may naturally change with concurrent writes, as in ANALYTICS1. The recipe total/latest-recipe API and UI stay separate and unchanged.

Keep snapshot definitions: `accounts.total` includes all retained roles/statuses/deactivated rows; `byRole` is current user/moderator/admin; `byStatus` is current active/suspended; `eligibleActive` is active status and not deactivated; `communityPosts.retainedTotal` is current retained posts. An unknown role/status fails the entire response closed. The five analytics KPI cards retain these meanings. `eligibleActive` remains a subset of active status and is never a third disjoint status category.

### Exact day boundaries, row eligibility, and period sums

Let `E = periodEndUtc`, and let `D` be the Manila civil date containing `E`. Use IANA `Asia/Manila` calendar conversion through the existing Temporal dependency. For bucket index `i = 0..89`, `localDate` is `D - (89 - i)` calendar dates. `fromUtc` is that date's Manila midnight converted to a UTC instant. For `i < 89`, `toUtc` is the next Manila midnight; for `i = 89`, `toUtc = E`. The first `fromUtc` equals existing `periods.days90.fromUtc`. The last `toUtc` equals every existing period's `toUtc`. Adjacent buckets satisfy `bucket[i].toUtc === bucket[i+1].fromUtc`. At exactly Manila midnight, the final current-day bucket is the empty `[E, E)` interval with zero counts; it remains present so the fixed 90-date shape and existing period windows are preserved. At other instants the final bucket is partial and nonempty. Use calendar arithmetic, not `N × 24 hours` or a hard-coded UTC offset.

The `User` and `CommunityPost` pipelines each retain the existing first `$match: { createdAt: { $gte: from.days90, $lt: E } }`, then the existing aggregation-expression scalar check `$expr: { $eq: [{ $type: '$createdAt' }, 'date'] }`, before grouping by the `Asia/Manila` local date. A query-level `$type` alone is insufficient because it can match an array containing a Date. Missing, null, string, numeric, array, and object timestamps are excluded, even if a nested element is an in-range Date. Never infer a timestamp from `_id` or `updatedAt`; the current snapshots may still count such retained rows. The isolated data-quality gate records excluded timestamp coverage and blocks release if it cannot support period reporting. A zero bucket means an authoritative successful query found no eligible rows for that day.

For each collection, replace its existing three-counter period aggregation with **one** 90-day daily aggregation on the same eligible rows. Group by Manila date; construct the fixed 90-day spine and fill absent groups with zero on the server after successful aggregation. Reject duplicate/out-of-range group keys, invalid counts, unsafe sums, or failed operations as a whole-response error. Derive `periods.daysN.accountsRegistered` and `.postsCreated` by summing the last `N` buckets of the respective series, for `N ∈ {7,30,90}`. Preserve the existing period `fromUtc` and `toUtc` values; do not send period totals computed independently of the buckets. There is no client-side counting of source records.

**Equivalence proof:** the 90 half-open buckets form a disjoint partition of the original `[from.days90, E)` interval. The original scalar BSON Date predicate is unchanged. For `N = 7, 30, 90`, the union of the last `N` buckets is exactly the existing `[from.daysN, E)` interval. Every eligible retained row therefore contributes once to the same existing `daysN` count, including at midnight boundaries; every excluded row contributes zero to both versions. Post deletion still removes its retained row from historical creation counts. If implementation or physical Mongo evidence contradicts this equivalence, **STOP** and return a contract decision before changing ANALYTICS1 semantics.

The existing four logical aggregate reads remain two current snapshots plus one bounded daily read per collection. User and post reads, and current snapshots versus period reads, are not transactionally synchronized. Do not assert snapshot/period equality across independent reads or an atomic cross-collection `asOf`; retain the current `generatedAtUtc` and concurrent-change disclosure.

### Frozen charts, controls, and states

| Surface | Frozen source and display |
| --- | --- |
| Registration line | Selected last 7, 30, or 90 `daily.buckets[].accountsRegistered`; title **Retained accounts registered per Manila calendar day**. Includes all current roles/statuses/deactivation states and excludes deleted accounts. |
| Post bars | The same selected dates with `daily.buckets[].postsCreated`; title **Retained posts created per Manila calendar day**. Deleted posts disappear. The section may say “Community activity,” but its chart, legend, tooltip, and table must say **retained posts created**. |
| Role pie | Current `accounts.byRole.user/moderator/admin` in that fixed order. Visible legend/table gives exact counts. If `accounts.total === 0`, show an empty state instead of a pie or percentage. If percentages are shown for a nonzero total, derive them only from these current server counts and show exact counts alongside them. |
| Status bars | Current `accounts.byStatus.active/suspended` as two separate bars, across all roles. Use **Active-status accounts** and **Suspended accounts**. Do not imply usage activity or plot `eligibleActive` as a third status. |
| KPI and period summaries | Preserve the five analytics KPI cards, the existing three 7/30/90 period summaries and their exact counts/labels, plus the separate recipe card and latest recipes. |

Add one native-button 7/30/90-day selector **inside `AnalyticsOverview.jsx`**, default 30, controlling only the two daily charts and their daily tables. It slices the last `N` already returned buckets; it does not change the role/status snapshots, hide the three existing period summaries, mutate the API request, refetch, or cache data. Show the selected server-returned `periods.daysN` total with each time-series title and the exact selected `[fromUtc, E)` window formatted in Manila time; identify today's partial bucket. No “active users,” lifetime engagement, growth-rate, retention, DAU/MAU, predictive AI, or audit-event claim.

Use only the already-declared Recharts 2.15.x dependency; no package or lockfile edit. Render a line, vertical bars, pie, and two status bars using server counts. Axes begin at zero and display integer counts; no smoothed or interpolated values, fabricated points, or decorative placeholder stats. Tooltips may aid pointer users but cannot be the sole presentation. Disable chart animation so the existing reduce-motion preference and media setting are respected without changing `App.jsx`. Use semantic Admin CSS tokens for both light and `.wc-dark` themes, visible focus/selection, distinguishable series beyond color, and a `ResponsiveContainer` or equivalent size-bound layout that works at narrow width and 200% zoom.

Provide a semantic HTML table with a caption and row/column headers for each chart. Daily tables show **exactly the selected N rows** (90 when 90 is selected), in matching date order, with dates and exact counts; role/status tables show all categories. Tables are keyboard and screen-reader readable without hovering a chart. Responsive treatment may scroll the table horizontally inside its own region but must keep labels and controls reachable. Native selector buttons expose selection with `aria-pressed` and the existing focus-ring styling. Test the actual browser layout and accessibility; static markup alone does not prove them.

Keep the existing `idle`, `loading`, `ready`, `denied`, `unsupported`, and `error` state meanings. Before an authoritative success, show no zero-valued chart or KPI placeholder. An empty successful collection yields zero counts and zero daily buckets, with explicit empty-chart copy where a pie has no slices. A denied/error/unsupported transition removes prior analytics values; malformed bucket shape, timestamps, sums, or count types becomes `error`, not fabricated zero. Preserve `App.jsx`'s existing tab/account request cancellation so a late response cannot repaint a changed session. Existing unsupported handling is a UI state; it is not proof that a new server-side partial-data fallback exists. If timestamp coverage is unsupported, block release under ANALYTICS1 rather than silently replacing periods.

### Authorization, performance, and release gates

Do not edit the route, controller, shared auth/capability middleware, or session/user services. Preserve `noStore → authenticate → requireCapability(MONITORING_READ) → reject any query string → controller`. After all aggregate reads, keep the existing active-Session/current-User ownership, unrevoked/unexpired and generation-equality, active/not-deactivated, current `monitoring.read` final fence before `sendSuccess`; demotion, revocation, lost authority, or final-fence read failure releases no analytics payload. No Moderator/consumer view. Keep fixed aggregate-only privacy boundaries and all-or-error behavior.

Keep `maxTimeMS <= 2000` and `allowDiskUse: false` on every Mongo operation. No source-row transfer to Node, `$lookup`, regex, `$where`, disk-spilling sort, or approximate count. Source declares a `CommunityPost(createdAt, _id)` index and no `User.createdAt` index; physical availability and winning plans are unverified. At the independently authorized isolated `wecooked-dev` gate, verify connected cluster/database identity, dedicated restricted credential, reset plan, and nonproduction fixtures; test at least 100,000 Users and 1,000,000 CommunityPosts unless a measured upper bound is higher. Explain both new 90-day daily pipelines and the unchanged all-time snapshots with `executionStats`, including 7/30/90 result comparisons to independently seeded expectations. Record winning plan, keys/docs examined, returned counts, time, memory/spill, and endpoint p95/p99 under 10 concurrent Admin reads. Preserve ANALYTICS1 acceptance: exact counts; no spill/timeout; all-time scans ≤ collection cardinality + 1%; period scans ≤ 3 × matching 90-day rows + 1000 and index use when a collection exceeds 10,000 rows; endpoint p95 ≤ 750 ms and p99 ≤ 2000 ms. A failed budget, missing physical index, poor timestamp coverage, or need for schema/index/migration work blocks release and requires a separate explicit allowlist amendment. These gates are **DEFERRED — NOT RUN — NOT CLAIMED AS PASS** at freeze. No production MongoDB access is authorized.

### Exact implementation allowlists and proof

**Production API:** `apps/api/src/modules/analytics/analytics.repository.js`; `apps/api/src/modules/analytics/analytics.service.js`.

**Production Admin:** `apps/admin/src/AnalyticsOverview.jsx`; `apps/admin/src/styles/dashboard.css`.

**Editable focused tests:** `apps/api/test/analytics-repository.test.js`; `apps/api/test/analytics-service.test.js`; `apps/admin/test/analyticsOverview.test.js`.

**Milestone:** `docs/milestones/ANALYTICS-VIZ1-admin-analytics-visualization.md`.

This is the exact audit-proposed allowlist. Any need to edit `App.jsx`, `analyticsApi.js`, routing/controller, User or post models/indexes, auth/capability, package/lockfile, tests outside this list, or STAFF-AUDIT1 files stops implementation for a contract amendment. Run the unchanged analytics route and dashboard tests, auth/session/capability regressions, Admin production build, and any relevant existing tests without editing them.

Focused tests must prove 90 contiguous Manila buckets; midnight and month/year/leap boundaries; `[from, to)` inclusion/exclusion; scalar BSON Date rejection of arrays/strings/missing/null; retained-row deletion behavior; zeros only after successful queries; exact 7/30/90 sum equivalence and safe-integer overflow rejection; unchanged snapshot/card/period semantics; strict field and query-string allowlists; no-store and Admin-only denial; demotion/revocation and final-fence error; selector 7/30/90 slicing without network parameters; all four exact chart/table mappings and truthful labels; empty/loading/denied/unsupported/error clearing; and dark, narrow, zoomed, keyboard, screen-reader, and reduced-motion browser behavior. Synthetic source tests and a build do not establish physical Mongo or deployed acceptance.

STAFF-AUDIT1 S0 remains unfinished and independent. This VIZ1 allowlist has no exact overlap with its observed modified paths, but both rely on current Session/User and `monitoring.read`; recheck its accepted integration diff and rerun privileged-read race tests before integration. Do not consume audit events or alter its files. Its completion is not a prerequisite for these `User`/`CommunityPost` charts.

**Freeze verdict: ANALYTICS-VIZ1 CONTRACT FROZEN — READY FOR IMPLEMENTATION.** The exact bucket partition preserves existing period definitions at source level. Implementation must establish that equality in tests; release still requires the deferred Mongo, index, performance, authorization, and browser gates.

## Narrow findings amendment - 2026-10-12

**Amendment verdict: ANALYTICS-VIZ1 AMENDMENT FROZEN - READY FOR FINDINGS FIX.** This amendment supersedes only the editable-test allowlist and the instruction to run `apps/admin/test/dashboard.test.js` unchanged above. It clarifies the already frozen fail-closed response and theme requirements. The 90-bucket shape, bucket and 7/30/90 boundary semantics, ANALYTICS1 metric definitions, KPI counts, authorization, no-store behavior, and final Session/User fence remain unchanged. No application or test source change is authorized during this documentation-only phase.

### Exact revised implementation allowlist

**Production API (unchanged):** `apps/api/src/modules/analytics/analytics.repository.js`; `apps/api/src/modules/analytics/analytics.service.js`.

**Production Admin (unchanged):** `apps/admin/src/AnalyticsOverview.jsx`; `apps/admin/src/styles/dashboard.css`.

**Editable tests (one addition):** `apps/api/test/analytics-repository.test.js`; `apps/api/test/analytics-service.test.js`; `apps/admin/test/analyticsOverview.test.js`; `apps/admin/test/dashboard.test.js`.

**Contract documentation:** `docs/milestones/ANALYTICS-VIZ1-admin-analytics-visualization.md`.

The first seven implementation paths are unchanged. The sole added implementation path is the existing `apps/admin/test/dashboard.test.js`. Its edit permission is limited to making the Analytics ready-response fixture and directly related assertions conform to the frozen 90-bucket API response, and to a focused missing/malformed-daily negative assertion if needed. Preserve its unrelated dashboard, recipe, navigation, responsiveness, and styling regressions. All other production and test paths remain outside the edit allowlist, including every STAFF-AUDIT1 path.

### Ready-response validity and dashboard fixture

A ready Analytics payload without `daily.buckets` containing exactly 90 ordered, contiguous Manila-date buckets and valid counts/boundaries is invalid. The Admin UI must fail closed to its error state and clear prior Analytics values; it must not render stale or partial KPI cards, period summaries, or charts as a valid response. It must not synthesize buckets, accept an old response shape, or relax production validation for an obsolete test fixture. Preserve or add a focused negative test that supplies a ready payload with missing or malformed daily buckets and proves the response does not display prior or partial KPI values.

Update the old dashboard test fixture to satisfy the frozen API contract, including its daily buckets, exact 7/30/90 period boundaries, and bucket-derived period totals. Keep the existing fixture's snapshot KPI meanings and counts and the unrelated recipe data/assertions. The fixture must use explicit deterministic counts and timestamps solely as test data; they are not production statistics or a substitute for Mongo evidence.

### Chart presentation and verification

The existing `apps/admin/src/styles/dashboard.css` production allowance covers the observed literal-color regression. Chart presentation must use the existing Admin light/dark semantic theme tokens and styling conventions, with distinguishable series and accessible text/focus states. Correct literal chart colors within the existing CSS allowlist; do not add a token file or weaken the dashboard test's no-literal-hex assertion to accommodate hard-coded chart colors.

After implementation resumes, rerun all frozen focused API and Admin Analytics tests, the revised `apps/admin/test/dashboard.test.js`, relevant analytics route and auth/session/capability regressions, and the Admin production build. Verify the conformant fixture, the missing/malformed-daily fail-closed path, preservation of unrelated dashboard assertions, and the CSS literal-color regression. Browser accessibility and physical Mongo performance/coverage gates remain separately deferred until actually run; neither is established by source tests or the build. No dependency, schema, index, reporting, security, predictive AI, or audit-event expansion is authorized.
