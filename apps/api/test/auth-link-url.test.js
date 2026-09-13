process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAuthLinkUrl } = require('../src/modules/auth/auth.service');

test('appends the token as a QUERY param for the wecooked:// mobile scheme', () => {
  const url = buildAuthLinkUrl('wecooked://verify-email', 'A'.repeat(43));
  assert.equal(url, `wecooked://verify-email?token=${'A'.repeat(43)}`);
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('token'), 'A'.repeat(43));
  assert.equal(parsed.hash, '');
});

test('reset-password: appends the token as a QUERY param for wecooked://', () => {
  const url = buildAuthLinkUrl('wecooked://reset-password', 'B'.repeat(43));
  assert.equal(url, `wecooked://reset-password?token=${'B'.repeat(43)}`);
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('token'), 'B'.repeat(43));
  assert.equal(parsed.hash, '');
});

test('appends the token as a URL FRAGMENT for http/https bases (unchanged web behavior)', () => {
  const httpUrl = buildAuthLinkUrl('http://localhost:5173/reset-password', 'C'.repeat(43));
  assert.equal(new URL(httpUrl).hash, `#token=${'C'.repeat(43)}`);
  assert.equal(new URL(httpUrl).search, '');

  const httpsUrl = buildAuthLinkUrl('https://example.com/verify-email', 'D'.repeat(43));
  assert.equal(new URL(httpsUrl).hash, `#token=${'D'.repeat(43)}`);
  assert.equal(new URL(httpsUrl).search, '');
});

test('URL-encodes a token containing characters unsafe in a bare query/fragment', () => {
  // Base64url tokens never actually contain these, but the encoding step must
  // still be correct and lossless for any string handed to it.
  const weirdToken = 'a+b/c=d e';
  const wecookedUrl = buildAuthLinkUrl('wecooked://verify-email', weirdToken);
  assert.equal(new URL(wecookedUrl).searchParams.get('token'), weirdToken);

  const httpUrl = buildAuthLinkUrl('https://example.com/verify-email', weirdToken);
  assert.equal(
    new URLSearchParams(new URL(httpUrl).hash.slice(1)).get('token'),
    weirdToken
  );
});
