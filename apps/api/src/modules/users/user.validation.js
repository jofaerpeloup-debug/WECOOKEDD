const { z } = require('zod');
const { objectIdSchema } = require('../../shared/validation/object-id');
const { ROLES, STATUSES } = require('./user.model');

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

// PATCH is a pure administrative-authority endpoint: the only writable fields
// are role and status, both admin-only concepts. .strict() means every other
// field — name, email, password, passwordHash, emailVerified, preferences,
// allergies, authProviders, createdAt, updatedAt, _id/id — is a
// 400 VALIDATION_ERROR, not a silently-dropped key. At least one of role/status
// must be present.
const updateUserSchema = z.object({
  params: z.object({ userId: objectIdSchema }).strict(),
  body: z
    .object({
      role: z.enum(ROLES, 'Invalid role.').optional(),
      status: z.enum(STATUSES, 'Invalid status.').optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one of role or status must be provided.',
    }),
});

module.exports = { listUsersSchema, updateUserSchema, SORT_VALUES };
