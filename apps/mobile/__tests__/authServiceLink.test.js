// B4.3A — authService Google account-linking methods.
//
// The locked invariant here is negative: linking is account management for an
// ALREADY authenticated user, so it must never run the session-establishment
// tail that login/register/googleLogin share. client + tokenStore are mocked so
// no real network / SecureStore.

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

const LINKED_USER = {
  id: 'u1',
  name: 'Ada',
  authIdentities: [{ provider: 'google', linkedAt: '2026-09-04T10:00:00.000Z' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  tokenStore.setAccessToken.mockReturnValue(undefined);
  tokenStore.setRefreshToken.mockResolvedValue(true);
  tokenStore.clearSession.mockResolvedValue(undefined);
});

describe('authService.getSocialLinkChallenge', () => {
  it('POSTs /auth/social/challenge/link AUTHENTICATED with body EXACTLY { provider: "google" }', async () => {
    api.post.mockResolvedValue({ challengeId: 'c1', nonce: 'n', expiresAt: 'later' });

    const data = await authService.getSocialLinkChallenge();

    expect(api.post).toHaveBeenCalledWith('/auth/social/challenge/link', {
      body: { provider: 'google' },
    });
    const opts = api.post.mock.calls[0][1];
    // `auth` is left at its default (true) — the bearer token is what binds the
    // challenge server-side.
    expect(opts.auth).toBeUndefined();
    expect(Object.keys(opts.body)).toEqual(['provider']);
    // The app never sends, and cannot choose, whose challenge this is.
    expect(opts.body).not.toHaveProperty('userId');
    expect(data).toEqual({ challengeId: 'c1', nonce: 'n', expiresAt: 'later' });
  });
});

describe('authService.linkGoogleAccount', () => {
  it('POSTs /auth/social/google/link with body EXACTLY { idToken, challengeId } and returns the updated user', async () => {
    api.post.mockResolvedValue({ user: LINKED_USER });

    const user = await authService.linkGoogleAccount({ idToken: 'tok', challengeId: 'c1' });

    expect(api.post).toHaveBeenCalledWith('/auth/social/google/link', {
      body: { idToken: 'tok', challengeId: 'c1' },
    });
    const { body } = api.post.mock.calls[0][1];
    expect(Object.keys(body).sort()).toEqual(['challengeId', 'idToken']);
    for (const forbidden of ['nonce', 'userId', 'email', 'sub', 'subject', 'role', 'status']) {
      expect(body).not.toHaveProperty(forbidden);
    }
    expect(user).toEqual(LINKED_USER);
  });

  it('never writes the access token', async () => {
    api.post.mockResolvedValue({ user: LINKED_USER });
    await authService.linkGoogleAccount({ idToken: 'tok', challengeId: 'c1' });
    expect(tokenStore.setAccessToken).not.toHaveBeenCalled();
  });

  it('never writes the refresh token', async () => {
    api.post.mockResolvedValue({ user: LINKED_USER });
    await authService.linkGoogleAccount({ idToken: 'tok', challengeId: 'c1' });
    expect(tokenStore.setRefreshToken).not.toHaveBeenCalled();
  });

  it('never runs establishSession: no /users/me re-read, no logout, no session clear', async () => {
    api.post.mockResolvedValue({ user: LINKED_USER });

    await authService.linkGoogleAccount({ idToken: 'tok', challengeId: 'c1' });

    // establishSession's observable fingerprint is a follow-up GET /users/me
    // and, on failure, POST /auth/logout + clearSession. None may happen.
    expect(api.get).not.toHaveBeenCalled();
    expect(tokenStore.clearSession).not.toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('touches no token state even when the refresh token store would fail', async () => {
    // A persistence failure is what tears a session down inside
    // establishSession. Linking never persists, so this must be irrelevant.
    tokenStore.setRefreshToken.mockResolvedValue(false);
    api.post.mockResolvedValue({ user: LINKED_USER });

    await expect(
      authService.linkGoogleAccount({ idToken: 'tok', challengeId: 'c1' })
    ).resolves.toEqual(LINKED_USER);
    expect(tokenStore.clearSession).not.toHaveBeenCalled();
  });

  it('propagates a backend link conflict without touching the session', async () => {
    const { ApiError } = require('../src/api/client');
    api.post.mockRejectedValue(
      new ApiError('conflict', { code: 'AUTH_SOCIAL_IDENTITY_IN_USE', status: 409 })
    );

    await expect(
      authService.linkGoogleAccount({ idToken: 'tok', challengeId: 'c1' })
    ).rejects.toMatchObject({ code: 'AUTH_SOCIAL_IDENTITY_IN_USE' });
    expect(tokenStore.setAccessToken).not.toHaveBeenCalled();
    expect(tokenStore.setRefreshToken).not.toHaveBeenCalled();
    expect(tokenStore.clearSession).not.toHaveBeenCalled();
  });
});
