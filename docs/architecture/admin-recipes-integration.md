# Admin ↔ REST API integration — Recipes slice

Third slice of connecting the React admin app (`apps/admin`) to the Express
REST API (`apps/api`) instead of Firebase/Firestore. Follows
[admin-api-integration.md](./admin-api-integration.md) (slice 1: shared client,
backend auth, Ingredients) and
[admin-substitutions-integration.md](./admin-substitutions-integration.md)
(slice 2: Substitutions), and consumes the domain described in
[recipes.md](./recipes.md). See [backend.md](./backend.md) for the API's
layered conventions.

Target end state (unchanged):

```
Admin React  ->  frontend service layer  ->  Express REST API  ->  MongoDB
```

## Scope of this slice

**In:**

- Recipe management: service (`src/recipeApi.js`) + enum/limit mirror
  (`src/recipeOptions.js`) + the **Recipes** admin tab, rewritten as
  `src/RecipesTab.jsx` — list, search, filter, sort, paginate, create, edit,
  archive, restore — talking only to `/api/v1/recipes`.
- A standalone canonical ingredient picker (`src/IngredientPicker.jsx`) used for
  recipe ingredient usages and for the "uses ingredient" list filter. The admin
  never types a Mongo id.
- The Overview tab's recipe widgets (total, "Latest recipes") read from the
  same REST API — the last Firestore recipe read is gone. The "Cuisines" donut
  was removed in M3 when `cuisine` left the Recipe domain; a region/category
  visualization waits on a content-classification milestone.

**Explicitly out (left exactly as they were):**

- Users / admin-management migration (still Firestore + Firebase Auth).
- Favorites, Shopping List, Community, Recommendations, AI, Mobile.
- Google sign-in, email verification, password reset/change, profile edit.
- Any new backend endpoint or backend change. `apps/api` is untouched.
- Image upload/storage (Firebase Storage, S3, Cloudinary) — `imageUrl` stays a
  plain stored URL reference.
- HttpOnly-cookie refresh auth (later auth-hardening task).

## REST integration structure

```
src/apiClient.js         shared client (slice 1, unchanged)
src/backendAuth.js       backend session + useBackendAuth() (slice 1, unchanged)
src/ingredientApi.js     ingredient feature service (slice 1) — reused by the picker
src/recipeApi.js         recipe feature service — one function per operation used
                         (list / create / update / archive / restore) + the
                         toIngredientUsagePayload() shaper; the backend GET-by-id
                         is deliberately not wrapped
src/recipeOptions.js     frontend-safe mirror of the backend difficulty /
                         dietary-tag / unit / sort / status enums + limits +
                         the region/category slug rules and slugLabel() helper
src/IngredientPicker.jsx standalone name->public-id combobox over /api/v1/ingredients
src/RecipesTab.jsx       the Recipes screen: useRecipes() hook + table + filters
                         + create/edit modal (ingredient rows + instruction rows)
```

Data path (the only one for recipe business data after this slice):

```
RecipesTab / useRecipes
  -> recipeApi.*
  -> apiClient (api.get/post/patch/del)
  -> fetch  ->  /api/v1/recipes  ->  MongoDB
```

Components never call `fetch` directly and never import `apiClient` except via a
feature service. No new fetch wrapper, no new auth store, no new token
storage — slices 1–2's `apiClient` + `backendAuth` are used verbatim.

## Backend contract consumed

Discovered by reading `apps/api/src/modules/recipes/*`,
`apps/api/src/shared/constants/measurement-units.js`, and the recipe tests — not
from memory.

| Function | Endpoint | Auth |
| --- | --- | --- |
| `listRecipes({ search, region, category, difficulty, dietaryTag, ingredientId, maxPrepTimeMinutes, status, sort, page, limit })` | `GET /api/v1/recipes` | any authenticated |
| `createRecipe({ title, description, region?, category?, difficulty, prepTimeMinutes, cookTimeMinutes, servings, ingredients, instructions, dietaryTags, imageUrl })` | `POST /api/v1/recipes` | admin |
| `updateRecipe(id, patch)` | `PATCH /api/v1/recipes/:id` | admin |
| `archiveRecipe(id)` | `DELETE /api/v1/recipes/:id` | admin (soft archive) |
| `restoreRecipe(id)` | `PATCH /api/v1/recipes/:id { isActive: true }` | admin |

`GET /api/v1/recipes/:id` exists on the backend but is **not** wrapped in
`recipeApi.js` — the list serializer already returns the complete recipe (every
field the table and the edit modal render), so this slice never needs a
single-resource read. Same choice as `substitutionApi.js`.

