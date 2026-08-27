# Admin ↔ REST API integration — Substitutions slice

Second slice of connecting the React admin app (`apps/admin`) to the Express
REST API (`apps/api`) instead of Firebase/Firestore. Follows
[admin-api-integration.md](./admin-api-integration.md) (slice 1: shared client,
backend auth, Ingredients) and consumes the domain described in
[ingredients-substitutions.md](./ingredients-substitutions.md). See
[backend.md](./backend.md) for the API's layered conventions.

Target end state (unchanged):

```
Admin React  ->  frontend service layer  ->  Express REST API  ->  MongoDB
```

## Scope of this slice

**In:**

- Substitution management: service (`src/substitutionApi.js`) + enum/limit
  mirror (`src/substitutionOptions.js`) + a new **Substitutions** admin tab
  (`src/SubstitutionsTab.jsx`) — list, filter, sort, paginate, create, edit,
  archive, restore — talking only to `/api/v1/substitutions`.
- A name-based ingredient picker (in `SubstitutionsTab.jsx`) that resolves
  canonical ingredient names to public ids via the existing
  `/api/v1/ingredients` service. The admin never types a Mongo id.

**Explicitly out (left exactly as they were):**

- Recipes REST migration, Users / admin-management migration.
- Favorites, Shopping List, Recommendations, AI, Mobile.
- The Overview / Recipes / Users tabs (still Firestore).
- Google sign-in, email verification, password reset/change, profile edit.
- Any new backend endpoint or backend change. `apps/api` is untouched.
- Broad Firebase removal. No Firebase code was added or deleted in this slice.
- HttpOnly-cookie refresh auth (later auth-hardening task).

## REST integration structure

```
src/apiClient.js          shared client (slice 1, unchanged)
src/backendAuth.js        backend session + useBackendAuth() (slice 1, unchanged)
src/ingredientApi.js      ingredient feature service (slice 1) — reused by the picker
src/substitutionApi.js    substitution feature service — one function per operation
                          actually used (list / create / update / archive / restore);
                          the backend GET-by-id is deliberately not wrapped
src/substitutionOptions.js frontend-safe mirror of the backend status/sort enums
                          and the contexts/notes length limits
src/SubstitutionsTab.jsx  the Substitutions screen: useSubstitutions() hook + table
                          + filters + IngredientPicker + create/edit modal
```

Data path (the only one for substitution business data):

```
SubstitutionsTab / useSubstitutions
  -> substitutionApi.*
  -> apiClient (api.get/post/patch/del)
  -> fetch  ->  /api/v1/substitutions  ->  MongoDB
```

Components never call `fetch` directly and never import `apiClient` except via a
feature service. No new fetch wrapper, no new auth store, no new token
storage — slice 1's `apiClient` + `backendAuth` are used verbatim.

## Backend contract consumed

Discovered by reading `apps/api/src/modules/substitutions/*` and its tests — not
from memory.

| Function | Endpoint | Auth |
| --- | --- | --- |
| `listSubstitutions({ sourceIngredientId, substituteIngredientId, context, status, sort, page, limit })` | `GET /api/v1/substitutions` | any authenticated |
| `createSubstitution({ sourceIngredientId, substituteIngredientId, ratio, contexts, notes })` | `POST /api/v1/substitutions` | admin |
| `updateSubstitution(id, patch)` | `PATCH /api/v1/substitutions/:id` | admin |
| `archiveSubstitution(id)` | `DELETE /api/v1/substitutions/:id` | admin (soft archive) |
| `restoreSubstitution(id)` | `PATCH /api/v1/substitutions/:id { isActive: true }` | admin |

`GET /api/v1/substitutions/:id` exists on the backend but is **not** wrapped in
`substitutionApi.js` — the list serializer already inlines every field the table
and the edit modal render, so this slice never needs a single-resource read.
It can be added when a future slice has a concrete use.

### Serializer shape (`substitution.serializer.js`)

