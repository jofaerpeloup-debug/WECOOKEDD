# Admin ↔ REST API integration

First slice of connecting the React admin app (`apps/admin`) to the Express
REST API (`apps/api`) instead of Firebase/Firestore. See
[backend.md](./backend.md) for the API's layered conventions,
[authentication-security.md](./authentication-security.md) for the auth/session
design, and [ingredients-substitutions.md](./ingredients-substitutions.md) for
the ingredient domain this slice consumes.

Target end state:

```
Admin React  ->  frontend service layer  ->  Express REST API  ->  MongoDB
```

## Scope of this slice

**In:**

- Shared REST API client (`src/apiClient.js`).
- Backend local-auth login/session handling (`src/backendAuth.js`), authoritative
  for the dashboard gate and every API call.
- Ingredient management: service (`src/ingredientApi.js`) + a new **Ingredients**
  admin tab (`src/IngredientsTab.jsx`) — list, search, filter, create, edit,
  archive, restore — talking only to `/api/v1/ingredients`.

**Explicitly out (left exactly as they were, reported as deferred):**

- Substitutions REST migration, Recipes REST migration.
- The Overview / Recipes / Users tabs (still Firestore).
- Admin user management, profile editing, email verification, password
  reset/change, Google sign-in — these need backend capabilities that do not
  exist yet. Their existing Firebase behavior is untouched; no mock/substitute
  backend was added for them.
- Mobile integration, Community, Recommendations, AI.
- HttpOnly-cookie refresh auth (later auth-hardening task).

## REST integration structure

```
src/apiClient.js        shared client: base URL, JSON, token attach, envelope
                        parsing, error normalization, one transparent refresh+retry
src/backendAuth.js      backend session: login / logout / restore, token store,
                        useBackendAuth() hook; registers the token adapter on apiClient
src/ingredientApi.js    ingredient feature service (thin, one function per endpoint)
src/ingredientOptions.js frontend-safe mirror of the backend category / allergen /
                        sort enums (+ display labels)
src/IngredientsTab.jsx  the Ingredients screen: useIngredients() hook + table +
                        filters + create/edit modal
```

Data path (the only one for ingredient business data after this slice):

```
IngredientsTab / useIngredients
  -> ingredientApi.*
  -> apiClient (api.get/post/patch/del)
  -> fetch  ->  /api/v1/ingredients  ->  MongoDB
```

Components never call `fetch` directly and never import `apiClient` except via a
feature service. There is one `API_BASE_URL` (see below), never inline localhost
strings.

### Response envelope handling

`apiClient` unwraps the backend contract:

- Success `{ success: true, data }` → returns `data`.
- Error `{ success: false, error: { code, message, details } }` → throws an
  `ApiError` carrying `code`, `status`, `message`, `details`.
- Transport failure (server down, DNS, offline) → throws an `ApiError` with
  `kind: "network"` and a friendly message — distinct from an API rejection
  (`kind: "api"`). `ApiError.isNetworkError` / `isUnauthorized` / `isForbidden` /
  `isNotFound` / `isConflict` / `isValidationError` are the checks used by the UI.

Raw internal errors are never shown. `ApiError.message` for an API rejection is
always the backend's safe `error.message`; for a network failure it is one of
ours. Mongo details (`E11000`, index names) never reach the client — the API
already maps them to stable codes.

## Auth flow used in this slice

The admin login screen now authenticates against the **backend**:

```
Sign-in form
  -> backendAuth.login(email, password)
       POST /api/v1/auth/login        { email, password }        (no role in body)
       -> { user, accessToken, refreshToken }
       GET  /api/v1/users/me          -> fresh { user }          (role confirmed here)
  -> (best effort) firebase signInWithEmailAndPassword(email, password)
```

- **Backend is authoritative.** The dashboard renders only when
  `backend.status === "authenticated"` **and** `backend.user.role === "admin"`,
  where `role` comes from `GET /users/me` (current DB value), not from anything
  the client supplies. A non-admin backend user gets the `AccessDeniedScreen`.
- **`role` is never sent** in the login request (the backend login schema is
  `.strict()` and would reject it anyway).
- **Firebase sign-in runs alongside, best effort only**, so the not-yet-migrated
  Firestore tabs (Overview / Recipes / Users) keep working for an admin whose
  same email/password also exist in Firebase. If it fails (backend-only admin,
  different password), it is logged and ignored — it never blocks login and the
  dashboard still loads; those Firestore tabs then render their empty states.
- `logout` calls `POST /api/v1/auth/logout` (revokes the session) then clears
  local tokens, and also best-effort `firebase signOut`.
- Sign-up, "forgot password", profile edit, password change, email
  verification, "delete admin account" remain **Firebase-only** and are
  **deferred** — there is no backend endpoint for them in scope. An account
  created via sign-up cannot reach the dashboard until it exists in the backend
  with `role: "admin"`.

