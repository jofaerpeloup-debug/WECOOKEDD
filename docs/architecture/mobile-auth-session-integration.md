# Mobile ↔ REST API: auth & session integration

First slice of connecting the React Native / Expo app (`apps/mobile`) to the
Express REST API (`apps/api`) instead of its previous fake local session. See
[backend.md](./backend.md) for the API's layered conventions,
[authentication-security.md](./authentication-security.md) for the auth/session
design this consumes, and [admin-api-integration.md](./admin-api-integration.md)
for the equivalent admin slice (this mirrors its client/session split).

Target end state:

```
React Native / Expo  ->  mobile api layer  ->  Express REST /api/v1  ->  MongoDB
```

## Scope of this slice

**In:** auth/session foundation only.

- Mobile API config (`src/api/config.js`) + shared REST client
  (`src/api/client.js`).
- Token storage abstraction (`src/api/tokenStore.js`): access token in memory,
  refresh token in Expo SecureStore.
- Auth/session orchestration (`src/api/authService.js`): login, register,
  refresh (rotating + single-flight), logout, logout-all, startup restore.
- `AuthContext` rewritten onto the backend session; a minimal `RegisterScreen`
  wired to `POST /auth/register`; `LoginScreen` wired to `POST /auth/login`.
- Google sign-in **disabled** (was a fake client-only session; also removed a
  client secret shipped via `EXPO_PUBLIC_*`).
- `RootNavigator` gates the screen set on real auth state.

**Explicitly out (unchanged, deferred):** recipes, discovery, favorites,
shopping list, ingredients, substitutions, community backend, notifications,
recommendations, AI, profile/preferences editing beyond identity from
`GET /users/me`, password reset/change, email verification, and backend Google
auth. The screens for those keep their existing local/mock behavior.

## REST layer structure

```
src/api/config.js         base URL resolution (EXPO_PUBLIC_API_BASE_URL + per-platform default)
src/api/client.js         shared client: base URL, JSON, envelope parsing, error
                          normalization (ApiError), one transparent refresh+retry
src/api/tokenStore.js     access token (memory) + refresh token (SecureStore / web-memory)
src/api/authService.js    login / register / logout / logout-all / restoreSession /
                          fetchCurrentUser + single-flight rotating refresh;
                          registers the token adapter on the client
src/api/errorMessages.js  ApiError -> short safe user-facing string
src/context/AuthContext.js  React state machine over authService; the one auth source of truth
```

Data path (the only one for auth after this slice):

```
LoginScreen / RegisterScreen / ProfileScreen
  -> useAuth() (AuthContext)
  -> authService.*
  -> api (client.js)
  -> fetch  ->  /api/v1/auth/*  |  /api/v1/users/me  ->  MongoDB
```

Screens and contexts never call `fetch` directly and never import `client.js`
except through `authService`.

## Backend auth contract consumed

Response envelope: success `{ success: true, data }`, error
`{ success: false, error: { code, message, details? } }`.

| Method & path | Auth | Request body | Success data | Notable errors |
| --- | --- | --- | --- | --- |
| `POST /api/v1/auth/register` | none | `{ name, email, password }` (strict — extra fields rejected) | `201 { user, accessToken, refreshToken }` | `400 VALIDATION_ERROR` (`details[]`), `409 USER_EMAIL_ALREADY_EXISTS` |
| `POST /api/v1/auth/login` | none | `{ email, password }` (strict) | `200 { user, accessToken, refreshToken }` | `401 AUTH_INVALID_CREDENTIALS`, `403 AUTH_ACCOUNT_SUSPENDED`, `400 VALIDATION_ERROR` |
| `POST /api/v1/auth/refresh` | none | `{ refreshToken }` (strict) | `200 { accessToken, refreshToken }` — **no user** | `401 AUTH_REFRESH_TOKEN_INVALID` |
| `POST /api/v1/auth/logout` | **access token** | — | `200 { loggedOut: true }` | `401 AUTH_TOKEN_*` / `AUTH_SESSION_INVALID` |
| `POST /api/v1/auth/logout-all` | **access token** | — | `200 { revokedCount }` | as logout |
| `GET /api/v1/users/me` | **access token** | — | `200 { user }` | `401 AUTH_TOKEN_MISSING` / `AUTH_TOKEN_INVALID` / `AUTH_SESSION_INVALID` |

