# MODERATOR-OPS-REVIEW1 - Derived Moderator Draft Review View v1

**Freeze date:** 2026-09-30

**Phase:** Read-only audit and milestone freeze; no implementation

**Branch:** `main`

**Baseline:** `0c22f2eba3dbd8a8e0b6725b783e17fffedca7af`

**STATUS:** `REVIEW1 AUDIT PASS - READY FOR IMPLEMENTATION`

## 1. Goal and authority

REVIEW1 gives a Moderator one bounded view of active Recipe Drafts and the
current server-derived attention required before publication. It is a derived
view over the existing `Recipe` collection and READY1. It does not create a
review queue, task record, second lifecycle, or new source of truth.

The saved Recipe, current Ingredient records, READY1 shared publication
evaluator, DUP1 comparison, and actual Publish transaction remain
authoritative. The Admin must render READY1 output and must not reproduce
required-field, Ingredient-activity, duplicate-freshness, or publishability
rules. A displayed result describes one saved Recipe version only; actual
Publish continues to reload and re-evaluate current state.

## 2. Audit boundary and baseline

The live checkout was audited at the requested baseline:

```text
0c22f2eba3dbd8a8e0b6725b783e17fffedca7af
```

At audit time `HEAD`, `main`, and `origin/main` were aligned at that merge
commit. It contains READY1 implementation commit `746da76` and the earlier
DUP1 implementation. The audit covered the live Recipe list validation,
routes, controller, service, repository, serializer, model indexes, capability
middleware, Admin Recipes surface, Recipe API client, authoring entry path,
focused tests, and the READY1 and DUP1 milestone contracts.

No application or test file was modified. This milestone is the only file
created by this audit.

## 3. Current Admin Recipe list and catalog capability

The current Staff Portal Recipes surface has these capabilities:

- `GET /api/v1/recipes` is an authenticated, paginated list with title or
  description search; canonical region, category, dietary tag, difficulty,
  Ingredient, and maximum-prep-time filters; active/archived/all lifecycle
  filtering; and named sorts.
- `catalog.read_all` callers receive `toStaffRecipe`, including
  `publicationStatus`, `isActive`, and `updatedAt`, and may see active or
  archived records. Under the current capability map both Admin and Moderator
  have this read capability.
- The Admin `RecipesTab` renders one table for both active Draft and Published
  Recipes. Moderator actions include Add recipe, Resume/Edit, archive, restore,
  and the existing authoring wizard. Admin receives the same catalog as a
  read-only surface.
- The list's `status` query is activation state only:
  `active | inactive | all`. It is not publication state.
- The existing `newest` and `oldest` sorts use `createdAt`, not `updatedAt`.
  Although `updatedAt` is already serialized, the table does not show it.
- The authoring wizard reloads a selected Recipe through `GET /recipes/:id`.
  Its Review step currently has client presentation checks and an explicit
  DUP1 check, but the catalog list has no READY1 consumer.

### Draft-filter finding

Draft filtering does not exist. Staff can see Drafts only when they happen to
be mixed into an active, archived, or all lifecycle result. There is no
`publicationStatus` list query, no Draft-only Admin view, and no server-side
review-task concept.

The Recipe model already has the supporting compound index:

```text
{ publicationStatus: 1, isActive: 1, updatedAt: -1 }
```

Therefore the smallest useful list change is an exact Draft-only query on the
existing endpoint, using the existing collection, pagination, staff
serializer, repository list method, and index. No new endpoint, collection,
model field, serializer, repository method, migration, or index is required.

## 4. Frozen REVIEW1 UX

### 4.1 Entry and scope

The Recipes surface gains a two-option view switch for Moderators only:

```text
Catalog | Draft review
```

`Catalog` is the current Recipes view and keeps its behavior. `Draft review`
is shown only when the existing Admin policy supplies `canWriteCatalog: true`;
under the current capability map that means Moderator. Admin remains on the
read-only Catalog view and is not shown REVIEW1.

The Draft review view lists active explicit Drafts only. Archived Drafts are
not publication work and remain accessible through the existing Catalog
Archived/All lifecycle filter. Published and legacy-Published Recipes never
appear in REVIEW1.

