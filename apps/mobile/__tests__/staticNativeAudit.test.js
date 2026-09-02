// §33 / §41 — static source validation of the native + JS Google code.
//
// B4.2A does NOT compile the native projects, so this is source-level review
// encoded as assertions. It does NOT prove the native code compiles or that a
// real device produces a correctly-signed nonce.
//
// "Forbidden" checks run against a comment-stripped copy of the source, so a
// word appearing only in an explanatory comment (e.g. "no serverAuthCode") does
// not trip them; "must contain" checks run against the raw source.

const fs = require('fs');
const path = require('path');

const MODULE_ROOT = path.join(__dirname, '../modules/wecooked-google-signin');
const read = (rel) => fs.readFileSync(path.join(MODULE_ROOT, rel), 'utf8');

// Strip // line comments and /* */ block comments (good enough for source audit;
// none of our string literals contain `//` or `/*`).
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const androidRaw = read(
  'android/src/main/java/expo/modules/wecookedgooglesignin/WeCookedGoogleSignInModule.kt'
);
const iosRaw = read('ios/WeCookedGoogleSignInModule.swift');
const iosSubscriberRaw = read('ios/WeCookedGoogleSignInAppDelegateSubscriber.swift');
const flowRaw = fs.readFileSync(path.join(__dirname, '../src/auth/googleAuthFlow.js'), 'utf8');
const adapterRaw = fs.readFileSync(path.join(__dirname, '../src/native/googleSignIn.js'), 'utf8');
const authServiceRaw = fs.readFileSync(path.join(__dirname, '../src/api/authService.js'), 'utf8');
const authContextRaw = fs.readFileSync(path.join(__dirname, '../src/context/AuthContext.js'), 'utf8');

const androidCode = stripComments(androidRaw);
const iosCode = stripComments(iosRaw);
const flowCode = stripComments(flowRaw);
const adapterCode = stripComments(adapterRaw);
const authServiceCode = stripComments(authServiceRaw);
const authContextCode = stripComments(authContextRaw);