```jsonc
{
  "id": "…",
  "sourceIngredient":     { "id": "…", "name": "Butter" },   // or null
  "substituteIngredient": { "id": "…", "name": "Olive Oil" }, // or null
  "ratio": { "sourceAmount": 1, "substituteAmount": 0.75 },
  "contexts": ["baking"],
  "notes": "…",         // or null
  "isActive": true,
  "createdAt": "…",
  "updatedAt": "…"
}
```

- Public JSON uses `id`, never `_id`. The referenced ingredients are inlined as
  `{ id, name }` only — `isActive`/`normalizedName`/other internal ingredient
  fields are never exposed on the nested summary.
- `ratio` is an explicit `{ sourceAmount, substituteAmount }` subdocument, both
  finite numbers greater than zero. **No unit conversion** is done anywhere —
  backend or frontend. The UI renders it literally as `sourceAmount : substituteAmount`
  and sends the admin's exact numbers back.
- `contexts` is free-text (max 10 entries, 40 chars each), deduplicated
  case-insensitively **by the backend**. The frontend does not normalize
  contexts beyond trimming/splitting the comma-separated input for display.

### List query capabilities (used, not re-implemented in the browser)

`status` (`active` default / `inactive` / `all` — the last two admin-only,
enforced server-side), `sort` (`newest` default / `oldest` — the ingredient
`nameAsc`/`nameDesc` values are **not** valid here), `page` (default 1),
`limit` (default 20, cap 100), plus three filters: `sourceIngredientId`,
`substituteIngredientId`, and `context` (an **exact, case-sensitive** match
against one entry of the `contexts` array). The tab exposes all of these; it
does no client-side filtering of the returned page.

Response envelope: `{ substitutions: [...], pagination: { page, limit, total, totalPages } }`.

### Error codes handled

| Code | Status | UI treatment |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | per-field messages in the modal from `error.details` (field paths `sourceIngredientId`, `substituteIngredientId`, `ratio.*`, `contexts.*`, `notes`) |
| `SUBSTITUTION_SAME_INGREDIENT` | 400 | safe backend message on the modal (also pre-checked client-side for UX) |
| `INGREDIENT_INACTIVE` | 400 | safe backend message on the modal (rare — picker only offers active ingredients) |
| `INGREDIENT_NOT_FOUND` | 404 | safe backend message on the modal |
| `SUBSTITUTION_NOT_FOUND` | 404 | row/modal error line |
| `SUBSTITUTION_ALREADY_EXISTS` | 409 | the backend's safe message ("This substitution relationship already exists.") — **never** `E11000`, index names, or collection names |
| `FORBIDDEN` | 403 | the backend's safe permission message |
| 401 | 401 | "session expired"; slice 1's one transparent refresh+retry applies, and the app returns to sign-in if that also fails |
| network | — | slice 1's friendly "unable to reach the API" line, with a Retry button on the list |

Raw internal errors are never shown; `apiClient` already maps Mongo driver
errors to stable codes before they reach the client.

## Ingredient selector

`SubstitutionsTab.jsx` contains an `IngredientPicker` combobox used in three
places, in two modes controlled by a single `searchStatus` prop:

| Usage | `searchStatus` | Why |
| --- | --- | --- |
| Create / edit modal — source & substitute fields | `'active'` (default) | The backend rejects a substitution that references an archived ingredient on **create or reactivation** (`INGREDIENT_INACTIVE`), so a replacement can only ever be a currently-active ingredient. |
| List filters — source & substitute | `'all'` | An admin narrowing the **Archived** / **All** substitution views to one specific archived ingredient (to find and clean up its relationships) must be able to pick that archived ingredient. Archived hits in the dropdown are labelled `archived` so the admin is never misled into thinking one is active. |