### 4.2 Draft list

On entry, the view issues one paginated list request for page 1, limit 20,
ordered by most recently updated. The list contains exactly:

- Recipe title;
- state label `Draft`;
- updated time, rendered in the user's locale with a semantic `time` element
  whose `dateTime` is the server timestamp;
- readiness state for the currently selected row only; and
- a `Review` action that selects the row.

No row is labelled ready, blocked, duplicate-clear, or duplicate-required
from Recipe fields or client validation. Before selection its readiness value
is exactly `Not checked`. Empty, loading, error, retry, and server-pagination
states must remain explicit. Page movement follows authoritative
`pagination.totalPages`, not visible row count.

The view retains only title search. Region, category, difficulty, dietary,
Ingredient, prep-time, lifecycle, and general catalog sorts stay in Catalog;
they do not belong in the minimum REVIEW1 queue. Search is debounced using the
current list behavior and resets page to 1.

### 4.3 Selected Draft review panel

Selecting `Review` opens one adjacent or stacked detail/review panel within
the same Recipes surface and immediately requests READY1 for that row's exact
`id` and `updatedAt`. Responsive layout may stack the panel below the list,
but list and panel remain one view. The selected row and panel heading expose
the Recipe title, `Draft`, and updated time.

The panel has these exact states:

- `Checking saved Draft...` while the single READY1 request is in flight;
- `Ready to publish` only when the returned `publishReadiness.ready` is
  literally `true`;
- `Needs attention` when READY1 returns `ready: false`;
- `Could not check readiness` for request/infrastructure errors, with an
  explicit `Retry` action; and
- `Draft changed - refresh the list and review it again` for
  `RECIPE_EDIT_CONFLICT`. That response is never rendered as a readiness
  result.

For a successful projection, the issue summary displays the returned issue
count and every READY1 `issues[]` entry in server order using its `message` and
`path`. The UI may style known codes consistently, but it must not replace,
merge, suppress, or recalculate an issue or infer readiness from paths. An
empty issue array displays `No server-derived publication issues.`

The panel provides one primary `Open Draft` action. It opens the existing
`RecipeAuthoringWizard` for the selected Recipe; the wizard retains its fresh
detail reload, save, Review, duplicate acknowledgement, Filipino-cuisine
confirmation, and Publish flow. REVIEW1 itself has no edit form, Publish
button, acknowledgement control, or mutation.

After the authoring modal closes following any save or publication, or after
a catalog lifecycle refresh, REVIEW1 reloads page 1 and clears the selected
projection. It never keeps an old readiness claim beside changed list data.

### 4.4 Focus and stale-response behavior

The view must support keyboard selection and return focus to the invoking
`Review` control after the panel is closed or the authoring modal closes when
that control still exists. Loading uses `aria-busy`; READY1 results use a
status region; request errors use an alert region. The selected row/control
must be programmatically identifiable without color alone.

Rapid row changes, filter changes, pagination, retry, and unmount must use a
request-generation or equivalent mounted guard so a late result for Draft A
cannot overwrite Draft B. REVIEW1 must not alter the shared API client or
authentication architecture solely to add cancellation.

## 5. READY1 consumption strategy

REVIEW1 consumes the existing endpoint exactly:

```text
POST /api/v1/recipes/:recipeId/publish-readiness
```

The request body for list selection is exactly:

```json
{
  "expectedUpdatedAt": "<selected staff Recipe updatedAt>"
}
```

No `duplicateReview` acknowledgement is supplied by the list panel. This is
intentional: REVIEW1 displays whether duplicate review is required, while the
existing authoring Review step owns the explicit human review and digest-bound
acknowledgement before Publish.

The Admin API adapter returns the existing
`data.publishReadiness` projection unchanged. The component must consume:

- `ready` as the only ready/not-ready decision;
- `recipeId` and `recipeUpdatedAt` as response identity/version checks;
- `issues` as the authoritative attention summary; and
- `duplicateReview` as the only duplicate-review evidence.

If response identity does not match the selected Recipe/version, the client
fails closed as stale, discards the projection, and reloads the list. The
existing local `publicationReadiness(form)` helper remains confined to the
working authoring form. It is not called, imported, copied, or presented as
authority by REVIEW1.

