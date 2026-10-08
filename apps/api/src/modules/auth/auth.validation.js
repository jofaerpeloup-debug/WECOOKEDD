const { z } = require('zod');
const {
  PASSWORD_MAX_UTF8_BYTES,
  EMAIL_MAX_CHARS,
  utf8ByteLength,
  validateNewPassword,
} = require('@wecooked/contracts');
const { PASSWORD_RESET_TOKEN_PATTERN } = require('../../shared/security/password-reset-token');
const {
  EMAIL_VERIFICATION_TOKEN_PATTERN,
} = require('../../shared/security/email-verification-token');
const { objectIdSchema } = require('../../shared/validation/object-id');

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Invalid email address.')
  .max(EMAIL_MAX_CHARS, `Email must be ${EMAIL_MAX_CHARS} characters or fewer.`);

const maxPasswordBytesRefinement = (value) =>
  utf8ByteLength(value) <= PASSWORD_MAX_UTF8_BYTES;
const maxPasswordBytesMessage = {
  message: `Password must be ${PASSWORD_MAX_UTF8_BYTES} UTF-8 bytes or fewer.`,
};

const newPasswordSchema = z.string().superRefine((value, context) => {
  for (const message of validateNewPassword(value)) {
    context.addIssue({ code: 'custom', message });
  }
});

// Login doesn't enforce the minimum-length policy (an existing account may
// predate it) but still must never pass more than bcrypt's 72-byte limit
// through to comparePassword.
const loginPasswordSchema = z
  .string()
  .min(1, 'Password is required.')
  .refine(maxPasswordBytesRefinement, maxPasswordBytesMessage);

// .strict() rejects unknown fields outright (e.g. role, status, passwordHash)
// instead of silently dropping them, so a malicious/careless extra field in
// the request body fails validation rather than being ignored.
const registerSchema = z.object({
  body: z
    .object({
      name: z
        .string()
        .trim()
        .min(1, 'Name is required.')
        .max(100, 'Name must be 100 characters or fewer.'),
      email: emailSchema,
      password: newPasswordSchema,
    })
    .strict(),
});

const loginSchema = z.object({
  body: z
    .object({
      email: emailSchema,
      password: loginPasswordSchema,
    })
    .strict(),
});

const refreshSchema = z.object({
  body: z
    .object({
      refreshToken: z.string().min(1, 'Refresh token is required.'),
    })
    .strict(),
});

// Authenticated self-service password change (POST /api/v1/auth/change-password).
// `currentPassword` reuses loginPasswordSchema: an existing password may predate
// the 8-character minimum, so only the byte cap is enforced — but it must never
// pass more than bcrypt's 72-byte limit through to comparePassword.
// `newPassword` reuses newPasswordSchema, so register / change / reset all
// share one composition, character-allowlist, and byte-length policy.
// .strict() rejects confirmPassword, email, userId, role, and every other extra
// key as a 400 VALIDATION_ERROR rather than silently dropping it.
const changePasswordSchema = z.object({
  body: z
    .object({
      currentPassword: loginPasswordSchema,
      newPassword: newPasswordSchema,
    })
    .strict(),
});

const forgotPasswordSchema = z.object({
  body: z.object({ email: emailSchema }).strict(),
});

const resetPasswordSchema = z.object({
  body: z
    .object({
      token: z.string().regex(PASSWORD_RESET_TOKEN_PATTERN, 'Invalid password reset token.'),
      newPassword: newPasswordSchema,
    })
    .strict(),
});

const verifyEmailSchema = z.object({
  body: z
    .object({
      token: z.string().regex(EMAIL_VERIFICATION_TOKEN_PATTERN, 'Invalid verification token.'),
    })
    .strict(),
});

const resendVerificationSchema = z.object({
  body: z.object({ email: emailSchema }).strict(),
});

const emailChangeSchema = z.object({
  body: z.object({ newEmail: emailSchema, currentPassword: loginPasswordSchema }).strict(),
});

const emailChangeCancelSchema = z.object({ body: z.object({}).strict() });

const emailChangeVerifySchema = z.object({
  // Token-shape failures deliberately reach the service so malformed, expired,
  // replayed, replaced, and cancelled credentials share one public error.
  body: z.object({ token: z.unknown().optional() }).strict(),
});

const deactivateSchema = z.object({
  body: z.object({ confirmation: z.literal('DEACTIVATE') }).strict(),
});

const socialChallengeSchema = z.object({
  body: z.object({ provider: z.literal('google') }).strict(),
});

const googleSocialSchema = z.object({
  body: z
    .object({
      idToken: z.string().min(1, 'Google ID token is required.').max(8192),
      challengeId: objectIdSchema,
    })
    .strict(),
});

module.exports = {
  registerSchema,
  loginSchema,
  refreshSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  socialChallengeSchema,
  googleSocialSchema,
  emailSchema,
  newPasswordSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  emailChangeSchema,
  emailChangeCancelSchema,
  emailChangeVerifySchema,
  deactivateSchema,
};
