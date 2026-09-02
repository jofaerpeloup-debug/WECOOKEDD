# Mobile Google Sign-In (B4.2A foundation)

B4.2A adds the **credential-free, login-only source foundation** for Google
sign-in on the mobile app. It builds the local native module, the JS
orchestration, the config surface, and the automated tests — but it does **not**
configure Google Cloud, perform a real Google sign-in, or produce a development
build.

> **Do not replace this design with a third-party wrapper.** The tiny native
> surface is intentional and security-relevant. See "Why a local module" below.

## Implemented in B4.2A

- A **local Expo module** (`apps/mobile/modules/wecooked-google-signin`) using
  the Expo Modules API, compatible with Expo SDK 54 / RN 0.81 / New Architecture.
  Native name everywhere: `WeCookedGoogleSignIn`.
- **Per-attempt raw-nonce** Google sign-in orchestration:
  `LoginScreen → useGoogleSignIn → AuthContext.signInWithGoogle → googleAuthFlow
  → authService + native adapter`.
- **Backend exchange** of the resulting Google ID token via the existing B4.1
  API (`POST /api/v1/auth/social/challenge`, `POST /api/v1/auth/social/google`),
  reusing the existing WeCooked session/token architecture (`establishSession`).
- The disabled Google login stub is replaced with the real (but
  native-module-gated) flow.
- Safe mobile social-auth error messages (native `GOOGLE_*` codes + B4.1 backend
  codes) with no raw provider/backend strings surfaced.
- Automated JS + config-plugin tests (`apps/mobile/__tests__`) — **plain Jest**
  with Jest's built-in `babel-jest` transform (which picks up
  `apps/mobile/babel.config.js` → `babel-preset-expo`) and narrow local module
  mocks (`apps/mobile/test/mocks/`). `jest-expo` is **not** used and is not a
  dependency: its preset assumes a hoisted `node_modules`, which conflicts with
  this repo's `.npmrc install-strategy=nested`. `@babel/runtime` is declared as a
  runtime dependency (a `babel-preset-expo` companion the nested layout otherwise
  hides from Jest).
- **Safe behavior with no native module / no Google config**: the app still
  boots, password auth still works, and the Google button is visually
  dimmed/unavailable — it stays pressable, and pressing it just shows the
  "use email and password" message without starting any Google OAuth / native
  operation. The adapter uses `requireOptionalNativeModule`, so there is no
  import-time crash in Expo Go.

## Not yet verified (later slices)

- native compilation (Kotlin / Swift) — **B4.2B**
- Google Cloud OAuth clients (Web/server, Android, iOS) — **B4.2B**
- a real Android provider result — **B4.2C**
- a real iOS provider result — **B4.2D**
- real ID-token `aud` / `nonce` behavior on a device
- EAS build / `expo-dev-client` / `eas.json`
- production readiness

Do not claim mobile Google login works on a real device after B4.2A.

## Locked security protocol (per user attempt)

1. Fetch a **new** WeCooked challenge (`authService.getSocialChallenge()` →
   `{ challengeId, nonce, expiresAt }`).
2. Receive the raw **43-character base64url** nonce `N`.
3. Pass **exactly `N`** to the native `signIn({ nonce })` — no trim, no hashing,
   no encoding, no transformation.
4. Google signs `N` into the ID token's `nonce` claim.
5. The native layer returns **only** the Google `idToken`.
6. Send **only** `{ idToken, challengeId }` to `POST /api/v1/auth/social/google`.
7. The backend verifies and establishes an ordinary WeCooked session.

Rules: one attempt = one challenge = at most one native operation. Cancellation,
provider failure, and backend failure all abandon the challenge. Every retry
fetches a new challenge. No challenge reuse, no cached-token path, no silent
sign-in, no `restorePreviousSignIn`, no `getTokens`/`currentUser` path, no
Google-token persistence, no mobile-side nonce hashing.

## Components

