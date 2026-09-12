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

const { api, ApiError } = require('../src/api/client');
const tokenStore = require('../src/api/tokenStore');
const authService = require('../src/api/authService');

const loginResponse = {
  user: { id: 'u1', name: 'Login response' },
  accessToken: 'access',
  refreshToken: 'refresh',
};

beforeEach(() => {
  jest.clearAllMocks();
  tokenStore.setAccessToken.mockReturnValue(undefined);
  tokenStore.setRefreshToken.mockResolvedValue(true);
  tokenStore.clearSession.mockResolvedValue(undefined);
  api.post.mockResolvedValue(loginResponse);
});

describe('authService session establishment identity fallback', () => {
  it('rejects and clears local state after a definitive current-user rejection', async () => {
    const rejection = new ApiError('session invalid', {
      code: 'AUTH_SESSION_INVALID',
      status: 401,
    });
    api.get.mockRejectedValue(rejection);

    await expect(authService.login({ email: 'cook@example.com', password: 'password' })).rejects.toBe(
      rejection
    );
    expect(tokenStore.clearSession).toHaveBeenCalledTimes(1);
  });

  it.each([
    new ApiError('offline', { kind: 'network' }),
    new ApiError('temporary backend failure', { status: 503 }),
  ])('uses the auth-response user only for a temporary read failure', async (failure) => {
    api.get.mockRejectedValue(failure);

    await expect(
      authService.login({ email: 'cook@example.com', password: 'password' })
    ).resolves.toEqual(loginResponse.user);
    expect(tokenStore.clearSession).not.toHaveBeenCalled();
  });
});