Readiness is loaded on selection, not per row and not on initial list load.
There is no hover/focus preload, background sweep, automatic retry, periodic
poll, or persistence. Re-selecting or explicitly retrying performs one fresh
request. The projection is memory-only for the current selection and is
discarded on selection, page, search, view, catalog-refresh, or unmount change.

## 6. Frozen Draft query and API design

REVIEW1 extends the existing list endpoint; it does not add a review endpoint:

```text
GET /api/v1/recipes?publicationStatus=draft&status=active&sort=updatedDesc&page=1&limit=20
```

Optional title search adds the existing escaped `search` parameter. The exact
contract changes are:

1. `listRecipesSchema.query.publicationStatus` is optional and accepts only
   the literal `draft` in REVIEW1. Omission preserves every existing list
   behavior. `published`, `all`, arbitrary values, and unknown parameters are
   not added.
2. `sort` adds the named value `updatedDesc`; it maps only to
   `{ updatedAt: -1 }`. No raw Mongo sort syntax is accepted.
3. When `publicationStatus=draft` is present, middleware requires existing
   `CAPABILITIES.CATALOG_WRITE` after authentication and validation. Admin and
   User receive the existing `403 FORBIDDEN`; unauthenticated requests retain
   existing authentication errors. The gate is server-side and may not rely
   on the hidden Admin control.
4. The controller forwards the validated `publicationStatus`; the service adds
   `filter.publicationStatus = 'draft'`. The existing `status=active` handling
   independently adds `filter.isActive = true`.
5. The current repository runs the same filter for `findMany` and
   `countDocuments`, and the current staff serializer supplies title,
   publication state, activity state, and `updatedAt`.
6. The success envelope and pagination remain unchanged:
   `{ recipes, pagination: { page, limit, total, totalPages } }`.

The route middleware order is frozen as:

```text
authenticate
-> validate(listRecipesSchema)
-> require catalog.write when publicationStatus=draft
-> existing catalog.read_all gate for inactive/all
-> recipeController.listRecipes
```

The dynamic gate belongs beside the existing conditional catalog-list gate
and delegates to `requireCapability`; it must not compare role strings or
trust token claims.

## 7. Duplicate-review presentation

REVIEW1 does not call `POST /recipes/duplicate-check`. READY1 already invokes
DUP1 only after lifecycle, completeness, and Ingredient eligibility pass, so a
second check would duplicate the most expensive work and could present two
different snapshots.

The selected panel derives its duplicate section only from the returned
`duplicateReview` member:

- `null`: `Not evaluated by READY1 for this saved Draft.` No duplicate-clear
  claim is permitted.
- non-null, `truncated: false`, and zero candidates:
  `No duplicate or variant candidates in the current bounded comparison.`
- one or more candidates: `Duplicate review required`, candidate count, and
  each returned candidate's title, classification, lifecycle/archive label,
  and evidence.
- `truncated: true`: an additional non-color warning states that the comparison
  window is incomplete and displays `comparedCount` and
  `candidateUniverseCount`; it never displays a clearance message, including
  when the returned candidate array is empty.

The panel does not invent a duplicate score, recompute evidence, compare
Recipe content, acknowledge distinctness, or persist the result. `Open Draft`
takes the Moderator to the existing Review step where the current digest can
be acknowledged and actual Publish reruns READY1/DUP1 authority.

## 8. Performance and N+1 strategy

The frozen request shape is:

```text
one Draft list query and count for the current page
-> zero READY1/DUP1 calls until a row is selected
-> one READY1 call for the selected saved version
```

REVIEW1 explicitly forbids:

- a readiness POST for every visible row;
- a DUP1 request for every visible row;
- server-side readiness or DUP1 expansion inside the list serializer/service;
- automatic sequential or parallel page scanning;
- background warming, polling, or durable client caching; and
- a new denormalized readiness/review field or collection.

The active-Draft filter plus `updatedAt` descending sort matches the existing
`{ publicationStatus: 1, isActive: 1, updatedAt: -1 }` index prefix. The
implementation runtime gate must verify this with `explain('executionStats')`
on controlled development data. No new index is frozen.

