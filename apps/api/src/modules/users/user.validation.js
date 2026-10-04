const { z } = require('zod');
const { objectIdSchema } = require('../../shared/validation/object-id');
const { ROLES, STATUSES, COOKING_LEVELS } = require('./user.model');

// Explicit allow-list of list sort keys. Never a raw Mongo sort string — the
// service maps each value to a fixed sort object with a deterministic `_id`
// tiebreaker (see user.service.js SORT_MAP).
const SORT_VALUES = ['newest', 'oldest', 'nameAsc', 'nameDesc'];

const pageSchema = z.coerce.number().int().min(1).default(1);
const limitSchema = z.coerce.number().int().min(1).max(100).default(20);

// .strict() rejects any unknown query param outright (e.g. ?isActive, ?sortBy,
// ?limit[]) rather than silently ignoring it.
const listUsersSchema = z.object({
  query: z
    .object({
      search: z.string().trim().min(1).max(100).optional(),
      role: z.enum(ROLES, 'Invalid role.').optional(),
      status: z.enum(STATUSES, 'Invalid status.').optional(),
      sort: z.enum(SORT_VALUES, 'Invalid sort value.').default('newest'),
      page: pageSchema,
      limit: limitSchema,
    })
    .strict(),
});

// PATCH is a pure administrative-authority endpoint. `status` (active |
// suspended) is the ONLY writable field — it is required. `role` is deliberately
// NOT accepted: there is no generic runtime promote/demote capability (a second
// admin is never created through the application). A `role` key — like `name`,
// `email`, `password`, `passwordHash`, `emailVerified`, `preferences`,
// `allergies`, `authIdentities`, legacy `authProviders`, `createdAt`,
// `updatedAt`, `_id`/`id`, or any
// other field — is rejected by `.strict()` as a 400 VALIDATION_ERROR, never a
// silently-dropped key. `ROLES` is still imported above because `listUsersSchema`
// keeps `role` as a read-only GET filter.
const updateUserSchema = z.object({
  params: z.object({ userId: objectIdSchema }).strict(),
  body: z
    .object({
      status: z.enum(STATUSES, 'Invalid status.'),
    })
    .strict(),
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/users/me — self-profile mutation
// ---------------------------------------------------------------------------
// A pure self-profile endpoint: the ONLY writable fields are `name` and the
// three preference leaves. Distinct from updateUserSchema (admin-only status).
// Preference entries stay free-form strings — no controlled vocabulary. The
// caps below are an API-boundary policy only; the User schema itself remains a
// permissive [String] store, so the constants live here rather than in
// user.model.js. See docs/architecture/self-profile-backend-api.md.
const MAX_PREFERENCE_ENTRIES = 20;
const MAX_PREFERENCE_ENTRY_LENGTH = 50;
const MAX_SELF_NAME_LENGTH = 100;
const MAX_BIO_LENGTH = 500;

// Registration-compatible name semantics (see auth.validation.js): trim, 1..100.
// No internal-whitespace collapsing, no Unicode normalization — neither the
// model nor registration does either.
const selfNameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required.')
  .max(MAX_SELF_NAME_LENGTH, `Name must be ${MAX_SELF_NAME_LENGTH} characters or fewer.`);

const preferenceEntrySchema = z
  .string()
  .trim()
  .min(1, 'Preference entries cannot be empty.')
  .max(
    MAX_PREFERENCE_ENTRY_LENGTH,
    `Each preference entry must be ${MAX_PREFERENCE_ENTRY_LENGTH} characters or fewer.`
  );

// No .default([]) — an omitted array leaves the stored value untouched. A
// supplied array (including []) replaces that array wholesale. Duplicates are
// intentionally preserved: this endpoint stores exactly what the client sent,
// after per-entry trimming only.
const preferenceListSchema = z
  .array(preferenceEntrySchema)
  .max(
    MAX_PREFERENCE_ENTRIES,
    `A maximum of ${MAX_PREFERENCE_ENTRIES} preference entries is allowed.`
  );

// `enabled` is REQUIRED when `notifications` is present, so `{ notifications: {} }`
// is rejected natively. Presence is by key, never truthiness — `enabled: false`
// is a valid update.
const notificationsPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    push: z.boolean().optional(),
    email: z.boolean().optional(),
    suggestions: z.boolean().optional(),
    digest: z.boolean().optional(),
    reminders: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'notifications must include at least one supported field.',
  })
  .refine(
    (value) => value.enabled === undefined || value.push === undefined || value.enabled === value.push,
    { message: 'enabled and push must match when both are supplied.' }
  );

// .strict() rejects any unknown preference key. .refine() rejects a
// structurally-empty `{ preferences: {} }` no-op.
const preferencesPatchSchema = z
  .object({
    dietaryPreferences: preferenceListSchema.optional(),
    allergies: preferenceListSchema.optional(),
    notifications: notificationsPatchSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'preferences must include at least one field to update.',
  });

// .strict() on the body makes role, status, email, emailVerified, passwordHash,
// authIdentities, legacy authProviders, _id/id, createdAt/updatedAt — and every
// other key, including
// `$set` / `__proto__` — a 400 VALIDATION_ERROR rather than a silently-dropped
// key or a mass-assignment vector. The outer wrapper is deliberately NOT
// .strict(): the validate middleware always hands the schema { body, params,
// query }.
const updateCurrentUserSchema = z.object({
  body: z
    .object({
      name: selfNameSchema.optional(),
      bio: z.string().trim().max(MAX_BIO_LENGTH, `Bio must be ${MAX_BIO_LENGTH} characters or fewer.`).optional(),
      cookingLevel: z.enum(COOKING_LEVELS, 'Invalid cooking level.').optional(),
      preferences: preferencesPatchSchema.optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
      message: 'At least one field must be provided.',
    }),
});

module.exports = {
  listUsersSchema,
  updateUserSchema,
  updateCurrentUserSchema,
  SORT_VALUES,
  MAX_PREFERENCE_ENTRIES,
  MAX_PREFERENCE_ENTRY_LENGTH,
  MAX_BIO_LENGTH,
};