### Serializer shape (`recipe.serializer.js`)

```jsonc
{
  "id": "…",                       // Mongo _id, never exposed as _id
  "title": "Chicken Adobo",
  "description": "…",
  "region": "central-luzon",       // optional canonical slug | null
  "category": "main-dish",         // optional canonical slug | null
  "difficulty": "easy",            // easy | medium | hard
  // "steps": [{ order, text }]    // derived from instructions, 1-based
  // (no "cuisine" — retired in M3)
  "prepTimeMinutes": 15,
  "cookTimeMinutes": 40,
  "servings": 4,
  "ingredients": [
    {
      "ingredient": { "id": "…", "name": "Chicken" },  // or null if the ref no longer resolves
      "quantity": 1,                                    // null for unit "toTaste"
      "unit": "kg",
      "note": "cut into serving pieces",                // or null
      "optional": false
    }
  ],
  "instructions": ["step 1", "step 2", "…"],            // ordered
  "dietaryTags": ["dairyFree"],                          // subset of the fixed enum
  "imageUrl": "https://…",                               // or null
  "isActive": true,
  "createdAt": "…",
  "updatedAt": "…"
}
```

- Public JSON uses `id`, never `_id`. The nested ingredient summary exposes
  **only `{ id, name }`** — `isActive` / `normalizedName` / other internal
  ingredient fields are never present, even for an admin. The UI therefore
  cannot (and does not) badge a recipe's stored ingredient as archived; it only
  renders the name, or a muted "Unavailable" when the ref is `null`.
- **Admin vs non-admin views differ.** For an admin, `GET /recipes` and
  `GET /recipes/:id` return the complete, unfiltered ingredient array. For the
  default `status=active` view, though, the backend still applies its
  "usable" filter to each fetched page — even for an admin — so a recipe whose
  **required** ingredient was archived after the fact drops out of the Active
  list until the admin switches `status` to `inactive`/`all`.

### List query capabilities (used, not re-implemented in the browser)

All server-owned. Every parameter the backend actually implements is exposed by
the tab, and it does **no** client-side filtering of the returned page:

| Param | Values | Notes |
| --- | --- | --- |
| `search` | free text | case-insensitive substring over `title` + `description`, regex-escaped by the backend |
| `region` | canonical slug | optional Philippine region; normalized like the stored field |
| `category` | canonical slug | optional recipe category; normalized like the stored field |
| `difficulty` | `easy` / `medium` / `hard` | |
| `dietaryTag` | `DIETARY_TAGS` enum (singular param) | matches recipes containing that tag |
| `ingredientId` | ObjectId | recipes referencing that canonical ingredient (picker resolves the name) |
| `maxPrepTimeMinutes` | 0–1440 | `prepTimeMinutes <= value` |
| `status` | `active` (default) / `inactive` / `all` | `inactive`/`all` are admin-only server-side |
| `sort` | `titleAsc` (default) / `titleDesc` / `newest` / `oldest` / `prepTimeAsc` / `prepTimeDesc` | fixed named set, never raw Mongo sort |
| `page` | default 1 | |
| `limit` | default 20, cap 100 | the tab requests 20 |

Response envelope: `{ recipes: [...], pagination: { page, limit, total, totalPages } }`.

#### Known backend count imprecision (surfaced, not worked around)

Per [recipes.md](./recipes.md), in the `active` view the backend trims recipes
whose required ingredient was archived *after* the page was fetched, so
`pagination.total` / `totalPages` can slightly overcount and a page can show
fewer than `limit` rows. The tab shows a one-line note in the Active view rather
than re-implementing the backend's read-time filter client-side.

### Error codes handled

| Code | Status | UI treatment |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | per-field messages in the modal from `error.details` (field paths `title`, `description`, `region`, `category`, `difficulty`, `prepTimeMinutes`, `cookTimeMinutes`, `servings`, `imageUrl`, `ingredients.*`, `instructions.*`, `steps.*`, `dietaryTags.*`) — a body still sending `cuisine` is rejected as an unknown field |
| `RECIPE_INGREDIENT_NOT_FOUND` | 404 | safe backend message on the modal ("One or more referenced ingredients do not exist.") |
| `RECIPE_INGREDIENT_INACTIVE` | 400 (no `details`) | safe backend message on the modal ("One or more referenced ingredients are not active.") — the main path to this is reactivating a recipe whose stored ingredient is archived |
| `RECIPE_NOT_FOUND` | 404 | row/modal error line |
| `FORBIDDEN` | 403 | the backend's safe permission message |
| 401 | 401 | "session expired"; slice 1's one transparent refresh+retry applies, and the app returns to sign-in if that also fails |
| network | — | slice 1's friendly "unable to reach the API" line, with a Retry button on the list |

