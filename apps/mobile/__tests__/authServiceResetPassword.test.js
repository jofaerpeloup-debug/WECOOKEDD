// Password reset COMPLETION step (backend reset-password already exists and
// is not being rebuilt here). Like forgotPassword, this is a plain public
// POST — the raw token is the credential, not the caller's session — so the
// contract pinned down here is as much about what it must NOT touch (the
// session) as about the request it sends. client + tokenStore are mocked so
// no real network / SecureStore is involved.

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
const RESET_RESPONSE = { passwordReset: true };

beforeEach(() => {
  jest.clearAllMocks();
  tokenStore.setAccessToken.mockReturnValue(undefined);
  tokenStore.setRefreshToken.mockResolvedValue(true);
  tokenStore.clearSession.mockResolvedValue(undefined);
});

describe('authService.resetPassword', () => {
  it('POSTs /auth/reset-password with body EXACTLY { token, newPassword }', async () => {
    api.post.mockResolvedValue(RESET_RESPONSE);

    await authService.resetPassword({ token: 'A'.repeat(43), newPassword: 'brand-new-secret' });

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/auth/reset-password', {
      auth: false,
      body: { token: 'A'.repeat(43), newPassword: 'brand-new-secret' },
    });
    const { body } = api.post.mock.calls[0][1];
    expect(Object.keys(body).sort()).toEqual(['newPassword', 'token']);
  });

  it('is unauthenticated (auth: false) — the token is the credential, not a session', async () => {
    api.post.mockResolvedValue(RESET_RESPONSE);

    await authService.resetPassword({ token: 'A'.repeat(43), newPassword: 'brand-new-secret' });

    const [path, opts] = api.post.mock.calls[0];
    expect(path).toBe('/auth/reset-password');
    expect(opts.auth).toBe(false);
    expect(Object.keys(opts).sort()).toEqual(['auth', 'body']);
  });

  it('touches no token or session state itself on success (the caller decides when to clear)', async () => {
    api.post.mockResolvedValue(RESET_RESPONSE);

    await authService.resetPassword({ token: 'A'.repeat(43), newPassword: 'brand-new-secret' });

    expect(tokenStore.setAccessToken).not.toHaveBeenCalled();
    expect(tokenStore.setRefreshToken).not.toHaveBeenCalled();
    expect(tokenStore.clearSession).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('propagates a rejection unchanged (invalid/expired/replayed token) without touching session state', async () => {
    const { ApiError } = require('../src/api/client');
    const failure = new ApiError('Password reset token is invalid or expired.', {
      code: 'AUTH_PASSWORD_RESET_TOKEN_INVALID',
      status: 400,
    });
    api.post.mockRejectedValue(failure);

    await expect(
      authService.resetPassword({ token: 'B'.repeat(43), newPassword: 'brand-new-secret' })
    ).rejects.toBe(failure);
    expect(tokenStore.clearSession).not.toHaveBeenCalled();
  });
});

describe('authService.clearLocalSession', () => {
  it('clears local token storage without calling any network endpoint', async () => {
    await authService.clearLocalSession();

    expect(tokenStore.clearSession).toHaveBeenCalledTimes(1);
    expect(api.post).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
  });
});
