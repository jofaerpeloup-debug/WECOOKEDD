const dotenv = require('dotenv');
const { z } = require('zod');

const passwordResetUrlSchema = z
  .string()
  .url('PASSWORD_RESET_URL must be an absolute URL')
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  }, 'PASSWORD_RESET_URL must use http or https')
  .refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash;
  }, 'PASSWORD_RESET_URL must not contain credentials, a query, or a fragment');

const googleOAuthClientIdsSchema = z
  .string()
  .max(2048, 'GOOGLE_OAUTH_CLIENT_IDS must be 2048 characters or fewer')
  .transform((value) => [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))])
  .refine((items) => items.length > 0, 'GOOGLE_OAUTH_CLIENT_IDS must contain at least one client ID')
  .refine(
    (items) => items.every((item) => item.length <= 255),
    'Each GOOGLE_OAUTH_CLIENT_IDS entry must be 255 characters or fewer'
  );

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    MONGODB_URI: z
      .string()
      .min(1, 'MONGODB_URI is required')
      .refine(
        (value) => value.startsWith('mongodb://') || value.startsWith('mongodb+srv://'),
        'MONGODB_URI must start with mongodb:// or mongodb+srv://'
      ),
    CORS_ORIGINS: z.string().default(''),
    JWT_ACCESS_SECRET: z
      .string()
      .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters long'),
    JWT_ACCESS_TTL: z.string().min(1).default('15m'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
    RESEND_API_KEY: z.string().trim().min(1, 'RESEND_API_KEY is required'),
    EMAIL_FROM: z.string().trim().min(1, 'EMAIL_FROM is required').max(500),
    PASSWORD_RESET_URL: passwordResetUrlSchema,
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(60).default(30),
    GOOGLE_OAUTH_CLIENT_IDS: googleOAuthClientIdsSchema,
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && !value.PASSWORD_RESET_URL.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['PASSWORD_RESET_URL'],
        message: 'PASSWORD_RESET_URL must use https in production',
      });
    }
  });

const TEST_EMAIL_DEFAULTS = {
  RESEND_API_KEY: 'test-resend-api-key',
  EMAIL_FROM: 'WeCooked <no-reply@example.com>',
  PASSWORD_RESET_URL: 'http://localhost:5173/reset-password',
};

const TEST_GOOGLE_DEFAULTS = {
  GOOGLE_OAUTH_CLIENT_IDS: 'test-google-client-id.apps.googleusercontent.com',
};

/**
 * Pure validation function: takes a raw env-like object and returns a
 * normalized config, or throws a descriptive Error. Has no side effects,
 * so it can be unit tested without touching process.env or process.exit.
 */
function parseEnv(source) {
  // Automated tests never contact Resend. Supplying safe test-only defaults
  // keeps every isolated test file from needing to duplicate provider config,
  // while development/production still fail closed when configuration is absent.
  const normalizedSource =
    source.NODE_ENV === 'test'
      ? { ...TEST_EMAIL_DEFAULTS, ...TEST_GOOGLE_DEFAULTS, ...source }
      : source;
  const result = envSchema.safeParse(normalizedSource);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  const parsed = result.data;
  const corsOrigins = parsed.CORS_ORIGINS
    ? parsed.CORS_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    : [];

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    mongodbUri: parsed.MONGODB_URI,
    corsOrigins,
    jwtAccessSecret: parsed.JWT_ACCESS_SECRET,
    jwtAccessTtl: parsed.JWT_ACCESS_TTL,
    refreshTokenTtlDays: parsed.REFRESH_TOKEN_TTL_DAYS,
    bcryptRounds: parsed.BCRYPT_ROUNDS,
    resendApiKey: parsed.RESEND_API_KEY,
    emailFrom: parsed.EMAIL_FROM,
    passwordResetUrl: parsed.PASSWORD_RESET_URL,
    passwordResetTtlMinutes: parsed.PASSWORD_RESET_TTL_MINUTES,
    googleOAuthClientIds: parsed.GOOGLE_OAUTH_CLIENT_IDS,
  };
}

let cachedEnv;

/**
 * Loads .env (once) and validates process.env against envSchema, caching
 * the result. Not called merely by requiring this module — callers invoke
 * it explicitly, so importing this file has no side effects.
 */
function loadEnv() {
  if (!cachedEnv) {
    dotenv.config();
    cachedEnv = parseEnv(process.env);
  }
  return cachedEnv;
}

module.exports = { loadEnv, parseEnv };