READY1 may still compare up to DUP1's existing bounded 500-candidate universe
for the one selected Draft. That cost is on-demand and visible to the
Moderator, not multiplied by the page size. Reopening or retrying deliberately
gets fresh evidence rather than relying on a potentially stale cache.

## 9. Authorization

REVIEW1 is Moderator-only through existing `CAPABILITIES.CATALOG_WRITE`.
Current active Moderators have both `catalog.write` and `catalog.read_all`;
Admins have `catalog.read_all` but not `catalog.write`, so they retain the
ordinary read-only Catalog and cannot invoke the Draft review filter or READY1.
Users and unauthenticated callers cannot obtain the review list or readiness.

Authentication must continue to hydrate current MongoDB role and status.
Stale token role claims, client mode, `canWrite` props, or hidden navigation
are never authorization authority. No role, capability, or navigation model
is redesigned.

## 10. API surface

The minimum API surface is:

- extend `GET /api/v1/recipes` with the guarded optional literal
  `publicationStatus=draft` and named `sort=updatedDesc`;
- retain the existing list success envelope and staff Recipe serializer; and
- consume the already-implemented Moderator-only
  `POST /api/v1/recipes/:recipeId/publish-readiness` without changing its
  request, response, error, evaluation, or no-write contract.

There is no `/reviews`, `/review-tasks`, batch-readiness, persisted-summary,
bulk-publish, or new duplicate API.

## 11. Admin surface

The implementation is limited to the current Recipes feature:

- add the Moderator-only Catalog/Draft review view switch;
- add a bounded Draft review component with list, selection, READY1 result,
  issue summary, DUP1 presentation, retry, and Open Draft action;
- extend the Recipe API adapter with the Draft list parameter and READY1 call;
  and
- reuse the existing authoring wizard rather than create a second editor.

No Dashboard count, badge, global navigation item, mobile screen, notification,
assignment surface, or local-storage state is added.

## 12. Exact implementation allowlist

Only these production files may be added or modified:

| File | Change | Exact responsibility |
|---|---|---|
| `apps/api/src/middleware/catalog-read.middleware.js` | modify | Add the conditional Draft-list gate by delegating to existing `requireCapability(CATALOG_WRITE)`. |
| `apps/api/src/modules/recipes/recipe.validation.js` | modify | Add the optional literal Draft publication filter and `updatedDesc` named sort. |
| `apps/api/src/modules/recipes/recipe.routes.js` | modify | Insert the conditional Draft-list capability gate in the frozen list route order. |
| `apps/api/src/modules/recipes/recipe.controller.js` | modify | Forward the validated optional publication-status filter. |
| `apps/api/src/modules/recipes/recipe.service.js` | modify | Apply the explicit Draft filter and map the fixed updated-time sort. |
| `apps/admin/src/recipeApi.js` | modify | Forward the Draft filter and add the exact READY1 adapter. |
| `apps/admin/src/RecipesTab.jsx` | modify | Expose the Moderator-only view switch, host the selected panel, reuse the authoring wizard, and coordinate refresh/focus. |
| `apps/admin/src/RecipeDraftReview.jsx` | add | Own the bounded Draft list/panel rendering and selection-driven READY1 state. |
| `docs/milestones/MODERATOR-OPS-REVIEW1-derived-draft-review-view-v1.md` | modify | Append implementation, independent-review, and runtime evidence only; do not silently change this freeze. |

No Recipe model, repository, serializer, READY1 evaluator, DUP1 comparator,
capability map, portal policy, shared API client, authoring model/state/hook,
CSS-wide design system, migration, package, lockfile, mobile, or new persistence
file is allowlisted. Component-local styles may live in the new component,
consistent with the current Recipes surface. If implementation evidence makes
another file necessary, stop and amend this milestone before editing it.

## 13. Exact test allowlist

Only these test files may be added or modified:

```text
apps/api/test/recipe-validation.test.js       (modify)
apps/api/test/recipe-service.test.js          (modify)
apps/api/test/recipe-routes.test.js           (modify)
apps/admin/test/recipeDraftReview.test.js      (add)
```

