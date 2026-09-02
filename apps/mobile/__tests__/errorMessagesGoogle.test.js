// §25 — safe user-facing messages for Google native + backend error codes.

import { ApiError } from '../src/api/client';
import { getAuthErrorMessage } from '../src/api/errorMessages';

describe('getAuthErrorMessage — native Google adapter codes (not ApiError)', () => {
  it.each([
    'GOOGLE_CANCELLED',
    'GOOGLE_IN_PROGRESS',
    'GOOGLE_NOT_CONFIGURED',
    'GOOGLE_UNAVAILABLE',
    'GOOGLE_PROVIDER_FAILED',
  ])('maps %s to a non-empty safe string', (code) => {
    const msg = getAuthErrorMessage({ name: 'GoogleSignInError', code });
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).not.toBe('Something went wrong. Please try again.');
  });
});

describe('getAuthErrorMessage — backend social codes', () => {
  const cases = {
    AUTH_SOCIAL_CHALLENGE_INVALID: /try again/i,
    AUTH_SOCIAL_CREDENTIAL_INVALID: /google account/i,
    AUTH_SOCIAL_LOGIN_UNAVAILABLE: /email and password/i,
    AUTH_SOCIAL_EMAIL_REQUIRED: /email/i,
    AUTH_PROVIDER_UNAVAILABLE: /unavailable/i,
  };

  for (const [code, pattern] of Object.entries(cases)) {
    it(`maps ${code} to its intended safe message`, () => {
      const err = new ApiError('RAW BACKEND DETAIL should never surface', { code, status: 400 });
      const msg = getAuthErrorMessage(err);
      expect(msg).toMatch(pattern);
      expect(msg).not.toMatch(/RAW BACKEND DETAIL/);
    });
  }

  it('AUTH_ACCOUNT_LINK_REQUIRED tells the user to use their WeCooked password, not a link screen', () => {
    const err = new ApiError('link', { code: 'AUTH_ACCOUNT_LINK_REQUIRED', status: 409 });
    const msg = getAuthErrorMessage(err);
    expect(msg).toMatch(/password/i);
    expect(msg).not.toMatch(/link/i);
  });

  it('still maps the shared AUTH_ACCOUNT_SUSPENDED / RATE_LIMIT_EXCEEDED codes', () => {
    expect(getAuthErrorMessage(new ApiError('x', { code: 'AUTH_ACCOUNT_SUSPENDED', status: 403 }))).toMatch(
      /suspended/i
    );
    expect(getAuthErrorMessage(new ApiError('x', { code: 'RATE_LIMIT_EXCEEDED', status: 429 }))).toMatch(
      /too many/i
    );
  });

  it('does not regress the existing password-login mapping', () => {
    expect(
      getAuthErrorMessage(new ApiError('x', { code: 'AUTH_INVALID_CREDENTIALS', status: 401 }))
    ).toMatch(/email or password/i);
  });
});