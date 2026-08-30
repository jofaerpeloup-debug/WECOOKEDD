# Admin Users — Firestore → REST migration (Phase B)

Moves the admin app's **Users** tab off Firestore onto the Express REST API.
Phase A ([admin-users-backend-api.md](./admin-users-backend-api.md)) added the
backend endpoints; this slice is the frontend half. Reuses the shared
`apiClient` / `backendAuth` from the first admin slice unchanged
([admin-api-integration.md](./admin-api-integration.md)).

After this slice the admin app has **zero Firestore reads/writes for user
business data**. The Firestore `users` collection, the `subscribeUsers`
subscription, and the demo-seed helpers are gone.

## Data path

```
UsersTab / useUsers
  -> userApi.listUsers / userApi.updateUser
  -> apiClient (api.get / api.patch)
  -> fetch  ->  /api/v1/users  ->  MongoDB
```

Components never call `fetch` and never import `apiClient` except via
`userApi.js`. `UsersTab` **must not** import `backendAuth` / `useBackendAuth`
— `App.jsx` owns the single backend-auth hook instance and passes what the tab
needs as props.

## Files

| File | Role |
| --- | --- |
| `src/userApi.js` (new) | feature service: `listUsers(params)`, `updateUser(userId, patch)`, plus `suspendUser` / `reactivateUser` status wrappers (no role wrapper — see below) |
| `src/userOptions.js` (new) | frontend-safe mirror of the backend role / status / sort enums (+ label maps) |
| `src/UsersTab.jsx` (new) | the Users screen: `useUsers()` hook + table + filters + inline row confirmations |
| `src/App.jsx` (modified) | renders `<UsersTab>`; removed the Firestore users state / subscription / legacy tab+modal / seed plumbing; Overview user counts now come from REST |
| `src/firestore.js` (modified) | removed `subscribeUsers` / `saveUserDoc` / `deleteUserDoc` / `seedCollection`; kept `submitReportDoc` |

## `userApi.js`

| Function | Endpoint | Notes |
| --- | --- | --- |
| `listUsers({ search, role, status, sort, page, limit })` | `GET /api/v1/users` | admin only |
| `updateUser(userId, { role?, status? })` | `PATCH /api/v1/users/:userId` | admin only, strict body |
| `suspendUser(userId)` / `reactivateUser(userId)` | `updateUser(userId, { status })` | thin status-only wrappers |

- **No** create, **no** delete, **no** GET-by-id — the backend has no such
  route (same decision as the Recipes / Substitutions slices).
- **No role wrapper.** `updateUser` stays generic (`{ role?, status? }`) to
  match the Phase A backend contract, but the Users UI never passes `role` —
  see "Users V1 — supported actions" below.
- **`page` / `limit` normalization.** The list query schema coerces with
  `z.coerce.number().int().min(1)`, so a stray `NaN` (`Number(undefined)`,
  `Number('')`) becomes a `400 VALIDATION_ERROR`. `userApi` runs each through
  `toPosInt` — a value is sent only when it is a finite positive integer,
  otherwise it is omitted and the backend default (`page: 1`, `limit: 20`)
  applies. `NaN` / `'abc'` / `undefined` / `0` / `-1` → param omitted;
  `2` / `'2'` → `2`.
- `search` / `role` / `status` / `sort` are passed straight through;
  `apiClient`'s `buildUrl` drops `undefined` / `null` / `''`, so the
  empty-string "All" sentinel for the filters means "param not sent".

## Users V1 — supported actions

The Users tab manages **account status only**:

| Action | PATCH body | Row control |
| --- | --- | --- |
| Suspend another user/admin | `{ status: 'suspended' }` | ban icon (active rows) |
| Reactivate another user/admin | `{ status: 'active' }` | restore icon (suspended rows) |

Each non-self row shows exactly **one** action: Suspend when `status` is
`active`, Reactivate when `status` is `suspended`. The action opens an
**inline confirmation** in the row showing the locked copy below, then
`Confirm` / `Cancel`.

### Role is read-only in this UI

- The role is **displayed** (a pill per row) and **filterable**
  (`GET /api/v1/users?role=user|admin`).
- The role is **never mutated** from the Admin Users screen. There is no
  Promote / Demote control.
- `PATCH /api/v1/users/:userId` still technically accepts `role` **and**
  `status` because Phase A shipped that backend contract
  ([admin-users-backend-api.md](./admin-users-backend-api.md)). Admin Users V1
  **deliberately exposes status transitions only**. Do **not** re-add
  Promote / Demote merely because the backend supports role PATCH — that is a
  product decision, not a technical limitation.
- There is no in-app admin-promotion flow. Granting admin access is done
  directly in MongoDB (registration always creates `role: "user"`; there is no
  provisioning endpoint).

