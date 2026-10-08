const dotenv = require('dotenv');
const { z } = require('zod');

// WeCooked ships ONE consumer of these links today — the mobile app — whose
// app.json declares `"scheme": "wecooked"` unconditionally, for every build
// (dev client and production alike; there is no separate per-environment
// scheme). A `wecooked://verify-email` / `wecooked://reset-password` base URL
// is therefore not a "custom protocol someone might set by mistake" — it is
// this project's own verified, already-shipped mobile deep-link scheme, exactly
// as consumed by RootNavigator's `linking` config (apps/mobile/src/navigation/
// RootNavigator.js) — and is accepted in EVERY environment, production
// included. `http:`/`https:` remain for a possible future web landing page;
// production still requires `https:` specifically for that case (plain `http:`
// stays rejected in production). No other scheme is ever accepted, in any
// environment — this is an exact allow-list of three protocols, not "anything
// non-http".
const ALLOWED_AUTH_LINK_PROTOCOLS = Object.freeze(['http:', 'https:', 'wecooked:']);

// Shared by PASSWORD_RESET_URL and EMAIL_VERIFICATION_URL so the two env vars
// can never drift apart on what counts as a valid/safe base URL. Both are a
// FIXED landing target that the API appends a one-time token to at send time
// (see buildAuthLinkUrl in auth.service.js) — never a query or fragment of
// their own, and never carrying inline credentials.
function buildAuthLinkUrlSchema(envVarName) {
  return z
    .string()
    .url(`${envVarName} must be an absolute URL`)
    .refine(
      (value) => ALLOWED_AUTH_LINK_PROTOCOLS.includes(new URL(value).protocol),
      `${envVarName} must use http, https, or the wecooked mobile scheme`
    )
    .refine((value) => {
      const url = new URL(value);
      return !url.username && !url.password && !url.search && !url.hash;
    }, `${envVarName} must not contain credentials, a query, or a fragment`);
}

const passwordResetUrlSchema = buildAuthLinkUrlSchema('PASSWORD_RESET_URL');
const emailVerificationUrlSchema = buildAuthLinkUrlSchema('EMAIL_VERIFICATION_URL');
const emailChangeVerificationUrlSchema = buildAuthLinkUrlSchema('EMAIL_CHANGE_VERIFICATION_URL');

// Only a plain `http:` base is downgraded in production — `https:` already
// satisfies it and `wecooked:` was never an http(s) URL to begin with, so it
// is never subject to a TLS requirement in the first place.
function requiresHttpsUpgrade(value) {
  return new URL(value).protocol === 'http:';
}

const googleOAuthClientIdsSchema = z
  .string()
  .max(2048, 'GOOGLE_OAUTH_CLIENT_IDS must be 2048 characters or fewer')
  .transform((value) => [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))])
  .refine((items) => items.length > 0, 'GOOGLE_OAUTH_CLIENT_IDS must contain at least one client ID')
  .refine(
    (items) => items.every((item) => item.length <= 255),
    'Each GOOGLE_OAUTH_CLIENT_IDS entry must be 255 characters or fewer'
  );