Raw internal errors are never shown; `apiClient` already maps Mongo driver
errors to stable codes before they reach the client. There is **no**
duplicate-title check anywhere — recipe titles are deliberately not unique in
the backend, so the UI invents no such rule.

## Recipe list / table

Columns come straight from the serializer: **Title**, **Category** and
**Region** (humanized slug or "—"), **Difficulty** (pill), **Prep** / **Cook**
(minutes), **Servings**, **Dietary** (tag pills or "—"), **Status** (Active /
Archived pill), row actions. `id` (not `_id`) is the React key and the id sent
to every mutation.

## Create form behavior

`POST` sends the backend create body:
`{ title, description, difficulty, prepTimeMinutes, cookTimeMinutes, servings,
ingredients, instructions, dietaryTags, imageUrl }` plus `region` / `category`
only when non-blank.

- `region` / `category` are optional free-text slug inputs (no dropdown — there
  is no controlled vocabulary yet). The value is normalized client-side
  (lowercased, spaces → hyphens) for a UX pre-check; the backend Zod schema is
  authoritative and rejects a non-slug or an empty string. On **create** a
  blank field is omitted from the payload entirely.
- `cuisine` is **gone** — the field, its default, and its select were removed
  in M3. A stray `cuisine` in the body is rejected as an unknown field.
- `difficulty` defaults to `easy` — an ordinary controlled select over the
  backend enum.
- `description` is required (min 1 char) — a field the legacy Firestore form did
  not have; it was added to match the contract.
- `prepTimeMinutes` / `cookTimeMinutes` / `servings` are whole numbers in the
  backend ranges (0–1440, 0–1440, 1–100), validated client-side for UX and
  authoritatively by the backend.
- `imageUrl` is optional; an empty field sends `null`. A non-empty value must
  parse as a URL (client guard) — the backend also requires a valid URL.
- `dietaryTags` is a chip multi-select over the fixed backend enum
  (`vegetarian`, `vegan`, `pescatarian`, `glutenFree`, `dairyFree`, `nutFree`).
  Admin-set only — never inferred, no AI.
- At least one ingredient row and one instruction step are required (backend
  minimums). These are UX guards; the backend Zod schema stays authoritative and
  its field errors are surfaced inline.

## Edit / PATCH behavior

The modal builds a **minimal patch** — only fields whose value actually changed
versus the loaded recipe:

- scalars (`title`, `description`, `region`, `category`, `difficulty`,
  `prepTimeMinutes`, `cookTimeMinutes`, `servings`) — sent only if different.
  `region` / `category` use `slugPatchValue(stored, formValue)`: an unchanged
  field is omitted, a changed value is sent as the normalized slug, and a
  populated field the admin **blanked** is sent as `null` — which the API
  `$unset`s (the way to remove a bad classification). `title` is compared
  after the same whitespace-collapse the backend applies, so a cosmetic re-save
  is a true no-op.
- `dietaryTags` — sent (as a de-duplicated array, a full replacement) only if
  the set differs.
- `imageUrl` — sent only if the trimmed value differs; an emptied field sends
  `null` to clear it.
- `instructions` — sent as the complete replacement array only if the ordered,
  trimmed, non-empty step list differs.
- `ingredients` — sent as the complete replacement array only if the row set
  differs (compared via an identical projection of each row and each stored
  entry: `ingredientId`, normalized `quantity`, `unit`, `note`, `optional`).
- `isActive` — sent only if the status toggle moved.

An unchanged save is a no-op (the modal just closes; the API rejects an empty
patch anyway). Server-owned fields (`id`, `createdAt`, `updatedAt`, the nested
ingredient summaries) are never written back — the displayed object is never
blindly serialized to the API. Create defaults are never inherited into a PATCH.

## Canonical ingredient usages

`src/IngredientPicker.jsx` is a name-search combobox over `/api/v1/ingredients`
that returns a `{ id, name }` pair; only the `id` is ever sent. Used in two
modes via a `searchStatus` prop:

| Usage | `searchStatus` | Why |
| --- | --- | --- |
| Recipe modal — each ingredient-usage row | `'active'` (default) | The backend rejects a recipe that references an archived ingredient on **create, on any ingredients-array replacement, and on reactivation** (`RECIPE_INGREDIENT_NOT_FOUND` / `RECIPE_INGREDIENT_INACTIVE`). A replacement can only ever be a currently-active ingredient. |
| List filter — "uses ingredient" | `'all'` | An admin narrowing the Archived / All views to a specific archived ingredient must be able to pick it. Archived hits are labelled `archived`. |