| Layer | File | Responsibility |
|---|---|---|
| UI hook | `src/hooks/useGoogleSignIn.js` | React/UI state only: `loading`, `error`, `ready`. No auth authority. Cancellation is silent. |
| Auth state | `src/context/AuthContext.js` | Sole React auth-state authority. `signInWithGoogle()` reconciles the returned user. Stores no credentials. |
| Orchestration | `src/auth/googleAuthFlow.js` | Authoritative JS single-flight (mirrors `authService.refreshInFlight`). Challenge → native → backend. No React state, no persistence, no logging. |
| REST | `src/api/authService.js` | `getSocialChallenge()`, `googleLogin()`. `googleLogin` reuses `establishSession()` — no duplicated token/session logic. |
| Native adapter | `src/native/googleSignIn.js` | Thin seam. Optional native-module detection, error normalization to `GOOGLE_*`, returns only `{ idToken }`. No persistence, no logging. |
| Native module | `modules/wecooked-google-signin/{android,ios}` | `signIn({ nonce }) -> { idToken }`, `clearState() -> void`. Nothing else. |

### Missing-native / Expo Go safety

`src/native/googleSignIn.js` calls `requireOptionalNativeModule('WeCookedGoogleSignIn')`,
which returns `null` when the module is not in the running binary. In that state
`isGoogleSignInAvailable()` is `false`, `signIn()` rejects with `GOOGLE_UNAVAILABLE`,
and `useGoogleSignIn().ready` is `false` so `LoginScreen` renders the button
visually dimmed/unavailable. It stays pressable; a press just shows a safe
"use email and password" message and starts no Google OAuth / native operation.
This is covered by tests.

## Native surface

Public native capability is intentionally exactly:

```
signIn({ nonce }) -> { idToken }
clearState() -> void
```

There is **no** native API for profile, email, subject, access token, refresh
token, server auth code, scopes, restore, silent sign-in, current user, get
tokens, disconnect, or revoke.

### Native error contract

Errors crossing the bridge carry only stable WeCooked codes + fixed safe
messages: `GOOGLE_CANCELLED`, `GOOGLE_IN_PROGRESS`, `GOOGLE_NOT_CONFIGURED`,
`GOOGLE_UNAVAILABLE`, `GOOGLE_PROVIDER_FAILED`. `NSError.localizedDescription`,
Credential Manager exception text, Google internal payloads, tokens, nonce,
profile, subject, and email are never exposed. The JS adapter collapses anything
unknown to `GOOGLE_PROVIDER_FAILED`.

### Native nonce validation

Both platforms validate `^[A-Za-z0-9_-]{43}$` before calling Google, do not
trim/transform/hash, reject a malformed nonce with a safe category, and never
log the nonce.

### Android

`androidx.credentials:credentials:1.6.0`,
`androidx.credentials:credentials-play-services-auth:1.6.0`,
`com.google.android.libraries.identity.googleid:googleid:1.2.0` — no direct
`com.google.android.gms:play-services-auth`. Flow:
`GetSignInWithGoogleOption.Builder(webServerClientId).setNonce(rawNonce).build()`
→ `GetCredentialRequest` → `CredentialManager.getCredential(activity, …)` →
`GoogleIdTokenCredential.createFrom(…)` → return `idToken` only. Explicit,
user-present button flow using the foreground Activity; `GOOGLE_UNAVAILABLE`
when no Activity. Native in-progress guard cleared on every terminal path.
`clearState()` calls `clearCredentialState()` — for logout hygiene only, never
after a successful acquisition.

The Web/server client ID is **not** passed from JS. The config plugin writes it
into a dedicated Android string resource `wecooked_google_web_client_id`; the
module reads the build-pinned value. Android's own OAuth client is associated in
Google Cloud via `com.wecooked.app` + signing-cert fingerprints in **B4.2B**.

### iOS

`GoogleSignIn ~> 9.2` (pinned in the local podspec). Flow: validate nonce →
foreground presenting `UIViewController` → confirm build-time `GIDClientID` +
`GIDServerClientID` → `GIDConfiguration(clientID:, serverClientID:)` →
`signIn(withPresenting:hint:nil,additionalScopes:nil,nonce:rawNonce)` → read only
`result.user.idToken.tokenString` → copy to a local → best-effort
`GIDSignIn.sharedInstance.signOut()` → resolve `{ idToken }`. No
`restorePreviousSignIn` / `currentUser` / `refreshTokensIfNeeded` / `disconnect`.

**AppDelegate**: the generated `ios/AppDelegate.swift` is not edited. A
`WeCookedGoogleSignInAppDelegateSubscriber` is registered via
`expo-module.config.json` (`apple.appDelegateSubscribers`). Its URL-open handler
delegates Google callback URLs to `GIDSignIn.sharedInstance.handle(url)` and
returns `false` otherwise, so `wecooked://` deep linking is unaffected.

