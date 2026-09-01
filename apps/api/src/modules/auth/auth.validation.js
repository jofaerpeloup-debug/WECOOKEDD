const { z } = require('zod');
const { MAX_PASSWORD_BYTES } = require('../../shared/security/password');

const emailSchema = z.string().trim().toLowerCase().email('Invalid email address.');

const maxPasswordBytesRefinement = (value) =>
  Buffer.byteLength(value, 'utf8') <= MAX_PASSWORD_BYTES;
const maxPasswordBytesMessage = { message: `Password must not exceed ${MAX_PASSWORD_BYTES} bytes.` };

const newPasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters long.')
  .refine(maxPasswordBytesRefinement, maxPasswordBytesMessage);

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
// `newPassword` reuses newPasswordSchema, so register / change / any future
// reset all share ONE policy (min 8, max 72 bytes, no complexity, no trim).
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

module.exports = { registerSchema, loginSchema, refreshSchema, changePasswordSchema };