function hasExplicitMongoDatabase(uri) {
  const schemeEnd = uri.indexOf('://');
  const pathStart = uri.indexOf('/', schemeEnd + 3);
  if (schemeEnd < 0 || pathStart < 0) {
    return false;
  }

  const encodedName = uri.slice(pathStart + 1).split(/[?#]/, 1)[0];
  if (!encodedName) {
    return false;
  }

  try {
    const name = decodeURIComponent(encodedName);
    return name.trim().length > 0 && !name.includes('/');
  } catch {
    return false;
  }
}

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
    BREVO_API_KEY: z.string().trim().min(1, 'BREVO_API_KEY is required'),
    EMAIL_FROM_ADDRESS: z
      .string()
      .trim()
      .max(254, 'EMAIL_FROM_ADDRESS must be 254 characters or fewer')
      .email('EMAIL_FROM_ADDRESS must be a valid email address'),
    EMAIL_FROM_NAME: z
      .string()
      .trim()
      .min(1, 'EMAIL_FROM_NAME must not be blank')
      .max(70, 'EMAIL_FROM_NAME must be 70 characters or fewer')
      .optional()
      .default('WeCooked'),
    PASSWORD_RESET_URL: passwordResetUrlSchema,
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(60).default(30),
    EMAIL_VERIFICATION_URL: emailVerificationUrlSchema,
    // Bounded 5 minutes .. 7 days; default 1440 (24 hours).
    EMAIL_VERIFICATION_TTL_MINUTES: z.coerce.number().int().min(5).max(10080).default(1440),
    EMAIL_CHANGE_VERIFICATION_URL: emailChangeVerificationUrlSchema,
    GOOGLE_OAUTH_CLIENT_IDS: googleOAuthClientIdsSchema,
    // Recipe uploads are optional. Partial or absent provider configuration
    // never prevents the API from booting; the upload endpoint checks that all
    // three values are present and otherwise returns UPLOADS_NOT_CONFIGURED.
    CLOUDINARY_CLOUD_NAME: z.string().trim().optional().default(''),
    CLOUDINARY_API_KEY: z.string().trim().optional().default(''),
    CLOUDINARY_API_SECRET: z.string().trim().optional().default(''),
    CLOUDINARY_RECIPE_FOLDER: z.string().trim().max(255).optional().default('wecooked/recipes'),
    CLOUDINARY_AVATAR_FOLDER: z.string().trim().max(255).optional().default('wecooked/avatars'),
    OPENAI_API_KEY: z.string().trim().optional().default(''),
    OPENAI_MODEL: z.string().trim().optional().default(''),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && !hasExplicitMongoDatabase(value.MONGODB_URI)) {
      ctx.addIssue({
        code: 'custom',
        path: ['MONGODB_URI'],
        message: 'MONGODB_URI must explicitly select a database in production',
      });
    }
    if (value.NODE_ENV === 'production' && requiresHttpsUpgrade(value.PASSWORD_RESET_URL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['PASSWORD_RESET_URL'],
        message: 'PASSWORD_RESET_URL must use https (or the wecooked mobile scheme) in production',
      });
    }
    if (value.NODE_ENV === 'production' && requiresHttpsUpgrade(value.EMAIL_VERIFICATION_URL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_VERIFICATION_URL'],
        message:
          'EMAIL_VERIFICATION_URL must use https (or the wecooked mobile scheme) in production',
      });
    }
    if (value.NODE_ENV === 'production' && requiresHttpsUpgrade(value.EMAIL_CHANGE_VERIFICATION_URL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_CHANGE_VERIFICATION_URL'],
        message:
          'EMAIL_CHANGE_VERIFICATION_URL must use https (or the wecooked mobile scheme) in production',
      });
    }
  });

const TEST_EMAIL_DEFAULTS = {
  BREVO_API_KEY: 'test-brevo-api-key',
  EMAIL_FROM_ADDRESS: 'no-reply@example.com',
  EMAIL_FROM_NAME: 'WeCooked',
  PASSWORD_RESET_URL: 'http://localhost:5173/reset-password',
  EMAIL_VERIFICATION_URL: 'http://localhost:5173/verify-email',
  EMAIL_CHANGE_VERIFICATION_URL: 'wecooked://verify-email-change',
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
  // Automated tests never contact Brevo. Supplying safe test-only defaults
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
    brevoApiKey: parsed.BREVO_API_KEY,
    emailFromAddress: parsed.EMAIL_FROM_ADDRESS,
    emailFromName: parsed.EMAIL_FROM_NAME,
    passwordResetUrl: parsed.PASSWORD_RESET_URL,
    passwordResetTtlMinutes: parsed.PASSWORD_RESET_TTL_MINUTES,
    emailVerificationUrl: parsed.EMAIL_VERIFICATION_URL,
    emailVerificationTtlMinutes: parsed.EMAIL_VERIFICATION_TTL_MINUTES,
    emailChangeVerificationUrl: parsed.EMAIL_CHANGE_VERIFICATION_URL,
    googleOAuthClientIds: parsed.GOOGLE_OAUTH_CLIENT_IDS,
    cloudinary: {
      cloudName: parsed.CLOUDINARY_CLOUD_NAME,
      apiKey: parsed.CLOUDINARY_API_KEY,
      apiSecret: parsed.CLOUDINARY_API_SECRET,
      recipeFolder: parsed.CLOUDINARY_RECIPE_FOLDER || 'wecooked/recipes',
      avatarFolder: parsed.CLOUDINARY_AVATAR_FOLDER || 'wecooked/avatars',
    },
    openai: {
      apiKey: parsed.OPENAI_API_KEY,
      model: parsed.OPENAI_MODEL,
    },
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