`register` / `login` / `refresh` share a stricter rate limiter (20 / 15 min) →
`429 RATE_LIMIT_EXCEEDED`.

Backend user serializer (`toPublicUser`) — the only shape the app treats as the
current user:

```json
{
  "id": "…", "name": "…", "email": "…",
  "role": "user" | "admin",
  "status": "active" | "suspended",
  "preferences": {
    "dietaryPreferences": [], "allergies": [],
    "notifications": { "enabled": true }
  },
  "emailVerified": false,
  "createdAt": "…", "updatedAt": "…"
}
```

The app does **not** decode the JWT for profile data and does not invent fields
the serializer does not return.

### Registration semantics

`register` sends **exactly** `{ name, email, password }` — never `role`,
`status`, `emailVerified`, or any server-owned field (the schema is `.strict()`
and would 400 anyway). The backend always creates an `active`, `role:"user"`
account and returns a full session (`accessToken` + `refreshToken`), so a
successful registration **also signs the new account in**.

### Logout semantics

`logout` / `logout-all` authenticate with the **access token** (not the refresh
token) and revoke server-side sessions (`logout` = this session,
`logout-all` = every session for the user). `logout-all` is exposed as
`useAuth().signOutEverywhere()` but has no dedicated UI in this slice (no
existing "log out all devices" action to wire).

## Token lifecycle

| Token | Where it lives | Rules |
| --- | --- | --- |
| **Access token** | Process **memory only** (`tokenStore` module variable). | Never written to SecureStore, AsyncStorage, files, or app config. Sent as `Authorization: Bearer …`. ~15 min TTL. Gone on app restart — the session is rebuilt from the refresh token. |
| **Refresh token** | **Native (iOS/Android): Expo SecureStore only**, one stable key `wecooked.refreshToken`. **Web: memory only** for the JS session. | Never in AsyncStorage. Never logged, never put in React/UI state. Replaced in place after **every** successful refresh rotation. |

### Access token — memory only

`tokenStore.get/set/clearAccessToken` operate on a single module-scoped
variable. There is no persistence path for it anywhere in the app. On restart it
is necessarily `null`; `restoreSession()` obtains a fresh one via the refresh
token.

### Refresh token — SecureStore

`tokenStore` is the only place `expo-secure-store` is called. Native reads/writes
go through `SecureStore.{get,set,delete}ItemAsync` under one key. Every access is
wrapped so a SecureStore failure degrades to "no session" / "not persisted"
rather than throwing — and it never falls back to an insecure store.

**Web:** `expo-secure-store` is unavailable in a browser and there is no safe
persistent store for a long-lived bearer token there, so on web the refresh
token is held in memory for the session only. **Persistent web login is
intentionally unsupported this slice** — a page reload signs out. (The proper
answer, matching the admin's planned direction, is an `HttpOnly; Secure` refresh
cookie issued by the backend — a later auth-hardening slice, not here. No new
dependency was added.)

## Rotation + concurrency strategy

`POST /auth/refresh` rotates: the presented refresh token is consumed and a new
access **and** refresh token are returned. The client must therefore:

1. send the stored refresh token to `/auth/refresh`;
2. on success, replace the in-memory access token and **overwrite** the
   SecureStore refresh token with the rotated value;
3. retry the original request **once** (`_retried` flag in `client.js`);
4. never call `/auth/refresh` for the refresh request itself (`auth: false`), so
   a 401 there cannot recurse;
5. never retry a 401 more than once — no refresh loops.

**Single-flight:** `authService.performRefresh()` guards a module-scoped
`refreshInFlight` promise. The check-and-assign is synchronous (all async work is
inside the IIFE), so if several requests 401 at once they all await the *same*
in-flight refresh — exactly one `/auth/refresh` call runs, one rotation happens,
and everyone retries with the new access token.

**After a refresh failure:**

- a definitive rejection (invalid / expired / already-rotated / revoked session)
  → clear the in-memory access token, delete the SecureStore refresh token, and
  fire `onSessionExpired` **once** → `AuthContext` transitions to
  `unauthenticated`;
- a transient **network** failure → the token is left intact (a dropped
  connection should not destroy a valid session); the triggering request fails
  for now and can be retried.

## Startup session restoration

