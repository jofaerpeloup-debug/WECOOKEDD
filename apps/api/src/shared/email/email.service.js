const crypto = require('node:crypto');
const { loadEnv } = require('../../config/env');
const { buildPasswordResetEmail, buildVerificationEmail } = require('./email.templates');

const BREVO_EMAILS_URL = 'https://api.brevo.com/v3/smtp/email';
const REQUEST_TIMEOUT_MS = 5000;

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

async function sendViaBrevo({ to, subject, text, html }) {
  const { brevoApiKey, emailFromAddress, emailFromName } = loadEnv();

  let response;
  try {
    response = await fetch(BREVO_EMAILS_URL, {
      method: 'POST',
      headers: {
        'api-key': brevoApiKey,
        accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'wecooked-api/1.0',
      },
      body: JSON.stringify({
        sender: { name: emailFromName, email: emailFromAddress },
        to: [{ email: to }],
        subject,
        textContent: text,
        htmlContent: html,
        headers: { idempotencyKey: crypto.randomUUID() },
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
  await sendViaBrevo({ to, ...content });
}

async function sendVerificationEmail({ to, verifyUrl, expiresInMinutes }) {
  const content = buildVerificationEmail({ verifyUrl, expiresInMinutes });
  await sendViaBrevo({ to, ...content });
}

module.exports = {
  sendPasswordResetEmail,
  buildPasswordResetEmail,
  sendVerificationEmail,
  buildVerificationEmail,
};
