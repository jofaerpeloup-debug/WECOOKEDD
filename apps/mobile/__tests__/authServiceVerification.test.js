// Email verification: verifyEmail (token consumption) and resendVerification
// (public, enumeration-safe request). Both are plain public POSTs that never
// touch the session — verifying an email changes no credential. client +
// tokenStore are mocked so no real network / SecureStore is involved.

jest.mock('../src/api/client', () => {
  class ApiError extends Error {
    constructor(message, opts = {}) {
      super(message);
      this.name = 'ApiError';
      Object.assign(this, { code: 'UNKNOWN', status: 0, details: [], kind: 'api' }, opts);
    }
    get isNetworkError() {
      return this.kind === 'network';
    }
  }
  return {
    api: { post: jest.fn(), get: jest.fn(), patch: jest.fn(), del: jest.fn(), request: jest.fn() },
    ApiError,
    setAuthAdapter: jest.fn(),
  };
});
jest.mock('../src/api/tokenStore');
jest.mock('../src/auth/googleAuthFlow', () => ({
  signInWithGoogle: jest.fn(),
  linkGoogleAccount: jest.fn(),
  clearNativeState: jest.fn(async () => {}),
}));

const { api } = require('../src/api/client');
const tokenStore = require('../src/api/tokenStore');
const authService = require('../src/api/authService');

beforeEach(() => {
  jest.clearAllMocks();
  tokenStore.setAccessToken.mockReturnValue(undefined);
  tokenStore.setRefreshToken.mockResolvedValue(true);
  tokenStore.clearSession.mockResolvedValue(undefined);
  tokenStore.getRefreshToken.mockResolvedValue(null);
});

describe('authService.verifyEmail', () => {
  const VERIFY_RESPONSE = { emailVerified: true };

  it('POSTs /auth/verify-email with body EXACTLY { token }, unauthenticated', async () => {
    api.post.mockResolvedValue(VERIFY_RESPONSE);

    await authService.verifyEmail('A'.repeat(43));

    expect(api.post).toHaveBeenCalledWith('/auth/verify-email', {
      auth: false,
      body: { token: 'A'.repeat(43) },
    });
    const [path, opts] = api.post.mock.calls[0];
    expect(path).toBe('/auth/verify-email');
    expect(Object.keys(opts.body)).toEqual(['token']);
  });

  it('touches no token or session state on success or failure', async () => {
    api.post.mockResolvedValue(VERIFY_RESPONSE);
    await authService.verifyEmail('A'.repeat(43));
    expect(tokenStore.setAccessToken).not.toHaveBeenCalled();
    expect(tokenStore.setRefreshToken).not.toHaveBeenCalled();
    expect(tokenStore.clearSession).not.toHaveBeenCalled();

    const { ApiError } = require('../src/api/client');
    api.post.mockRejectedValue(
      new ApiError('nope', { code: 'AUTH_EMAIL_VERIFICATION_TOKEN_INVALID', status: 400 })
    );
    await expect(authService.verifyEmail('B'.repeat(43))).rejects.toThrow('nope');
    expect(tokenStore.clearSession).not.toHaveBeenCalled();
  });

  it('returns the backend response unchanged', async () => {
    api.post.mockResolvedValue(VERIFY_RESPONSE);
    const result = await authService.verifyEmail('A'.repeat(43));
    expect(result).toBe(VERIFY_RESPONSE);
  });
});