### Access / refresh token behavior in this slice

| Token | Where it lives | Notes |
| --- | --- | --- |
| Access token | **In memory only** (module scope in `backendAuth.js`). Never persisted. | Sent as `Authorization: Bearer <token>`. ~15 min TTL. |
| Refresh token | In memory **+ mirrored to `sessionStorage`** (`wecooked.admin.refreshToken`). | Per-tab, cleared on tab close. Used to rebuild the session on page reload and to transparently refresh an expired access token. |

- On page load, if a refresh token is in `sessionStorage`, the app calls
  `POST /api/v1/auth/refresh` (rotating it) then `GET /users/me` to restore the
  session; any failure clears it and shows the sign-in screen.
- On any authenticated request that returns `401`, `apiClient` calls
  `refresh` once and retries the request once. If refresh fails, the session is
  cleared and the UI returns to sign-in.
- Refresh-token transport is the backend's **current JSON dev behavior**
  (token in request/response body). This is a temporary compromise — see below.

## Ingredient migration

`src/ingredientApi.js` covers the full backend surface:

| Function | Endpoint | Auth |
| --- | --- | --- |
| `listIngredients({ search, category, allergen, status, sort, page, limit })` | `GET /api/v1/ingredients` | any authenticated |
| `getIngredient(id)` | `GET /api/v1/ingredients/:id` | any authenticated |
| `createIngredient({ name, aliases, category, allergenTags })` | `POST /api/v1/ingredients` | admin |
| `updateIngredient(id, patch)` | `PATCH /api/v1/ingredients/:id` | admin |
| `archiveIngredient(id)` | `DELETE /api/v1/ingredients/:id` | admin (soft archive) |
| `restoreIngredient(id)` | `PATCH /api/v1/ingredients/:id { isActive: true }` | admin |

Contract details honored by the UI:

- Public JSON uses `id` (never `_id`). `normalizedName`, `_id`, `__v` are never
  read or sent.
- Create sends exactly `{ name, aliases, category, allergenTags }`. Edit sends a
  **minimal patch** — only the fields that actually changed — so an unchanged
  save is a no-op and the API never re-normalizes needlessly. An empty patch is
  not sent (the API rejects it).
- `category` / `allergenTags` values come from `ingredientOptions.js`, a mirror
  of the backend enums (`apps/api/src/modules/ingredients/ingredient.model.js`).
  No invented values — the API returns `400 VALIDATION_ERROR` for anything it
  does not recognize, and those field errors are surfaced inline in the modal.
- `allergenTags` are admin-entered only, never inferred (matches the backend
  rule).

### Archive behavior

`DELETE` is a **soft archive** (`isActive: false`), not a physical delete, and
the UI says so:

- The row action is labelled **Archive** (not Delete); archived rows show an
  **Archived** status pill and a **Restore** action.
