const OUTER_BACKGROUND = '#FAF9F6';
const PRIMARY_COLOR = '#4A5D4E';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatExpiryDuration(expiresInMinutes) {
  if (expiresInMinutes % 60 === 0) {
    const hours = expiresInMinutes / 60;
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }

  return `${expiresInMinutes} ${expiresInMinutes === 1 ? 'minute' : 'minutes'}`;
}

function buildEmailHtml({ heading, purpose, actionLabel, actionUrl, fallbackCopy, expiryText, ignoreCopy }) {
  const safeUrl = escapeHtml(actionUrl);

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>',
    `<body style="margin:0;padding:0;background-color:${OUTER_BACKGROUND};font-family:Arial,Helvetica,sans-serif;color:#243028;">`,
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:${OUTER_BACKGROUND};">`,
    '<tr><td align="center" style="padding:32px 16px;">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background-color:#FFFFFF;border:1px solid #E4E0D8;border-radius:12px;">',
    '<tr><td style="padding:28px 32px 16px;font-size:24px;font-weight:700;line-height:1.2;color:#2F4235;">WeCooked</td></tr>',
    '<tr><td style="padding:8px 32px 32px;">',
    `<h1 style="margin:0 0 16px;font-size:28px;line-height:1.25;color:#243028;">${heading}</h1>`,
    `<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#465049;">${purpose}</p>`,
    '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;"><tr><td bgcolor="#4A5D4E" style="border-radius:6px;background-color:#4A5D4E;">',
    `<a href="${safeUrl}" style="display:inline-block;padding:14px 24px;color:#FFFFFF;text-decoration:none;font-size:16px;font-weight:700;line-height:1.2;">${actionLabel}</a>`,
    '</td></tr></table>',
    `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#5C665F;">${fallbackCopy}</p>`,
    `<p style="margin:0 0 24px;font-size:14px;line-height:1.6;word-break:break-all;"><a href="${safeUrl}" style="color:${PRIMARY_COLOR};text-decoration:underline;word-break:break-all;">${safeUrl}</a></p>`,
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#5C665F;">This link expires in ${expiryText}.</p>`,
    `<p style="margin:0;font-size:14px;line-height:1.6;color:#5C665F;">${ignoreCopy}</p>`,
    '</td></tr>',
    '<tr><td style="padding:20px 32px;border-top:1px solid #E4E0D8;font-size:12px;line-height:1.5;color:#707872;">WeCooked &mdash; thoughtful meals, made together.</td></tr>',
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('');
}

function buildVerificationEmail({ verifyUrl, expiresInMinutes }) {
  const expiryText = formatExpiryDuration(expiresInMinutes);
  const purpose = 'Welcome to WeCooked. Confirm your email address to finish setting up your account.';
  const ignoreCopy = 'If you did not create a WeCooked account, you can ignore this email.';

  return {
    subject: 'Verify your WeCooked email address',
    text: [
      'WeCooked',
      '',
      'Verify your email',
      '',
      purpose,
      '',
      `Verify Email Address: ${verifyUrl}`,
      `This link expires in ${expiryText}.`,
      '',
      ignoreCopy,
    ].join('\n'),
    html: buildEmailHtml({
      heading: 'Verify your email',
      purpose,
      actionLabel: 'Verify Email Address',
      actionUrl: verifyUrl,
      fallbackCopy: 'If the button does not work, use the verification link below.',
      expiryText,
      ignoreCopy,
    }),
  };
}

function buildPasswordResetEmail({ resetUrl, expiresInMinutes }) {
  const expiryText = formatExpiryDuration(expiresInMinutes);
  const purpose = 'We received a request to reset your WeCooked password.';
  const ignoreCopy = 'If you did not request this password reset, you can safely ignore this email.';

  return {
    subject: 'Reset your WeCooked password',
    text: [
      'WeCooked',
      '',
      'Reset your password',
      '',
      purpose,
      '',
      `Reset Password: ${resetUrl}`,
      `This link expires in ${expiryText}.`,
      '',
      ignoreCopy,
    ].join('\n'),
    html: buildEmailHtml({
      heading: 'Reset your password',
      purpose,
      actionLabel: 'Reset Password',
      actionUrl: resetUrl,
      fallbackCopy: 'If the button does not work, use the reset link below.',
      expiryText,
      ignoreCopy,
    }),
  };
}

module.exports = {
  buildPasswordResetEmail,
  buildVerificationEmail,
};