The focused tests must prove at minimum:

1. strict acceptance of omitted or literal `draft`, rejection of every other
   publication-status value/unknown query, and acceptance of only the named
   `updatedDesc` sort;
2. the exact combined `{ publicationStatus: 'draft', isActive: true }` filter,
   `{ updatedAt: -1 }` sort, same-universe count, pagination, search escaping,
   and unchanged list behavior when the new filter is omitted;
3. Moderator list success plus Admin/User/unauthenticated denial, including
   database-authoritative stale-role demotion and correct middleware order;
4. the API adapter emits exactly one Draft list request and an exact readiness
   body containing only `expectedUpdatedAt`;
5. Admin cannot render or activate Draft review while Moderator can;
6. initial list, empty, search, pagination, list error/retry, and page-reset
   behavior through the mounted production component;
7. zero READY1 calls on list load and one call only after selection;
8. actual rendering of loading, ready, needs-attention, ordered server issue,
   request-error, retry, stale-conflict, and response-identity mismatch states;
9. `duplicateReview: null`, bounded clear, candidates/classifications/evidence,
   and truncated zero/nonzero-candidate presentations, including suppression of
   false clearance;
10. rapid A-to-B selection and late A response cannot replace B; search, page,
    refresh, modal completion, view change, and unmount discard old results;
11. `Open Draft` reaches the existing authoring wizard and refreshes/clears
    REVIEW1 after save or publication without adding a REVIEW1 mutation; and
12. keyboard activation, focus return, semantic time, selected-state,
    `aria-busy`, status, and alert wiring on the rendered production path.

Source-string presence tests or tests of a private child in isolation are
insufficient for items 5-12. The test must mount the default production path
and use its real controls/handlers. Existing Recipe authoring, DUP1, READY1,
catalog freshness, portal policy, and URL/ING1/ING2 integration suites are
regression commands only and are not thereby allowlisted for modification.

## 14. Runtime gate

REVIEW1 implementation is not complete until all of these are measured:

1. Run the four focused allowlisted test files, then the existing READY1 route
   and service tests, DUP1 API/Admin tests, Recipe authoring/API-contract and
   catalog-freshness tests, portal-policy tests, and Admin production build.
2. Run the full API and Admin test suites. If the Windows sandbox produces the
   known Vite/esbuild or test-worker `spawn EPERM`, rerun the identical command
   outside that environment boundary or with the established focused
   `--test-isolation=none` form and report the distinction.
3. Against controlled development MongoDB data, verify active Draft-only
   membership, Published/legacy/archived-Draft exclusion, updated ordering,
   pagination/count, and the list query's `explain('executionStats')` use of
   the existing publication/activity/update index without a collection scan or
   unbounded blocking sort.
4. Instrument real network calls with a 20-row page: initial load must issue
   one list request and zero readiness/duplicate requests; selecting one Draft
   must issue exactly one READY1 request and no direct duplicate-check request.
   Rapid selection, retry, page/search changes, and stale conflicts must not
   display a mismatched response or trigger an uncontrolled request loop.
5. In a real Admin browser, verify Moderator access and Admin absence; list,
   empty/error/retry/pagination; complete/incomplete/missing-or-inactive
   Ingredient readiness; zero-candidate/candidate/truncated DUP1 states; stale
   Draft conflict; and Open Draft edit/save/publish refresh behavior.
6. Verify keyboard-only selection, retry, Open Draft, modal close/focus return,
   visible focus, status/alert announcements, accessibility-tree labels,
   narrow layout, light/dark theme, and 200% browser zoom. Screen-reader use
   must be reported separately and never inferred from the accessibility tree.
7. Verify User/Admin/unauthenticated denial and stale Moderator demotion against
   live database role authority. Confirm REVIEW1/READY1 create no writes and
   that actual Publish still performs the only publication mutation after its
   own fresh evaluation.

The existing READY1 milestone records that its controlled-development-MongoDB
runtime gate was unavailable in that checkout even though focused and full
automated suites passed. REVIEW1 runtime must either complete the combined live
READY1/REVIEW1 cases above or explicitly retain that environment gap; automated
tests are not live-database or browser proof.

