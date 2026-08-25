const dotenv = require('dotenv');
const { z } = require('zod');

const envSchema = z.object({
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
});

/**
 * Pure validation function: takes a raw env-like object and returns a
 * normalized config, or throws a descriptive Error. Has no side effects,
 * so it can be unit tested without touching process.env or process.exit.
 */
function parseEnv(source) {
  const result = envSchema.safeParse(source);

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
