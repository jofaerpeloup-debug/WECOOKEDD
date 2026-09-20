const { z } = require('zod');
const { objectIdSchema } = require('../../shared/validation/object-id');
const { EVENT_TYPES, TARGET_TYPES, OUTCOMES } = require('./audit-log.model');

// Express query values are strings, but its parser can also produce arrays or
// objects for repeated/bracketed keys. Only a missing value or a true scalar
// reaches the underlying schema; every composite shape fails validation.
function scalarNumber(schema) {
  return z.preprocess(
    (value) =>
      value === undefined || typeof value === 'string' || typeof value === 'number'
        ? value
        : Number.NaN,
    schema
  );
}

function optionalScalarString(schema) {
  return z.preprocess(
    (value) => (value === undefined || typeof value === 'string' ? value : null),
    schema.optional()
  );
}

const pageSchema = scalarNumber(z.coerce.number().int().min(1).default(1));
const limitSchema = scalarNumber(z.coerce.number().int().min(1).max(100).default(20));
const optionalObjectIdSchema = optionalScalarString(objectIdSchema);
const optionalTimestampSchema = optionalScalarString(
  z
    .string()
    .datetime({ offset: true, message: 'Expected an ISO-8601 timestamp with timezone.' })
    .transform((value) => new Date(value))
);

const listAuditLogsSchema = z.object({
  query: z
    .object({
      eventType: optionalScalarString(z.enum(EVENT_TYPES, 'Invalid audit event type.')),
      actorUserId: optionalObjectIdSchema,
      targetType: optionalScalarString(z.enum(TARGET_TYPES, 'Invalid audit target type.')),
      targetId: optionalObjectIdSchema,
      outcome: optionalScalarString(z.enum(OUTCOMES, 'Invalid audit outcome.')),
      from: optionalTimestampSchema,
      to: optionalTimestampSchema,
      page: pageSchema,
      limit: limitSchema,
    })
    .strict()
    .superRefine((query, ctx) => {
      if (query.from && query.to && query.from > query.to) {
        ctx.addIssue({
          code: 'custom',
          path: ['to'],
          message: 'to must be at or after from.',
        });
      }
    }),
});

module.exports = { listAuditLogsSchema };
