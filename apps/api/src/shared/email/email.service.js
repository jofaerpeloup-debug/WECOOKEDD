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

async function sendPasswordResetEmail({ to, resetUrl, expiresInMinutes }) {
  const { resendApiKey, emailFrom } = loadEnv();
  const content = buildPasswordResetEmail({ resetUrl, expiresInMinutes });

  let response;
  try {
    response = await fetch(RESEND_EMAILS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'wecooked-api/1.0',
        'Idempotency-Key': `password-reset/${crypto.randomUUID()}`,
      },
      body: JSON.stringify({
        from: emailFrom,
        to: [to],
        subject: content.subject,
        text: content.text,
        html: content.html,
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

module.exports = { sendPasswordResetEmail, buildPasswordResetEmail };
