process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.RESEND_API_KEY = 'test-resend-key';
process.env.EMAIL_FROM = 'WeCooked <no-reply@example.com>';
process.env.PASSWORD_RESET_URL = 'http://localhost:5173/reset-password';

const test = require('node:test');
const assert = require('node:assert/strict');

const emailService = require('../src/shared/email/email.service');

test('sendPasswordResetEmail sends text/html through Resend with safe transport headers', async (t) => {
  let request;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, headers: new Headers() };
  });

  const resetUrl = `https://accounts.example/reset-password#token=${'A'.repeat(43)}`;
  await emailService.sendPasswordResetEmail({
    to: 'ada@example.com',
    resetUrl,
    expiresInMinutes: 30,
  });

  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer test-resend-key');
  assert.equal(request.options.headers['User-Agent'], 'wecooked-api/1.0');
  assert.match(request.options.headers['Idempotency-Key'], /^password-reset\/[0-9a-f-]+$/);
  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.to, ['ada@example.com']);
  assert.equal(body.from, 'WeCooked <no-reply@example.com>');
  assert.ok(body.text.includes(resetUrl));
  assert.ok(body.html.includes('Reset your password'));
  assert.ok(body.text.includes('30 minutes'));
});

test('sendPasswordResetEmail converts provider failures into a sanitized error', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    status: 429,
    headers: new Headers({ 'x-request-id': 'safe-request-id' }),
  }));

  await assert.rejects(
    () =>
      emailService.sendPasswordResetEmail({
        to: 'ada@example.com',
        resetUrl: `https://accounts.example/reset-password#token=${'B'.repeat(43)}`,
        expiresInMinutes: 30,
      }),
    (error) => {
      assert.equal(error.name, 'EmailDeliveryError');
      assert.equal(error.providerStatus, 429);
      assert.equal(error.providerRequestId, 'safe-request-id');
      assert.equal(JSON.stringify(error).includes('ada@example.com'), false);
      assert.equal(JSON.stringify(error).includes('BBBB'), false);
      return true;
    }
  );
});
