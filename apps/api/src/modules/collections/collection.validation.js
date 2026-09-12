const { z } = require('zod');
const { objectIdSchema } = require('../../shared/validation/object-id');
const { NAME_MAX_LENGTH, DESCRIPTION_MAX_LENGTH } = require('./collection.model');

const sortSchema = z.enum(['newest', 'oldest'], 'Invalid sort value.').default('newest');
const pageSchema = z.coerce.number().int().min(1).default(1);
const limitSchema = z.coerce.number().int().min(1).max(100).default(20);

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required.')
  .max(NAME_MAX_LENGTH, `Name must be ${NAME_MAX_LENGTH} characters or fewer.`);

const descriptionSchema = z
  .string()
  .trim()
  .max(DESCRIPTION_MAX_LENGTH, `Description must be ${DESCRIPTION_MAX_LENGTH} characters or fewer.`);

const collectionParamsSchema = z.object({
  params: z.object({ collectionId: objectIdSchema }).strict(),
});

const collectionRecipeParamsSchema = z.object({
  params: z.object({ collectionId: objectIdSchema, recipeId: objectIdSchema }).strict(),
});

const createCollectionSchema = z.object({
  body: z
    .object({
      name: nameSchema,
      description: descriptionSchema.optional(),
    })
    .strict(),
});

// Deliberately excludes userId/ownerId/createdAt/updatedAt/recipeIds — a
// PATCH can never touch ownership or membership, only the allowlisted
// name/description fields. Every other field is a 400 VALIDATION_ERROR via
// `.strict()`, never silently dropped.
const patchCollectionSchema = z.object({
  params: z.object({ collectionId: objectIdSchema }).strict(),
  body: z
    .object({
      name: nameSchema.optional(),
      description: descriptionSchema.optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field must be provided.',
    }),
});

const listCollectionRecipesSchema = z.object({
  params: z.object({ collectionId: objectIdSchema }).strict(),
  query: z
    .object({
      page: pageSchema,
      limit: limitSchema,
      sort: sortSchema,
    })
    .strict(),
});

// Body carries only recipeId — never userId/ownerId. Ownership of the target
// collection is derived solely from req.auth.userId (see collection.controller.js).
const addCollectionRecipeSchema = z.object({
  params: z.object({ collectionId: objectIdSchema }).strict(),
  body: z.object({ recipeId: objectIdSchema }).strict(),
});

module.exports = {
  collectionParamsSchema,
  collectionRecipeParamsSchema,
  createCollectionSchema,
  patchCollectionSchema,
  listCollectionRecipesSchema,
  addCollectionRecipeSchema,
};
