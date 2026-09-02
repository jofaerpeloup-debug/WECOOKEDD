// §19 / §30 — proves the shared API client only runs the refresh+retry for
// `auth: true` calls. A public Google-login 401 (AUTH_SOCIAL_CREDENTIAL_INVALID
// on an `auth: false` call) must NOT trigger an irrelevant WeCooked refresh.
//
// Uses the REAL client with a mocked global.fetch.

import { api, setAuthAdapter } from '../src/api/client';

const originalFetch = global.fetch;

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

afterEach(() => {
  global.fetch = originalFetch;
});

describe('shared client — refresh gating', () => {
  it('does NOT refresh or retry on a 401 from an auth:false request', async () => {
    const refreshAccessToken = jest.fn(async () => true);
    setAuthAdapter({ getAccessToken: () => 'stale', refreshAccessToken });

    global.fetch = jest.fn(async () =>
      jsonResponse(401, {
        success: false,
        error: { code: 'AUTH_SOCIAL_CREDENTIAL_INVALID', message: 'invalid' },
      })
    );

    await expect(
      api.post('/auth/social/google', { auth: false, body: { idToken: 't', challengeId: 'c' } })
    ).rejects.toMatchObject({ status: 401, code: 'AUTH_SOCIAL_CREDENTIAL_INVALID' });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it('still performs exactly one refresh+retry on a 401 from an auth:true request', async () => {
    const refreshAccessToken = jest.fn(async () => true);
    setAuthAdapter({ getAccessToken: () => 'token', refreshAccessToken });

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { success: false, error: { code: 'AUTH_TOKEN_INVALID' } }))
      .mockResolvedValueOnce(jsonResponse(200, { success: true, data: { ok: true } }));

    await expect(api.get('/users/me')).resolves.toEqual({ ok: true });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });
});