- Typing debounces (250 ms) a call to
  `listIngredients({ search, status: searchStatus, sort: 'nameAsc', limit: 10 })`
  and shows matching ingredients by name. Selecting one stores a `{ id, name }`
  pair (never the ingredient's `isActive` flag); only the `id` is ever sent to
  the substitution API.
- In edit mode the current source/substitute come straight from the list
  serializer's inlined `{ id, name }` — no extra fetch to render them. This is
  the one place an archived ingredient can appear as a selected value; the
  picker shows only its name (no active/inactive claim), and a notes/contexts/
  ratio-only PATCH does not force replacing it (the backend only re-validates a
  side that is being changed, or both sides on reactivation).
- Each picker instance carries its own monotonic request-id guard, so a slow
  earlier search can never overwrite a newer result. Closing the modal unmounts
  its pickers and cancels any in-flight ingredient search before it can call
  `setState`.
- If the ingredient search request fails, the dropdown shows a safe inline
  error and the admin can retype to retry; a failed search never wipes an
  already-selected valid value, and the rest of the form still works.
- The picker cannot drift: once a value is selected it renders as a read-only
  chip, so there is no way to keep typing free text while the old id is still
  held. Clearing the chip clears the id.

## Create behavior

`POST` sends exactly `{ sourceIngredientId, substituteIngredientId, ratio, contexts }`
plus `notes` only when non-empty (the backend body schema is `.strict()`).
Client-side, before the request: both ingredients required and different; both
ratio amounts must parse to finite numbers `> 0`; contexts ≤ 10 and ≤ 40 chars
each; notes ≤ 500 chars. These are UX guards only — the backend Zod schema
remains authoritative and its field errors are surfaced inline.

The ratio form pre-fills `sourceAmount` to `1` (the natural reference quantity)
and leaves `substituteAmount` empty so the admin makes an explicit choice for
the part that carries the domain meaning. No other defaults are invented.

## Edit / PATCH behavior

The modal builds a **minimal patch** — only fields whose value actually changed
versus the loaded substitution:

- `sourceIngredientId` / `substituteIngredientId` — only if the picked id differs.
- `ratio` — sent as the whole `{ sourceAmount, substituteAmount }` object if
  either number changed (the backend replaces `ratio` wholesale).
- `contexts` — only if the parsed array differs (order-sensitive compare).
- `notes` — only if the trimmed text differs; an emptied field sends `""` to
  clear it.
- `isActive` — only if the status toggle moved.

An unchanged save is a no-op (the modal just closes; the API rejects an empty
patch anyway). Fields the backend owns internally (`id`, `createdAt`,
`updatedAt`, the nested ingredient summaries) are never written back. The whole
displayed object is never blindly serialized to the API.

## Archive / restore

`DELETE` is a **soft archive** (`isActive: false`), never a physical delete —
the same contract as ingredients:

- The row action is labelled **Archive** (icon + "Archive?" confirm), not Delete.
- Archived rows show an **Archived** status pill and a **Restore** action.
- Restore is `PATCH { isActive: true }`. The backend additionally re-checks that
  **both** referenced ingredients are still active before allowing reactivation;
  if not, it returns `INGREDIENT_INACTIVE` and the UI shows that safe message.
- Row mutations are serialized by a `busyRowId` flag: a second click on
  Archive-confirm / Restore while a request is in flight is ignored, and both
  buttons are disabled (confirm shows "Archiving…") for that row until it
  settles — no duplicate archive/restore request. The create/edit modal has the
  equivalent `saving` guard (covers an Enter-key double submit too).
- A mutation error is stored as `{ id, message }` and rendered only on the
  matching row; success bumps a `nonce` in `useSubstitutions`, which refetches
  the current server-owned list.

## Search / filter / sort / pagination

All server-owned. `useSubstitutions` holds `{ source, substitute, context,
status, sort, page }`, debounces 250 ms, and applies slice 1's stale-request
guard (a `cancelled` flag per effect run) so a slow older query never
overwrites a newer page. Any filter change resets to page 1; the pager only
appears when `totalPages > 1`.

### Known backend count imprecision (surfaced, not worked around)

Per [ingredients-substitutions.md](./ingredients-substitutions.md), in the
`active` view the backend trims rows whose referenced ingredient was archived
*after* the page was fetched, so `pagination.total` / `totalPages` can slightly
overcount and a page can show fewer than `limit` rows. The tab shows a small
one-line note explaining this in the active view rather than trying to
re-compute counts in the browser (which would mean re-implementing the backend's
filtering contract client-side).

## Stale / archived ingredient relationships

- The `active` list view already excludes any substitution whose source or
  substitute ingredient is archived (backend read-time filter) — the frontend
  does not need to guess.
- In the `all` / `inactive` admin views, a substitution that references an
  archived ingredient still comes back with that ingredient's **name** inlined
  (soft delete keeps the document, so the populate resolves). The table shows
  the name normally; no internal `isActive` flag is exposed for the nested
  ingredient, so the UI does not (and cannot) badge it.
- If a nested `sourceIngredient` / `substituteIngredient` is `null` (the ref did
  not resolve at all), the cell renders a muted "Unavailable" instead of
  crashing. Editing such a row requires picking a valid active ingredient for
  that side before saving — the frontend never bypasses the backend's
  availability rules.

## Firebase boundary

**Firebase business-data usage for substitutions: ZERO.** The admin had no
substitution UI before this slice, so — exactly like ingredients — the
Substitutions tab is REST-only from day one. There is no dual
(`component -> Firestore` **and** `component -> REST`) path, no Firebase
fallback, and no new Firestore collection or path.

No Firebase/Firestore dependency or code was added or removed. `firebase.js`,
`auth.js`, `firestore.js` are byte-for-byte unchanged.

### Firebase still in use elsewhere (unchanged temporary debt — later slices)

| Area | Firebase use | Removal slice |
| --- | --- | --- |
| Overview / Recipes / Users tabs | Firestore `recipes`, `users` | Recipes slice, Users/admin-management slice |
| "Report a problem" | Firestore `reports` | later |
| Sign-up, forgot/reset password, profile edit, password change, email verification, delete account | Firebase Auth | auth-hardening slice(s) |
| Legacy session for the Firestore tabs | best-effort `signInWithEmailAndPassword` during login | when the last Firestore tab migrates |

## Auth / API foundation reuse (slice 1, untouched)

- `apiClient.js` — same base URL resolution, same `{ success, data }` /
  `{ success, error }` envelope handling, same `ApiError` with
  `isNetworkError` / `isUnauthorized` / `isForbidden` / `isNotFound` /
  `isConflict` / `isValidationError`, same single transparent refresh+retry on
  401. Not modified.
- `backendAuth.js` — same in-memory access token, same `sessionStorage` refresh
  token, same `useBackendAuth()` gate. Not modified. Substitution mutations rely
  entirely on the API's `authorize('admin')`; the admin-gated dashboard is
  defense-in-depth, not the enforcement point.
- No `userId`/ownership fields are sent (substitutions have no per-user
  ownership). No `role` is sent anywhere.

## Slice 1 regression check

- Backend admin login still works (auth path unchanged).
- Ingredients tab unchanged and still functional (`ingredientApi.js` /
  `ingredientOptions.js` are imported read-only by the picker; not edited).
- Overview / Recipes / Users tabs unchanged.
- No duplicate auth/API infrastructure introduced.
- `npm run build --workspace=apps/admin` succeeds.
- `npm test --workspace=apps/api` — 556 passed, 0 failed (backend untouched).

## Intentionally deferred

- Recipes REST migration; Users / admin-management (needs new backend
  endpoints — design first); auth hardening (HttpOnly refresh cookie).
- A dedicated "what can replace X / what is X a substitute for" reverse-lookup
  view — the two ingredient filters already cover both directions.
- Bulk actions, CSV import/export.
- Any cascade UI for "archive this ingredient → its substitutions" — the
  backend deliberately has no cascade (read-time filtering instead), and this
  slice does not add one.