## 15. In scope

- a Moderator-only active-Draft review view inside Recipes;
- one indexed Draft list query with title search and server pagination;
- newest-updated ordering;
- selection-time READY1 evaluation of the exact saved version;
- server issue, readiness, and DUP1 evidence presentation;
- retry/stale-response/focus/accessibility behavior;
- opening the existing Draft authoring flow; and
- focused API/Admin tests and the stated runtime gates.

## 16. Out of scope

- assignment, ownership, priority, comments, due dates, SLA, or task lifecycle;
- a Review model, collection, queue document, persisted readiness, fingerprint,
  acknowledgement, issue summary, or denormalized Recipe field;
- community Recipe submission or Community-post changes;
- bulk selection, bulk review, bulk publish, auto-publish, or auto-archive;
- AI suggestions, scoring, semantic classification, or content generation;
- client reimplementation of READY1 or DUP1 rules;
- list-wide readiness/DUP1 precomputation or polling;
- editing, publishing, or duplicate acknowledgement inside the REVIEW1 panel;
- role/capability redesign, Admin write access, mobile UI, notifications, or
  Dashboard metrics; and
- model/index/migration/package/lockfile changes.

## 17. Blockers and residual boundaries

There is no architecture or contract blocker to implementing REVIEW1 within
the exact allowlists. The existing Recipe fields, staff serializer, READY1
endpoint, capability model, and compound index are sufficient.

The following are boundaries, not audit blockers:

- readiness is on-demand for the selected saved Draft, so unselected rows
  truthfully remain `Not checked`;
- the view excludes archived Drafts by design; they remain in Catalog;
- READY1 may return no DUP1 result until earlier publication gates pass;
- the READY1 projection does not satisfy the actual Publish request's explicit
  Filipino-cuisine confirmation and grants no mutation authority;
- DUP1 remains a bounded current comparison, not uniqueness enforcement; and
- live MongoDB, query-plan, browser, keyboard, screen-reader, zoom, and runtime
  authorization evidence is deferred to implementation and must not be
  claimed by this audit.

## 18. Audit-time Git and stash state

The final audit commands are recorded after creation of this milestone:

```text
git diff --check
git status --short --branch
git stash list
```

No file is staged, committed, or pushed. The protected Cook Mode stash is
listed only for status and is not inspected, applied, popped, dropped, or
otherwise manipulated.

## 19. Verdict

**REVIEW1 AUDIT PASS - READY FOR IMPLEMENTATION**

## 20. Implementation evidence (2026-09-30)

Implemented on `feat/moderator-ops-review1-draft-review-view` from frozen
baseline `0c22f2eba3dbd8a8e0b6725b783e17fffedca7af` within the production and test
allowlists above.

- The existing Recipe list now accepts only the optional literal Draft filter
  and the named `updatedDesc` sort. The guarded route validates first, then
  delegates Draft-list authorization to `catalog.write`; the controller and
  service reuse the existing repository, serializer, count, pagination, and
  compound index shape.
- The Moderator-only Recipes view switch mounts a Draft review list using one
  active-Draft request. READY1 remains selection-driven and receives only the
  selected row's `expectedUpdatedAt`; the view makes no direct DUP1 call and
  contains no client publication-readiness rules.
- Mounted production-path coverage proves zero READY1 calls on entry, one per
  explicit selection, response identity/version checks, rapid-selection race
  rejection, search/page/refresh invalidation, issue and duplicate projection
  rendering, retry/conflict states, and the existing Open Draft authoring path.
- Focused API files passed `190/190`; the focused mounted Admin file passed
  `4/4`. The full API suite passed `1720/1720` and the full Admin suite passed
  `233/233`. The ordinary sandbox full-API command hit the known worker
  `spawn EPERM` boundary before execution; the identical command passed outside
  that boundary.
- The Admin production build passed outside the sandbox after the initial
  Vite/esbuild `spawn EPERM` boundary. No package or lockfile changed.

Live development-MongoDB membership/query-plan checks and real-browser,
keyboard, accessibility-tree, zoom, theme, screen-reader, and live network
instrumentation remain runtime gates; this automated implementation evidence
does not claim them.