`AuthContext` starts in `status: 'restoring'`. `App.js` keeps the native splash
up and renders nothing until `status !== 'restoring'`, so authenticated screens
never flash before restoration finishes.

`authService.restoreSession()`:

1. read the refresh token from SecureStore — none → signed out;
2. `POST /auth/refresh` (rotating; single-flight) — persist the rotated refresh
   token, keep the new access token in memory;
3. `GET /users/me` — establish the authoritative user;
4. success → `AuthContext` `authenticated` with that user; any definitive auth
   failure → tokens cleared, `unauthenticated`; a network failure → stay
   signed-out for this launch without discarding the token.

No local/fake user is ever constructed.

## Login / register behavior

- **Login:** `LoginScreen` → `useAuth().signIn({ email, password })` →
  `POST /auth/login` → store refresh token in SecureStore, access token in
  memory → `GET /users/me` for the authoritative user (falls back to the login
  body only if that read is briefly unavailable) → `AuthContext` `authenticated`
  → `RootNavigator` swaps to the app stack (no imperative navigation). Submit is
  disabled while a request is in flight (no duplicate submissions). Errors are
  mapped to safe strings by `errorMessages.js`; a failed request never counts as
  a login.
- **Register:** `RegisterScreen` → `useAuth().signUp({ name, email, password })`
  → `POST /auth/register` → same session handling as login (backend returns a
  full session) → authenticated. Client-side checks are minimal (required
  fields, password ≥ 8); the backend validation contract is authoritative and
  its `VALIDATION_ERROR` `details` are surfaced. Submit guarded against
  duplicates.

## `GET /users/me`

The single authority for current identity/session state. Used on startup, after
login, after register, and via `useAuth().refreshUser()`. The app adapts its
existing user-facing surfaces minimally and does not rely on JWT claims for
profile data. (Profile/account **editing** screens keep their existing local
behavior — out of scope here.)

## Logout behavior

`useAuth().signOut()` → `POST /auth/logout` (revokes the backend session; the
client transparently refreshes+retries once if the access token expired) → clear
the in-memory access token → delete the SecureStore refresh token → `AuthContext`
`unauthenticated` → `RootNavigator` swaps back to the Landing stack. **Local
cleanup always runs even if the network logout fails** — no refresh token is
left on the device after logout. Wired into the existing Profile and Settings
"Log out" actions; the Account UI was not redesigned.

## Google auth — deferred

The backend has no Google-auth endpoint. The previous mobile implementation ran
a client-side Google OAuth flow (web popup / native device-code grant) and
treated the returned Google profile as a logged-in user — a **fake** session
that never touched Express auth — and it required an OAuth **client secret**
passed through `EXPO_PUBLIC_GOOGLE_CLIENT_SECRET_*` (bundled into the app,
therefore not secret).

`src/hooks/useGoogleSignIn.js` is now a stub that keeps the shape `LoginScreen`
consumes so the button still renders, but `signIn` only reports "not available
yet" and never yields a profile or session. No OAuth requests are made; no
Google client id/secret is read anywhere. `expo-auth-session` /
`expo-web-browser` remain installed (not removed this slice). `.env.example` no
longer lists any Google client id/secret. When backend Google auth lands it will
be a server-side ID-token exchange returning the standard
`{ user, accessToken, refreshToken }` — wire it through `authService`, do not
resurrect a client-only session.

## AsyncStorage

The only auth use of AsyncStorage was the fake `wecooked:isLoggedIn` flag in the
old `AuthContext`. It is **gone** — the new `AuthContext` imports no storage
helper. No access token, refresh token, or session flag is in AsyncStorage.

AsyncStorage (`src/utils/storage.js`) is still used for **non-sensitive
presentation/preferences** only — saved-recipe ids, the local community feed,
the shopping list, the local "account details" form draft, cook-mode notes —
and was left as-is.

## Auth / navigation state

`AuthContext` exposes `status` (`'restoring' | 'authenticated' |
'unauthenticated'`), the backend `user`, plus `isReady` / `isLoggedIn`
convenience flags and `signIn` / `signUp` / `signOut` / `signOutEverywhere` /
`refreshUser`. It is the single source of truth — there is no second auth
context, and networking lives in `authService`, not in screens.