## Build-time configuration

`apps/mobile/app.config.js` preserves `app.json` verbatim and reads
`GOOGLE_WEB_CLIENT_ID` + `GOOGLE_IOS_CLIENT_ID` from **process env** at config
time, passing them **only** as config-plugin props — never under Expo `extra`,
never as `EXPO_PUBLIC_*`.

- both unset → config resolves; Google native config stays unset (the normal
  B4.2A state).
- exactly one set → config resolution fails (incomplete).
- both set → the co-located plugin
  (`modules/wecooked-google-signin/app.plugin.js`) applies:
  - **Android**: one dedicated string resource, idempotent, no manifest auth
    entries, no `google-services.json`.
  - **iOS**: `GIDClientID`, `GIDServerClientID`, and the reversed iOS-client URL
    scheme appended (idempotent; existing `wecooked` scheme preserved). No
    `GoogleService-Info.plist`, no Firebase.

There is no client secret anywhere — Google verification is server-side (B4.1).

## Logout hygiene

At the WeCooked logout boundary (`authService.logout()` / `logoutAll()`), after
the ordinary backend-logout + local-token clearing, `nativeGoogleSignIn.clearState()`
is called best-effort. A native failure never blocks backend logout, local token
clearing, or the `AuthContext` unauthenticated transition. Android:
`CredentialManager.clearCredentialState()`. iOS: `GIDSignIn.sharedInstance.signOut()`.
Never `disconnect` / `revoke`.

## Why a local module (not a wrapper)

- The paid Universal Google Sign-In library is excluded.
- Nitro's configure-time / global nonce model is incompatible with B4.1's
  per-attempt raw-nonce contract.
- Immature community wrappers are not trusted to hold auth-relevant behavior.
- The exact, tiny native surface (`signIn({ nonce }) -> { idToken }`) is
  deliberately minimal because it *is* the security boundary: it guarantees the
  raw nonce reaches Google untransformed and that nothing but the ID token comes
  back.

Excluded dependencies (do not add): `expo-dev-client`,
`react-native-nitro-google-signin`, `react-native-nitro-modules`,
`@react-native-google-signin/google-signin`, any third-party Google auth
wrapper, Firebase, a direct `play-services-auth` dependency.

## Future gates

- **B4.2B** — Google Cloud OAuth clients + development build + `expo-dev-client`
  + `eas.json`.
- **B4.2C** — real Android provider verification.
- **B4.2D** — real iOS provider verification.
- **B4.3** — explicit Google account linking (`POST /auth/social/google/link`,
  SecurityScreen UI). Not implemented in B4.2A.

## Tests

Config: `apps/mobile/jest.config.js` — plain Jest, `testEnvironment: 'node'`, no
preset, `babel-jest` via `apps/mobile/babel.config.js`, and `moduleNameMapper`
entries for `react-native`, `expo-secure-store`, `expo-modules-core`, and
`expo/virtual/env` pointing at the small stubs in `apps/mobile/test/mocks/`.

`apps/mobile/__tests__/` (run: `npm test --workspace apps/mobile`):

- `googleAuthFlow.test.js` — challenge-before-native ordering, exact nonce to
  native, exact `{ idToken, challengeId }` body (no nonce/email/sub/…),
  authoritative user on success, no backend exchange on cancel/failure, fresh
  challenge per attempt, single-flight, in-flight cleanup, no auto-retry, no
  logging.
- `authServiceSocial.test.js` — `auth:false`, exact bodies, `establishSession`
  reuse.
- `clientAuthFalseRefresh.test.js` — an `auth:false` 401 does not trigger the
  WeCooked refresh+retry; an `auth:true` 401 still does.
- `googleSignInAdapter.test.js` — missing native module safety, only `{ idToken }`
  returned, error normalization, no logging.
- `configPlugin.test.js` / `appConfig.test.js` — both/one/none resolution,
  idempotent Android string + iOS scheme, `wecooked` preserved, no `extra`
  leakage, no Firebase / AppDelegate patching.
- `staticNativeAudit.test.js` — source-level checks: `setNonce(rawNonce)` /
  `nonce: rawNonce`, no SHA/hashing, no token logging, no persistent-storage or
  silent/restore APIs, no `serverAuthCode`.

Mocks prove orchestration only — **not** real Google token behavior. Real build
and provider verification are B4.2B–B4.2D.