describe('Android native source', () => {
  it('validates the raw nonce shape ^[A-Za-z0-9_-]{43}$ before calling Google', () => {
    expect(androidRaw).toMatch(/\^\[A-Za-z0-9_-\]\{43\}\$/);
  });
  it('passes the raw nonce to setNonce(...) untransformed', () => {
    expect(androidRaw).toMatch(/setNonce\(\s*rawNonce\s*\)/);
  });
  it('does no hashing of the nonce', () => {
    expect(androidCode).not.toMatch(/sha-?256/i);
    expect(androidCode).not.toMatch(/MessageDigest/);
  });
  it('uses no persistent storage / silent-credential / server-auth-code APIs', () => {
    expect(androidCode).not.toMatch(/SharedPreferences/);
    expect(androidCode).not.toMatch(/restorePreviousSignIn/);
    expect(androidCode).not.toMatch(/setFilterByAuthorizedAccounts/);
    expect(androidCode).not.toMatch(/serverAuthCode/i);
  });
  it('never logs', () => {
    expect(androidCode).not.toMatch(/\bLog\.[dviwe]\s*\(/);
    expect(androidCode).not.toMatch(/println\(/);
  });
  it('returns only the idToken across the bridge', () => {
    expect(androidRaw).toMatch(/mapOf\(\s*"idToken"\s*to\s*idToken\s*\)/);
  });
  it('only surfaces stable WeCooked GOOGLE_* error-code literals', () => {
    const ALLOWED = [
      'GOOGLE_CANCELLED',
      'GOOGLE_IN_PROGRESS',
      'GOOGLE_NOT_CONFIGURED',
      'GOOGLE_UNAVAILABLE',
      'GOOGLE_PROVIDER_FAILED',
    ];
    // A WeCooked error code is only ever a QUOTED string literal ("GOOGLE_...").
    // Bare identifiers such as
    // GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL are Google SDK
    // type names, not our codes, and must not be matched.
    const codeLiterals = [...androidCode.matchAll(/"(GOOGLE_[A-Z_]+)"/g)].map((m) => m[1]);
    expect(codeLiterals.length).toBeGreaterThan(0);
    for (const c of codeLiterals) {
      expect(ALLOWED).toContain(c);
    }
    // The full allow-list is present, and nothing outside it.
    expect([...new Set(codeLiterals)].sort()).toEqual([...ALLOWED].sort());
  });
});

describe('iOS native source', () => {
  it('validates the raw nonce shape before calling Google', () => {
    expect(iosRaw).toMatch(/\^\[A-Za-z0-9_-\]\{43\}\$/);
  });
  it('passes the raw nonce to the GoogleSignIn nonce: parameter untransformed', () => {
    expect(iosRaw).toMatch(/nonce:\s*rawNonce/);
  });
  it('does no hashing of the nonce', () => {
    expect(iosCode).not.toMatch(/sha-?256/i);
    expect(iosCode).not.toMatch(/CryptoKit|CC_SHA/);
  });
  it('reads only the ID token from the result', () => {
    expect(iosRaw).toMatch(/idToken\?\.tokenString/);
    expect(iosCode).not.toMatch(/serverAuthCode/);
    expect(iosCode).not.toMatch(/\.accessToken/);
  });
  it('uses no restore / currentUser / refresh / disconnect / revoke APIs', () => {
    expect(iosCode).not.toMatch(/restorePreviousSignIn/);
    expect(iosCode).not.toMatch(/\.currentUser/);
    expect(iosCode).not.toMatch(/refreshTokensIfNeeded/);
    expect(iosCode).not.toMatch(/\.disconnect\(/);
    expect(iosCode).not.toMatch(/\.revoke/i);
  });
  it('does not persist to UserDefaults and does not log', () => {
    expect(iosCode).not.toMatch(/UserDefaults/);
    expect(iosCode).not.toMatch(/\bprint\(/);
    expect(iosCode).not.toMatch(/NSLog/);
    expect(iosCode).not.toMatch(/os_log|Logger\(/);
  });
  it('calls signOut() after copying the token (logout hygiene semantics)', () => {
    expect(iosRaw).toMatch(/GIDSignIn\.sharedInstance\.signOut\(\)/);
  });
  it('classifies GOOGLE_CANCELLED only with the Google Sign-In error domain + canceled code', () => {
    // Cancellation must require BOTH kGIDSignInErrorDomain AND .canceled, so a
    // non-Google NSError that merely shares the numeric code is not
    // misclassified as a user cancellation.
    expect(iosCode).toMatch(/kGIDSignInErrorDomain/);
    expect(iosCode).toMatch(/GIDSignInError\.canceled/);
    expect(iosCode).toMatch(
      /kGIDSignInErrorDomain[\s\S]{0,160}GIDSignInError\.canceled|GIDSignInError\.canceled[\s\S]{0,160}kGIDSignInErrorDomain/
    );
  });
});

describe('iOS AppDelegate integration', () => {
  it('is an ExpoAppDelegateSubscriber (no generated AppDelegate edits)', () => {
    expect(iosSubscriberRaw).toMatch(/ExpoAppDelegateSubscriber/);
    expect(iosSubscriberRaw).toMatch(/GIDSignIn\.sharedInstance\.handle\(url\)/);
  });
  it('is registered via expo-module.config.json, not config-plugin source edits', () => {
    const cfg = JSON.parse(read('expo-module.config.json'));
    expect(cfg.apple.appDelegateSubscribers).toContain('WeCookedGoogleSignInAppDelegateSubscriber');
  });
});

describe('JS orchestration + adapter source', () => {
  it('googleAuthFlow persists nothing and logs nothing', () => {
    expect(flowCode).not.toMatch(/console\./);
    expect(flowCode).not.toMatch(/SecureStore|AsyncStorage|tokenStore/);
  });
  it('the native adapter logs nothing and stores nothing', () => {
    expect(adapterCode).not.toMatch(/console\./);
    expect(adapterCode).not.toMatch(/SecureStore|AsyncStorage/);
  });
});

describe('logout provider-cleanup wiring', () => {
  it('authService has no direct Google-native coupling', () => {
    expect(authServiceCode).not.toMatch(/native\/googleSignIn/);
    expect(authServiceCode).not.toMatch(/nativeGoogleSignIn/);
    expect(authServiceCode).not.toMatch(/clearNativeProviderState/);
  });

  it('AuthContext triggers googleAuthFlow.clearNativeState() and does NOT await it', () => {
    expect(authContextCode).toMatch(/googleAuthFlow\.clearNativeState\(\)/);
    expect(authContextCode).not.toMatch(/await\s+googleAuthFlow\.clearNativeState/);
  });
});