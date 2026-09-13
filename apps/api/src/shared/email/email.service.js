const crypto = require('node:crypto');
const { loadEnv } = require('../../config/env');

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';
const REQUEST_TIMEOUT_MS = 5000;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function emailDeliveryError({ status, requestId } = {}) {
  const error = new Error('Transactional email delivery failed.');
  error.name = 'EmailDeliveryError';
  if (Number.isInteger(status)) {
    error.providerStatus = status;
  }
  if (requestId) {
    error.providerRequestId = requestId;
  }
  return error;
}

function buildPasswordResetEmail({ resetUrl, expiresInMinutes }) {
  const expiryText = `${expiresInMinutes} minutes`;
  const safeUrl = escapeHtml(resetUrl);
  const safeExpiry = escapeHtml(expiryText);

  return {
    subject: 'Reset your WeCooked password',
    text: [
      'WeCooked password reset',
      '',
      `Use this link to reset your password: ${resetUrl}`,
      `This link expires in ${expiryText}.`,
      '',
      'If you did not request a password reset, you can ignore this email.',
    ].join('\n'),
    html: [
      '<h1>WeCooked password reset</h1>',
      '<p>Use the link below to reset your password.</p>',
      `<p><a href="${safeUrl}">Reset your password</a></p>`,
      `<p>This link expires in ${safeExpiry}.</p>`,
      '<p>If you did not request a password reset, you can ignore this email.</p>',
    ].join(''),
  };
}

async function sendViaResend({ to, subject, text, html, idempotencyPrefix }) {
  const { resendApiKey, emailFrom } = loadEnv();

  let response;
  try {
    response = await fetch(RESEND_EMAILS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'wecooked-api/1.0',
        'Idempotency-Key': `${idempotencyPrefix}/${crypto.randomUUID()}`,
      },
      body: JSON.stringify({
        from: emailFrom,
        to: [to],
        subject,
        text,
        html,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw emailDeliveryError();
  }

  if (!response.ok) {
    throw emailDeliveryError({
      status: response.status,
      requestId: response.headers.get('x-request-id'),
    });
  }
}

async function sendPasswordResetEmail({ to, resetUrl, expiresInMinutes }) {
  const content = buildPasswordResetEmail({ resetUrl, expiresInMinutes });
  await sendViaResend({ to, ...content, idempotencyPrefix: 'password-reset' });
}

function buildVerificationEmail({ verifyUrl, expiresInMinutes }) {
  const expiryText =
    expiresInMinutes % 60 === 0
      ? `${expiresInMinutes / 60} hours`
      : `${expiresInMinutes} minutes`;
  const safeUrl = escapeHtml(verifyUrl);
  const safeExpiry = escapeHtml(expiryText);

  return {
    subject: 'Verify your WeCooked email address',
    text: [
      'Verify your WeCooked email',
      '',
      `Use this link to verify your email address: ${verifyUrl}`,
      `This link expires in ${expiryText}.`,
      '',
      'If you did not create a WeCooked account, you can ignore this email.',
    ].join('\n'),
    html: [
      '<h1>Verify your WeCooked email</h1>',
      '<p>Use the link below to verify your email address.</p>',
      `<p><a href="${safeUrl}">Verify your email</a></p>`,
      `<p>This link expires in ${safeExpiry}.</p>`,
      '<p>If you did not create a WeCooked account, you can ignore this email.</p>',
    ].join(''),
  };
}

async function sendVerificationEmail({ to, verifyUrl, expiresInMinutes }) {
  const content = buildVerificationEmail({ verifyUrl, expiresInMinutes });
  await sendViaResend({ to, ...content, idempotencyPrefix: 'verify-email' });
}

module.exports = {
  sendPasswordResetEmail,
  buildPasswordResetEmail,
  sendVerificationEmail,
  buildVerificationEmail,
};
