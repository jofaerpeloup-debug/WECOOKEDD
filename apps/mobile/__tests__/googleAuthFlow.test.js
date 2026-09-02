// §29 — Google auth flow orchestration (src/auth/googleAuthFlow.js).
//
// Mocks isolate orchestration. They do NOT prove real Google token behavior.

// Preserve the real client module contract: authService.js destructures
// `api`, `setAuthAdapter`, and `ApiError` at import and calls `setAuthAdapter`
// at module load. googleAuthFlow.js itself only needs `ApiError`.
jest.mock('../src/api/client', () => {
  class ApiError extends Error {
    constructor(message, opts = {}) {
      super(message);
      this.name = 'ApiError';
      this.code = opts.code || 'UNKNOWN';
      this.status = opts.status || 0;
      this.details = opts.details || [];
      this.kind = opts.kind || 'api';
    }
    get isNetworkError() {
      return this.kind === 'network';
    }
  }
  return {
    ApiError,
    api: { post: jest.fn(), get: jest.fn(), patch: jest.fn(), del: jest.fn(), request: jest.fn() },
    setAuthAdapter: jest.fn(),
  };
});
jest.mock('../src/api/authService');
jest.mock('../src/native/googleSignIn');

// 43-char base64url strings (^[A-Za-z0-9_-]{43}$).
const VALID_NONCE = `a-b_${'A'.repeat(39)}`;
const OTHER_NONCE = `x-y_${'B'.repeat(39)}`;

// Re-require the mocks AND the flow from one fresh registry each test, so the
// flow observes exactly the mock objects the test configures and the module's
// private in-flight slot starts clean.
let authService;
let nativeGoogleSignIn;
let flow;

beforeEach(() => {
  jest.resetModules();
  authService = require('../src/api/authService');
  nativeGoogleSignIn = require('../src/native/googleSignIn');
  flow = require('../src/auth/googleAuthFlow');
});

function happyPath({ nonce = VALID_NONCE, challengeId = 'chal_1', user = { id: 'u1', name: 'Ada' } } = {}) {
  authService.getSocialChallenge.mockResolvedValue({ challengeId, nonce, expiresAt: 'later' });
  nativeGoogleSignIn.signIn.mockResolvedValue({ idToken: 'google.id.token' });
  authService.googleLogin.mockResolvedValue(user);
}

describe('googleAuthFlow.signInWithGoogle — happy path', () => {
  it('fetches a fresh challenge BEFORE calling native sign-in, then exchanges with the backend', async () => {
    happyPath();
    const user = await flow.signInWithGoogle();

    expect(user).toEqual({ id: 'u1', name: 'Ada' });

    const challengeOrder = authService.getSocialChallenge.mock.invocationCallOrder[0];
    const nativeOrder = nativeGoogleSignIn.signIn.mock.invocationCallOrder[0];
    const backendOrder = authService.googleLogin.mock.invocationCallOrder[0];
    expect(challengeOrder).toBeLessThan(nativeOrder);
    expect(nativeOrder).toBeLessThan(backendOrder);
  });

  it('passes the EXACT challenge nonce to native signIn({ nonce })', async () => {
    happyPath({ nonce: VALID_NONCE });
    await flow.signInWithGoogle();
    expect(nativeGoogleSignIn.signIn).toHaveBeenCalledWith({ nonce: VALID_NONCE });
  });

  it('sends the backend EXACTLY { idToken, challengeId } and nothing else', async () => {
    happyPath({ challengeId: 'chal_xyz' });
    await flow.signInWithGoogle();

    expect(authService.googleLogin).toHaveBeenCalledWith({
      idToken: 'google.id.token',
      challengeId: 'chal_xyz',
    });
    const body = authService.googleLogin.mock.calls[0][0];
    expect(Object.keys(body).sort()).toEqual(['challengeId', 'idToken']);
    for (const forbidden of [
      'nonce',
      'email',
      'name',
      'sub',
      'subject',
      'role',
      'status',
      'audience',
      'aud',
      'clientId',
      'userId',
    ]) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });

  it('clears the in-flight slot after a successful attempt', async () => {
    happyPath();
    await flow.signInWithGoogle();
    expect(flow.isInFlight()).toBe(false);
  });
});

describe('googleAuthFlow.signInWithGoogle — abandonment', () => {
  it('performs NO backend exchange when the user cancels', async () => {
    authService.getSocialChallenge.mockResolvedValue({ challengeId: 'c', nonce: VALID_NONCE });
    nativeGoogleSignIn.signIn.mockRejectedValue({ code: 'GOOGLE_CANCELLED', message: 'x' });

    await expect(flow.signInWithGoogle()).rejects.toMatchObject({ code: 'GOOGLE_CANCELLED' });
    expect(authService.googleLogin).not.toHaveBeenCalled();
    expect(flow.isInFlight()).toBe(false);
  });

  it('performs NO backend exchange when the provider fails', async () => {
    authService.getSocialChallenge.mockResolvedValue({ challengeId: 'c', nonce: VALID_NONCE });
    nativeGoogleSignIn.signIn.mockRejectedValue({ code: 'GOOGLE_PROVIDER_FAILED', message: 'x' });

    await expect(flow.signInWithGoogle()).rejects.toMatchObject({ code: 'GOOGLE_PROVIDER_FAILED' });
    expect(authService.googleLogin).not.toHaveBeenCalled();
  });

  it('rejects a malformed challenge nonce without calling native or backend, and never echoes the nonce', async () => {
    authService.getSocialChallenge.mockResolvedValue({ challengeId: 'c', nonce: 'too-short' });

    const err = await flow.signInWithGoogle().catch((e) => e);
    expect(err.code).toBe('AUTH_SOCIAL_CHALLENGE_INVALID');
    expect(JSON.stringify(err) + err.message).not.toMatch(/too-short/);
    expect(nativeGoogleSignIn.signIn).not.toHaveBeenCalled();
    expect(authService.googleLogin).not.toHaveBeenCalled();
  });

  it('does NOT automatically retry the provider after a failure', async () => {
    authService.getSocialChallenge.mockResolvedValue({ challengeId: 'c', nonce: VALID_NONCE });
    nativeGoogleSignIn.signIn.mockRejectedValue({ code: 'GOOGLE_PROVIDER_FAILED' });

    await flow.signInWithGoogle().catch(() => {});
    expect(authService.getSocialChallenge).toHaveBeenCalledTimes(1);
    expect(nativeGoogleSignIn.signIn).toHaveBeenCalledTimes(1);
  });
});