- The confirm prompt is "Archive?"; the edit modal has an Active / Archived
  status toggle and, for an archived record, an explanatory note ("hidden from
  the app… not deleted").
- Viewing archived records maps to the real backend query contract: the status
  filter sends `status=active` (default) / `inactive` / `all`. `inactive` and
  `all` are admin-only server-side — fine here because the whole dashboard is
  already admin-gated.

### Loading / error states

`useIngredients()` exposes `{ loading, error, items, pagination }`. The tab
handles:

- initial load (spinner line) and empty results (distinct copy for "no
  ingredients yet" vs "no match for these filters");
- mutation-in-flight (modal "Saving…" state, disabled submit);
- `400` validation → per-field messages in the modal from `error.details`;
- `401` → "session expired" message, and the app returns to sign-in when the
  refresh also fails;
- `403` → the backend's safe permission message;
- `404` → surfaced via the row/modal error line;
- `409` duplicate → the backend message ("An ingredient with this name already
  exists."), no `E11000`;
- network failure → the client's friendly "unable to reach the API" line, with a
  Retry button on the list.

No `alert()`, no full-screen error takeover for recoverable errors.

## Environment configuration

- **`VITE_API_BASE_URL`** — base URL of the REST API. **Not a secret.** Added to
  `apps/admin/.env.example`. Defaults in code to `http://localhost:5000/api/v1`
  (the local `apps/api` server), so local dev needs no `.env` change.
- No server secrets are in any `VITE_` variable. The API URL and the existing
  Firebase web keys are public client identifiers, not secrets.
- `apps/admin/.env` (real, git-ignored) was **not modified**. If a developer
  needs a non-default API URL they add `VITE_API_BASE_URL=...` to their own
  `apps/admin/.env`.
- The API's `CORS_ORIGINS` must include the admin dev origin
  (`http://localhost:5173` is already in `apps/api/.env.example`).

### Developer setup for this slice

1. Run MongoDB and the API (`npm run dev --workspace=apps/api`).
2. Create a backend user (`POST /api/v1/auth/register`) and, in MongoDB, set that
   user's `role` to `"admin"` (registration always creates `role: "user"`; there
   is no admin-provisioning endpoint yet). No admin credentials are hard-coded
   anywhere.
3. `npm run admin` and sign in with that user's email/password.

## Firebase / Firestore boundary

Firebase/Firestore is **not** part of the intended WeCooked architecture — it
was a temporary frontend data layer while the backend was built. This slice
moves **only ingredient business data** off it.

**Removed / replaced for ingredients:** nothing was using Firestore for
ingredients (the admin had no ingredient UI), so the Ingredients tab is
REST-only from day one — there is no dual path (`component -> Firestore` **and**
`component -> REST`) for ingredients.

**Firebase still in use (TEMPORARY technical debt, to be removed in later
integration slices):**

| Area | Firebase use | Removal slice |
| --- | --- | --- |
| Overview / Recipes / Users tabs | Firestore collections `recipes`, `users` (mock/seed shapes) | Recipes slice, Users/admin-management slice |
| "Report a problem" | Firestore `reports` collection | later |
| Sign-up, forgot/reset password, profile edit, password change, email verification, delete account | Firebase Auth | auth-hardening slice(s) |
| Legacy session for the Firestore tabs | best-effort `signInWithEmailAndPassword` during login | when the last Firestore tab migrates |

No new Firebase/Firestore dependencies or business logic were added. `firebase.js`,
`auth.js`, `firestore.js` are unchanged. `VerifyEmailScreen` and the
email-verification handlers remain in `App.jsx` but are no longer on the render
path (backend auth is the gate now).

**Consequences of backend auth becoming the gate (all deferred, not fixed here):**

- The dashboard render is **no longer gated on Firestore load state** — a slow or
  unavailable Firestore can never block the REST-backed Ingredients tab. The
  legacy tabs render their own empty states until Firestore data arrives.
- For a **backend-only admin** (credentials not also in Firebase), the legacy
  Firestore tabs are **read-degraded** (they show empty states) and their
  create/edit/delete actions fail against Firestore rules. The two most
  destructive sidebar actions ("Load sample data", "Delete admin account") are
  hidden when there is no Firebase session; the per-row modals surface a Firebase
  error rather than crashing.
- Firebase-only auth screens are now **dead ends** under backend-primary auth:
  `Sign Up` creates a Firebase account that cannot pass the backend admin gate
  (the sign-up form just returns to the sign-in screen); `Forgot password?` and
  the profile/password sections of "Settings & privacy" operate on Firebase Auth
  only. None of these crash. They are owned by the auth-hardening slice(s).

## Security review (this slice)

Confirmed the implementation does **not**:

- send `userId` for ownership (ingredients have no per-user ownership);
- send `role` in the login body or anywhere else (backend login schema is
  `.strict()`);
- trust a Firebase role for API authorization — the API derives role from the
  MongoDB user on every request; the admin gate uses `GET /users/me`;
- expose MongoDB credentials, the JWT signing secret, or any server secret — none
  are referenced by the admin;
- hard-code an admin password or any credentials;
- access MongoDB directly — all ingredient data goes through the REST API;
- put server secrets into `VITE_` env vars — only the non-secret API URL;
- bypass backend admin authorization — mutations rely entirely on the API's
  `authorize('admin')`; the client gate is defense-in-depth, not the enforcement
  point.

Access token is in memory. Refresh token is in `sessionStorage` (not
`localStorage`) — see compromise below. No raw backend/Mongo errors are shown.

## Temporary compromises

1. **Refresh token in `sessionStorage`.** Needed so a page reload doesn't force
   re-login. `sessionStorage` (per-tab, non-persistent) is a deliberate step down
   from `localStorage`. The real target is an **HttpOnly Secure cookie** issued
   by the backend refresh endpoint — a later auth-hardening task, explicitly not
   in this slice.
2. **JSON refresh-token transport.** Follows the backend's current dev behavior
   (token in body). Moves to the cookie flow with #1.
3. **Dual auth during transition.** Backend auth is authoritative, but a
   best-effort Firebase sign-in runs alongside it purely to keep the
   not-yet-migrated Firestore tabs alive. Removed when those tabs migrate.
4. **Deferred Firebase-only features left in place.** Sign-up / password reset /
   profile / email verification still call Firebase and can dead-end (e.g. a
   signed-up user with no backend admin account). Not redesigned — they are
   owned by later slices.

## Recommended next admin slice

**Substitutions REST migration** (`feat/admin-substitutions-integration`):
add a Substitutions tab using the same client + a new `substitutionApi.js`, wired
to `/api/v1/substitutions`. It reuses this slice's auth and client unchanged, and
the ingredient service is already there for the source/substitute pickers. After
that, **Recipes**, then **Users / admin-management** (needs new backend
endpoints — design first), then **auth hardening** (HttpOnly refresh cookie),
each removing another piece of Firebase.