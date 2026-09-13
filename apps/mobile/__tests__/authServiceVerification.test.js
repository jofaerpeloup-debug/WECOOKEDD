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

const { api } = require('../src/api/client');
const tokenStore = require('../src/api/tokenStore');
const authService = require('../src/api/authService');

beforeEach(() => {
  jest.clearAllMocks();
  tokenStore.setAccessToken.mockReturnValue(undefined);
  tokenStore.setRefreshToken.mockResolvedValue(true);
  tokenStore.clearSession.mockResolvedValue(undefined);
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