describe('authService.resendVerification', () => {
  const RESEND_RESPONSE = { verificationEmailRequested: true };

  it('POSTs /auth/resend-verification with body EXACTLY { email }, unauthenticated', async () => {
    api.post.mockResolvedValue(RESEND_RESPONSE);

    await authService.resendVerification('cook@example.com');

    expect(api.post).toHaveBeenCalledWith('/auth/resend-verification', {
      auth: false,
      body: { email: 'cook@example.com' },
    });
    const { body } = api.post.mock.calls[0][1];
    expect(Object.keys(body)).toEqual(['email']);
  });

  it('touches no token or session state and never reads identity', async () => {
    api.post.mockResolvedValue(RESEND_RESPONSE);
    await authService.resendVerification('cook@example.com');
    expect(tokenStore.setAccessToken).not.toHaveBeenCalled();
    expect(tokenStore.clearSession).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('returns the backend generic response unchanged, regardless of account eligibility', async () => {
    api.post.mockResolvedValue(RESEND_RESPONSE);
    const result = await authService.resendVerification('unknown@example.com');
    expect(result).toBe(RESEND_RESPONSE);
  });
});

describe('ACCOUNT2 auth service calls', () => {
  it('uses exact authenticated request and cancel bodies', async () => {
    api.post.mockResolvedValue({ pendingEmailChange: null });
    await authService.requestEmailChange({ newEmail: 'new@example.com', currentPassword: 'secret' });
    expect(api.post).toHaveBeenCalledWith('/auth/email-change', {
      body: { newEmail: 'new@example.com', currentPassword: 'secret' },
    });
    await authService.cancelEmailChange();
    expect(api.post).toHaveBeenLastCalledWith('/auth/email-change/cancel', { body: {} });
  });

  it('verifies email change unauthenticated without touching local token state itself', async () => {
    api.post.mockResolvedValue({ emailChanged: true });
    await authService.verifyEmailChange('C'.repeat(43));
    expect(api.post).toHaveBeenCalledWith('/auth/email-change/verify', {
      auth: false,
      body: { token: 'C'.repeat(43) },
    });
    expect(tokenStore.clearSession).not.toHaveBeenCalled();
  });

  it('sends only the exact deactivation confirmation and leaves cleanup to AuthContext', async () => {
    api.post.mockResolvedValue({ deactivated: true });
    await authService.deactivateAccount();
    expect(api.post).toHaveBeenCalledWith('/auth/deactivate', { body: { confirmation: 'DEACTIVATE' } });
    expect(tokenStore.clearSession).not.toHaveBeenCalled();
  });
});

describe('ACCOUNT2 stale-success auth transitions', () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require('react');
  const TestRenderer = require('react-test-renderer');
  const { act } = TestRenderer;
  const { AuthProvider, useAuth } = require('../src/context/AuthContext');

  function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
    return { promise, resolve };
  }

  async function renderProvider() {
    let current;
    function Capture() {
      current = useAuth();
      return null;
    }
    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(AuthProvider, null, React.createElement(Capture))
      );
      await Promise.resolve();
    });
    return { get current() { return current; }, renderer };
  }

  async function signIn(provider, user, email) {
    api.post.mockResolvedValueOnce({
      user,
      accessToken: `access-${user.id}`,
      refreshToken: `refresh-${user.id}`,
    });
    api.get.mockResolvedValueOnce({ user });
    await act(async () => {
      await provider.current.signIn({ email, password: 'Password1!' });
    });
  }

  it('does not let stale A deactivation clear a newer B account/session', async () => {
    const provider = await renderProvider();
    const userA = { id: 'A', email: 'a@example.com' };
    const userB = { id: 'B', email: 'b@example.com' };
    await signIn(provider, userA, userA.email);
    const response = deferred();
    api.post.mockImplementationOnce(() => response.promise);

    let staleCompletion;
    await act(async () => {
      staleCompletion = provider.current.deactivate();
      await Promise.resolve();
    });
    await signIn(provider, userB, userB.email);
    await act(async () => {
      response.resolve({ deactivated: true });
      await staleCompletion;
    });

    expect(provider.current.user).toBe(userB);
    expect(provider.current.isLoggedIn).toBe(true);
    expect(tokenStore.clearSession).not.toHaveBeenCalled();
    await act(async () => provider.renderer.unmount());
  });

  it('does not let stale A email-change verification clear a newer B account/session', async () => {
    const provider = await renderProvider();
    const userA = { id: 'A', email: 'a@example.com' };
    const userB = { id: 'B', email: 'b@example.com' };
    await signIn(provider, userA, userA.email);
    const response = deferred();
    api.post.mockImplementationOnce(() => response.promise);

    let staleCompletion;
    await act(async () => {
      staleCompletion = provider.current.verifyEmailChange('C'.repeat(43));
      await Promise.resolve();
    });
    await signIn(provider, userB, userB.email);
    await act(async () => {
      response.resolve({ emailChanged: true });
      await staleCompletion;
    });

    expect(provider.current.user).toBe(userB);
    expect(provider.current.isLoggedIn).toBe(true);
    expect(tokenStore.clearSession).not.toHaveBeenCalled();
    await act(async () => provider.renderer.unmount());
  });
});
