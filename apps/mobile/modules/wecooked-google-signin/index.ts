// WeCooked local Expo module — public JS surface.
//
// B4.2A intentionally keeps this surface tiny and security-relevant:
//
//   signIn({ nonce }) -> { idToken }   — one interactive Google operation that
//                                        signs EXACTLY the given 43-char
//                                        base64url raw nonce into the returned
//                                        Google ID token's `nonce` claim.
//   clearState()      -> void          — provider-side logout hygiene only.
//
// There is deliberately NO native API for profile / email / subject / access
// token / refresh token / server auth code / scopes / restore / silent sign-in
// / current user / getTokens / disconnect / revoke.
//
// App code does NOT import this module directly. It goes through
// `src/native/googleSignIn.js`, which uses `requireOptionalNativeModule` so the
// app still boots when the native module is not compiled (Expo Go / no dev
// build). This file exists for typing and for the Expo local-module convention.
//
// NOT VERIFIED IN B4.2A: native compilation, real Google providers, real token
// `aud` / `nonce` behavior. See docs/architecture/mobile-google-sign-in.md.

import { requireOptionalNativeModule } from 'expo-modules-core';

export type WeCookedGoogleSignInResult = {
  /** Raw Google ID token (JWT). The only value that crosses the bridge. */
  idToken: string;
};

export type WeCookedGoogleSignInModule = {
  /**
   * Runs one interactive, user-present Google sign-in. `nonce` must match
   * `^[A-Za-z0-9_-]{43}$` and is passed to Google untransformed (no trim, no
   * hashing, no encoding). Rejects with a stable `GOOGLE_*` coded error.
   */
  signIn(options: { nonce: string }): Promise<WeCookedGoogleSignInResult>;
  /** Best-effort provider-side state clear for WeCooked logout hygiene. */
  clearState(): Promise<void>;
};

const nativeModule = requireOptionalNativeModule<WeCookedGoogleSignInModule>(
  'WeCookedGoogleSignIn'
);

export default nativeModule;