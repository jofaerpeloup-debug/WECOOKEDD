// B4.3A — Google account-link orchestration and auth-state reconciliation.
//
// Mocks isolate orchestration. They do NOT prove real Google token behavior.

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

const CURRENT_USER = { id: 'u1', name: 'Ada', authIdentities: [] };
const LINKED_USER = {
  id: 'u1',
  name: 'Ada',
  authIdentities: [{ provider: 'google', linkedAt: '2026-09-04T10:00:00.000Z' }],
};

let authService;
let nativeGoogleSignIn;
let flow;

beforeEach(() => {
  jest.resetModules();
  authService = require('../src/api/authService');
  nativeGoogleSignIn = require('../src/native/googleSignIn');
  flow = require('../src/auth/googleAuthFlow');
});

function linkHappyPath({ nonce = VALID_NONCE, challengeId = 'link_chal_1' } = {}) {
  authService.getSocialLinkChallenge.mockResolvedValue({ challengeId, nonce, expiresAt: 'later' });
  nativeGoogleSignIn.signIn.mockResolvedValue({ idToken: 'google.id.token' });
  authService.linkGoogleAccount.mockResolvedValue(LINKED_USER);
}

function loginHappyPath({ nonce = OTHER_NONCE, challengeId = 'login_chal_1' } = {}) {
  authService.getSocialChallenge.mockResolvedValue({ challengeId, nonce, expiresAt: 'later' });
  nativeGoogleSignIn.signIn.mockResolvedValue({ idToken: 'google.id.token' });
  authService.googleLogin.mockResolvedValue({ id: 'u1' });
}