describe('googleAuthFlow.signInWithGoogle — fresh challenge per attempt', () => {
  it('fetches a NEW challenge on the attempt after a cancellation', async () => {
    authService.getSocialChallenge
      .mockResolvedValueOnce({ challengeId: 'c1', nonce: VALID_NONCE })
      .mockResolvedValueOnce({ challengeId: 'c2', nonce: OTHER_NONCE });
    nativeGoogleSignIn.signIn
      .mockRejectedValueOnce({ code: 'GOOGLE_CANCELLED' })
      .mockResolvedValueOnce({ idToken: 'tok2' });
    authService.googleLogin.mockResolvedValue({ id: 'u1' });

    await flow.signInWithGoogle().catch(() => {});
    await flow.signInWithGoogle();

    expect(authService.getSocialChallenge).toHaveBeenCalledTimes(2);
    expect(nativeGoogleSignIn.signIn).toHaveBeenNthCalledWith(2, { nonce: OTHER_NONCE });
    expect(authService.googleLogin).toHaveBeenCalledWith({ idToken: 'tok2', challengeId: 'c2' });
  });

  it('fetches a NEW challenge on the attempt after a provider failure', async () => {
    authService.getSocialChallenge
      .mockResolvedValueOnce({ challengeId: 'c1', nonce: VALID_NONCE })
      .mockResolvedValueOnce({ challengeId: 'c2', nonce: OTHER_NONCE });
    nativeGoogleSignIn.signIn
      .mockRejectedValueOnce({ code: 'GOOGLE_PROVIDER_FAILED' })
      .mockResolvedValueOnce({ idToken: 'tok2' });
    authService.googleLogin.mockResolvedValue({ id: 'u1' });

    await flow.signInWithGoogle().catch(() => {});
    await flow.signInWithGoogle();

    expect(authService.getSocialChallenge).toHaveBeenCalledTimes(2);
  });
});

describe('googleAuthFlow.signInWithGoogle — authoritative single-flight', () => {
  it('shares one in-flight promise; a concurrent caller creates no second challenge or native op', async () => {
    let resolveChallenge;
    authService.getSocialChallenge.mockImplementation(
      () => new Promise((res) => { resolveChallenge = res; })
    );
    nativeGoogleSignIn.signIn.mockResolvedValue({ idToken: 'tok' });
    authService.googleLogin.mockResolvedValue({ id: 'u1' });

    const p1 = flow.signInWithGoogle();
    const p2 = flow.signInWithGoogle();
    expect(p1).toBe(p2);
    expect(flow.isInFlight()).toBe(true);

    resolveChallenge({ challengeId: 'c', nonce: VALID_NONCE });
    await Promise.all([p1, p2]);

    expect(authService.getSocialChallenge).toHaveBeenCalledTimes(1);
    expect(nativeGoogleSignIn.signIn).toHaveBeenCalledTimes(1);
    expect(authService.googleLogin).toHaveBeenCalledTimes(1);
    expect(flow.isInFlight()).toBe(false);
  });

  it('allows a brand-new attempt once the previous one settled', async () => {
    happyPath();
    await flow.signInWithGoogle();
    await flow.signInWithGoogle();
    expect(authService.getSocialChallenge).toHaveBeenCalledTimes(2);
  });
});

describe('googleAuthFlow — logging hygiene', () => {
  it('logs nothing on a full successful attempt', async () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
      jest.spyOn(console, m).mockImplementation(() => {})
    );
    happyPath();
    await flow.signInWithGoogle();
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe('googleAuthFlow.clearNativeState — logout provider seam', () => {
  it('delegates to the native adapter clearState()', async () => {
    nativeGoogleSignIn.clearState.mockResolvedValue(undefined);
    await flow.clearNativeState();
    expect(nativeGoogleSignIn.clearState).toHaveBeenCalledTimes(1);
  });

  it('resolves safely (no throw) when the native clearState rejects', async () => {
    nativeGoogleSignIn.clearState.mockRejectedValue(new Error('provider blew up'));
    await expect(flow.clearNativeState()).resolves.toBeUndefined();
  });

  it('exposes nothing and logs nothing on failure', async () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
      jest.spyOn(console, m).mockImplementation(() => {})
    );
    nativeGoogleSignIn.clearState.mockRejectedValue(new Error('secret provider detail'));
    await flow.clearNativeState();
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});