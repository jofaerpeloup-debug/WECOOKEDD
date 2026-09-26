// Static source validation of the two deep-link completion screens
// (ResetPasswordScreen, VerifyEmailScreen). Like the M1 auth screens audit,
// this workspace has no RN renderer (see jest.config.js), so the invariants
// that matter — no local persistence of the raw token, correct wiring to the
// real authService calls, no logging of secrets — are encoded as source
// assertions rather than rendering assertions.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const FILES = {
  ResetPassword: 'screens/ResetPasswordScreen.js',
  VerifyEmail: 'screens/VerifyEmailScreen.js',
};

const raw = {};
const code = {};
for (const [name, rel] of Object.entries(FILES)) {
  raw[name] = read(rel);
  code[name] = stripComments(raw[name]);
}
const NAMES = Object.keys(FILES);

describe('no local persistence of the raw token', () => {
  it.each(NAMES)('%s never touches AsyncStorage/SecureStore/tokenStore', (name) => {
    expect(code[name]).not.toMatch(/AsyncStorage/);
    expect(code[name]).not.toMatch(/async-storage/);
    expect(code[name]).not.toMatch(/SecureStore|expo-secure-store/);
    expect(code[name]).not.toMatch(/tokenStore/);
  });

  it.each(NAMES)('%s reads the token only from route.params, never a persisted source', (name) => {
    expect(code[name]).toMatch(/route\??\.\s*params\??\.\s*token/);
  });

  it.each(NAMES)('%s never logs the token or the full route params', (name) => {
    expect(code[name]).not.toMatch(/console\.(log|warn|error)\([^)]*token/i);
    expect(code[name]).not.toMatch(/console\.(log|warn|error)\([^)]*route\.params/i);
  });
});

describe('ResetPasswordScreen — wired to the existing backend flow, no new one', () => {
  it('calls the real authService.resetPassword with { token, newPassword }', () => {
    expect(raw.ResetPassword).toMatch(
      /authService\.resetPassword\(\{\s*token,\s*newPassword\s*\}\)/
    );
  });

  it('clears local session after a successful reset, unconditionally', () => {
    const submitFn = code.ResetPassword.match(/const submit = async \(\) => \{[\s\S]*?\n  \};/);
    expect(submitFn).not.toBeNull();
    expect(submitFn[0]).toMatch(/await endLocalSession\(\);/);
    // Called after the reset call succeeds (source order), not before.
    const resetIdx = submitFn[0].indexOf('authService.resetPassword');
    const endIdx = submitFn[0].indexOf('endLocalSession()');
    expect(resetIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(resetIdx);
  });

  it('guards against a missing/empty token before submitting', () => {
    expect(code.ResetPassword).toMatch(/tokenMissing/);
    expect(code.ResetPassword).toMatch(/if \(inFlightRef\.current \|\| tokenMissing\) return;/);
  });

  it('enforces the shared new-password contract client-side before calling the API', () => {
    const submitFn = code.ResetPassword.match(/const submit = async \(\) => \{[\s\S]*?\n  \};/)[0];
    expect(submitFn).toMatch(/getNewPasswordValidationError\(newPassword\)/);
    const guardIdx = submitFn.indexOf('getNewPasswordValidationError(newPassword)');
    const callIdx = submitFn.indexOf('authService.resetPassword');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeGreaterThan(guardIdx);
  });

  it('maps errors through the shared safe mapper, never a raw backend/network message', () => {
    expect(raw.ResetPassword).toMatch(/getAuthErrorMessage/);
    expect(code.ResetPassword).not.toMatch(/err\.message|error\.response/);
  });

  it('never handles tokens/session fields of its own beyond the route param', () => {
    expect(code.ResetPassword).not.toMatch(/accessToken|refreshToken|idToken/);
  });
});

describe('VerifyEmailScreen — wired to the real endpoints, both auth states', () => {
  it('calls the real authService.verifyEmail with the route token', () => {
    expect(raw.VerifyEmail).toMatch(/authService\.verifyEmail\(token\)/);
  });

  it('refreshes the authoritative user ONLY when already logged in', () => {
    const effect = code.VerifyEmail.match(/useEffect\(\(\) => \{[\s\S]*?\n  \}, \[token, tokenMissing\]\);/);
    expect(effect).not.toBeNull();
    expect(effect[0]).toMatch(/if \(isLoggedIn\) \{/);
    expect(effect[0]).toMatch(/await refreshUser\(\);/);
  });

  it('offers a real resend action that calls authService.resendVerification with the authoritative email', () => {
    expect(raw.VerifyEmail).toMatch(/authService\.resendVerification\(user\.email\)/);
  });

  it('never fabricates a logged-in state — navigation target is derived from useAuth().isLoggedIn', () => {
    expect(raw.VerifyEmail).toMatch(/const \{ isLoggedIn, user, refreshUser \} = useAuth\(\)/);
    expect(code.VerifyEmail).not.toMatch(/setIsLoggedIn|markLoggedIn|fakeLogin|demoLogin/);
  });

  it('maps errors through the shared safe mapper, never a raw backend/network message', () => {
    expect(raw.VerifyEmail).toMatch(/getAuthErrorMessage/);
    expect(code.VerifyEmail).not.toMatch(/err\.message|error\.response/);
  });
});

describe('both screens add no fake or dead identity providers, no OAuth internals', () => {
  it.each(NAMES)('%s carries no Google/Facebook/Apple auth control', (name) => {
    expect(code[name]).not.toMatch(/GoogleSignin|facebook|apple-?auth/i);
  });

  it.each(NAMES)('%s carries no client/provider secrets', (name) => {
    expect(code[name]).not.toMatch(/clientId|CLIENT_ID|apiKey|API_KEY|secret|Bearer /i);
  });
});