describe('googleAuthFlow.linkGoogleAccount — happy path', () => {
  it('uses the LINK challenge endpoint, then native sign-in, then the link exchange', async () => {
    linkHappyPath();

    const user = await flow.linkGoogleAccount();

    expect(user).toEqual(LINKED_USER);
    expect(authService.getSocialLinkChallenge).toHaveBeenCalledTimes(1);
    // Never the login challenge, and never the login exchange.
    expect(authService.getSocialChallenge).not.toHaveBeenCalled();
    expect(authService.googleLogin).not.toHaveBeenCalled();

    const challengeOrder = authService.getSocialLinkChallenge.mock.invocationCallOrder[0];
    const nativeOrder = nativeGoogleSignIn.signIn.mock.invocationCallOrder[0];
    const exchangeOrder = authService.linkGoogleAccount.mock.invocationCallOrder[0];
    expect(challengeOrder).toBeLessThan(nativeOrder);
    expect(nativeOrder).toBeLessThan(exchangeOrder);
  });

  it('passes the EXACT link challenge nonce to native signIn and sends only { idToken, challengeId }', async () => {
    linkHappyPath({ challengeId: 'link_xyz' });

    await flow.linkGoogleAccount();

    expect(nativeGoogleSignIn.signIn).toHaveBeenCalledWith({ nonce: VALID_NONCE });
    expect(authService.linkGoogleAccount).toHaveBeenCalledWith({
      idToken: 'google.id.token',
      challengeId: 'link_xyz',
    });
    const body = authService.linkGoogleAccount.mock.calls[0][0];
    expect(Object.keys(body).sort()).toEqual(['challengeId', 'idToken']);
    for (const forbidden of ['nonce', 'userId', 'email', 'sub', 'subject']) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });

  it('rejects a malformed link challenge without calling native or the backend', async () => {
    authService.getSocialLinkChallenge.mockResolvedValue({ challengeId: 'c', nonce: 'too-short' });

    const err = await flow.linkGoogleAccount().catch((e) => e);
    expect(err.code).toBe('AUTH_SOCIAL_CHALLENGE_INVALID');
    expect(JSON.stringify(err) + err.message).not.toMatch(/too-short/);
    expect(nativeGoogleSignIn.signIn).not.toHaveBeenCalled();
    expect(authService.linkGoogleAccount).not.toHaveBeenCalled();
  });

  it('performs NO backend exchange when the user cancels the native operation', async () => {
    authService.getSocialLinkChallenge.mockResolvedValue({ challengeId: 'c', nonce: VALID_NONCE });
    nativeGoogleSignIn.signIn.mockRejectedValue({ code: 'GOOGLE_CANCELLED' });

    await expect(flow.linkGoogleAccount()).rejects.toMatchObject({ code: 'GOOGLE_CANCELLED' });
    expect(authService.linkGoogleAccount).not.toHaveBeenCalled();
    expect(flow.isInFlight()).toBe(false);
  });

  it('logs nothing on a full successful link', async () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
      jest.spyOn(console, m).mockImplementation(() => {})
    );
    linkHappyPath();
    await flow.linkGoogleAccount();
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe('googleAuthFlow — login and link share ONE native-operation slot', () => {
  it('duplicate link taps create exactly one challenge and one native operation', async () => {
    let resolveChallenge;
    authService.getSocialLinkChallenge.mockImplementation(
      () =>
        new Promise((res) => {
          resolveChallenge = res;
        })
    );
    nativeGoogleSignIn.signIn.mockResolvedValue({ idToken: 'tok' });
    authService.linkGoogleAccount.mockResolvedValue(LINKED_USER);

    const p1 = flow.linkGoogleAccount();
    const p2 = flow.linkGoogleAccount();
    expect(p1).toBe(p2);
    expect(flow.isInFlight()).toBe(true);

    resolveChallenge({ challengeId: 'c', nonce: VALID_NONCE });
    await Promise.all([p1, p2]);

    expect(authService.getSocialLinkChallenge).toHaveBeenCalledTimes(1);
    expect(nativeGoogleSignIn.signIn).toHaveBeenCalledTimes(1);
    expect(authService.linkGoogleAccount).toHaveBeenCalledTimes(1);
    expect(flow.isInFlight()).toBe(false);
  });

  it('a link attempt during an in-flight login runs no second native operation', async () => {
    let resolveChallenge;
    authService.getSocialChallenge.mockImplementation(
      () =>
        new Promise((res) => {
          resolveChallenge = res;
        })
    );
    nativeGoogleSignIn.signIn.mockResolvedValue({ idToken: 'tok' });
    authService.googleLogin.mockResolvedValue({ id: 'u1' });

    const login = flow.signInWithGoogle();
    const link = flow.linkGoogleAccount();

    // The link is refused rather than joined: it must never resolve with a
    // login's session switch.
    await expect(link).rejects.toMatchObject({ code: 'GOOGLE_IN_PROGRESS' });
    expect(authService.getSocialLinkChallenge).not.toHaveBeenCalled();

    resolveChallenge({ challengeId: 'c', nonce: VALID_NONCE });
    await login;

    expect(nativeGoogleSignIn.signIn).toHaveBeenCalledTimes(1);
    expect(authService.linkGoogleAccount).not.toHaveBeenCalled();
  });

  it('a login attempt during an in-flight link runs no second native operation', async () => {
    let resolveChallenge;
    authService.getSocialLinkChallenge.mockImplementation(
      () =>
        new Promise((res) => {
          resolveChallenge = res;
        })
    );
    nativeGoogleSignIn.signIn.mockResolvedValue({ idToken: 'tok' });
    authService.linkGoogleAccount.mockResolvedValue(LINKED_USER);

    const link = flow.linkGoogleAccount();
    await expect(flow.signInWithGoogle()).rejects.toMatchObject({ code: 'GOOGLE_IN_PROGRESS' });
    expect(authService.getSocialChallenge).not.toHaveBeenCalled();

    resolveChallenge({ challengeId: 'c', nonce: VALID_NONCE });
    await link;

    expect(nativeGoogleSignIn.signIn).toHaveBeenCalledTimes(1);
    expect(authService.googleLogin).not.toHaveBeenCalled();
  });

  it('releases the shared slot so the other mode can run once the first settles', async () => {
    loginHappyPath();
    await flow.signInWithGoogle();

    linkHappyPath();
    await flow.linkGoogleAccount();

    expect(nativeGoogleSignIn.signIn).toHaveBeenCalledTimes(2);
    expect(flow.isInFlight()).toBe(false);
  });

  it('releases the shared slot after a failed link', async () => {
    authService.getSocialLinkChallenge.mockRejectedValueOnce(new Error('boom'));
    await flow.linkGoogleAccount().catch(() => {});
    expect(flow.isInFlight()).toBe(false);

    loginHappyPath();
    await expect(flow.signInWithGoogle()).resolves.toEqual({ id: 'u1' });
  });
});

describe('AuthContext link reconciliation', () => {
  // The identity guard that AuthContext.syncUser (and therefore linkGoogle)
  // applies, asserted directly as a rule. The composed behaviour is covered by
  // the rendered-provider block below.
  let reconcileUser;
  beforeEach(() => {
    ({ reconcileUser } = require('../src/context/AuthContext'));
  });

  it('reconciles updated authIdentities into the SAME current user', () => {
    const next = reconcileUser(CURRENT_USER, LINKED_USER);
    expect(next).toBe(LINKED_USER);
    expect(next.id).toBe(CURRENT_USER.id);
    expect(next.authIdentities).toEqual([
      { provider: 'google', linkedAt: '2026-09-04T10:00:00.000Z' },
    ]);
  });

  it('never switches the active user, even if a payload for another user arrives', () => {
    const other = { id: 'u2', name: 'Someone else', authIdentities: [] };
    expect(reconcileUser(CURRENT_USER, other)).toBe(CURRENT_USER);
    expect(reconcileUser(CURRENT_USER, other).id).toBe('u1');
  });

  it('installs nothing when there is no current user (signed out mid-link)', () => {
    expect(reconcileUser(null, LINKED_USER)).toBe(null);
    expect(reconcileUser(CURRENT_USER, null)).toBe(CURRENT_USER);
    expect(reconcileUser(CURRENT_USER, undefined)).toBe(CURRENT_USER);
  });
});

describe('AuthContext.linkGoogle returns no user payload', () => {
  // The real AuthProvider is rendered with react-dom/server so the ACTUAL
  // linkGoogle closure runs (function components, useState/useCallback/
  // useContext all execute). Effects do not run in a server render, so this
  // exercises linkGoogle's return contract — not the provider's restore/state
  // lifecycle, which reconcileUser above covers.
  function captureContext() {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { AuthProvider, useAuth } = require('../src/context/AuthContext');

    let ctx = null;
    function Capture() {
      ctx = useAuth();
      return null;
    }
    renderToStaticMarkup(
      React.createElement(AuthProvider, null, React.createElement(Capture))
    );
    return ctx;
  }

  it('resolves with undefined on a successful link, through the real flow', async () => {
    linkHappyPath();
    const ctx = captureContext();

    await expect(ctx.linkGoogle()).resolves.toBeUndefined();
    // The whole chain still ran — this is not a no-op.
    expect(authService.linkGoogleAccount).toHaveBeenCalledTimes(1);
  });

  it('never hands back a payload syncUser refused (stale user switch mid-link)', async () => {
    // The backend answer belongs to a DIFFERENT user than the one this context
    // holds — exactly the sign-out / user-switch race. Returning it would let a
    // caller render a rejected object as "the current linked account".
    const staleOtherUser = {
      id: 'u2',
      name: 'Someone else',
      authIdentities: [{ provider: 'google', linkedAt: '2026-09-04T10:00:00.000Z' }],
    };
    authService.getSocialLinkChallenge.mockResolvedValue({
      challengeId: 'link_chal_1',
      nonce: VALID_NONCE,
    });
    nativeGoogleSignIn.signIn.mockResolvedValue({ idToken: 'google.id.token' });
    authService.linkGoogleAccount.mockResolvedValue(staleOtherUser);

    const ctx = captureContext();
    const result = await ctx.linkGoogle();

    expect(result).toBeUndefined();
    expect(result).not.toBe(staleOtherUser);
    expect(JSON.stringify(result ?? null)).not.toMatch(/u2|Someone else/);
  });

  it('propagates a link failure rather than resolving with a partial user', async () => {
    const { ApiError } = require('../src/api/client');
    authService.getSocialLinkChallenge.mockResolvedValue({
      challengeId: 'c',
      nonce: VALID_NONCE,
    });
    nativeGoogleSignIn.signIn.mockResolvedValue({ idToken: 'tok' });
    authService.linkGoogleAccount.mockRejectedValue(
      new ApiError('conflict', { code: 'AUTH_SOCIAL_IDENTITY_IN_USE', status: 409 })
    );

    const ctx = captureContext();
    await expect(ctx.linkGoogle()).rejects.toMatchObject({
      code: 'AUTH_SOCIAL_IDENTITY_IN_USE',
    });
  });
});

describe('safe link error messages', () => {
  let getAuthErrorMessage;
  let ApiError;
  beforeEach(() => {
    ({ getAuthErrorMessage } = require('../src/api/errorMessages'));
    ({ ApiError } = require('../src/api/client'));
  });

  it.each(['AUTH_SOCIAL_IDENTITY_IN_USE', 'AUTH_SOCIAL_PROVIDER_ALREADY_LINKED'])(
    'maps %s to a fixed safe string instead of the backend message',
    (code) => {
      const msg = getAuthErrorMessage(
        new ApiError('RAW BACKEND DETAIL should never surface', { code, status: 409 })
      );
      expect(msg).toMatch(/google account is already linked/i);
      expect(msg).not.toMatch(/RAW BACKEND DETAIL/);
      expect(msg).not.toBe('Something went wrong. Please try again.');
    }
  );

  it('distinguishes the two link conflicts without naming the other account', () => {
    const inUse = getAuthErrorMessage(
      new ApiError('x', { code: 'AUTH_SOCIAL_IDENTITY_IN_USE', status: 409 })
    );
    const already = getAuthErrorMessage(
      new ApiError('x', { code: 'AUTH_SOCIAL_PROVIDER_ALREADY_LINKED', status: 409 })
    );
    expect(inUse).not.toBe(already);
    for (const msg of [inUse, already]) {
      expect(msg).not.toMatch(/@|subject|sub\b|user id/i);
    }
  });

  it('maps the shared single-flight refusal to the existing safe in-progress string', () => {
    const msg = getAuthErrorMessage(
      new ApiError('internal detail', { code: 'GOOGLE_IN_PROGRESS', status: 409 })
    );
    expect(msg).toMatch(/already in progress/i);
    expect(msg).not.toMatch(/internal detail/);
  });
});
