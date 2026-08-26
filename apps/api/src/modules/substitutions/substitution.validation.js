const { z } = require('zod');
const { objectIdSchema } = require('../../shared/validation/object-id');
const { MAX_CONTEXTS, MAX_CONTEXT_LENGTH, MAX_NOTES_LENGTH } = require('./substitution.model');

const ratioAmountSchema = z
  .number()
  .finite('Ratio amounts must be finite numbers.')
  .positive('Ratio amounts must be greater than zero.');

const ratioBodySchema = z
  .object({
    sourceAmount: ratioAmountSchema,
    substituteAmount: ratioAmountSchema,
  })
  .strict();

const contextItemSchema = z
  .string()
  .trim()
  .min(1, 'Context cannot be empty.')
  .max(MAX_CONTEXT_LENGTH, `Each context must be ${MAX_CONTEXT_LENGTH} characters or fewer.`);

// No .default([]) — see the identical note in ingredient.validation.js;
// create opts into the default, patch does not so an omitted key never
// resets stored contexts.
const contextsArraySchema = z
  .array(contextItemSchema)
  .max(MAX_CONTEXTS, `A maximum of ${MAX_CONTEXTS} contexts is allowed.`);

const notesSchema = z
  .string()
  .trim()
  .max(MAX_NOTES_LENGTH, `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`);

const statusSchema = z.enum(['active', 'inactive', 'all'], 'Invalid status.').default('active');
const sortSchema = z.enum(['newest', 'oldest'], 'Invalid sort value.').default('newest');
const pageSchema = z.coerce.number().int().min(1).default(1);
const limitSchema = z.coerce.number().int().min(1).max(100).default(20);

const substitutionParamsSchema = z.object({
  params: z.object({ substitutionId: objectIdSchema }).strict(),
});

const listSubstitutionsSchema = z.object({
  query: z
    .object({
      sourceIngredientId: objectIdSchema.optional(),
      substituteIngredientId: objectIdSchema.optional(),
      context: z.string().trim().min(1).max(MAX_CONTEXT_LENGTH).optional(),
      status: statusSchema,
      page: pageSchema,
      limit: limitSchema,
      sort: sortSchema,
    })
    .strict(),
});

const createSubstitutionSchema = z.object({
  body: z
    .object({
      sourceIngredientId: objectIdSchema,
      substituteIngredientId: objectIdSchema,
      ratio: ratioBodySchema,
      contexts: contextsArraySchema.default([]),
      notes: notesSchema.optional(),
    })
    .strict()
    .refine(
      (body) => body.sourceIngredientId !== body.substituteIngredientId,
      {
        message: 'sourceIngredientId and substituteIngredientId must be different.',
        path: ['substituteIngredientId'],
      }
    ),
});

const updateSubstitutionSchema = z.object({
  params: z.object({ substitutionId: objectIdSchema }).strict(),
  body: z
    .object({
      sourceIngredientId: objectIdSchema.optional(),
      substituteIngredientId: objectIdSchema.optional(),
      ratio: ratioBodySchema.optional(),
      contexts: contextsArraySchema.optional(),
      notes: notesSchema.optional(),
      isActive: z.boolean().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field must be provided.',
    })
    .refine(
      (body) =>
        !(body.sourceIngredientId && body.substituteIngredientId) ||
        body.sourceIngredientId !== body.substituteIngredientId,
      {
        message: 'sourceIngredientId and substituteIngredientId must be different.',
        path: ['substituteIngredientId'],
      }
    ),
});

module.exports = {
  substitutionParamsSchema,
  listSubstitutionsSchema,
  createSubstitutionSchema,
  updateSubstitutionSchema,
};