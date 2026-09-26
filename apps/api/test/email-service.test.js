process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wecooked_test';
process.env.JWT_ACCESS_SECRET = 'test-suite-access-secret-at-least-32-chars-long';
process.env.BREVO_API_KEY = 'test-brevo-key';
process.env.EMAIL_FROM_ADDRESS = 'no-reply@example.com';
process.env.EMAIL_FROM_NAME = 'WeCooked Test';
process.env.PASSWORD_RESET_URL = 'http://localhost:5173/reset-password';

const test = require('node:test');
const assert = require('node:assert/strict');

const emailService = require('../src/shared/email/email.service');

test('sendPasswordResetEmail sends text/html through Brevo with safe transport headers', async (t) => {
  let request;
  let timeoutMs;
  const timeoutSignal = new AbortController().signal;
  t.mock.method(AbortSignal, 'timeout', (milliseconds) => {
    timeoutMs = milliseconds;
    return timeoutSignal;
  });
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

  assert.equal(request.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['api-key'], 'test-brevo-key');
  assert.equal(request.options.headers.accept, 'application/json');
  assert.equal(request.options.headers['Content-Type'], 'application/json');
  assert.equal(request.options.headers['User-Agent'], 'wecooked-api/1.0');
  assert.equal(timeoutMs, 5000);
  assert.equal(request.options.signal, timeoutSignal);
  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.sender, { name: 'WeCooked Test', email: 'no-reply@example.com' });
  assert.deepEqual(body.to, [{ email: 'ada@example.com' }]);
  assert.match(
    body.headers.idempotencyKey,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
  assert.equal(body.subject, 'Reset your WeCooked password');
  assert.match(body.textContent, new RegExp(resetUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(body.htmlContent, new RegExp(`href="${resetUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
});

test('sendVerificationEmail sends text/html through Brevo with safe transport headers', async (t) => {
  let request;
  let timeoutMs;
  const timeoutSignal = new AbortController().signal;
  t.mock.method(AbortSignal, 'timeout', (milliseconds) => {
    timeoutMs = milliseconds;
    return timeoutSignal;
  });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, headers: new Headers() };
  });

  const verifyUrl = `https://accounts.example/verify-email#token=${'A'.repeat(43)}`;
  await emailService.sendVerificationEmail({
    to: 'ada@example.com',
    verifyUrl,
    expiresInMinutes: 1440,
  });

  assert.equal(request.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['api-key'], 'test-brevo-key');
  assert.equal(request.options.headers.accept, 'application/json');
  assert.equal(request.options.headers['Content-Type'], 'application/json');
  assert.equal(request.options.headers['User-Agent'], 'wecooked-api/1.0');
  assert.equal(timeoutMs, 5000);
  assert.equal(request.options.signal, timeoutSignal);
  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.sender, { name: 'WeCooked Test', email: 'no-reply@example.com' });
  assert.deepEqual(body.to, [{ email: 'ada@example.com' }]);
  assert.match(
    body.headers.idempotencyKey,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
  assert.equal(body.subject, 'Verify your WeCooked email address');
  assert.match(body.textContent, new RegExp(verifyUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(body.htmlContent, new RegExp(`href="${verifyUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
});

function assertSharedEmailPresentation({ content, actionUrl, heading, purpose, actionLabel, fallback, expiry, ignore }) {
  assert.ok(content.html.includes('<table role="presentation"'));
  assert.ok(content.html.includes('max-width:600px'));
  assert.ok(content.html.includes('#FAF9F6'));
  assert.ok(content.html.includes('#4A5D4E'));
  assert.ok(content.html.includes(`>${heading}</h1>`));
  assert.ok(content.html.includes(purpose));
  assert.ok(content.html.includes(`>${actionLabel}</a>`));
  assert.ok(content.html.includes(`href="${actionUrl}"`));
  assert.ok(content.html.includes(`>${actionUrl}</a>`));
  assert.ok(content.html.includes(fallback));
  assert.ok(content.html.includes(`This link expires in ${expiry}.`));
  assert.ok(content.html.includes(ignore));
  assert.ok(content.html.includes('>WeCooked</td>'));
  assert.ok(content.html.includes('WeCooked &mdash; thoughtful meals, made together.'));
  assert.equal(/<script\b/i.test(content.html), false);
  assert.equal(/<link\b[^>]*rel=["']?stylesheet/i.test(content.html), false);
  assert.ok(content.text.includes('WeCooked'));
  assert.ok(content.text.includes(heading));
  assert.ok(content.text.includes(purpose));
  assert.ok(content.text.includes(actionUrl));
  assert.ok(content.text.includes(`This link expires in ${expiry}.`));
  assert.ok(content.text.includes(ignore));
}

test('buildVerificationEmail provides complete branded verification content', () => {
  const verifyUrl = `https://accounts.example/verify-email#token=${'V'.repeat(43)}`;
  const content = emailService.buildVerificationEmail({ verifyUrl, expiresInMinutes: 1440 });

  assert.equal(content.subject, 'Verify your WeCooked email address');
  assertSharedEmailPresentation({
    content,
    actionUrl: verifyUrl,
    heading: 'Verify your email',
    purpose: 'Welcome to WeCooked. Confirm your email address to finish setting up your account.',
    actionLabel: 'Verify Email Address',
    fallback: 'If the button does not work, use the verification link below.',
    expiry: '24 hours',
    ignore: 'If you did not create a WeCooked account, you can ignore this email.',
  });
});

test('buildPasswordResetEmail provides complete branded reset content', () => {
  const resetUrl = `https://accounts.example/reset-password#token=${'R'.repeat(43)}`;
  const content = emailService.buildPasswordResetEmail({ resetUrl, expiresInMinutes: 30 });

  assert.equal(content.subject, 'Reset your WeCooked password');
  assertSharedEmailPresentation({
    content,
    actionUrl: resetUrl,
    heading: 'Reset your password',
    purpose: 'We received a request to reset your WeCooked password.',
    actionLabel: 'Reset Password',
    fallback: 'If the button does not work, use the reset link below.',
    expiry: '30 minutes',
    ignore: 'If you did not request this password reset, you can safely ignore this email.',
  });
});

test('email templates derive singular, plural, hourly, and configured expiry copy from minutes', () => {
  const cases = [
    [1, '1 minute'],
    [5, '5 minutes'],
    [60, '1 hour'],
    [120, '2 hours'],
    [75, '75 minutes'],
  ];

  for (const [expiresInMinutes, expected] of cases) {
    const verification = emailService.buildVerificationEmail({ verifyUrl: 'https://example.test/verify', expiresInMinutes });
    const reset = emailService.buildPasswordResetEmail({ resetUrl: 'https://example.test/reset', expiresInMinutes });
    assert.ok(verification.html.includes(`This link expires in ${expected}.`));
    assert.ok(verification.text.includes(`This link expires in ${expected}.`));
    assert.ok(reset.html.includes(`This link expires in ${expected}.`));
    assert.ok(reset.text.includes(`This link expires in ${expected}.`));
  }
});

test('email templates escape every HTML URL occurrence while preserving the plain-text URL', () => {
  const unsafeUrl = `https://example.test/action?one=1&two=<tag>&quote="double"&apos='single'`;
  const escapedUrl = 'https://example.test/action?one=1&amp;two=&lt;tag&gt;&amp;quote=&quot;double&quot;&amp;apos=&#39;single&#39;';

  for (const content of [
    emailService.buildVerificationEmail({ verifyUrl: unsafeUrl, expiresInMinutes: 5 }),
    emailService.buildPasswordResetEmail({ resetUrl: unsafeUrl, expiresInMinutes: 5 }),
  ]) {
    assert.ok(content.html.includes(`href="${escapedUrl}"`));
    assert.ok(content.html.includes(`>${escapedUrl}</a>`));
    assert.equal(content.html.includes(unsafeUrl), false);
    assert.equal(content.html.includes('<tag>'), false);
    assert.ok(content.text.includes(unsafeUrl));
    assert.equal(content.text.includes(escapedUrl), false);
  }
});

test('sendVerificationEmail converts network failures into an error without credentials', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('network failed with test-brevo-key');
  });

  await assert.rejects(
    () =>
      emailService.sendVerificationEmail({
        to: 'ada@example.com',
        verifyUrl: `https://accounts.example/verify-email#token=${'C'.repeat(43)}`,
        expiresInMinutes: 1440,
      }),
    (error) => {
      assert.equal(error.name, 'EmailDeliveryError');
      assert.equal(error.message, 'Transactional email delivery failed.');
      assert.equal(JSON.stringify(error).includes('test-brevo-key'), false);
      assert.equal(JSON.stringify(error).includes('ada@example.com'), false);
      return true;
    }
  );
});

test('sendVerificationEmail converts provider failures into a sanitized error', async (t) => {
  const sensitiveBody = 'SUPER_SECRET_PROVIDER_BODY';
  let textReads = 0;
  let jsonReads = 0;
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    status: 429,
    headers: new Headers({ 'x-request-id': 'safe-request-id' }),
    body: sensitiveBody,
    text: async () => {
      textReads += 1;
      return sensitiveBody;
    },
    json: async () => {
      jsonReads += 1;
      return { message: sensitiveBody };
    },
  }));

  await assert.rejects(
    () =>
      emailService.sendVerificationEmail({
        to: 'ada@example.com',
        verifyUrl: `https://accounts.example/verify-email#token=${'B'.repeat(43)}`,
        expiresInMinutes: 1440,
      }),
    (error) => {
      assert.equal(error.name, 'EmailDeliveryError');
      assert.equal(error.message, 'Transactional email delivery failed.');
      assert.equal(error.providerStatus, 429);
      assert.equal(error.providerRequestId, 'safe-request-id');
      assert.equal(textReads, 0);
      assert.equal(jsonReads, 0);
      assert.equal(error.cause, undefined);
      assert.equal(error.message.includes(sensitiveBody), false);
      assert.equal(JSON.stringify(error).includes(sensitiveBody), false);
      assert.equal(JSON.stringify(error).includes('ada@example.com'), false);
      assert.equal(JSON.stringify(error).includes('BBBB'), false);
      return true;
    }
  );
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
