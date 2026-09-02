// §31 — JS native adapter (src/native/googleSignIn.js).
//
// These tests exercise the JS seam only. They do NOT and CANNOT prove real
// Google token behavior — the native module is mocked.

jest.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: jest.fn(),
}));

const VALID_NONCE = 'A'.repeat(43);

// Re-require both `expo-modules-core` and the adapter from a fresh module
// registry so the adapter observes exactly the mock this call configures
// (the adapter reads `requireOptionalNativeModule` once, at import time).
function loadAdapter(nativeModule) {
  jest.resetModules();
  require('expo-modules-core').requireOptionalNativeModule.mockReturnValue(nativeModule);
  return require('../src/native/googleSignIn');
}

describe('googleSignIn adapter — availability', () => {
  it('does not throw at import time when the native module is absent', () => {
    expect(() => loadAdapter(null)).not.toThrow();
  });

  it('reports unavailable when the native module is absent', () => {
    const adapter = loadAdapter(null);
    expect(adapter.isGoogleSignInAvailable()).toBe(false);
  });

  it('reports unavailable when the module exists but has no signIn()', () => {
    const adapter = loadAdapter({ clearState: jest.fn() });
    expect(adapter.isGoogleSignInAvailable()).toBe(false);
  });

  it('reports available when a usable native module is present', () => {
    const adapter = loadAdapter({ signIn: jest.fn(), clearState: jest.fn() });
    expect(adapter.isGoogleSignInAvailable()).toBe(true);
  });
});

describe('googleSignIn adapter — signIn()', () => {
  it('fails safely with GOOGLE_UNAVAILABLE when the native module is absent', async () => {
    const adapter = loadAdapter(null);
    await expect(adapter.signIn({ nonce: VALID_NONCE })).rejects.toMatchObject({
      name: 'GoogleSignInError',
      code: 'GOOGLE_UNAVAILABLE',
    });
  });

  it('returns ONLY { idToken } on success, dropping any extra native fields', async () => {
    const signIn = jest.fn().mockResolvedValue({
      idToken: 'header.payload.sig',
      accessToken: 'SHOULD_NOT_LEAK',
      serverAuthCode: 'SHOULD_NOT_LEAK',
      email: 'nope@example.com',
    });
    const adapter = loadAdapter({ signIn });
    const result = await adapter.signIn({ nonce: VALID_NONCE });
    expect(result).toEqual({ idToken: 'header.payload.sig' });
    expect(Object.keys(result)).toEqual(['idToken']);
  });

  it('passes the nonce through untouched to the native module', async () => {
    const signIn = jest.fn().mockResolvedValue({ idToken: 't' });
    const adapter = loadAdapter({ signIn });
    await adapter.signIn({ nonce: VALID_NONCE });
    expect(signIn).toHaveBeenCalledWith({ nonce: VALID_NONCE });
  });

  it.each([
    'GOOGLE_CANCELLED',
    'GOOGLE_IN_PROGRESS',
    'GOOGLE_NOT_CONFIGURED',
    'GOOGLE_UNAVAILABLE',
    'GOOGLE_PROVIDER_FAILED',
  ])('normalizes known native error %s to a fixed safe message', async (code) => {
    const signIn = jest.fn().mockRejectedValue({
      code,
      message: 'RAW NATIVE DETAIL: NSError blah blah credential payload',
    });
    const adapter = loadAdapter({ signIn });
    const err = await adapter.signIn({ nonce: VALID_NONCE }).catch((e) => e);
    expect(err.code).toBe(code);
    expect(err.message).not.toMatch(/RAW NATIVE DETAIL/);
    expect(err.message.length).toBeGreaterThan(0);
  });

  it('collapses an unknown native error code to GOOGLE_PROVIDER_FAILED', async () => {
    const signIn = jest.fn().mockRejectedValue({ code: 'ERR_SOMETHING_INTERNAL', message: 'stack...' });
    const adapter = loadAdapter({ signIn });
    await expect(adapter.signIn({ nonce: VALID_NONCE })).rejects.toMatchObject({
      code: 'GOOGLE_PROVIDER_FAILED',
    });
  });

  it('collapses a non-coded thrown Error to GOOGLE_PROVIDER_FAILED', async () => {
    const signIn = jest.fn().mockRejectedValue(new Error('boom with token abc.def.ghi'));
    const adapter = loadAdapter({ signIn });
    const err = await adapter.signIn({ nonce: VALID_NONCE }).catch((e) => e);
    expect(err.code).toBe('GOOGLE_PROVIDER_FAILED');
    expect(err.message).not.toMatch(/abc\.def\.ghi/);
  });

  it('treats a native result without an idToken as a provider failure', async () => {
    const signIn = jest.fn().mockResolvedValue({ somethingElse: true });
    const adapter = loadAdapter({ signIn });
    await expect(adapter.signIn({ nonce: VALID_NONCE })).rejects.toMatchObject({
      code: 'GOOGLE_PROVIDER_FAILED',
    });
  });

  it('never logs the nonce or the token', async () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
      jest.spyOn(console, m).mockImplementation(() => {})
    );
    const signIn = jest.fn().mockResolvedValue({ idToken: 'secret.jwt.value' });
    const adapter = loadAdapter({ signIn });
    await adapter.signIn({ nonce: VALID_NONCE });
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe('googleSignIn adapter — clearState()', () => {
  it('resolves quietly when the native module is absent', async () => {
    const adapter = loadAdapter(null);
    await expect(adapter.clearState()).resolves.toBeUndefined();
  });

  it('never rejects even when the native clearState throws', async () => {
    const clearState = jest.fn().mockRejectedValue(new Error('provider blew up'));
    const adapter = loadAdapter({ signIn: jest.fn(), clearState });
    await expect(adapter.clearState()).resolves.toBeUndefined();
    expect(clearState).toHaveBeenCalled();
  });
});