`RootNavigator` renders the **guest stack** (Landing / Login / Register) or the
**app stack** (MainTabs + detail screens) based on `isLoggedIn`. React
Navigation swaps the screen set when auth state flips, so login, register, and
logout need no imperative `navigation.replace` / `reset` — those calls were
removed. The already-fixed `CommunityProvider` placement in `App.js` is
untouched.

## Error / security behavior

`client.js` normalizes every failure to an `ApiError` with `kind`
(`"api"` | `"network"`), `status`, stable `code`, safe `message`, and
`details[]`. `errorMessages.getAuthErrorMessage` maps these to short user-facing
copy:

| Condition | Shown as |
| --- | --- |
| `400 VALIDATION_ERROR` | first field message from `details`, else a generic "check your details" |
| `401 AUTH_INVALID_CREDENTIALS` | "That email or password doesn't match our records." |
| `403 AUTH_ACCOUNT_SUSPENDED` | "This account has been suspended…" |
| `404` | surfaced via the calling screen where applicable |
| `409 USER_EMAIL_ALREADY_EXISTS` | "An account with this email already exists…" |
| `429 RATE_LIMIT_EXCEEDED` | "Too many attempts. Please wait a few minutes…" |
| `401` expired/again-invalid session | "Your session has expired. Please log in again." |
| `>= 500` | generic "WeCooked is having trouble right now…" — never the raw body |
| network / unreachable | "Can't reach WeCooked. Check your connection…" (`kind: "network"`) |

Never logged: passwords, access tokens, refresh tokens, `Authorization`
headers, SecureStore values. No stack traces or DB internals reach the UI (the
API already maps `E11000` etc. to stable codes; the client only ever shows
`error.message` for non-5xx).

## API base URL configuration

- **`EXPO_PUBLIC_API_BASE_URL`** — base URL of the REST API. **Not a secret.**
  Documented in `apps/mobile/.env.example` (created/updated; empty value, no
  secrets). The app appends `/api/v1` itself and normalizes a trailing
  `/api/v1` or `/` away, so either `http://host:5000` or
  `http://host:5000/api/v1` works.
- **Defaults when unset:** iOS simulator / web → `http://localhost:5000`;
  Android emulator → `http://10.0.2.2:5000` (the emulator's documented host
  alias — not a hard-coded LAN IP).
- **Physical device / LAN:** `localhost` on a phone is the phone, not the dev
  machine. A physical device must be given the machine's LAN address via
  `EXPO_PUBLIC_API_BASE_URL` (e.g. `http://192.168.1.50:5000`), with `apps/api`
  listening on that interface, the firewall allowing the port, and both devices
  on the same network. No automatic host detection beyond the emulator/simulator
  default.
- No server secret is in any `EXPO_PUBLIC_*` variable. The real `.env` (git
  ignored) was not touched.
- The API's `CORS_ORIGINS` does not gate native apps (requests with no `Origin`
  are allowed); an Expo **web** origin would need adding there if used.

## Assumptions / compromises

1. **No Register screen existed.** The "Sign up" link previously routed to
   Landing. A minimal `RegisterScreen` was added in the existing Login visual
   language (background, field style) and the "Sign up" link + Landing's "Get
   Started" / "Let's Cook!" CTAs now route to it. This is the smallest change
   that makes `POST /auth/register` reachable; navigation was not otherwise
   redesigned.
2. **Navigation gating changed shape.** `RootNavigator` moved from a single
   stack with an `initialRouteName` + imperative `replace`/`reset` to two
   conditionally-rendered stacks (the React Navigation auth pattern). This
   removed auth navigation code from screens rather than adding it.
3. **Web refresh token is non-persistent** (see SecureStore section) — reload
   signs out on web. Deliberate; the cookie-based fix is a later slice.
4. **Refresh network failure ≠ sign-out.** A definitive refresh rejection signs
   the user out; a transient network failure during refresh does not discard the
   token. Chosen for resilience on mobile networks.
5. **Google sign-in is a stub**, not removed — the button stays visible and
   reports unavailability. `expo-auth-session` / `expo-web-browser` packages
   were left installed.

## Future slices

Recipe discovery, recipe details, favorites, and shopping list are the next
mobile integration slices — each will add a feature service that reuses
`client.js` / `authService` unchanged (same pattern as the admin's
ingredient/substitution/recipe services), progressively replacing
`src/data/mockData.js` usage. Auth hardening (HttpOnly refresh cookie, shared
with the admin) is tracked separately.
