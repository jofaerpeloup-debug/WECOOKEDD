// §30 — authService social-login methods.
//
// Proves the exact request contract and that googleLogin reuses the SAME
// establishSession() tail as password login (no duplicated token/session
// logic). client + tokenStore are mocked so no real network / SecureStore.
//
// authService no longer imports the Google native adapter (provider cleanup on
// logout is triggered from AuthContext), so no native mock is needed here.

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

describe('authService.getSocialChallenge', () => {
  it('POSTs /auth/social/challenge unauthenticated with body EXACTLY { provider: "google" }', async () => {
    api.post.mockResolvedValue({ challengeId: 'c1', nonce: 'n', expiresAt: 'later' });

    const data = await authService.getSocialChallenge();

    expect(api.post).toHaveBeenCalledWith('/auth/social/challenge', {
      auth: false,
      body: { provider: 'google' },
    });
    const { body } = api.post.mock.calls[0][1];
    expect(Object.keys(body)).toEqual(['provider']);
    expect(data).toEqual({ challengeId: 'c1', nonce: 'n', expiresAt: 'later' });
  });
});

describe('authService.googleLogin', () => {
  function backendReturnsSession() {
    api.post.mockResolvedValue({
      user: { id: 'u1', name: 'fallback' },
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
    });
    api.get.mockResolvedValue({ user: { id: 'u1', name: 'authoritative' } });
  }

  it('POSTs /auth/social/google unauthenticated with body EXACTLY { idToken, challengeId }', async () => {
    backendReturnsSession();

    await authService.googleLogin({ idToken: 'tok', challengeId: 'c1' });

    expect(api.post).toHaveBeenCalledWith('/auth/social/google', {
      auth: false,
      body: { idToken: 'tok', challengeId: 'c1' },
    });
    const { body } = api.post.mock.calls[0][1];
    expect(Object.keys(body).sort()).toEqual(['challengeId', 'idToken']);
  });

  it('flows through the shared establishSession tail: persists issued tokens and reads /users/me', async () => {
    backendReturnsSession();

    const user = await authService.googleLogin({ idToken: 'tok', challengeId: 'c1' });

    expect(tokenStore.setAccessToken).toHaveBeenCalledWith('access-1');
    expect(tokenStore.setRefreshToken).toHaveBeenCalledWith('refresh-1');
    expect(api.get).toHaveBeenCalledWith('/users/me');
    expect(user).toEqual({ id: 'u1', name: 'authoritative' });
  });

  it('uses the exact same token-persistence calls as password login (no duplicated logic)', async () => {
    // password login
    api.post.mockResolvedValue({
      user: { id: 'u1' },
      accessToken: 'A',
      refreshToken: 'R',
    });
    api.get.mockResolvedValue({ user: { id: 'u1' } });
    await authService.login({ email: 'a@b.co', password: 'pw' });
    const loginTokenCalls = [
      tokenStore.setAccessToken.mock.calls.length,
      tokenStore.setRefreshToken.mock.calls.length,
    ];

    jest.clearAllMocks();
    tokenStore.setRefreshToken.mockResolvedValue(true);

    api.post.mockResolvedValue({
      user: { id: 'u1' },
      accessToken: 'A',
      refreshToken: 'R',
    });
    api.get.mockResolvedValue({ user: { id: 'u1' } });
    await authService.googleLogin({ idToken: 't', challengeId: 'c' });

    expect([
      tokenStore.setAccessToken.mock.calls.length,
      tokenStore.setRefreshToken.mock.calls.length,
    ]).toEqual(loginTokenCalls);
  });
});