- Each picker instance carries its own monotonic request-id guard (250 ms
  debounce) so a slow earlier search never overwrites a newer result. Unmounting
  (closing the modal) cancels any in-flight search before it can `setState`.
- A failed ingredient search shows a safe inline message and never wipes an
  already-selected value.
- Recipe ingredient-usage fields follow the exact backend embedded-entry
  contract: `ingredientId`, `quantity`, `unit`, `note`, `optional`. Repeated use
  of the same canonical ingredient is **allowed** — the UI never de-duplicates
  rows, because the backend deliberately permits the same ingredient more than
  once (e.g. garlic in a marinade and again as garnish).

## Quantity / unit / toTaste rules

The unit list is the shared backend measurement-unit contract
(`apps/api/src/shared/constants/measurement-units.js`), mirrored verbatim in
`recipeOptions.js` — no second list is invented, and no unit conversion is done
anywhere.

- For every measurable unit the quantity input is shown and a finite number
  greater than zero is required.
- For `unit === "toTaste"` the quantity input is **replaced** with a "no
  quantity — to taste" hint, and `toIngredientUsagePayload()` omits `quantity`
  entirely from the sent entry (the backend rejects a `toTaste` entry that
  carries a quantity, and normalizes an omitted/`null` one to "absent").
- Examples: `Black Pepper` → `unit: toTaste`, quantity omitted; `Chicken` →
  `quantity: 1`, `unit: kg`.

## Instructions

An ordered array of plain strings — there is no separate Instruction entity. The
modal renders a numbered list of textareas with add / remove / move-up /
move-down controls. Steps are trimmed and blank steps dropped before sending; at
least one non-empty step is required and each is capped at the backend's 1000
characters. Order is preserved exactly as shown.

## Archive / restore

`DELETE /recipes/:id` is a **soft archive** (`isActive: false`), never a
physical delete:

- The row action is labelled **Archive** (icon + "Archive?" confirm), not Delete.
- Archived rows show an **Archived** status pill and a **Restore** action; the
  edit modal has an Active / Archived toggle and an explanatory note.
- With `status` set to Active, an archived recipe disappears from the list after
  the action. Switching `status` to Archived / All shows it again with Restore.
- Restore is `PATCH { isActive: true }`. The backend additionally re-validates
  that **every** stored ingredient reference (including optional ones) is still
  active before allowing reactivation; if not, it returns
  `RECIPE_INGREDIENT_INACTIVE` / `RECIPE_INGREDIENT_NOT_FOUND` and the UI shows
  that safe message. The frontend never works around this domain rule.
- Row mutations are serialized by a `busyRowId` state flag **plus a
  synchronous `useRef` lock** (`rowBusyRef`), so a phantom double-click that
  fires two handlers before React re-renders still can't send a duplicate
  archive/restore. The create/edit modal has the equivalent `saving` state +
  `submittingRef` lock — important for create, where a duplicate `POST` would
  make a second recipe (titles are not unique).

## Archived / unresolved ingredient handling

- **List:** the `active` view already excludes any recipe whose *required*
  ingredient is archived (backend read-time filter). In `all` / `inactive`, a
  recipe referencing an archived ingredient still comes back with that
  ingredient's **name** inlined (soft delete keeps the document); the table
  renders it normally. If a nested `ingredient` is `null` (the ref did not
  resolve at all), the cell/picker renders a muted "Unavailable" instead of
  crashing.
- **Edit modal:** an existing ingredient-usage row whose ref is `null` is shown
  as a dashed "Original ingredient unavailable — pick a replacement" chip with a
  clear button (the row keeps `ingredient: null` internally, so it never
  fabricates an id). The admin can still edit unrelated fields and save —
  because the minimal patch omits `ingredients` when the section is unchanged
  (an unchanged `null`-ref row compares equal: both sides project to `id: null`
  plus the same quantity/unit/note/optional), the backend leaves the stored
  array alone. Any change to the ingredient list, or flipping the recipe back to
  Active, requires resolving every row to a valid active ingredient first
  (client guard) — and the backend enforces the same on reactivation regardless.
- The picker never presents an archived ingredient as an active, selectable
  replacement: replacement search is `status: 'active'` only, and archived hits
  in the `'all'` filter picker are explicitly labelled.

## Firebase boundary

