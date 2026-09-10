// M1 — authService.forgotPassword.
//
// The password-reset REQUEST step. It is a plain public POST that issues no
// tokens, so the contract this pins down is as much about what it must NOT do
// (touch the session) as about the request it sends. client + tokenStore are
// mocked so no real network / SecureStore is involved.

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

const { api } = require('../src/api/client');
const tokenStore = require('../src/api/tokenStore');
const authService = require('../src/api/authService');
const RESET_RESPONSE = { passwordResetRequested: true };

beforeEach(() => {
  jest.clearAllMocks();
  tokenStore.setAccessToken.mockReturnValue(undefined);
  tokenStore.setRefreshToken.mockResolvedValue(true);
  tokenStore.clearSession.mockResolvedValue(undefined);
});

describe('authService.forgotPassword', () => {
  it('POSTs /auth/forgot-password with body EXACTLY { email }', async () => {
    api.post.mockResolvedValue(RESET_RESPONSE);

    await authService.forgotPassword('cook@example.com');

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/auth/forgot-password', {
      auth: false,
      body: { email: 'cook@example.com' },
    });
    // Nothing else rides along — no userId, token, nonce or client identifier.
    const { body } = api.post.mock.calls[0][1];
    expect(Object.keys(body)).toEqual(['email']);
  });

  it('is unauthenticated (auth: false) and uses the normal shared client', async () => {
    api.post.mockResolvedValue(RESET_RESPONSE);

    await authService.forgotPassword('cook@example.com');

    const [path, opts] = api.post.mock.calls[0];
    expect(path).toBe('/auth/forgot-password');
    expect(opts.auth).toBe(false);
    // No bespoke transport: no custom headers, query or method override.
    expect(Object.keys(opts).sort()).toEqual(['auth', 'body']);
  });

  it('touches no token or session state on success', async () => {
    api.post.mockResolvedValue(RESET_RESPONSE);

    await authService.forgotPassword('cook@example.com');

    expect(tokenStore.setAccessToken).not.toHaveBeenCalled();
    expect(tokenStore.setRefreshToken).not.toHaveBeenCalled();
    expect(tokenStore.clearSession).not.toHaveBeenCalled();
    expect(tokenStore.getAccessToken).not.toHaveBeenCalled();
    expect(tokenStore.getRefreshToken).not.toHaveBeenCalled();
    // It is a request step, not a sign-in: identity is never read.
    expect(api.get).not.toHaveBeenCalled();
  });

  it('touches no token or session state when the backend rejects', async () => {
    const { ApiError } = require('../src/api/client');
    api.post.mockRejectedValue(new ApiError('nope', { code: 'RATE_LIMIT_EXCEEDED', status: 429 }));

    await expect(authService.forgotPassword('cook@example.com')).rejects.toThrow('nope');

    expect(tokenStore.setAccessToken).not.toHaveBeenCalled();
    expect(tokenStore.setRefreshToken).not.toHaveBeenCalled();
    expect(tokenStore.clearSession).not.toHaveBeenCalled();
  });

  it('propagates the rejection unchanged so the screen maps it through getAuthErrorMessage', async () => {
    const { ApiError } = require('../src/api/client');
    const failure = new ApiError('boom', { code: 'VALIDATION_ERROR', status: 400 });
    api.post.mockRejectedValue(failure);

    await expect(authService.forgotPassword('nope')).rejects.toBe(failure);
  });

  it('returns the backend generic response unchanged without inventing an account-existence signal', async () => {
    // The backend answers identically for known and unknown addresses; the
    // service must not transform that constant result into an existence signal.
    api.post.mockResolvedValue(RESET_RESPONSE);

    const result = await authService.forgotPassword('cook@example.com');

    expect(result).toBe(RESET_RESPONSE);
  });
});