### Unsupported — deliberately not built

Promote / demote (role mutation) · create user · delete user · edit name /
email · password reset or change · `emailVerified` mutation · preferences /
allergies / dietary editing. The `PATCH` body is a strict `{ role?, status? }`
and the backend has no route for the rest; role mutation is a product-policy
exclusion, not a backend gap. There is no "Add user" button and no edit modal.

## List UX

`useUsers()` owns server-side search / filter / sort / pagination, mirroring
`useRecipes` / `useIngredients` / `useSubstitutions`:

- Filters: `search` (name or email, debounced 250 ms), `role` (All / User /
  Admin), `status` (All / Active / Suspended), `sort` (Newest / Oldest / Name
  A–Z / Name Z–A).
- **Any filter change resets `page` to 1**; explicit pager moves do not.
- **Backend pagination is authoritative** — the footer renders
  `pagination.page` / `pagination.totalPages` from the response, never a
  client count.
- **Stale-response guard**: the fetch effect's `cancelled` flag means a
  superseded request can never write state (every `filters` / `nonce` change
  tears down the closure). No request-generation framework — same pattern as
  the shipped REST tabs.
- Previous rows stay on screen during a refetch (`loading` is set without
  clearing `items`).
- Displayed fields: `name`, `email`, `role` (pill), `status` (pill),
  `emailVerified` (check / "—"), `createdAt` (formatted). `updatedAt` is shown
  only as a tooltip on the Joined cell.
- `UsersTab` defines its **own ISO-safe `formatDate`** — it must not reuse
  `App.jsx`'s date-only helper, which appends `T00:00:00` and cannot parse the
  full ISO timestamps the serializer returns.

## Mutations — pessimistic, single-flight

```
open inline confirm -> Confirm -> PATCH -> authoritative list reload (reload())
```

- **No optimistic row mutation, no mutation queue.** The row's new state comes
  from the reload, not from local edits.
- **Synchronous tab-global single-flight lock**: `rowBusyRef` (a `useRef` set
  before any re-render) plus `busyRowId` state. `runAction` returns early if
  either is set, so a rapid double-click — or a click on row B while row A is
  in flight — cannot send a second PATCH. All row buttons are disabled while
  any mutation is in flight. Same guard as `RecipesTab`.