**Firebase business-data usage for recipes: ZERO.** After this slice:

- The Recipes tab is REST-only — no dual (`component -> Firestore` **and**
  `component -> REST`) path, no Firebase fallback.
- `App.jsx` no longer subscribes to the Firestore `recipes` collection at all.
  The `subscribeRecipes` / `saveRecipeDoc` / `deleteRecipeDoc` helpers were
  **deleted from `src/firestore.js`**, the `seedCollection('recipes', …)` call
  and `seedRecipes` fixture are gone, and the legacy inline `RecipesTab` /
  `RecipeModal` components were removed from `App.jsx`.
- The Overview tab's recipe widgets (Total Recipes, "Latest recipes") derive
  from one best-effort `listRecipes({ status: 'all', sort: 'newest', limit: 100 })`
  call. The total is exact (`pagination.total`). The former "Cuisines" donut was
  removed in M3 along with `cuisine`; a region/category breakdown returns after
  a content-classification milestone. These widgets are one-shot (were a live
  `onSnapshot` before); a page reload refreshes them.

`src/firestore.js` now holds only the Users / reports / generic-seed layer. No
Firebase dependency was added or removed from `package.json` (`firebase` stays
for Users + admin auth).

### Firebase still in use elsewhere (unchanged temporary debt — later slices)

| Area | Firebase use | Removal slice |
| --- | --- | --- |
| Overview user widgets / Users tab | Firestore `users` collection | Users / admin-management slice |
| "Report a problem" | Firestore `reports` | later |
| Sign-up, forgot/reset password, profile edit, password change, email verification, delete account | Firebase Auth | auth-hardening slice(s) |
| Legacy session for the Users tab | best-effort `signInWithEmailAndPassword` during login | when the Users tab migrates |
| `firebase.js`, `auth.js`, `firestore.js` (Users/reports/seed only) | live code, Users domain | Users slice |

## Auth / API foundation reuse (slices 1–2, untouched)

- `apiClient.js` — same base URL resolution, same `{ success, data }` /
  `{ success, error }` envelope handling, same `ApiError` with
  `isNetworkError` / `isUnauthorized` / `isForbidden` / `isNotFound` /
  `isConflict` / `isValidationError`, same single transparent refresh+retry on
  401. Not modified.
- `backendAuth.js` — same in-memory access token, same `sessionStorage` refresh
  token, same `useBackendAuth()` gate. Not modified. Recipe mutations rely
  entirely on the API's `authorize('admin')`; the admin-gated dashboard is
  defense-in-depth, not the enforcement point.
- No `userId` / ownership fields are sent (recipes have no per-user ownership).
  No `role` is sent anywhere.

## Request race safety

`useRecipes` holds all filter state, debounces 250 ms, and applies the
established stale-request guard (a `cancelled` flag per effect run, plus a
`nonce` that mutations bump to refetch). Each `IngredientPicker` instance adds
its own monotonic request-id guard. A slower old request can never overwrite a
newer one, for either the recipe list or an ingredient search.

Duplicate-write protection is separate from race safety: both the row actions
(`rowBusyRef`) and the modal submit (`submittingRef`) take a synchronous `useRef`
lock in addition to the React `busyRowId` / `saving` state, because a rapid
double-click can fire two handlers against a stale state closure before React
re-renders and disables the button.

## Slices 1–2 regression check

- Backend admin login still works (auth path unchanged).
- Ingredients tab unchanged and still functional (`ingredientApi.js` /
  `ingredientOptions.js` imported read-only; not edited).
- Substitutions tab unchanged (`SubstitutionsTab.jsx` not edited — it keeps its
  own inline ingredient picker from slice 2; consolidating it with
  `IngredientPicker.jsx` is deferred low-risk cleanup).
- Shared auth / refresh / session behaviour unchanged.
- Overview / Users tabs still render and do not crash.
- No duplicate API/auth infrastructure introduced.
- `npm run build --workspace=apps/admin` succeeds.
- `npm test --workspace=apps/api` — 556 passed, 0 failed (backend untouched).

## Intentionally deferred

- Users / admin-management migration (needs new backend endpoints — design
  first); auth hardening (HttpOnly refresh cookie).
- Image upload/storage — `imageUrl` stays a plain stored URL.
- Consolidating `IngredientPicker.jsx` with the equivalent still inline in
  `SubstitutionsTab.jsx`.
- Bulk actions, CSV import/export.
- A REST-backed replacement for the Overview's static demo `growthData` /
  `activityFeed` (still hard-coded sample data, same as before this slice).