- `USER_NOT_FOUND` from a PATCH → a dismissible notice ("that user no longer
  exists — the list has been refreshed") **and** an authoritative `reload()`,
  because the list is stale.

## Self-protection — UX + backend

The acting admin's own row is identified with
`String(row.id) === String(currentUserId)`, where `currentUserId` is
`backend.user.id` — the canonical `String(_id)` from the same serializer path
as the list rows, so a plain string compare is safe (no ObjectId casing
issue).

On that row: a **"You"** chip on the name, and the action cell renders **"—"**
(no Suspend / Reactivate button). This is **UX only**. The backend's
`403 ADMIN_CANNOT_MODIFY_SELF` (it blocks self-demotion **and** self-suspension)
remains the authoritative guard — if a self status-PATCH were somehow issued,
it still fails and the message is shown inline on the row.

## Authority-loss handling

`App.jsx` passes `onAuthorityLost={() => backend.refreshUser().catch(() => {})}`.
`UsersTab` holds it in a ref (App re-creates the arrow each render) so it never
re-triggers the list effect.

- **`err.code === 'FORBIDDEN'`** on a Users request (list GET or a PATCH) means
  this admin lost admin authority elsewhere. The tab shows a safe inline
  message and calls `onAuthorityLost()`. `backend.refreshUser()` re-reads
  `GET /users/me`; if the role is now `user`, `App`'s existing gate
  (`backend.user?.role !== 'admin'`) re-renders into `AccessDeniedScreen`.
- **`err.code === 'ADMIN_CANNOT_MODIFY_SELF'`** (also 403) shows the safe
  message but does **not** call `onAuthorityLost` — it is expected, and the
  self row already exposes no status action (kept as a defensive fallback for
  the case where `currentUserId` is unavailable).

`backendAuth.js` and `apiClient.js` are unchanged.

## Error handling

| Code / condition | Message placement |
| --- | --- |
| `VALIDATION_ERROR` (400) | inline on the row (effectively unreachable — all inputs are controlled) |
| `USER_NOT_FOUND` (404) | dismissible notice + list reload |
| `ADMIN_CANNOT_MODIFY_SELF` (403) | inline on the row, no reload, no authority refresh |
| `FORBIDDEN` (403) | notice + `onAuthorityLost()` (App re-gates) |
| `AUTH_*` / session (401) | handled by `apiClient`'s one transparent refresh+retry; a hard failure returns the whole app to the sign-in screen |
| `RATE_LIMIT_EXCEEDED` (429) | inline / notice — the backend's safe message |
| network / 5xx | list-level error banner with Retry (load) or inline on the row (mutation) |

No raw backend/Mongo internals are shown — `ApiError.message` is always the
backend's safe `error.message` or one of ours.

## Locked status-action copy

| Action | Copy |
| --- | --- |
| Suspend account | "Signs the user out and blocks access until reactivated." |
| Reactivate account | "Reactivates the account. The user must sign in again." |

Deliberately avoids "immediately" / "instantly" / "kills every session". The
backend model ([user.service.js](../../apps/api/src/modules/users/user.service.js)):
suspend persists `status: 'suspended'` then best-effort revokes sessions
(`status` is authoritative for `authenticate`/`login` regardless); reactivate
revokes sessions **first**, then persists `status: 'active'`, so prior sessions
stay dead and the user must sign in again. There is no role-action copy —
role is not mutated from this UI.

## Overview REST metrics

The Overview tab's user cards no longer read Firestore. On entering the
Overview tab (and behind the authenticated-admin gate), `App.jsx` issues:

```
Promise.all([
  listUsers({ limit: 1 }),                       // -> pagination.total = Total Users
  listUsers({ limit: 1, status: 'active' }),      // -> pagination.total = Active Users
  listUsers({ limit: 1, status: 'suspended' }),   // -> pagination.total = Suspended Users
])
```

Only `pagination.total` is used; `limit: 1` keeps the payload minimal. The
four-card layout is kept: **Total Users · Active Users · Suspended Users ·
Total Recipes** (the old Firestore-only "Avg. Recipes Saved" card is gone —
there is no backend equivalent for a per-user saved-recipe average). Counts
refresh each time the admin returns to Overview, so a suspend / reactivate
done on the Users tab is reflected.

## Firebase boundary (unchanged by this slice)

Still Firebase, still working:

- `firebase.js` / `auth.js` — **kept**. `db` backs `submitReportDoc`; `auth`
  backs every account flow.
- `auth.onAuthStateChanged` in `App.jsx` — **kept** (feeds the profile menu /
  Settings / Report identity). It no longer sets an `authenticated` flag —
  that flag existed only to gate the removed Firestore users subscription.
- Best-effort Firebase sign-in mirror in `signIn` — **kept** (so Report and
  the account flows work for admins who also exist in Firebase).
- "Report a problem" → `submitReportDoc` → Firestore `reports` — **kept**.
- Sign-up, forgot/reset password, profile edit, password change, email
  verification, delete account — **kept** (Firebase Auth; own later slice).

No Firebase package was added or removed.

## Smoke-test expectations

With the API running and DevTools Network filtered to
`firestore.googleapis.com` for the whole session:

1. Backend admin login → dashboard renders.
2. Users tab lists real Mongo users (`GET /api/v1/users?...limit=20`); **no**
   Firestore `users` request.
3. Search → debounced `?search=`; page resets to 1.
4. Role filter → `?role=admin` / `?role=user` (read-only filter — the role
   column stays visible, and **no Promote / Demote control appears on any
   row**, admin or user).
5. Status filter → `?status=active` / `?status=suspended`.
6. Sort → `?sort=nameAsc` etc.
7. Pagination controls issue `?page=n`; footer tracks
   `pagination.page`/`totalPages`. (With < 20 users, verify the footer hides
   at `totalPages === 1`; the backend paging is covered by API tests. Do not
   create users just to reach page 2.)
8. Each non-self row shows exactly one action button: Suspend on active rows,
   Reactivate on suspended rows. No shield / promote / demote icons anywhere.
9. Suspend a disposable target → inline confirm shows the Suspend copy →
   Confirm → `PATCH { status: 'suspended' }` → status pill flips after reload;
   the target's next API call → 401.
10. Suspended login blocked → `403 AUTH_ACCOUNT_SUSPENDED`.
11. Reactivate the target → `PATCH { status: 'active' }`; prior sessions stay
    dead; a fresh login succeeds.
12. Self row → "You" chip, action cell renders "—" (no usable status
    mutation); a forced self status-PATCH → inline `ADMIN_CANNOT_MODIFY_SELF`.
13. Non-admin token → `GET`/`PATCH /api/v1/users` → `403 FORBIDDEN`.
14. Rapid double-click Suspend (and separately Reactivate) → exactly one PATCH
    in Network; other rows' buttons disabled while in flight.
15. Overview cards populate from `GET /users?limit=1[&status=…]`; no Firestore
    `users` read.
16. "Report a problem" still writes to Firestore `reports`; Settings profile /
    password still work (Firebase Auth).
17. `npm --workspace apps/admin run build` succeeds.
18. `apps/api` regression: `node --test` → 619 passed, 0 failed (unchanged).

Restore any status changes made while smoke-testing before committing.